// Keeps one observer per student's agent system, sends its activity to the Agents page viewers,
// and writes a report to the history when each run ends. Read-only towards the agents.
import type { AgentSystem } from '../agents/system.ts';
import type { RunSnapshot } from '../agents/types.ts';
import { keep, MemoryRunHistory, type RunHistory } from './history.ts';
import { outlineReport, reportOf, RunObserver } from './observer.ts';
import type { LiveActivity, RunReport } from './types.ts';

export type ActivityEvent = { event: 'activity'; data: LiveActivity } | { event: 'history'; data: RunReport[] };
type Viewer = (message: ActivityEvent) => void;

interface Entry {
  key: string;
  system: AgentSystem;
  observer: RunObserver;
  viewers: Set<Viewer>;
  last: LiveActivity;
  current: RunSnapshot | null;
  reported: Set<string>;
  changed: string[];
  timer: NodeJS.Timeout | null;
}

export interface HubOptions {
  history?: RunHistory;
  now?: () => Date;
  /** Activity messages are coalesced into one per this many milliseconds. 0 sends each at once. */
  throttleMs?: number;
}

const runKey = (r: { id: string; startedAt: string }) => `${r.id}@${r.startedAt}`;

export class ActivityHub {
  private entries = new WeakMap<AgentSystem, Entry>();
  private history: RunHistory;
  private now: () => Date;
  private throttleMs: number;

  constructor(opts: HubOptions = {}) {
    this.history = opts.history ?? new MemoryRunHistory();
    this.now = opts.now ?? (() => new Date());
    this.throttleMs = opts.throttleMs ?? 150;
  }

  /** Start following a student's agents. `key` names them in the history. Safe to call twice. */
  attach(key: string, system: AgentSystem) {
    if (this.entries.has(system)) return;
    const observer = new RunObserver(this.now);
    const current = system.currentRun();
    const entry: Entry = { key, system, observer, viewers: new Set(), last: observer.update(current).live, current, reported: new Set(), changed: [], timer: null };
    this.entries.set(system, entry);
    system.observe((event, data) => {
      if (event === 'run') this.onRun(entry, data as RunSnapshot | null);
    });
  }

  private onRun(e: Entry, run: RunSnapshot | null) {
    // A run can end and the next start before a message goes out: report the old one from its
    // own snapshot (the system keeps updating that object until the run is over).
    const previous = e.current;
    if (previous && previous.id !== run?.id && previous.status !== 'running') this.report(e, previous, e.observer.update(previous).agents);
    const { live, agents } = e.observer.update(run);
    e.current = run;
    e.last = live;
    e.changed.push(...live.changed);
    if (run && run.status !== 'running') this.report(e, run, agents);
    this.queue(e);
  }

  private report(e: Entry, run: RunSnapshot, agents: ReturnType<RunObserver['update']>['agents']) {
    const id = runKey(run);
    if (e.reported.has(id)) return;
    e.reported.add(id);
    this.history.add(e.key, reportOf(run, agents));
    this.send(e, { event: 'history', data: this.historyOf(e) });
  }

  private queue(e: Entry) {
    const flush = () => {
      e.timer = null;
      const changed = [...new Set(e.changed)];
      e.changed = [];
      this.send(e, { event: 'activity', data: { ...e.last, changed } });
    };
    if (this.throttleMs <= 0) return flush();
    e.timer ??= setTimeout(flush, this.throttleMs);
  }

  private send(e: Entry, message: ActivityEvent) {
    for (const v of e.viewers) v(message);
  }

  private entry(system: AgentSystem) {
    const e = this.entries.get(system);
    if (!e) throw new Error('activity hub: these agents were never attached');
    return e;
  }

  /** The current run's activity as a full refresh. */
  live(system: AgentSystem): LiveActivity {
    return { ...this.entry(system).last, changed: [], serverTime: this.now().toISOString() };
  }

  private historyOf(e: Entry): RunReport[] {
    // Runs from before reports were kept still show, as outlines, from the student's memory.
    const outlines = e.system.searchHistory().runs.map(outlineReport);
    const kept = this.history.list(e.key);
    const known = new Set(kept.map(runKey));
    return keep([...kept, ...outlines.filter((o) => !known.has(runKey(o)))]);
  }

  /** Reports of the last runs, newest first. */
  reports(system: AgentSystem): RunReport[] {
    return this.historyOf(this.entry(system));
  }

  /** Be told of every activity and history message for these agents until the returned function is called. */
  watch(system: AgentSystem, viewer: Viewer) {
    const e = this.entry(system);
    e.viewers.add(viewer);
    return () => e.viewers.delete(viewer);
  }
}
