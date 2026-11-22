// Pure helpers that turn the activity feed into what the live view and the history show.
// No React and no network here, so every state can be tested directly.
import { LEVELS, type ActivityAgent, type ActivityFlow, type ActivityLevel, type ActivityStatus, type LiveActivity, type ReasonCount, type RunFunnel, type RunOutcome, type RunReport } from './types.ts';

export const LEVEL_TITLE: Record<ActivityLevel, string> = {
  master: 'Master',
  manager: 'Search managers',
  worker: 'Workers',
  validation: 'Validation',
  presentation: 'Presentation',
};

/** Short level names for the outcome list in History. */
export const LEVEL_SHORT: Record<ActivityLevel, string> = { master: 'Master', manager: 'Manager', worker: 'Worker', validation: 'Validation', presentation: 'Presentation' };

export const STATUS_WORD: Record<ActivityStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  timed_out: 'Timed out',
  skipped: 'Skipped',
};

export const OUTCOME_WORD: Record<RunOutcome, string> = {
  running: 'Running',
  finished: 'Finished',
  partly_failed: 'Partly failed',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** What each empty column says while there is nothing in it. */
const EMPTY_HINT: Record<ActivityLevel, string> = {
  master: 'Starts first, when a run begins.',
  manager: 'Briefed by the master.',
  worker: 'Sent by the managers.',
  validation: 'Reviews each posting the readers bring back.',
  presentation: 'Starts when validation has kept postings.',
};

export interface WorkerGroup {
  managerId: string | null;
  title: string;
  agents: ActivityAgent[];
}

export interface Column {
  level: ActivityLevel;
  title: string;
  /** "3 running · 6 done · 2 failed", or "none yet". */
  counts: string;
  agents: ActivityAgent[];
  /** Workers only: grouped under the manager that sent them, in the managers' order. */
  groups: WorkerGroup[] | null;
  /** The hand-off from this level to the next; null for the last level. */
  flow: ActivityFlow | null;
  empty: string;
}

const COUNT_ORDER: ActivityStatus[] = ['running', 'queued', 'done', 'failed', 'timed_out', 'skipped'];

export function countsText(agents: { status: ActivityStatus }[]): string {
  if (!agents.length) return 'none yet';
  const parts = COUNT_ORDER.map((s) => [s, agents.filter((a) => a.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${STATUS_WORD[s].toLowerCase()}`);
  return parts.join(' · ');
}

export function columnsOf(live: LiveActivity | null): Column[] {
  const agents = live?.agents ?? [];
  const managers = agents.filter((a) => a.level === 'manager');
  return LEVELS.map((level) => {
    const mine = agents.filter((a) => a.level === level);
    let groups: WorkerGroup[] | null = null;
    if (level === 'worker') {
      groups = managers.map((m) => ({ managerId: m.id, title: m.name, agents: mine.filter((a) => a.managerId === m.id) })).filter((g) => g.agents.length);
      const loose = mine.filter((a) => !a.managerId || !managers.some((m) => m.id === a.managerId));
      if (loose.length) groups.push({ managerId: null, title: 'Other work', agents: loose });
    }
    return {
      level,
      title: LEVEL_TITLE[level],
      counts: countsText(mine),
      agents: mine,
      groups,
      flow: live?.flows.find((f) => f.from === level) ?? null,
      empty: EMPTY_HINT[level],
    };
  });
}

const TASK_PREFIX = /^(Search|Read|Picture|Deadline|Application|Guide):\s*/;

/** The row title: what the agent is and what it works on, e.g. "Reader · Data Science Society". */
export function rowTitle(a: ActivityAgent): string {
  if (a.level === 'worker') return `${a.name} · ${a.task.replace(TASK_PREFIX, '')}`;
  if (a.level === 'validation') return `${a.kind === 'criteria' ? 'Criteria' : 'Status'} · ${a.target ?? a.task}`;
  return a.name;
}

/** The second line: progress, outcome or reason; the task when there is nothing else to say. */
export function rowDetail(a: ActivityAgent): string {
  if (a.detail) return a.detail;
  if (a.status === 'queued') return 'Waiting for a free worker';
  return a.task;
}

export function elapsedMs(a: Pick<ActivityAgent, 'startedAt' | 'finishedAt'>, now: number): number | null {
  if (!a.startedAt) return null;
  const end = a.finishedAt ? Date.parse(a.finishedAt) : now;
  return Math.max(0, end - Date.parse(a.startedAt));
}

/** 0:42, 4:28, 1:02:03. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** The whole row as one sentence for screen readers. */
export function rowLabel(a: ActivityAgent, now: number): string {
  const time = elapsedMs(a, now);
  return `${rowTitle(a)}. ${STATUS_WORD[a.status]}${time !== null ? `, ${formatDuration(time)}` : ''}. ${rowDetail(a)}`;
}

/** Messages for the polite live region: agents that just finished badly, and a run that ended. */
export function announcements(prev: LiveActivity | null, next: LiveActivity): string[] {
  const out: string[] = [];
  const before = new Map((prev?.agents ?? []).map((a) => [a.id, a.status]));
  for (const id of next.changed) {
    const a = next.agents.find((x) => x.id === id);
    if (!a || before.get(id) === a.status) continue;
    if (a.status === 'failed' || a.status === 'timed_out') out.push(`${rowTitle(a)} ${STATUS_WORD[a.status].toLowerCase()}: ${rowDetail(a)}`);
  }
  const was = prev?.run?.id === next.run?.id ? prev?.run?.outcome : undefined;
  if (next.run && next.run.outcome !== 'running' && was === 'running') out.push(`Run ${next.run.number} ${OUTCOME_WORD[next.run.outcome].toLowerCase()}.`);
  if (next.run && next.run.outcome === 'running' && prev?.run?.id !== next.run.id) out.push(`Run ${next.run.number} started.`);
  return out;
}

// ---- history ------------------------------------------------------------------------------

/** The student's local day, YYYY-MM-DD. */
export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function dayLabel(key: string, today = new Date()): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(date.toISOString()) === dayKey(today.toISOString())) return 'Today';
  if (dayKey(date.toISOString()) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function whenText(iso: string, today = new Date()): string {
  const time = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel(dayKey(iso), today)} · ${time}`;
}

/** The days that have runs, newest first, for the day filter. */
export function historyDays(history: RunReport[]): string[] {
  return [...new Set(history.map((r) => dayKey(r.startedAt)))];
}

export const HISTORY_SHOWN = 5;

/** The runs shown for a day filter (null: all days): 5, or up to 10 after Show more. */
export function visibleHistory(history: RunReport[], day: string | null, more: boolean) {
  const matching = day ? history.filter((r) => dayKey(r.startedAt) === day) : history;
  const shown = matching.slice(0, more ? 10 : HISTORY_SHOWN);
  return { shown, total: matching.length, canShowMore: !more && matching.length > HISTORY_SHOWN };
}

/** The warning line under a run's request: what went wrong, most important first. */
export function failureLine(r: RunReport): string | null {
  if (r.outlineOnly) return null;
  const parts: string[] = [];
  const failed = r.outcomes.filter((o) => o.status === 'failed').length;
  const timedOut = r.outcomes.filter((o) => o.status === 'timed_out').length;
  if (r.error) parts.push(`Run failed: ${r.error}`);
  if (failed) parts.push(`${failed} failed`);
  if (timedOut) parts.push(`${timedOut} timed out`);
  if (r.skipped.count) parts.push(`${r.skipped.count} skipped${r.skipped.reasons[0] ? `: ${r.skipped.reasons[0].reason}` : ''}`);
  if (r.results.rejected) parts.push(`${r.results.rejected} rejected by validation`);
  return parts.length ? parts.join(' · ') : null;
}

/** The line under an outline-only run: what is known. */
export function outlineLine(r: RunReport): string {
  const parts = ['Recorded before agent reports were kept: outline only'];
  if (r.skipped.count) parts.push(`${r.skipped.count} skipped: ${r.skipped.reasons[0]?.reason ?? 'budget reached'}`);
  if (r.results.rejected) parts.push(`${r.results.rejected} rejected by validation`);
  return parts.join(' · ');
}

export interface FunnelStep {
  label: string;
  value: number;
  unit: string;
  /** What dropped at this stage and why, most important first. */
  notes: string[];
}

const top = (reasons: ReasonCount[]) => (reasons[0] ? `: ${reasons[0].reason}${reasons.length > 1 ? ' and others' : ''}` : '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The run's funnel as five stages, from searching to the feed, each with what it lost. */
export function funnelSteps(f: RunFunnel): FunnelStep[] {
  const searched: string[] = [];
  if (f.duplicates) searched.push(`${plural(f.duplicates, 'duplicate')} already taken by another worker`);
  if (f.scouts.failed) searched.push(`${plural(f.scouts.failed, 'search')} failed`);
  if (f.scouts.skipped) searched.push(`${plural(f.scouts.skipped, 'search', 'searches')} skipped`);
  const read: string[] = [];
  if (f.readers.skipped) read.push(`${f.readers.skipped} not read${top(f.readers.skippedReasons)}`);
  if (f.readers.empty) read.push(`${f.readers.empty} with no posting`);
  if (f.readers.failed) read.push(`${f.readers.failed} failed`);
  const reviewed: string[] = [];
  if (f.noLink) reviewed.push(`${f.noLink} dropped with no usable link`);
  if (f.alreadyRejected) reviewed.push(`${f.alreadyRejected} turned down in an earlier run`);
  if (f.alreadyBelowThreshold) reviewed.push(`${f.alreadyBelowThreshold} still below your minimum match from an earlier run`);
  const kept: string[] = [];
  if (f.rejected) kept.push(`${f.rejected} rejected${top(f.rejectedReasons)}`);
  if (f.belowThreshold) kept.push(`${f.belowThreshold} below your minimum match${f.threshold !== undefined ? ` of ${f.threshold}%` : ''}`);
  if (f.unfinishedReviews) kept.push(`${plural(f.unfinishedReviews, 'review')} did not finish; reviewed again next time`);
  const saved = f.kept > f.saved ? [`${f.kept - f.saved} already in your feed`] : [];
  return [
    { label: 'Searched', value: f.leads, unit: f.leads === 1 ? 'lead' : 'leads', notes: [`from ${plural(f.scouts.done, 'search', 'searches')}`, ...searched] },
    { label: 'Read', value: f.readers.done, unit: f.readers.done === 1 ? 'page' : 'pages', notes: read },
    { label: 'Reviewed', value: f.reviewed, unit: f.reviewed === 1 ? 'posting' : 'postings', notes: reviewed },
    { label: 'Kept', value: f.kept, unit: f.kept === 1 ? 'posting' : 'postings', notes: kept },
    { label: 'Saved', value: f.saved, unit: 'new in your feed', notes: saved },
  ];
}
