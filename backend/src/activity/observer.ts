// Turns the agent system's run snapshots into the activity feed. It only reads the snapshot:
// timing is stamped here, the first time each agent is seen in each status.
import { REVIEWERS, type Job, type RunRecord, type RunSnapshot, type Trigger } from '../agents/types.ts';
import { LEVELS, type ActivityAgent, type ActivityFlow, type ActivityLevel, type ActivityRun, type ActivityStatus, type AgentKind, type AgentOutcome, type LiveActivity, type RunOutcome, type RunReport } from './types.ts';

const TIMEOUT = /timed? ?out|timeout|deadline exceeded|ETIMEDOUT/i;
const NOT_REVIEWED = /^Could not be reviewed:?\s*/;
const TERMINAL: ActivityStatus[] = ['done', 'failed', 'timed_out', 'skipped'];

export const TRIGGER_TEXT: Record<Trigger, string> = {
  first: 'First run',
  manual: 'Requested by hand',
  profile: 'Profile changed',
  feedback: 'New reactions',
  schedule: 'Scheduled',
  auto: 'Automode',
  fill: 'Refill: the feed was short',
};

const failedOrTimedOut = (message: string | null): ActivityStatus => (message && TIMEOUT.test(message) ? 'timed_out' : 'failed');

/** A run error in words: the CLI's JSON error body is cut down to its message. */
export function plainError(error: string | null): string | null {
  if (!error) return error;
  const message = /"message"\s*:\s*"([^"]+)"/.exec(error)?.[1];
  if (!message) return error.trim();
  const lead = error.slice(0, error.indexOf(':')).trim();
  return lead && !error.trimStart().startsWith('{') ? `${lead}: ${message}` : message;
}

const JOB_KIND: Record<Job['kind'], { kind: AgentKind; name: string }> = {
  scout: { kind: 'scout', name: 'Scout' },
  extract: { kind: 'reader', name: 'Reader' },
  application: { kind: 'application', name: 'Application reader' },
  deadline: { kind: 'deadline', name: 'Deadline finder' },
  image: { kind: 'image', name: 'Picture finder' },
  'guide-research': { kind: 'guide-research', name: 'Guide researcher' },
  'guide-review': { kind: 'guide-review', name: 'Guide reviewer' },
};

/** An agent before timing is added. */
type Shape = Omit<ActivityAgent, 'queuedAt' | 'startedAt' | 'finishedAt'>;

/** Every agent in a run snapshot, by level, without timing. Pure. */
export function shapesOf(run: RunSnapshot): Shape[] {
  const ended = run.status !== 'running';
  const managers = run.agents.filter((a) => a.level === 'manager');
  // Jobs for deadlines, pictures and applications name their manager by its display name.
  const managerOf = (ref: string) => managers.find((m) => m.id === ref)?.id ?? managers.find((m) => m.name === ref)?.id ?? null;
  const out: Shape[] = [];

  for (const a of run.agents) {
    // An agent that failed with the run still shows what it was doing ("Reading the student…"); its reason is the run's error.
    const detail = a.status === 'failed' && run.error && (!a.detail || a.detail.endsWith('…')) ? plainError(run.error) : a.detail || null;
    const status: ActivityStatus = a.status === 'idle' ? 'queued' : a.status === 'failed' ? failedOrTimedOut(detail) : a.status;
    const task = a.level === 'master' ? 'Read the student and brief the managers' : a.level === 'presentation' ? 'Order the feed and write why each card fits' : `Cover ${a.role.charAt(0).toLowerCase()}${a.role.slice(1)}`;
    out.push({ id: a.id, level: a.level, kind: a.level, name: a.name, task, target: null, managerId: a.level === 'manager' ? a.id : null, status, detail, verdict: null });
  }

  for (const j of run.jobs) {
    const { kind, name } = JOB_KIND[j.kind] ?? { kind: 'reader' as const, name: 'Worker' };
    let status: ActivityStatus = j.status === 'failed' ? failedOrTimedOut(j.result) : j.status;
    // A job still waiting when the run ended never ran.
    if (ended && (status === 'queued' || status === 'running')) status = 'skipped';
    out.push({ id: `job:${j.id}`, level: 'worker', kind, name, task: j.label, target: null, managerId: managerOf(j.managerId), status, detail: j.result ?? (ended && status === 'skipped' ? 'The run ended first' : null), verdict: null });
  }

  for (const v of run.validations) {
    for (const r of v.reviews ?? []) {
      const reviewer = REVIEWERS.find((x) => x.focus === r.focus);
      let status: ActivityStatus;
      let verdict: ActivityAgent['verdict'] = null;
      let detail = r.reason;
      if (r.status === 'checking') {
        status = ended ? 'skipped' : 'running';
        if (ended) detail = v.reason ?? 'The run ended before this review';
      } else if (r.reason && NOT_REVIEWED.test(r.reason)) {
        // A review that could not run is a failure of the reviewer, not a verdict on the posting.
        detail = r.reason.replace(NOT_REVIEWED, '');
        status = failedOrTimedOut(detail);
      } else {
        status = 'done';
        verdict = r.status;
        detail = `${r.status === 'kept' ? 'Kept' : 'Rejected'}${r.reason ? `: ${r.reason}` : ''}`;
      }
      out.push({
        id: `review:${v.id}:${r.focus}`,
        level: 'validation',
        kind: r.focus,
        name: reviewer?.name ?? r.reviewer,
        task: r.focus === 'criteria' ? "Check it meets the student's rules" : 'Check it is real and still open',
        target: v.title,
        managerId: managerOf(v.managerId),
        status,
        detail,
        verdict,
      });
    }
  }
  return out;
}

function countsOf(agents: { status: ActivityStatus }[]): Record<ActivityStatus, number> {
  const counts: Record<ActivityStatus, number> = { queued: 0, running: 0, done: 0, failed: 0, timed_out: 0, skipped: 0 };
  for (const a of agents) counts[a.status]++;
  return counts;
}

/** The four hand-offs between levels. Pure. */
export function flowsOf(run: RunSnapshot, agents: Shape[]): ActivityFlow[] {
  const busy = (level: ActivityLevel) => run.status === 'running' && agents.some((a) => a.level === level && (a.status === 'queued' || a.status === 'running'));
  const of = (level: ActivityLevel) => agents.filter((a) => a.level === level);
  return [
    { from: 'master', to: 'manager', kind: 'task', count: of('manager').length, unit: 'briefs', active: busy('manager') },
    { from: 'manager', to: 'worker', kind: 'task', count: of('worker').filter((a) => a.status !== 'skipped').length, unit: 'tasks', active: busy('worker') },
    { from: 'worker', to: 'validation', kind: 'result', count: run.validations.length, unit: 'postings', active: busy('validation') },
    { from: 'validation', to: 'presentation', kind: 'result', count: run.validations.filter((v) => v.status === 'kept').length, unit: 'kept', active: busy('presentation') },
  ];
}

export function outcomeOf(status: RunSnapshot['status'], agents: { status: ActivityStatus }[]): RunOutcome {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'stopped') return 'stopped';
  return agents.some((a) => a.status === 'failed' || a.status === 'timed_out') ? 'partly_failed' : 'finished';
}

function runOf(run: RunSnapshot, agents: { status: ActivityStatus }[]): ActivityRun {
  const triggerText = TRIGGER_TEXT[run.trigger] ?? run.trigger;
  return {
    id: run.id,
    number: run.number,
    trigger: run.trigger,
    triggerText,
    request: run.brief?.goal || triggerText,
    mode: run.mode,
    status: run.status,
    outcome: outcomeOf(run.status, agents),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: plainError(run.error),
  };
}

/** The most common reasons, most frequent first. */
function reasons(list: (string | null)[], limit = 5) {
  const counts = new Map<string, number>();
  for (const r of list) {
    const reason = (r ?? 'No reason given').trim().slice(0, 200);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

const durationOf = (start: string | null, end: string | null) => (start && end ? Math.max(0, Date.parse(end) - Date.parse(start)) : null);
const RANK: Record<ActivityStatus, number> = { failed: 0, timed_out: 1, skipped: 3, done: 2, running: 4, queued: 5 };

/** The worker fleet's "Funnel: …" line, the stage-by-stage drop counts, when the run logged one. */
function funnelOf(run: RunSnapshot): string | null {
  const line = [...run.log].reverse().find((l) => l.text.startsWith('Funnel: '));
  return line ? line.text.slice('Funnel: '.length).trim() : null;
}

/** The brief report of a finished run. Pure. */
export function reportOf(run: RunSnapshot, agents: ActivityAgent[]): RunReport {
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, agents.filter((a) => a.level === l).length])) as Record<ActivityLevel, number>;
  const broken = agents.filter((a) => a.status === 'failed' || a.status === 'timed_out');
  const skipped = agents.filter((a) => a.status === 'skipped');
  const ran = agents.filter((a) => a.status !== 'skipped');
  const outcomes: AgentOutcome[] = [...agents]
    .sort((a, b) => RANK[a.status] - RANK[b.status] || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
    .slice(0, 200)
    .map((a) => ({ id: a.id, level: a.level, name: a.name, task: a.task, status: a.status, outcome: a.detail, durationMs: durationOf(a.startedAt, a.finishedAt) }));
  return {
    ...runOf(run, agents),
    durationMs: durationOf(run.startedAt, run.finishedAt),
    agents: { total: ran.length, byLevel },
    results: { found: run.stats.candidates || run.validations.length, validated: run.stats.kept, rejected: run.stats.rejected, saved: run.stats.added },
    failures: { count: broken.length, reasons: reasons(broken.map((a) => a.detail)) },
    skipped: { count: skipped.length, reasons: reasons(skipped.map((a) => a.detail)) },
    outcomes,
    outlineOnly: false,
    funnel: funnelOf(run),
  };
}

/** A run recorded before reports were kept: only its outline. */
export function outlineReport(r: RunRecord): RunReport {
  return {
    id: `run-${r.number}`,
    number: r.number,
    trigger: r.trigger,
    triggerText: TRIGGER_TEXT[r.trigger] ?? r.trigger,
    request: null,
    mode: null,
    status: r.status,
    outcome: r.status === 'complete' ? 'finished' : r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: durationOf(r.startedAt, r.finishedAt),
    agents: null,
    results: { found: r.stats.candidates, validated: r.stats.kept, rejected: r.stats.rejected, saved: r.stats.added },
    failures: null,
    skipped: { count: r.stats.skipped, reasons: r.stats.skipped ? [{ reason: 'budget reached', count: r.stats.skipped }] : [] },
    error: null,
    outcomes: [],
    outlineOnly: true,
    funnel: null,
  };
}

type Timing = { status: ActivityStatus; queuedAt: string; startedAt: string | null; finishedAt: string | null };

/**
 * Follows one run at a time. update() takes each snapshot the system sends and returns the
 * activity with timing, plus the ids whose status changed since the previous snapshot.
 */
export class RunObserver {
  private runId: string | null = null;
  private times = new Map<string, Timing>();
  private now: () => Date;
  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  /** The run being followed changed: forget the old one's timing. */
  private reset(run: RunSnapshot | null) {
    this.runId = run?.id ?? null;
    this.times.clear();
  }

  update(run: RunSnapshot | null): { live: LiveActivity; agents: ActivityAgent[] } {
    if ((run?.id ?? null) !== this.runId) this.reset(run);
    const stamp = this.now().toISOString();
    if (!run) return { live: { run: null, agents: [], flows: [], counts: countsOf([]), changed: [], serverTime: stamp }, agents: [] };
    const shapes = shapesOf(run);
    const changed: string[] = [];
    const agents = shapes.map((s): ActivityAgent => {
      let t = this.times.get(s.id);
      if (!t || t.status !== s.status) {
        changed.push(s.id);
        // The master and managers are created already running: they start when first seen.
        const queuedAt = t?.queuedAt ?? stamp;
        const startedAt = t?.startedAt ?? (s.status === 'queued' || s.status === 'skipped' ? null : stamp);
        const finishedAt = TERMINAL.includes(s.status) ? (t?.finishedAt ?? (run.finishedAt && !t ? run.finishedAt : stamp)) : null;
        t = { status: s.status, queuedAt, startedAt, finishedAt };
        this.times.set(s.id, t);
      }
      return { ...s, queuedAt: t.queuedAt, startedAt: t.startedAt, finishedAt: t.finishedAt };
    });
    return {
      live: { run: runOf(run, agents), agents, flows: flowsOf(run, shapes), counts: countsOf(agents), changed: changed.reverse(), serverTime: stamp },
      agents,
    };
  }
}
