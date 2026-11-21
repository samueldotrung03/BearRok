// The live view at the top of the Agents page: every agent of the current run in five level
// columns, what each is doing and for how long, and the work flowing from one level to the next.
// Figma: S1 Agents / running (5:7) and its states. Props in, markup out; the page owns the data.
import { AlertTriangle, CircleX, RefreshCw, Square } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ActivityState } from '../../../lib/activity/useActivity.ts';
import type { ActivityAgent, ActivityFlow, LiveActivity } from '../../../lib/activity/types.ts';
import { announcements, columnsOf, elapsedMs, formatDuration, OUTCOME_WORD, rowDetail, rowLabel, rowTitle, STATUS_WORD, type Column } from '../../../lib/activity/view.ts';
import { AnimatedNumber } from '../AnimatedNumber.tsx';

const FLOW_TO: Record<ActivityFlow['to'], string> = { master: 'the master', manager: 'the search managers', worker: 'the workers', validation: 'validation', presentation: 'presentation' };

export interface LiveBoardProps {
  state: Pick<ActivityState, 'status' | 'live' | 'attempt' | 'error'>;
  /** The current time on the server's clock. */
  now: number;
  reduced: boolean;
  /** Run now / Stop search and Agent settings, owned by the page. */
  actions: ReactNode;
  /** True when History has at least one run, so the empty state can point at it. */
  hasHistory: boolean;
  onRetry: () => void;
}

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="ag-chip-dark ag-live-chip" data-tone={tone}>
      <span className="ag-live-dot" data-status={tone} aria-hidden="true" />
      {children}
    </span>
  );
}

function Banner({ tone, icon, children, action }: { tone: 'warn' | 'danger' | 'quiet'; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ag-live-banner" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="ag-live-banner-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

function Flow({ flow, reduced }: { flow: ActivityFlow; reduced: boolean }) {
  return (
    <span className="ag-flow" data-kind={flow.kind} data-active={flow.active} data-reduced={reduced}>
      <span className="ag-flow-count">
        <AnimatedNumber value={flow.count} reduced={reduced} /> {flow.unit}
      </span>
      <span className="ag-flow-track" aria-hidden="true" />
      <span className="sr-only">
        {` handed to ${FLOW_TO[flow.to]}${flow.active ? ', work moving now' : ''}.`}
      </span>
    </span>
  );
}

const AgentRow = memo(function AgentRow({ agent, now }: { agent: ActivityAgent; now: number }) {
  const time = elapsedMs(agent, now);
  const title = rowTitle(agent);
  const detail = rowDetail(agent);
  return (
    <li className="ag-live-row" data-status={agent.status} tabIndex={-1} aria-label={rowLabel(agent, now)} title={`${title}\n${STATUS_WORD[agent.status]}: ${detail}`}>
      <span className="ag-live-row-top">
        <span className="ag-live-dot" data-status={agent.status} aria-hidden="true" />
        <span className="ag-live-row-name">{title}</span>
        <span className="ag-live-row-time tabular-nums">{formatDuration(time)}</span>
      </span>
      <span className="ag-live-row-detail">
        <span className="ag-live-row-word">{STATUS_WORD[agent.status]}</span>
        <span className="ag-live-row-text">{detail}</span>
      </span>
    </li>
  );
});

/** Arrow keys move between rows inside a column; Tab moves on to the next column. */
function onListKeys(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.ag-live-row')];
  if (!rows.length) return;
  e.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
  rows[next]!.focus();
}

function LevelColumn({ column, now, reduced, loading }: { column: Column; now: number; reduced: boolean; loading: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  // The bottom edge dissolves only while more rows continue below it.
  const [more, setMore] = useState(false);
  const check = () => {
    const el = list.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useLayoutEffect(check, [column.agents.length]);
  const rows = (agents: ActivityAgent[]) => agents.map((a) => <AgentRow key={a.id} agent={a} now={now} />);
  const id = `ag-live-col-${column.level}`;
  return (
    <section className="ag-live-col" aria-labelledby={id}>
      <header className="ag-live-col-head">
        <span className="min-w-0">
          <h3 id={id} className="ag-live-col-title">
            {column.title}
          </h3>
          <span className="ag-live-col-counts">{loading ? '…' : column.counts}</span>
        </span>
        {column.flow && !loading && <Flow flow={column.flow} reduced={reduced} />}
      </header>
      <div ref={list} className="ag-live-list" data-more={more} onScroll={check} tabIndex={column.agents.length ? 0 : -1} onKeyDown={onListKeys} aria-label={`${column.title}: ${column.counts}`}>
        {loading ? (
          <ul className="ag-live-rows" aria-hidden="true">
            <li className="ag-live-row ag-live-skeleton" />
            <li className="ag-live-row ag-live-skeleton" />
          </ul>
        ) : !column.agents.length ? (
          <p className="ag-live-empty">{column.empty}</p>
        ) : column.groups ? (
          column.groups.map((g) => (
            <div key={g.managerId ?? 'other'}>
              <p className="ag-live-group">
                {g.title} · {g.agents.length}
              </p>
              <ul className="ag-live-rows">{rows(g.agents)}</ul>
            </div>
          ))
        ) : (
          <ul className="ag-live-rows">{rows(column.agents)}</ul>
        )}
      </div>
    </section>
  );
}

/** One polite message at a time, at most every two seconds, so a busy run does not flood a screen reader. */
function useAnnouncer(live: LiveActivity | null) {
  const [message, setMessage] = useState('');
  const prev = useRef<LiveActivity | null>(null);
  const queue = useRef<string[]>([]);
  const last = useRef(0);
  useEffect(() => {
    if (!live) return;
    queue.current.push(...announcements(prev.current, live));
    prev.current = live;
    const wait = Math.max(0, 2000 - (Date.now() - last.current));
    const timer = window.setTimeout(() => {
      const next = queue.current.splice(0).slice(-3).join(' ');
      if (next) {
        last.current = Date.now();
        setMessage(next);
      }
    }, wait);
    return () => window.clearTimeout(timer);
  }, [live]);
  return message;
}

export function LiveBoard({ state, now, reduced, actions, hasHistory, onRetry }: LiveBoardProps) {
  const { live } = state;
  const run = live?.run ?? null;
  const loading = state.status === 'connecting' && !live;
  const failedToLoad = state.status === 'error' && !live;
  const columns = columnsOf(live);
  const message = useAnnouncer(live);
  const broken = (live?.counts.failed ?? 0) + (live?.counts.timed_out ?? 0);
  const runTime = run ? formatDuration(elapsedMs(run, now)) : null;

  const connection =
    state.status === 'live' ? <Chip tone="running">Live</Chip> : state.status === 'reconnecting' ? <Chip tone="timed_out">Reconnecting…</Chip> : state.status === 'connecting' || state.status === 'error' ? null : <Chip tone="queued">Offline</Chip>;
  const runChip = loading ? (
    <Chip tone="queued">Connecting…</Chip>
  ) : failedToLoad ? (
    <Chip tone="queued">Unknown</Chip>
  ) : run ? (
    <Chip tone={run.outcome === 'running' ? 'running' : run.outcome === 'finished' ? 'done' : run.outcome === 'partly_failed' ? 'timed_out' : run.outcome === 'failed' ? 'failed' : 'queued'}>
      {OUTCOME_WORD[run.outcome]} · <span className="tabular-nums">{runTime}</span>
    </Chip>
  ) : (
    <Chip tone="queued">No run yet</Chip>
  );

  const request = loading
    ? 'Connecting to your agents…'
    : failedToLoad
      ? 'The agent server did not answer, so there is nothing to show yet.'
      : run
        ? run.request === run.triggerText
          ? run.request
          : `${run.request} · ${run.triggerText}`
        : `No search is running. Press Run now, or wait for Automode; every agent appears here as it starts.${hasHistory ? ' The last run is in History below.' : ''}`;

  return (
    <section className="ag-hero ag-live" aria-labelledby="ag-live-title" data-stale={state.status === 'reconnecting'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="ag-live-title" className="font-display text-3xl leading-none">
            {run ? `Run #${run.number}` : 'Live view'}
          </h2>
          {runChip}
          {connection}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Run controls">
          {actions}
        </div>
      </div>
      <p className="ag-live-request">
        <span className="ag-live-label">Request</span>
        <span className="min-w-0">{request}</span>
      </p>

      {state.status === 'reconnecting' && (
        <Banner tone="warn" icon={<RefreshCw className="size-4" />}>
          Connection to your agents was lost. Reconnecting… (try {state.attempt}). What you see is the last update.
        </Banner>
      )}
      {failedToLoad && (
        <Banner
          tone="danger"
          icon={<CircleX className="size-4" />}
          action={
            <button type="button" className="ag-btn" onClick={onRetry}>
              Retry
            </button>
          }
        >
          Could not load your agents&rsquo; activity: {state.error}.
        </Banner>
      )}
      {run?.outcome === 'failed' && (
        <Banner tone="danger" icon={<CircleX className="size-4" />}>
          The run failed{run.error ? `: ${run.error}` : ''}. What was already checked stays in your feed.
        </Banner>
      )}
      {run?.outcome === 'partly_failed' && (
        <Banner tone="warn" icon={<AlertTriangle className="size-4" />}>
          {broken} {broken === 1 ? 'agent' : 'agents'} failed or timed out. The rest finished; the reason is on each row.
        </Banner>
      )}
      {run?.outcome === 'running' && broken > 0 && (
        <Banner tone="warn" icon={<AlertTriangle className="size-4" />}>
          {broken} {broken === 1 ? 'agent has' : 'agents have'} failed or timed out so far. The others carry on.
        </Banner>
      )}
      {run?.outcome === 'stopped' && (
        <Banner tone="quiet" icon={<Square className="size-4" />}>
          Stopped by you. Postings already checked stay in your feed; ones still under review are reviewed first next time.
        </Banner>
      )}

      {!failedToLoad && (
        <div className="ag-live-board">
          {columns.map((c) => (
            <LevelColumn key={c.level} column={c} now={now} reduced={reduced} loading={loading} />
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
