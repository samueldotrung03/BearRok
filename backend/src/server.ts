import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { GrokBrain } from './agents/grokBrain.ts';
import { ImageFinder } from './agents/images.ts';
import { SimBrain } from './agents/simBrain.ts';
import { AgentSystem } from './agents/system.ts';
import type { StudentMemory } from './agents/types.ts';
import { createApp } from './app.ts';
import { CareerGuides } from './careers/guide.ts';
import { firebaseVerifier, webConfig } from './auth.ts';
import { config, liveAvailable, provider } from './config.ts';
import { oauthSetup } from './googleOAuth.ts';
import { feedCatalog, mountOpportunities, openDatabase, OpportunityCatalog } from './opportunities/index.ts';
import { HARNESSES, modelLabel, onHarnessChange, tierModels, transport } from './harness.ts';
import { openStore } from './store/index.ts';
import { cached, writeRoadmap } from './roadmap.ts';
import { cachedSearch, writeSearch } from './search.ts';
import { UserFirestore } from './store/userFirestore.ts';
import { mountMetrics, trackUsage, UsageLog } from './usage.ts';

const store = await openStore();
// The agents run on the harness connected in Settings (harness.ts); with none they are simulated on
// sample data. A harness connected or changed later moves every student's agents over at once.
const feed = { feedTarget: config.feed.target, maxFillRuns: config.feed.maxFillRuns, images: new ImageFinder() };
function engine() {
  const via = transport();
  if (via === null) return { brain: new SimBrain({ speed: Number(process.env.SIM_SPEED ?? 0.6) }), opts: { managerStaggerMs: 900, concurrency: 8, maxJobs: 30, ...feed } };
  const p = provider();
  const live = { provider: p === 'simulated' ? undefined : p, ...feed } as const;
  return via === 'api'
    ? { brain: new GrokBrain(), opts: { ...live, concurrency: 8, maxJobs: 30, managerStaggerMs: 0 } }
    : // Each command-line call is a whole program, so far fewer run at once and a run is kept small.
      { brain: new GrokBrain(), opts: { ...live, concurrency: config.grokCli.concurrency, maxJobs: config.liveCli.maxJobs, managerStaggerMs: 600 } };
}
const systems = new Set<AgentSystem>();
const newSystem = (profile = {}) => {
  const { brain, opts } = engine();
  const system = new AgentSystem(brain, opts, profile);
  systems.add(system);
  return system;
};
onHarnessChange(() => {
  for (const system of systems) {
    const { brain, opts } = engine();
    system.useEngine(brain, opts);
  }
  console.log(`  postings: ${catalog ? `shared table in ${catalog.where}` : 'no shared table'}`);
  console.log(`  agents: ${agentsLine()}`);
});
const connection = () => {
  const via = transport();
  if (via === null) return { connected: false, mode: 'simulated' as const, detail: 'No model is connected. Connect Claude, ChatGPT or Grok in Settings.' };
  if (via === 'api') return { connected: true, mode: 'api' as const, detail: `Through the xAI API (${config.xaiModels.normal} and ${config.xaiModels.low}).` };
  const h = HARNESSES[via];
  return { connected: true, mode: via, detail: `Through ${h.cli}, the ${h.name} app for the command line, on the ${h.name} account signed in on this computer.` };
};
const agentsLine = () => {
  const via = transport();
  if (via === null) return 'simulated on sample data (no model connected; connect one in Settings)';
  if (via === 'api') return `live Grok API: ${config.xaiModels.normal} and ${config.xaiModels.low}`;
  const t = tierModels();
  return `live on ${HARNESSES[via].name} through ${HARNESSES[via].cli} (${modelLabel(t.normal)} and ${modelLabel(t.low)})`;
};
const verify = firebaseVerifier();
// On a student's own laptop there is no service account, so their memory goes to Firestore under
// their own sign-in. The guest student has no account and stays in the local file.
const tokens = new Map<string, string>();
const account = !config.firebaseServiceAccount && config.studentStore === 'account' && config.firebaseWeb.projectId ? new UserFirestore(config.firebaseWeb.projectId, (id) => tokens.get(id) ?? null) : null;
const isGuest = (id: string) => id.startsWith('guest:');
const memory = account
  ? {
      loadStudent: (id: string) => (isGuest(id) ? store : account).loadStudent(id),
      saveStudent: (id: string, m: StudentMemory) => (isGuest(id) ? store : account).saveStudent(id, m),
      deleteStudent: (id: string) => (isGuest(id) ? store : account).deleteStudent(id),
    }
  : store;
// The shared opportunities table: every posting the agents keep for any student, once, under its
// link. The backend runs without it when the database cannot be opened.
const off = (what: string) => (e: unknown) => {
  console.error(`${what} is off: ${e instanceof Error ? e.message : e}`);
  return null;
};
const database = config.opportunitiesDb.off ? null : await openDatabase(config.opportunitiesDb.url, config.opportunitiesDb.dir).catch(off('the shared database'));
const catalog = database ? await OpportunityCatalog.open(database).catch(off('shared opportunities table')) : null;
// Usage tracking: what students do, under a code that is not their account id, in the same database.
const usage = database && !config.usage.off ? await UsageLog.open(database).catch(off('usage tracking')) : null;
const withCatalog = catalog ? feedCatalog(memory, catalog) : memory;
const remembered = usage ? trackUsage(withCatalog, usage) : withCatalog;
// A Google connection (account, Calendar, Sheets) needs a "Desktop app" OAuth client:
// GOOGLE_OAUTH_CLIENT_FILE, or GOOGLE_OAUTH_CLIENT_ID and _SECRET. Without one, Settings says what
// to set and offers nothing Google. Google sends the student back to the loopback address on this
// port (a Desktop app client accepts any port); GOOGLE_OAUTH_REDIRECT_BASE overrides it.
const { client: oauthClient, problem: googleProblem } = oauthSetup(process.env);
const redirectBase = process.env.GOOGLE_OAUTH_REDIRECT_BASE?.trim().replace(/\/+$/, '') || `http://127.0.0.1:${config.port}`;
const careers = new CareerGuides();
// Career guide parts a restart stopped are picked up again (or stay marked, for the student to retry).
const resumed = careers.resume();
if (resumed.length) console.log(`career guides: picked up ${resumed.join(', ')} after the restart`);
const { app } = createApp(store, {}, {
  memory: remembered,
  google: oauthClient ? { client: oauthClient, redirectBase } : null,
  googleProblem,
  onToken: (uid, token) => {
    tokens.set(uid, token);
    usage?.visit(uid);
  },
  demo: newSystem(),
  // A student who signs in gets their own agents, named from their Google name or, for email sign-in, the part before the @.
  forUser: (user) => {
    const name = user.name?.split(' ')[0] ?? user.email?.split('@')[0];
    return newSystem(name ? { name } : {});
  },
  verify,
  webConfig: webConfig(),
  // Both writers check for a connected model on every request.
  roadmap: cached(writeRoadmap),
  search: cachedSearch(writeSearch),
  live: liveAvailable,
  grok: connection,
}, careers, { activityFile: process.env.ACTIVITY_FILE ?? join(dirname(config.localDataFile), 'agent-activity.json') });

if (catalog) mountOpportunities(app, catalog);
if (usage) mountMetrics(app, usage, config.usage.token);

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`backend listening on http://localhost:${port}`);
  console.log(`  store:  ${store.kind === 'firestore' ? 'Firestore' : account ? `Firestore under each student's own sign-in; guests in a local file (${config.localDataFile})` : `local file (${config.localDataFile})`}`);
  console.log(`  postings: ${catalog ? `shared table in ${catalog.where}` : 'no shared table'}`);
  console.log(`  usage:  ${usage ? `recorded${config.usage.token ? ', numbers at /api/metrics' : '; set METRICS_TOKEN to read the numbers at /api/metrics'}` : 'not recorded'}`);
  console.log(`  agents: ${agentsLine()}`);
  console.log(`  google: ${oauthClient ? `OAuth client set; Google sends students back to ${redirectBase}/auth/google/callback` : (googleProblem ?? 'not set up (set GOOGLE_OAUTH_CLIENT_FILE, or GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET)')}`);
  console.log(`  sign-in: ${verify ? `Google and email, Firebase project ${config.firebaseWeb.projectId}` : 'off (set FIREBASE_WEB_API_KEY and FIREBASE_PROJECT_ID)'}`);
  console.log(`  watch:  http://localhost:${port}/`);
});
