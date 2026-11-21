// The Agents page's live activity feed, as the backend sends it (backend/src/activity/types.ts is
// the source of truth; keep the two in step).
type Trigger = 'manual' | 'profile' | 'feedback' | 'schedule' | 'first' | 'fill' | 'auto';
type RunStatus = 'running' | 'complete' | 'failed' | 'stopped';

export type ActivityLevel = 'master' | 'manager' | 'worker' | 'validation' | 'presentation';
export const LEVELS: ActivityLevel[] = ['master', 'manager', 'worker', 'validation', 'presentation'];

/** timed_out: failed because a call ran out of time. skipped: never ran (budget, or the run stopped). */
export type ActivityStatus = 'queued' | 'running' | 'done' | 'failed' | 'timed_out' | 'skipped';

export type AgentKind =
  | 'master'
  | 'manager'
  | 'scout'
  | 'reader'
  | 'application'
  | 'deadline'
  | 'image'
  | 'guide-research'
  | 'guide-review'
  | 'criteria'
  | 'status'
  | 'presentation';

export interface ActivityAgent {
  id: string;
  level: ActivityLevel;
  kind: AgentKind;
  /** What it is, in a few words: "Reader", "Internships manager". */
  name: string;
  /** What it was asked to do: "Read: Data Science Society new member application". */
  task: string;
  /** The thing it works on, when there is one: a posting under review. */
  target: string | null;
  /** The search manager it works for, for workers and reviews. */
  managerId: string | null;
  status: ActivityStatus;
  /** Progress while working, the outcome when finished, the reason when it failed or was skipped. */
  detail: string | null;
  /** Validation only: what the review decided. */
  verdict: 'kept' | 'rejected' | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Work handed from one level to the next. active: the receiving level has work queued or running. */
export interface ActivityFlow {
  from: ActivityLevel;
  to: ActivityLevel;
  kind: 'task' | 'result';
  /** Hand-offs so far this run, counted in `unit`. */
  count: number;
  unit: string;
  active: boolean;
}

export type RunOutcome = 'running' | 'finished' | 'partly_failed' | 'failed' | 'stopped';

export interface ActivityRun {
  id: string;
  number: number;
  trigger: Trigger;
  /** Why the run started, in words. */
  triggerText: string;
  /** What the agents were asked to find: the master's brief, or the trigger before the brief exists. */
  request: string;
  mode: 'simulated' | 'live';
  status: RunStatus;
  outcome: RunOutcome;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface LiveActivity {
  run: ActivityRun | null;
  agents: ActivityAgent[];
  flows: ActivityFlow[];
  counts: Record<ActivityStatus, number>;
  /** Agents whose status changed since the last message, newest first. Empty on a full refresh. */
  changed: string[];
  /** The server's clock when this was sent, so elapsed times do not depend on the browser's clock. */
  serverTime: string;
}

/** One agent's brief outcome, kept in a run report. */
export interface AgentOutcome {
  id: string;
  level: ActivityLevel;
  name: string;
  task: string;
  status: ActivityStatus;
  outcome: string | null;
  durationMs: number | null;
}

export interface RunReport {
  id: string;
  number: number;
  trigger: Trigger;
  triggerText: string;
  /** Null for runs recorded before reports were kept. */
  request: string | null;
  mode: 'simulated' | 'live' | null;
  status: RunStatus;
  outcome: RunOutcome;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Null for runs recorded before reports were kept. */
  agents: { total: number; byLevel: Record<ActivityLevel, number> } | null;
  /** found: postings the readers brought back. validated: kept by every review. saved: new in the feed. */
  results: { found: number; validated: number; rejected: number; saved: number };
  /** Agents that failed or timed out, with the most common reasons. Null when not recorded. */
  failures: { count: number; reasons: { reason: string; count: number }[] } | null;
  /** Jobs that never ran, mostly for budget. */
  skipped: { count: number; reasons: { reason: string; count: number }[] };
  error: string | null;
  /** Failures first. Empty for runs recorded before reports were kept. */
  outcomes: AgentOutcome[];
  /** True for runs recorded before per-agent reports were kept: only the outline is known. */
  outlineOnly: boolean;
}

/** Reports kept per student; the page shows 5 and up to 10 with Show more. */
export const HISTORY_LIMIT = 10;
