// Career guides for the Career discovery page, run by the agent system's career discovery skill
// (src/agents/skills/careerDiscovery.ts). For any career a student types, the master plans the
// guide, one manager per part writes its researcher's job, the researchers run on the shared worker
// fleet, a validator per part checks what they found, and the presentation agent writes the summary
// over the posts. How to start is researched after the interviews, so every interview format gets a
// step that prepares for it. "Add more" runs the same levels for one part, starting from the
// master's reading of what the student asked. Guides are kept and shared by every student; each
// student sees only their own asks.
//
// Each part is saved as soon as it is checked, and the researcher's answer is saved before its
// check starts, so a restart never loses finished work: on the next start the unfinished parts are
// picked up again (from the check, when the answer was already in) or marked with what stopped them.
// One part can be searched again on its own. Every call has the transport's time limit, and a call
// that times out or answers badly is tried once more before its part is marked failed with the
// reason. An empty Grok balance (HTTP 402) stops the run at once and says so.
import { mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { config, liveAvailable, provider } from '../config.ts';
import { grokJson, type GrokTool } from '../grok.ts';
import { Fleet } from '../agents/fleet.ts';
import type { Job, JobKind } from '../agents/types.ts';
import { managerBrief, master, presentation, researcher, validator, type AgentCall } from '../agents/skills/careerDiscovery.ts';
import type { StudentContext } from '../agents/skills/index.ts';
import { BALANCE_MESSAGE, BalanceExhaustedError, isBalanceError } from '../quota.ts';
import { careerKey, keysOf, slugFor } from './names.ts';
import { simulatedAsk } from './simulated.ts';
import {
  mergeSection,
  SECTION_IDS,
  SECTION_NAMES,
  summarize,
  unpreparedFormats,
  type Failure,
  type Guide,
  type GuideAsk,
  type GuideEvent,
  type SectionData,
  type SectionId,
  type SectionState,
} from './schemas.ts';

export { mergeSection, SECTION_IDS, type Guide, type SectionId } from './schemas.ts';
export { careerKey, slugFor } from './names.ts';

/** One model call. The default goes through grok.ts (xAI API or Grok CLI), or the simulated agents. */
export type Ask = <S extends z.ZodType>(opts: { name: string; system: string; user: string; schema: S; tools?: GrokTool[]; model?: string; timeoutMs?: number }) => Promise<{ data: z.infer<S> }>;

export class CareerError extends Error {
  readonly status: 400 | 404 | 409 | 503;
  constructor(message: string, status: 400 | 404 | 409 | 503) {
    super(message);
    this.status = status;
  }
}

type Env = { live: () => boolean; provider: () => Guide['provider']; canSearchX: () => boolean };
type Options = {
  /** The time limit of one call. Defaults to the transport's: GROK_CLI_TIMEOUT_MS for the CLI, GROK_TIMEOUT_MS for the API. */
  timeoutMs?: number;
  /** Extra time past the limit before a call that never answers is given up on. The CLI ends its own run at the limit. */
  graceMs?: number;
};

/** A call that did not answer within its time limit. */
class CallTimeout extends Error {}

const emptySection = <T>(): SectionState<T> => ({ status: 'waiting', data: null, sample: false, error: null, added: null, failure: null, stage: null, mode: null, draft: null, unchecked: null, finishedAt: null });

/** The models behind each tier, for the transport in use. */
function tierModels(): { normal?: string; low?: string } {
  if (config.grokTransport === 'cli') return config.grokCli.models;
  return config.xaiModels;
}

const MAX_ACTIVITY = 80;
/** Two sentences of at most 25 words each, with a little room. */
const MAX_SUMMARY_WORDS = 60;
const GROK_ONLY =
  'Grok researched this guide, and your agents are simulated right now. It is kept as it is, so simulated examples never replace what Grok found. Connect Grok in Settings to search it again.';
/** What an "Add more" with no words of its own asks for. */
const DEFAULT_PROMPT = 'Find more of what this part covers.';
const CUT = 'A restart stopped this part before it finished.';

/** The fleet's job labels, as the activity log names each agent. */
const agentName = (section: SectionId, role: 'manager' | 'researcher' | 'validator') => `${SECTION_NAMES[section]} ${role}`;

/** The default model: Grok when it is connected, the simulated agents when it is not. */
const defaultAsk = (): Ask => {
  let sim: Ask | null = null;
  return ((opts) => (liveAvailable() ? grokJson(opts) : (sim ??= simulatedAsk())(opts))) as Ask;
};

export class CareerGuides {
  private guides = new Map<string, Guide>();
  private running = new Set<string>();
  private suggestions = new Map<string, string[]>();
  /** Parts a restart cut off, to pick up in resume(). */
  private cutOff = new Map<string, SectionId[]>();
  private readonly file: string | null;
  private readonly ask: Ask;
  private readonly env: Env;
  private readonly timeoutMs: number;
  private readonly graceMs: number;

  constructor(
    file: string | null = config.careerGuidesFile,
    ask: Ask = defaultAsk(),
    env: Env = {
      live: liveAvailable,
      provider,
      // Grok reads X. Without X search the stories are written as labelled samples.
      canSearchX: () => true,
    },
    opts: Options = {},
  ) {
    this.file = file;
    this.ask = ask;
    this.env = env;
    this.timeoutMs = opts.timeoutMs ?? (config.grokTransport === 'cli' ? config.grokCli.timeoutMs : config.grokTimeoutMs);
    this.graceMs = opts.graceMs ?? 15_000;
    this.load();
  }

  list(limit = 12): (Pick<Guide, 'slug' | 'title' | 'oneLine' | 'updatedAt' | 'status' | 'provider' | 'aliases'> & { query: string })[] {
    return [...this.guides.values()]
      .filter((g) => g.status === 'ready' || g.status === 'researching' || g.status === 'planning')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(({ slug, query, title, oneLine, updatedAt, status, provider, aliases }) => ({ slug, query, title, oneLine, updatedAt, status, provider, aliases }));
  }

  get(slug: string): Guide | null {
    return this.guides.get(slug) ?? null;
  }

  /** The guide for any name of a career: its slug, the words first typed, its title or an alias. */
  find(name: string): Guide | null {
    const exact = this.guides.get(name) ?? this.guides.get(slugFor(name));
    if (exact) return exact;
    const key = careerKey(name);
    if (!key) return null;
    return [...this.guides.values()].find((g) => keysOf(g).includes(key)) ?? null;
  }

  /** The guide as one student sees it: their own asks, and only the activity that is not someone else's ask. */
  view(slug: string, by: string | null): Guide | null {
    const guide = this.find(slug);
    if (!guide) return null;
    this.backfillSummary(guide);
    const mine = guide.asks.filter((a) => by && a.by === by);
    const ids = new Set(mine.map((a) => a.id));
    // Drafts stay on the server: the page shows only checked parts.
    const sections = Object.fromEntries(SECTION_IDS.map((id) => [id, { ...guide.sections[id], draft: null }])) as Guide['sections'];
    return { ...guide, sections, asks: mine, activity: guide.activity.filter((e) => e.ask === null || ids.has(e.ask)) };
  }

  /** Returns the kept guide, or starts researching one. A refresh keeps the old parts on screen until new ones arrive. */
  start(query: string, refresh = false): Guide {
    const clean = query.replace(/\s+/g, ' ').trim();
    if (clean.length < 2 || clean.length > 60) throw new CareerError('Type a career between 2 and 60 characters.', 400);
    const slug = slugFor(clean);
    if (!slug || !careerKey(clean)) throw new CareerError('Type a career using letters or numbers.', 400);

    const existing = this.find(clean);
    if (existing) this.remember(existing, clean);
    if (existing && this.busy(existing.slug)) return existing;
    // Grok's research is never replaced by simulated examples. Without Grok it is shown as it is.
    if (existing && existing.provider === 'grok' && this.env.provider() !== 'grok') {
      if (refresh) throw new CareerError(GROK_ONLY, 503);
      return existing;
    }
    // A guide the simulated agents wrote is kept only while the agents are simulated.
    const stale = existing?.provider === 'simulated' && this.env.provider() === 'grok';
    if (existing && existing.status === 'ready' && !refresh && !stale) return existing;

    const now = new Date().toISOString();
    const guide: Guide = existing
      ? { ...existing, status: 'planning', startedAt: now, updatedAt: now, error: null, failure: null, provider: this.env.provider(), activity: [] }
      : {
          slug,
          query: clean,
          title: clean,
          oneLine: null,
          field: null,
          angles: null,
          status: 'planning',
          provider: this.env.provider(),
          startedAt: now,
          updatedAt: now,
          error: null,
          failure: null,
          aliases: [],
          sections: { basics: emptySection(), voices: emptySection(), interview: emptySection(), start: emptySection() },
          asks: [],
          activity: [],
        };
    // Simulated examples are not kept over a refresh by Grok.
    for (const id of SECTION_IDS) {
      const keep = stale ? null : guide.sections[id].data;
      guide.sections[id] = { ...guide.sections[id], status: 'waiting', data: keep as never, error: null, added: null, failure: null, stage: null, mode: null, draft: null, unchecked: keep ? guide.sections[id].unchecked : null };
    }
    this.guides.set(guide.slug, guide);
    this.running.add(guide.slug);
    this.save();
    void this.research(guide).finally(() => this.running.delete(guide.slug));
    return guide;
  }

  /**
   * "Search again" on one part: its manager, researcher and validator run again for that part only.
   * The other parts are left as they are. A part whose researcher already answered (a restart or an
   * empty balance stopped its check) starts from the check.
   */
  retry(slug: string, id: string): Guide {
    const guide = this.find(slug);
    if (!guide) throw new CareerError('No guide for this career yet.', 404);
    if (!(SECTION_IDS as readonly string[]).includes(id)) throw new CareerError('There is no such part of the guide.', 404);
    const section = id as SectionId;
    const s = guide.sections[section];
    if (s.status === 'working' || this.running.has(`${guide.slug}/${section}`)) throw new CareerError('The agents are already working on this part. Wait until they finish.', 409);
    if (s.status === 'waiting' && this.running.has(guide.slug)) throw new CareerError('This part has not started yet. It is next in the search.', 409);
    if (guide.status === 'planning') throw new CareerError('The guide is still being planned. Wait a moment.', 409);
    this.assertCanRun(guide);

    const task = `${guide.slug}/${section}`;
    this.running.add(task);
    const fromDraft = s.draft !== null;
    if (guide.failure === 'balance') this.update(guide, { failure: null, error: null });
    this.setSection(guide, section, { status: 'working', mode: 'research', stage: fromDraft ? 'validating' : 'researching', error: null, failure: null });
    this.log(guide, 'Master', `Searching ${SECTION_NAMES[section].toLowerCase()} again on its own`, 'info', null);
    void this.retryPart(guide, section, fromDraft).finally(() => this.running.delete(task));
    return guide;
  }

  /**
   * "Add more" on one part, with what the student asked. It runs the same levels as a first search,
   * for this part only: the master reads the request, the part's manager writes the job, the
   * researcher looks, the validator checks, and the presentation agent merges it in.
   */
  more(slug: string, id: string, request: { prompt?: string; by?: string; student?: StudentContext | null } = {}): { guide: Guide; ask: GuideAsk } {
    const guide = this.find(slug);
    if (!guide) throw new CareerError('No guide for this career yet.', 404);
    if (!(SECTION_IDS as readonly string[]).includes(id)) throw new CareerError('There is no such part of the guide.', 404);
    const section = id as SectionId;
    if (this.running.has(guide.slug)) throw new CareerError('The guide is still being researched. Wait until it is ready.', 409);
    if (this.running.has(`${guide.slug}/${section}`) || guide.sections[section].status === 'working') throw new CareerError('The agents are already working on this part. Wait until they finish.', 409);
    if (!guide.sections[section].data) throw new CareerError('This part has nothing yet. Search this part again first.', 409);
    this.assertCanRun(guide);

    const prompt = (request.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || DEFAULT_PROMPT;
    const ask: GuideAsk = { id: `ask-${Date.now().toString(36)}-${guide.asks.length + 1}`, section, by: request.by || 'guest', prompt, at: new Date().toISOString(), status: 'working', added: 0, note: null };
    guide.asks.push(ask);
    const task = `${guide.slug}/${section}`;
    this.running.add(task);
    this.setSection(guide, section, { status: 'working', mode: 'more', stage: 'researching', error: null, failure: null });
    this.log(guide, 'Master', `Asked for more on ${SECTION_NAMES[section].toLowerCase()}: "${prompt}"`, 'info', ask.id);
    void this.askPart(guide, section, ask, request.student ?? null).finally(() => this.running.delete(task));
    return { guide: this.view(guide.slug, ask.by)!, ask };
  }

  /** Requests to offer in the "Add more" window: from what the part holds, the student, and what they asked before. */
  async suggest(slug: string, id: string, request: { by?: string; student?: StudentContext | null } = {}): Promise<string[]> {
    const guide = this.find(slug);
    if (!guide) throw new CareerError('No guide for this career yet.', 404);
    if (!(SECTION_IDS as readonly string[]).includes(id)) throw new CareerError('There is no such part of the guide.', 404);
    const section = id as SectionId;
    if (!guide.sections[section].data) return [];
    this.assertCanRun(guide);
    const holds = summarize(section, guide.sections[section].data);
    const pastAsks = guide.asks.filter((a) => a.section === section && a.by === (request.by || 'guest')).map((a) => a.prompt);
    const cacheKey = JSON.stringify([guide.slug, section, holds.length, pastAsks, request.student ?? null]);
    const kept = this.suggestions.get(cacheKey);
    if (kept) return kept;
    const { prompts } = await this.call(presentation.suggest({ guide, section, holds, student: request.student ?? null, pastAsks }));
    const clean = prompts.map((p) => p.trim()).filter((p) => p.length > 3 && p.length <= 120).slice(0, 3);
    this.suggestions.set(cacheKey, clean);
    return clean;
  }

  /**
   * Picks up the parts a restart cut off. A part whose researcher had answered starts from its check.
   * Parts of a guide the agents in use did not write (Grok's guide while simulated, or the other way)
   * stay marked, so the student can search them again once the right agents are back.
   */
  resume(): string[] {
    const resumed: string[] = [];
    for (const [slug, parts] of this.cutOff) {
      const guide = this.guides.get(slug);
      if (!guide || this.busy(slug) || guide.provider !== this.env.provider() || guide.failure === 'balance') continue;
      this.running.add(slug);
      resumed.push(slug);
      this.update(guide, { status: guide.angles ? 'researching' : 'planning' });
      this.log(guide, 'Master', `Picked up ${parts.length} part(s) a restart stopped`, 'info', null);
      void this.resumeGuide(guide, parts).finally(() => this.running.delete(slug));
    }
    this.cutOff.clear();
    return resumed;
  }

  /** Resolves when nothing is running for this guide: its research and any "Add more". For tests. */
  async settled(slug: string): Promise<Guide | null> {
    while (this.busy(slug)) await new Promise((r) => setTimeout(r, 5));
    return this.find(slug);
  }

  private busy(slug: string) {
    return [...this.running].some((t) => t === slug || t.startsWith(`${slug}/`));
  }

  /** Only the agents that wrote a guide may change it: simulated examples never land in Grok's research. */
  private assertCanRun(guide: Guide) {
    if (guide.provider === 'grok' && this.env.provider() !== 'grok') throw new CareerError(GROK_ONLY, 503);
  }

  /** Another name a student asked for this guide by. */
  private remember(guide: Guide, name: string) {
    const same = (n: string) => n.toLowerCase() === name.toLowerCase();
    if (same(guide.query) || same(guide.title) || same(guide.slug) || guide.aliases.some(same)) return;
    guide.aliases = [...guide.aliases, name].slice(-20);
    this.save();
  }

  /** One call with the transport's time limit. A call that never answers is given up on a little after it. */
  private call<S extends z.ZodType>(c: AgentCall<S>): Promise<z.infer<S>> {
    const models = tierModels();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CallTimeout(`timed out after ${Math.round(this.timeoutMs / 1000)}s`)), this.timeoutMs + this.graceMs);
      timer.unref?.();
    });
    const answer = this.ask({ name: c.name, system: c.system, user: c.user, schema: c.schema, tools: c.tools, model: c.tier === 'normal' ? models.normal : models.low, timeoutMs: this.timeoutMs }).then((r) => r.data);
    return Promise.race([answer, limit]).finally(() => clearTimeout(timer));
  }

  /** A call tried once more when it fails, unless the balance is empty. For calls that do not run on the fleet. */
  private async twice<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (isBalance(e)) throw e;
      return work();
    }
  }

  /** A fleet for one run of this guide. Its jobs are written to the guide's activity as they start and finish. */
  private fleet(guide: Guide, ask: string | null): Fleet {
    return new Fleet({
      // A CLI call is a whole program. Share the same cap as the opportunity search.
      concurrency: config.grokTransport === 'cli' ? Math.max(1, config.grokCli.concurrency) : 4,
      maxJobs: 24,
      onUpdate: (job: Job) => {
        if (job.status === 'running' && job.attempts === 1) this.log(guide, job.label, 'Started', 'info', ask);
        if (job.status === 'running' && job.attempts > 1) this.log(guide, job.label, 'Trying once more', 'info', ask);
        if (job.status === 'done') this.log(guide, job.label, job.result ?? 'Done', 'good', ask);
        if (job.status === 'failed') this.log(guide, job.label, `Failed: ${job.result ?? 'no answer'}`, 'bad', ask);
      },
    });
  }

  /**
   * One job on the fleet, which tries it once more when it fails (not when the balance is empty).
   * Returns the answer, or what went wrong on the last try.
   */
  private async job<T>(
    fleet: Fleet,
    spec: { kind: JobKind; managerId: string; label: string; exempt?: boolean; role: 'researcher' | 'validator' },
    work: () => Promise<T>,
    summary: (value: T) => string,
  ): Promise<{ ok: true; value: T } | { ok: false; failure: Failure; reason: string }> {
    let last: unknown = null;
    const value = await fleet.run({ kind: spec.kind, managerId: spec.managerId, label: spec.label, exempt: spec.exempt }, async () => {
      try {
        const v = await work();
        return { value: v, summary: summary(v) };
      } catch (e) {
        last = e;
        throw e;
      }
    });
    if (value !== null) return { ok: true, value };
    if (last === null) return { ok: false, failure: 'stopped', reason: `The ${spec.role} was stopped before it answered.` };
    return { ok: false, ...explain(last, spec.role, this.timeoutMs) };
  }

  /**
   * One part, from its manager to its validator. `holds` is set for an "Add more", so the
   * researcher looks for new items only. The researcher's answer is saved as the part's draft before
   * the check starts. Returns what went wrong when the researcher has nothing; a check that fails
   * after its retry keeps the researcher's answer, marked unchecked, unless the balance ran out.
   */
  private async runPart<K extends SectionId>(
    guide: Guide,
    section: K,
    ctx: { fleet: Fleet; focus: string | null; holds: string | null; formats: string[]; student: StudentContext | null; ask: string | null; fromDraft?: boolean; keepDraft: boolean },
  ): Promise<{ ok: true; data: SectionData[K]; unchecked: string | null } | { ok: false; failure: Failure; reason: string; drafted: boolean }> {
    const sample = this.writesSamples(section);
    let found = ctx.fromDraft ? (guide.sections[section].draft as unknown) : null;
    if (found === null) {
      const brief = managerBrief({ guide, section, focus: ctx.focus, holds: ctx.holds, formats: ctx.formats, student: ctx.student });
      this.log(guide, agentName(section, 'manager'), ctx.holds === null ? 'Handed the researcher its job' : 'Handed the researcher a job for new items only', 'info', ctx.ask);
      const got = await this.job(
        ctx.fleet,
        { kind: 'guide-research', managerId: section, label: agentName(section, 'researcher'), role: 'researcher' },
        () => this.call(researcher(section, brief, { canSearchX: this.env.canSearchX() })),
        (value) => `Brought back ${countItems(section, value)} items`,
      );
      if (!got.ok) return { ...got, drafted: false };
      found = got.value;
      // Saved before the check, so a restart or an empty balance during it does not lose the answer.
      if (ctx.keepDraft) this.setSection(guide, section, { draft: found as never, stage: 'validating' });
      else this.setSection(guide, section, { stage: 'validating' });
    } else {
      this.log(guide, agentName(section, 'manager'), 'Picked up the researcher’s saved answer for its check', 'info', ctx.ask);
      this.setSection(guide, section, { stage: 'validating' });
    }

    // The validator is exempt from the budget: a part is never saved unchecked because the run was busy.
    const reviewed = await this.job(
      ctx.fleet,
      { kind: 'guide-review', managerId: section, label: agentName(section, 'validator'), exempt: true, role: 'validator' },
      () => this.call(validator(section, found, { sample, formats: ctx.formats })),
      (value) => (value.removed.length ? `Took out ${value.removed.length}: ${value.removed.map((r) => r.reason).slice(0, 2).join('; ')}` : 'Every item follows the rules'),
    );
    if (!reviewed.ok && (reviewed.failure === 'balance' || reviewed.failure === 'stopped')) return { ...reviewed, drafted: ctx.keepDraft };
    let unchecked: string | null = null;
    if (!reviewed.ok) {
      unchecked = `Not checked: ${lowerFirst(reviewed.reason)}`;
      this.log(guide, agentName(section, 'validator'), 'Could not check this part; kept as the researcher wrote it', 'bad', ctx.ask);
    }
    const data = (reviewed.ok ? reviewed.value.data : found) as Record<string, unknown>;
    return { ok: true, data: (section === 'voices' ? { summary: null, ...data } : data) as SectionData[K], unchecked };
  }

  /** A part written as labelled examples: stories without X search, and everything the simulated agents write. */
  private writesSamples(section: SectionId) {
    return this.env.provider() === 'simulated' || (section === 'voices' && !this.env.canSearchX());
  }

  /** A whole part, researched and saved the moment it is checked. Used by a first search, a retry and a resume. */
  private async part(guide: Guide, id: SectionId, opts: { fleet: Fleet; formats: string[]; fromDraft: boolean }) {
    if (guide.failure === 'balance') {
      this.setSection(guide, id, { status: guide.sections[id].data ? 'done' : 'failed', stage: null, mode: null, failure: 'balance', error: `Not researched: ${BALANCE_MESSAGE}.` });
      return;
    }
    this.setSection(guide, id, { status: 'working', mode: 'research', stage: opts.fromDraft ? 'validating' : 'researching', error: null, failure: null });
    const result = await this.runPart(guide, id, { fleet: opts.fleet, focus: null, holds: null, formats: opts.formats, student: null, ask: null, fromDraft: opts.fromDraft, keepDraft: true });
    if (!result.ok) {
      if (result.failure === 'balance') this.outOfBalance(guide);
      // The earlier version, if any, stays on screen; the part says why the new search stopped.
      const had = guide.sections[id].data !== null;
      this.setSection(guide, id, { status: had ? 'done' : 'failed', stage: null, mode: null, failure: result.failure, error: had ? `${result.reason} This is the earlier version.` : result.reason });
      return;
    }
    this.setSection(guide, id, {
      status: 'done',
      data: result.data as never,
      draft: null,
      sample: this.writesSamples(id),
      unchecked: result.unchecked,
      error: null,
      failure: null,
      stage: null,
      mode: null,
      added: null,
      finishedAt: new Date().toISOString(),
    });
    if (id === 'voices') await this.summarizeVoices(guide, null);
  }

  /** Grok answered 402: nothing more is started this run, and the guide says why. */
  private outOfBalance(guide: Guide) {
    if (guide.failure === 'balance') return;
    this.update(guide, { failure: 'balance', error: `${BALANCE_MESSAGE}.` });
    this.log(guide, 'Master', `${BALANCE_MESSAGE}. Finished parts are kept; the rest wait for the balance`, 'bad', null);
  }

  /**
   * Guides researched before the summary existed, or whose summary is longer than two short
   * sentences, get one written the first time they are opened. Runs once at a time per guide.
   */
  private backfillSummary(guide: Guide) {
    const s = guide.sections.voices;
    const words = s.data?.summary?.split(/\s+/).length ?? 0;
    const task = `${guide.slug}/voices-summary`;
    if (!s.data?.posts.length || (s.data.summary && words <= MAX_SUMMARY_WORDS) || guide.provider !== this.env.provider() || guide.failure === 'balance') return;
    if (this.running.has(task) || this.running.has(guide.slug) || this.running.has(`${guide.slug}/voices`)) return;
    this.running.add(task);
    void this.summarizeVoices(guide, null).finally(() => this.running.delete(task));
  }

  /** The presentation agent's two sentences over every post. Keeps the old summary if it cannot write one. */
  private async summarizeVoices(guide: Guide, ask: string | null) {
    const s = guide.sections.voices;
    if (!s.data?.posts.length) return;
    try {
      const { summary } = await this.call(presentation.voicesSummary(guide.title, s.data.posts, s.sample));
      this.setSection(guide, 'voices', { data: { ...guide.sections.voices.data!, summary } });
      this.log(guide, 'Presentation', 'Wrote the summary of what people say', 'good', ask);
    } catch (e) {
      if (isBalance(e)) this.outOfBalance(guide);
      this.log(guide, 'Presentation', `Could not write the summary: ${message(e)}`, 'bad', ask);
    }
  }

  /** The master's plan. Returns false when it failed (the guide says why) or the guide turned out to be another one's. */
  private async plan(guide: Guide): Promise<boolean> {
    try {
      this.log(guide, 'Master', `Routed "${guide.query}" to career discovery and is planning the guide`, 'info', null);
      const plan = await this.twice(() => this.call(master.plan(guide.query)));
      // The plan named a career that already has its own guide: this becomes one more name for it.
      const other = this.find(plan.title);
      if (other && other.slug !== guide.slug && SECTION_IDS.some((id) => other.sections[id].data)) {
        this.fold(guide, other);
        return false;
      }
      this.update(guide, { title: plan.title, oneLine: plan.oneLine, field: plan.field, angles: plan.angles, status: 'researching', failure: null, error: null });
      this.log(guide, 'Master', `Planned the guide to ${plan.title}`, 'good', null);
      return true;
    } catch (e) {
      const { failure, reason } = explain(e, 'master', this.timeoutMs);
      if (failure === 'balance') this.outOfBalance(guide);
      this.update(guide, { failure, error: `Could not plan the guide: ${lowerFirst(reason)}` });
      this.log(guide, 'Master', `Could not plan the guide: ${lowerFirst(reason)}`, 'bad', null);
      for (const id of SECTION_IDS) {
        const s = guide.sections[id];
        if (s.status === 'waiting' || s.status === 'working') this.setSection(guide, id, { status: s.data ? 'done' : 'failed', stage: null, mode: null, failure, error: s.data ? null : 'Not researched: the plan failed.' });
      }
      this.update(guide, { status: settledStatus(guide) });
      return false;
    }
  }

  /** A guide whose plan named a career that already has a guide is kept as one more name for that guide. */
  private fold(guide: Guide, into: Guide) {
    this.guides.delete(guide.slug);
    for (const name of [guide.query, ...guide.aliases]) this.remember(into, name);
    into.asks.push(...guide.asks);
    this.log(into, 'Master', `"${guide.query}" is this career, so it opens this guide`, 'info', null);
  }

  private async research(guide: Guide) {
    if (!(await this.plan(guide))) return;
    const fleet = this.fleet(guide, null);
    // How to start waits for the interviews, so its steps can be written to prepare for each format.
    await Promise.all([
      this.part(guide, 'basics', { fleet, formats: [], fromDraft: false }),
      this.part(guide, 'voices', { fleet, formats: [], fromDraft: false }),
      this.part(guide, 'interview', { fleet, formats: [], fromDraft: false }).then(() => this.part(guide, 'start', { fleet, formats: formatsOf(guide), fromDraft: false })),
    ]);
    this.finish(guide);
  }

  /** Runs again the parts a restart stopped; how to start still waits for the interviews. */
  private async resumeGuide(guide: Guide, parts: SectionId[]) {
    if (!guide.angles && !(await this.plan(guide))) return;
    const fleet = this.fleet(guide, null);
    const run = (id: SectionId) => (parts.includes(id) ? this.part(guide, id, { fleet, formats: id === 'start' ? formatsOf(guide) : [], fromDraft: guide.sections[id].draft !== null }) : Promise.resolve());
    await Promise.all([run('basics'), run('voices'), run('interview').then(() => run('start'))]);
    this.finish(guide);
  }

  private async retryPart(guide: Guide, section: SectionId, fromDraft: boolean) {
    if (!guide.angles && !(await this.plan(guide))) {
      this.setSection(guide, section, { status: guide.sections[section].data ? 'done' : 'failed', stage: null, mode: null, failure: guide.failure, error: guide.error });
      return;
    }
    await this.part(guide, section, { fleet: this.fleet(guide, null), formats: section === 'start' ? formatsOf(guide) : [], fromDraft });
    this.update(guide, { status: settledStatus(guide) });
    const s = guide.sections[section];
    this.log(guide, 'Master', s.failure ? `${SECTION_NAMES[section]} could not be searched again: ${s.error ?? 'no answer'}` : `Searched ${SECTION_NAMES[section].toLowerCase()} again`, s.failure ? 'bad' : 'good', null);
  }

  private finish(guide: Guide) {
    const failed = SECTION_IDS.filter((id) => guide.sections[id].failure);
    const status = settledStatus(guide);
    this.update(guide, status === 'failed' && !guide.error ? { status, error: 'None of the four parts could be researched.' } : { status });
    this.log(guide, 'Master', failed.length ? `Finished; ${failed.length} part(s) could not be researched` : 'Finished the guide', failed.length ? 'bad' : 'good', null);
  }

  private async askPart(guide: Guide, section: SectionId, ask: GuideAsk, student: StudentContext | null) {
    const done = (patch: Partial<GuideAsk>) => {
      Object.assign(ask, patch);
      this.update(guide, {});
    };
    const fail = (reason: string, failure: Failure) => {
      if (failure === 'balance') this.outOfBalance(guide);
      // The old items stay; the part is only marked so the page can say this try found nothing.
      this.setSection(guide, section, { status: 'done', stage: null, mode: null, failure, error: `Could not find more: ${lowerFirst(reason)}` });
      done({ status: 'failed', note: `Could not find more: ${lowerFirst(reason)}` });
    };
    try {
      const holds = summarize(section, guide.sections[section].data);
      const pastAsks = guide.asks.filter((a) => a.section === section && a.by === ask.by && a.id !== ask.id);
      let focus = ask.prompt;
      try {
        const plan = await this.call(master.readAsk({ guide, section, prompt: ask.prompt, student, holds, pastAsks }));
        if (plan.route === 'opportunity-search') {
          this.log(guide, 'Master', 'Routed this request to the opportunity search', 'info', ask.id);
          this.setSection(guide, section, { status: 'done', stage: null, mode: null });
          done({ status: 'redirected', note: plan.reply });
          return;
        }
        focus = plan.focus || ask.prompt;
        ask.note = plan.reply || null;
        this.log(guide, 'Master', plan.reply || 'Planned what to look for', 'info', ask.id);
      } catch (e) {
        if (isBalance(e)) return fail(BALANCE_MESSAGE, 'balance');
        // Without the master's reading, the researcher works from the student's own words.
        this.log(guide, 'Master', `Could not read the request, so the researcher works from it as written: ${message(e)}`, 'bad', ask.id);
      }

      const fleet = this.fleet(guide, ask.id);
      const more = await this.runPart(guide, section, { fleet, focus, holds, formats: formatsOf(guide), student, ask: ask.id, keepDraft: false });
      if (!more.ok) return fail(more.reason, more.failure);
      const merged = mergeSection(section, guide.sections[section].data as never, more.data as never);
      this.setSection(guide, section, { status: 'done', stage: null, mode: null, data: merged.data as never, error: null, failure: null, added: { count: merged.added, at: new Date().toISOString() } });
      this.log(guide, 'Presentation', merged.added ? `Added ${merged.added} new items` : 'Found nothing new this time', merged.added ? 'good' : 'info', ask.id);
      if (section === 'voices' && merged.added) await this.summarizeVoices(guide, ask.id);
      let added = merged.added;

      // New interview formats get steps in how to start that prepare for them.
      if (section === 'interview' && guide.sections.start.data) {
        const missing = unpreparedFormats(guide);
        if (missing.length) added += await this.prepareFormats(guide, missing, fleet, student, ask.id);
      }
      done({ status: 'done', added });
    } catch (e) {
      const { failure, reason } = explain(e, 'agents', this.timeoutMs);
      fail(reason, failure);
    }
  }

  /** Writes steps in how to start for interview formats nothing prepares for yet. Returns how many items it added. */
  private async prepareFormats(guide: Guide, formats: string[], fleet: Fleet, student: StudentContext | null, ask: string | null): Promise<number> {
    const task = `${guide.slug}/start`;
    if (this.running.has(task)) return 0;
    this.running.add(task);
    this.setSection(guide, 'start', { status: 'working', mode: 'more', stage: 'researching' });
    this.log(guide, 'Master', `Asked how to start for steps that prepare for: ${formats.join(', ')}`, 'info', ask);
    try {
      const focus = `Steps that get a student ready for these interview formats: ${formats.join('; ')}. Every step's prepares names the formats it covers.`;
      const more = await this.runPart(guide, 'start', { fleet, focus, holds: summarize('start', guide.sections.start.data), formats, student, ask, keepDraft: false });
      if (!more.ok) {
        this.setSection(guide, 'start', { status: 'done', stage: null, mode: null, error: `Could not add steps for the new formats: ${lowerFirst(more.reason)}` });
        return 0;
      }
      const merged = mergeSection('start', guide.sections.start.data!, more.data);
      this.setSection(guide, 'start', { status: 'done', stage: null, mode: null, data: merged.data, error: null, added: { count: merged.added, at: new Date().toISOString() } });
      return merged.added;
    } finally {
      this.running.delete(task);
    }
  }

  private log(guide: Guide, agent: string, text: string, tone: GuideEvent['tone'], ask: string | null) {
    guide.activity.push({ at: new Date().toISOString(), agent, text: text.slice(0, 200), tone, ask });
    if (guide.activity.length > MAX_ACTIVITY) guide.activity.splice(0, guide.activity.length - MAX_ACTIVITY);
    this.update(guide, {});
  }

  private setSection<K extends SectionId>(guide: Guide, id: K, patch: Partial<SectionState<SectionData[K]>>) {
    guide.sections[id] = { ...guide.sections[id], ...patch };
    this.update(guide, {});
  }

  private update(guide: Guide, patch: Partial<Guide>) {
    Object.assign(guide, patch, { updatedAt: new Date().toISOString() });
    this.save();
  }

  private load() {
    if (!this.file || !existsSync(this.file)) return;
    let saved: { guides?: Guide[] };
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8')) as { guides?: Guide[] };
    } catch (e) {
      // An unreadable file is set aside, never written over, so no researched guide is lost.
      const aside = `${this.file}.unreadable-${Date.now()}`;
      try {
        copyFileSync(this.file, aside);
      } catch {
        // Nothing more to do; the original stays where it is until the next save.
      }
      console.error(`could not read career guides (${message(e)}); kept a copy at ${aside}`);
      return;
    }
    for (const g of saved.guides ?? []) {
      const { guide, cut } = upgrade(g);
      this.guides.set(guide.slug, guide);
      if (cut.length) this.cutOff.set(guide.slug, cut);
    }
    const merged = mergeDuplicates(this.guides);
    for (const [from, into] of merged) {
      const cut = this.cutOff.get(from);
      if (cut) this.cutOff.delete(from);
      console.log(`career guides: "${from}" is the same career as "${into}"; merged into it`);
    }
    if (merged.length || this.cutOff.size) this.save();
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Written next to the file and moved into place, so a restart mid-write cannot leave half a file.
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ guides: [...this.guides.values()] }, null, 1));
      renameSync(tmp, this.file);
    } catch (e) {
      console.error('could not save career guides:', message(e));
    }
  }
}

/** The guide's status once nothing is running: ready when any part holds something, failed when none does. */
function settledStatus(guide: Guide): Guide['status'] {
  return SECTION_IDS.some((id) => guide.sections[id].data) ? 'ready' : 'failed';
}

const formatsOf = (guide: Guide) => guide.sections.interview.data?.formats.map((f) => f.name) ?? [];

/**
 * Brings a guide saved by an older version up to the current shape, and marks work a restart cut
 * off. Returns the parts that were cut off, to pick up again.
 */
export function upgrade(g: Guide): { guide: Guide; cut: SectionId[] } {
  g.angles ??= null;
  g.asks ??= [];
  g.activity ??= [];
  g.aliases ??= [];
  g.failure ??= null;
  const basics = g.sections.basics.data as (SectionData['basics'] & { skills: unknown[] }) | null;
  // Older guides kept skills as plain words; they are kept, filed as knowledge.
  if (basics) basics.skills = basics.skills.map((s) => (typeof s === 'string' ? { name: s, kind: 'knowledge' as const } : s)) as SectionData['basics']['skills'];
  if (g.sections.voices.data) g.sections.voices.data.summary ??= null;
  for (const step of g.sections.start.data?.steps ?? []) step.prepares ??= [];
  // Older guides said a raw CLI error for an empty balance; it is said plainly.
  if (g.error && isBalanceError(g.error) && g.failure === null) Object.assign(g, { failure: 'balance', error: `Could not plan the guide: ${BALANCE_MESSAGE}.` });

  const runWasOn = g.status === 'planning' || g.status === 'researching';
  const cut: SectionId[] = [];
  for (const id of SECTION_IDS) {
    const s = { ...emptySection(), ...g.sections[id] } as SectionState<unknown>;
    g.sections[id] = s as never;
    const stopped = s.status === 'working' || (s.status === 'waiting' && runWasOn);
    if (stopped && s.mode === 'more') {
      // An "Add more" a restart cut off: the part keeps what it had.
      Object.assign(s, { status: 'done', stage: null, mode: null, error: `Could not find more: ${lowerFirst(CUT)}` });
    } else if (stopped) {
      cut.push(id);
      Object.assign(s, {
        status: s.data ? 'done' : 'failed',
        stage: null,
        mode: null,
        failure: 'interrupted',
        error: s.data ? `${CUT} This is the earlier version.` : s.draft ? `${CUT} The researcher’s answer is saved; searching this part again starts from its check.` : CUT,
      });
    } else if (s.status === 'waiting') {
      // A part never started by an older version that did not finish the plan.
      Object.assign(s, { status: s.data ? 'done' : 'failed', error: s.data ? s.error : s.error ?? 'Not researched.' });
    }
  }
  if (runWasOn) {
    if (!g.angles) Object.assign(g, { failure: 'interrupted', error: 'A restart stopped the research before the guide was planned.' });
    g.status = settledStatus(g);
  }
  for (const a of g.asks) if (a.status === 'working') Object.assign(a, { status: 'failed', note: CUT });
  return { guide: g, cut };
}

/**
 * One guide per career: guides kept under different names of the same career ("AI Engineering"
 * and the "AI Engineer" it was planned as) are merged into the oldest. Their parts are combined
 * without repeats and every name becomes an alias. Returns [merged slug, kept slug] pairs.
 */
export function mergeDuplicates(guides: Map<string, Guide>): [string, string][] {
  const out: [string, string][] = [];
  const kept: Guide[] = [];
  for (const g of [...guides.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const keys = keysOf(g);
    const into = kept.find((k) => keysOf(k).some((key) => keys.includes(key)));
    if (!into) {
      kept.push(g);
      continue;
    }
    for (const id of SECTION_IDS) {
      const mine = into.sections[id];
      const theirs = g.sections[id];
      if (!theirs.data) continue;
      if (!mine.data) into.sections[id] = theirs as never;
      else into.sections[id] = { ...mine, data: mergeSection(id, mine.data as never, theirs.data as never).data } as never;
    }
    const names = [g.query, g.title, g.slug, ...g.aliases].filter((n) => ![into.query, into.title, ...into.aliases].some((m) => m.toLowerCase() === n.toLowerCase()));
    into.aliases = [...new Set([...into.aliases, ...names])].slice(-20);
    into.asks.push(...g.asks);
    into.oneLine ??= g.oneLine;
    into.angles ??= g.angles;
    if (into.status === 'failed' && SECTION_IDS.some((id) => into.sections[id].data)) Object.assign(into, { status: 'ready', error: null, failure: null });
    into.activity.push({ at: new Date().toISOString(), agent: 'Master', text: `Merged the guide kept as "${g.slug}": it is the same career`, tone: 'info', ask: null });
    guides.delete(g.slug);
    out.push([g.slug, into.slug]);
  }
  return out;
}

const isBalance = (e: unknown) => e instanceof BalanceExhaustedError || isBalanceError(message(e));

/** What went wrong with a call, in words a student can read. `who` names the agent: researcher, validator, master. */
export function explain(e: unknown, who: string, timeoutMs: number): { failure: Failure; reason: string } {
  const text = message(e);
  if (isBalance(e)) return { failure: 'balance', reason: `${BALANCE_MESSAGE}.` };
  if (e instanceof CallTimeout || /timed? ?out|timeout|aborted/i.test(text)) return { failure: 'timeout', reason: `The ${who} timed out twice (each try may take ${Math.round(timeoutMs / 1000)}s).` };
  if (e instanceof z.ZodError || /json|parse|schema|expected|invalid_type|unexpected token/i.test(text)) return { failure: 'parse', reason: `The ${who} answered twice in a form that could not be read.` };
  if (/stopped/i.test(text)) return { failure: 'stopped', reason: `The ${who} was stopped before it answered.` };
  return { failure: 'error', reason: `The ${who} failed twice: ${text.slice(0, 160)}` };
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function countItems(section: SectionId, data: unknown): number {
  const d = data as Record<string, unknown[] | undefined>;
  const n = (k: string) => d[k]?.length ?? 0;
  if (section === 'basics') return n('dayInLife') + n('whatTheyDo') + n('whereTheyWork') + n('specialties') + n('skills');
  if (section === 'voices') return n('posts');
  if (section === 'start') return n('steps') + n('resources');
  return n('formats') + n('questions');
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}
