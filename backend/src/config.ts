import { fileURLToPath } from 'node:url';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  xaiApiKey: env.XAI_API_KEY?.trim() || null,
  xaiBaseUrl: env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
  xaiModel: env.XAI_MODEL ?? 'grok-4.7',
  /**
   * One model per tier of the agent system.
   * normal: master agent, search managers, validation agents, presentation manager. low: the worker fleet.
   * high: not assigned to any level at the moment.
   */
  xaiModels: {
    high: env.XAI_MODEL_HIGH ?? env.XAI_MODEL ?? 'grok-4.7',
    normal: env.XAI_MODEL_NORMAL ?? 'grok-4.5',
    low: env.XAI_MODEL_LOW ?? 'grok-4.3',
  },
  /** The Claude harness (claudeCli.ts). Its models are in harness.ts. */
  claudeCli: {
    timeoutMs: Number(env.CLAUDE_CLI_TIMEOUT_MS ?? 240_000),
    /** low, medium, high, xhigh or max, passed to the CLI as --effort. Unset leaves the CLI's own default. */
    effort: env.CLAUDE_EFFORT || undefined,
  },
  /** With a CLI each call is a whole program, so a live run is kept small enough to finish in a few minutes. */
  liveCli: { maxJobs: Number(env.LIVE_MAX_JOBS ?? 12) },
  /** The feed should hold at least `target` cards; the agents search again, up to `maxFillRuns` times in a row, until it does. */
  feed: { target: Number(env.FEED_MIN ?? 12), maxFillRuns: Number(env.FEED_FILL_MAX_RUNS ?? 4) },
  /** The ChatGPT harness (codexCli.ts). Its models are in harness.ts. */
  codexCli: {
    timeoutMs: Number(env.CODEX_CLI_TIMEOUT_MS ?? 240_000),
  },
  /** The Grok harness (grokCli.ts). Its models are in harness.ts. */
  grokCli: {
    /** Let the CLI use its tools without asking. Needed for web search if the CLI asks for approval. */
    alwaysApprove: env.GROK_CLI_ALWAYS_APPROVE === '1',
    timeoutMs: Number(env.GROK_CLI_TIMEOUT_MS ?? 240_000),
    /** How hard the CLI thinks between steps. Low keeps a search to well under a minute; set it empty for the CLI's own default. */
    effort: env.GROK_CLI_EFFORT === undefined ? 'low' : env.GROK_CLI_EFFORT || undefined,
    /** CLI processes running at once. Each one is a full program, so far fewer than API calls. */
    concurrency: Number(env.GROK_CLI_CONCURRENCY ?? 3),
  },
  /** Also give workers the X search tool. Off unless the account supports it. */
  xSearch: env.XAI_X_SEARCH === '1',
  /**
   * "account": keep each student's memory in Firestore using that student's own sign-in, with no
   * service account. This is how a copy of the app on a student's laptop stores it.
   */
  studentStore: env.STUDENT_STORE === 'account' ? ('account' as const) : null,
  /** Path to a Firebase service account JSON file. Without it, results stay in a local file. */
  firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT?.trim() || null,
  /**
   * Firebase web settings for Google sign-in (Project settings > Your apps > Web app).
   * Sign-in is on when apiKey and projectId are both set.
   */
  firebaseWeb: {
    apiKey: env.FIREBASE_WEB_API_KEY?.trim() || null,
    projectId: env.FIREBASE_PROJECT_ID?.trim() || null,
    authDomain: env.FIREBASE_AUTH_DOMAIN?.trim() || null,
  },
  maxResultsPerType: Number(env.MAX_RESULTS_PER_TYPE ?? 3),
  grokTimeoutMs: Number(env.GROK_TIMEOUT_MS ?? 120_000),
  /** Pause between prepared-mode stages so the dashboard can show progress. */
  preparedStepMs: Number(env.PREPARED_STEP_MS ?? 1200),
  // fileURLToPath, not URL.pathname: on Windows pathname gives "/C:/..." and file writes fail.
  localDataFile: env.LOCAL_DATA_FILE ?? fileURLToPath(new URL('../.data/store.json', import.meta.url)),
  /**
   * The shared opportunities table. DATABASE_URL is the connection string of a hosted Postgres
   * that every copy of the backend shares; without it the table is kept in a folder on this
   * computer. OPPORTUNITIES_DB=off switches the table off.
   */
  opportunitiesDb: {
    off: env.OPPORTUNITIES_DB === 'off',
    url: env.DATABASE_URL?.trim() || null,
    dir: env.OPPORTUNITIES_DB_DIR ?? fileURLToPath(new URL('../.data/opportunities-db', import.meta.url)),
  },
  /**
   * Usage tracking, kept in the same database as the opportunities table. USAGE_TRACKING=off stops
   * it. METRICS_TOKEN is the password the team sends to read the numbers at /api/metrics; without
   * one that page answers nobody.
   */
  usage: { off: env.USAGE_TRACKING === 'off', token: env.METRICS_TOKEN?.trim() || null },
  careerGuidesFile: env.CAREER_GUIDES_FILE ?? fileURLToPath(new URL('../.data/career-guides.json', import.meta.url)),
};

// Which harness the agents run on is decided at run time (harness.ts), not at start-up.
export { liveAvailable, provider, tierModels, modelLabel } from './harness.ts';
