// The live map: one layer per level, one node per agent, and the arrows between them.
// Pure, so grouping, the action line, the popover and arrow direction are tested without a browser.
import type { Level, NodeStatus } from '../agents/engine.ts';
import type { ActivityAgent, ActivityFlow, ActivityLevel, ActivityStatus, AgentKind } from './types.ts';
import { EMPTY_HINT, LEVEL_TITLE, STATUS_WORD, countsText, elapsedMs, formatDuration, rowDetail, rowTitle } from './view.ts';

export interface MapColumn {
  id: string;
  title: string;
}

export interface LayerGroup {
  id: string;
  title: string;
  agents: ActivityAgent[];
}

export interface Layer {
  level: ActivityLevel;
  title: string;
  counts: string;
  empty: string;
  /** One group per manager column. Master and presentation are a single centred group. */
  groups: LayerGroup[];
}

export interface MapArrow {
  id: string;
  direction: 'down' | 'up';
  kind: 'task' | 'result';
  /** Visible count, already pluralised: "2 tasks". */
  label: string;
  active: boolean;
  /** band: one centred arrow (narrow layout, and the arrows that are not per manager). column: under that manager. */
  place: 'band' | 'column';
  columnId: string | null;
  /** The layer this arrow sits under. */
  after: ActivityLevel;
  /** One sentence for a screen reader. */
  text: string;
}

export interface PopoverContent {
  name: string;
  doing: string;
  task: string;
  target: string | null;
  status: string;
  elapsed: string;
  /** Newest first, at most four. */
  recent: { at: string; text: string }[];
  results: string[];
}

export interface MapStat {
  label: string;
  value: number;
}

const KIND_LABEL: Record<AgentKind, string> = {
  master: 'Master',
  manager: 'Manager',
  scout: 'Scout',
  reader: 'Reader',
  application: 'Application',
  deadline: 'Deadline',
  image: 'Picture',
  'guide-research': 'Guide',
  'guide-review': 'Guide review',
  criteria: 'Criteria',
  status: 'Status',
  presentation: 'Presenter',
};

const busy = (agents: ActivityAgent[]) => agents.some((a) => a.status === 'queued' || a.status === 'running');

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function sentence(label: string, direction: 'down' | 'up', dest: string, active: boolean): string {
  return `${label}, ${direction} to ${dest}${active ? ', work moving now' : ''}.`;
}

/** The columns the manager, worker and validation bands share, in manager order. */
export function managerColumns(agents: ActivityAgent[]): MapColumn[] {
  const managers = agents.filter((a) => a.level === 'manager');
  const ids = new Set(managers.map((m) => m.id));
  const cols: MapColumn[] = managers.map((m) => ({ id: m.id, title: m.name }));
  const needsOther = agents.some((a) => (a.level === 'worker' || a.level === 'validation') && (!a.managerId || !ids.has(a.managerId)));
  if (needsOther) cols.push({ id: 'other', title: 'Other work' });
  if (!cols.length) cols.push({ id: 'solo', title: '' });
  return cols;
}

function inColumn(agent: ActivityAgent, columnId: string, managerIds: Set<string>): boolean {
  // A manager sits in their own column, even when the feed did not set managerId.
  if (agent.level === 'manager') return agent.id === columnId;
  if (columnId === 'solo') return true;
  if (columnId === 'other') return !agent.managerId || !managerIds.has(agent.managerId);
  return agent.managerId === columnId;
}

/** Five layers, top to bottom. Each real agent is in exactly one group. */
export function layersOf(agents: ActivityAgent[]): Layer[] {
  const columns = managerColumns(agents);
  const managerIds = new Set(columns.filter((c) => c.id !== 'other' && c.id !== 'solo').map((c) => c.id));
  return (['master', 'manager', 'worker', 'validation', 'presentation'] as const).map((level) => {
    const mine = agents.filter((a) => a.level === level);
    const groups: LayerGroup[] =
      level === 'master' || level === 'presentation'
        ? [{ id: level, title: LEVEL_TITLE[level], agents: mine }]
        : columns.map((column) => ({
            id: column.id,
            title: column.title,
            agents: mine.filter((a) => inColumn(a, column.id, managerIds)),
          }));
    return { level, title: LEVEL_TITLE[level], counts: countsText(mine), empty: EMPTY_HINT[level], groups };
  });
}

/** The short line under an agent's icon: its latest action, or what it is waiting on. */
export function actionText(agent: ActivityAgent): string {
  return rowDetail(agent);
}

export function kindLabel(kind: AgentKind): string {
  return KIND_LABEL[kind];
}

/** Grok bot shape for an activity level. Validation and presentation use the old bot names. */
export function botLevel(level: ActivityLevel): Level {
  if (level === 'validation') return 'validator';
  if (level === 'presentation') return 'presenter';
  return level;
}

export function botStatus(status: ActivityStatus): NodeStatus {
  if (status === 'running') return 'working';
  if (status === 'queued' || status === 'skipped') return 'waiting';
  if (status === 'done') return 'done';
  return 'idle';
}

function postings(reviews: ActivityAgent[]): number {
  return new Set(reviews.map((r) => r.target).filter((t): t is string => !!t)).size;
}

/** What this agent has to show for itself, worked out from the whole run. */
export function resultCounts(agent: ActivityAgent, agents: ActivityAgent[]): string[] {
  if (agent.level === 'master') {
    const n = agents.filter((a) => a.level === 'manager').length;
    return [plural(n, 'manager') + ' briefed'];
  }
  if (agent.level === 'manager') {
    const workers = agents.filter((a) => a.level === 'worker' && a.managerId === agent.id);
    const reviews = agents.filter((a) => a.level === 'validation' && a.managerId === agent.id);
    const sent = workers.filter((w) => w.status !== 'queued' && w.status !== 'skipped').length;
    const kept = reviews.filter((r) => r.verdict === 'kept').length;
    const rejected = reviews.filter((r) => r.verdict === 'rejected').length;
    return [plural(sent, 'worker') + ' sent', plural(postings(reviews), 'posting') + ' brought back', `${kept} kept · ${rejected} rejected`];
  }
  if (agent.kind === 'scout') {
    const n = agent.detail?.match(/(\d+)/);
    return [n ? plural(Number(n[1]), 'lead') : agent.status === 'done' ? 'Search finished' : 'No leads yet'];
  }
  if (agent.kind === 'reader' || agent.kind === 'application') {
    if (agent.status === 'running' || agent.status === 'queued') return ['Still reading'];
    if (agent.status === 'failed' || agent.status === 'timed_out' || agent.status === 'skipped') return ['No posting'];
    const empty = /no posting|nothing found|empty/i.test(agent.detail ?? '');
    return [empty ? 'No posting' : 'Posting found'];
  }
  if (agent.level === 'validation') {
    if (agent.verdict === 'kept') return ['Kept'];
    if (agent.verdict === 'rejected') return ['Rejected'];
    if (agent.status === 'failed' || agent.status === 'timed_out') return ['Review did not finish'];
    return ['No verdict yet'];
  }
  if (agent.level === 'presentation') {
    const n = savedCount(agents);
    return [n ? plural(n, 'posting') + ' saved to your feed' : 'Nothing saved yet'];
  }
  return [agent.detail?.trim() || 'No result yet'];
}

/** New postings the presentation agent put in the feed, from its own action line. */
export function savedCount(agents: ActivityAgent[]): number {
  const presenter = agents.find((a) => a.level === 'presentation');
  const match = presenter?.detail?.match(/(\d+)\s+new/);
  return match ? Number(match[1]) : 0;
}

export function popoverOf(agent: ActivityAgent, agents: ActivityAgent[], now: number): PopoverContent {
  return {
    name: rowTitle(agent),
    doing: actionText(agent),
    task: agent.task,
    target: agent.target,
    status: STATUS_WORD[agent.status],
    elapsed: formatDuration(elapsedMs(agent, now)),
    recent: (agent.recent ?? []).slice(0, 4),
    results: resultCounts(agent, agents),
  };
}

export function mapStats(agents: ActivityAgent[], flows: ActivityFlow[]): MapStat[] {
  const found = flows.find((f) => f.from === 'worker' && f.to === 'validation')?.count ?? 0;
  const kept = flows.find((f) => f.from === 'validation' && f.to === 'presentation')?.count ?? 0;
  return [
    { label: 'agents working', value: agents.filter((a) => a.status === 'running').length },
    { label: 'agents done', value: agents.filter((a) => a.status === 'done').length },
    { label: 'pages read', value: agents.filter((a) => (a.kind === 'reader' || a.kind === 'application') && a.status === 'done').length },
    { label: 'found', value: found },
    { label: 'kept', value: kept },
    { label: 'in your feed', value: savedCount(agents) },
  ];
}

function arrow(part: {
  id: string;
  direction: 'down' | 'up';
  kind: 'task' | 'result';
  count: number;
  unit: string;
  active: boolean;
  place: 'band' | 'column';
  columnId: string | null;
  after: ActivityLevel;
  dest: string;
}): MapArrow {
  const fixed = part.unit === 'brought back' || part.unit === 'to review' || part.unit === 'kept' || part.unit === 'saved';
  const label = fixed ? `${part.count} ${part.unit}` : plural(part.count, part.unit);
  return {
    id: part.id,
    direction: part.direction,
    kind: part.kind,
    label,
    active: part.active,
    place: part.place,
    columnId: part.columnId,
    after: part.after,
    text: sentence(label, part.direction, part.dest, part.active),
  };
}

/**
 * Assignments point down. A manager's workers point results back up to that manager.
 * From there, results point down the pipeline: validation, presentation, your feed.
 * An arrow is active only while the agent receiving that work is queued or running.
 */
export function arrowsOf(agents: ActivityAgent[], flows: ActivityFlow[]): MapArrow[] {
  const columns = managerColumns(agents);
  const managerIds = new Set(agents.filter((a) => a.level === 'manager').map((a) => a.id));
  const out: MapArrow[] = [];

  const managers = agents.filter((a) => a.level === 'manager');
  const briefActive = busy(managers);
  const briefCount = flows.find((f) => f.from === 'master' && f.to === 'manager')?.count ?? managers.length;
  out.push(
    arrow({
      id: 'band-briefs',
      direction: 'down',
      kind: 'task',
      count: briefCount,
      unit: 'brief',
      active: briefActive,
      place: 'band',
      columnId: null,
      after: 'master',
      dest: 'the search managers',
    }),
  );

  const workers = agents.filter((a) => a.level === 'worker');
  const taskFlow = flows.find((f) => f.from === 'manager' && f.to === 'worker');
  const taskActive = busy(workers);
  out.push(
    arrow({
      id: 'band-tasks',
      direction: 'down',
      kind: 'task',
      count: taskFlow?.count ?? workers.filter((w) => w.status !== 'skipped').length,
      unit: 'task',
      active: taskActive,
      place: 'band',
      columnId: null,
      after: 'manager',
      dest: 'the workers',
    }),
  );

  const reviews = agents.filter((a) => a.level === 'validation');
  const brought = postings(reviews);
  const upActive = busy(managers);
  out.push(
    arrow({
      id: 'band-back',
      direction: 'up',
      kind: 'result',
      count: brought,
      unit: 'brought back',
      active: upActive,
      place: 'band',
      columnId: null,
      after: 'manager',
      dest: 'the search managers',
    }),
  );

  for (const column of columns) {
    const mine = workers.filter((a) => inColumn(a, column.id, managerIds));
    const sent = mine.filter((w) => w.status !== 'skipped').length;
    const manager = agents.find((a) => a.id === column.id && a.level === 'manager');
    out.push(
      arrow({
        id: `col-tasks-${column.id}`,
        direction: 'down',
        kind: 'task',
        count: sent,
        unit: 'task',
        active: busy(mine),
        place: 'column',
        columnId: column.id,
        after: 'manager',
        dest: manager ? `${manager.name}'s workers` : 'the workers',
      }),
    );
    if (manager) {
      const back = postings(reviews.filter((a) => inColumn(a, column.id, managerIds)));
      const managerBusy = manager.status === 'queued' || manager.status === 'running';
      out.push(
        arrow({
          id: `col-back-${column.id}`,
          direction: 'up',
          kind: 'result',
          count: back,
          unit: 'brought back',
          active: managerBusy,
          place: 'column',
          columnId: column.id,
          after: 'manager',
          dest: manager.name,
        }),
      );
    }
  }

  const reviewFlow = flows.find((f) => f.from === 'worker' && f.to === 'validation');
  out.push(
    arrow({
      id: 'band-review',
      direction: 'down',
      kind: 'result',
      count: reviewFlow?.count ?? brought,
      unit: 'to review',
      active: reviewFlow?.active ?? busy(reviews),
      place: 'band',
      columnId: null,
      after: 'worker',
      dest: 'validation',
    }),
  );
  for (const column of columns) {
    const mine = reviews.filter((a) => inColumn(a, column.id, managerIds));
    out.push(
      arrow({
        id: `col-review-${column.id}`,
        direction: 'down',
        kind: 'result',
        count: postings(mine),
        unit: 'to review',
        active: busy(mine),
        place: 'column',
        columnId: column.id,
        after: 'worker',
        dest: 'validation',
      }),
    );
  }

  const keptFlow = flows.find((f) => f.from === 'validation' && f.to === 'presentation');
  const presentation = agents.filter((a) => a.level === 'presentation');
  out.push(
    arrow({
      id: 'band-kept',
      direction: 'down',
      kind: 'result',
      count: keptFlow?.count ?? 0,
      unit: 'kept',
      active: keptFlow?.active ?? busy(presentation),
      place: 'band',
      columnId: null,
      after: 'validation',
      dest: 'presentation',
    }),
  );

  const saved = savedCount(agents);
  out.push(
    arrow({
      id: 'band-saved',
      direction: 'down',
      kind: 'result',
      count: saved,
      unit: 'saved',
      active: busy(presentation),
      place: 'band',
      columnId: null,
      after: 'presentation',
      dest: 'your feed',
    }),
  );

  return out;
}
