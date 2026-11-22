// The live map at the top of the Agents page: the old run panel, with one layer per level and
// one bot per agent. Hover or focus a bot for what it is doing. Arrows show which way work moves.
// Props in, markup out; the page owns the data.
import { AlertTriangle, CircleX, RefreshCw, Square } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import type { ActivityState } from '../../../lib/activity/useActivity.ts';
import type { ActivityAgent, ActivityLevel, LiveActivity } from '../../../lib/activity/types.ts';
import { actionText, arrowsOf, botLevel, botStatus, kindLabel, layersOf, managerColumns, mapStats, popoverOf, savedCount, type MapArrow, type MapColumn } from '../../../lib/activity/map.ts';
import { announcements, elapsedMs, formatDuration, OUTCOME_WORD, rowLabel } from '../../../lib/activity/view.ts';
import { sourceLabel } from '../../../lib/agents/fromLive.ts';
import { AnimatedNumber } from '../AnimatedNumber.tsx';
import { GrokBot } from '../GrokBot.tsx';

export interface LiveMapProps {
  state: Pick<ActivityState, 'status' | 'live' | 'attempt' | 'error'>;
  /** The current time on the server's clock. */
  now: number;
  reduced: boolean;
  /** Run now / Stop search and Agent settings, owned by the page. */
  actions: ReactNode;
  /** True when History has at least one run, so the empty state can point at it. */
  hasHistory: boolean;
  /** Tell your agents, owned by the page; shown under the request line. */
  tell?: ReactNode;
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

function Arrow({ arrow, reduced }: { arrow: MapArrow; reduced: boolean }) {
  const up = arrow.direction === 'up';
  return (
    <span className="ag-map-arrow" data-direction={arrow.direction} data-kind={arrow.kind} data-active={arrow.active} data-reduced={reduced}>
      <span className="ag-map-arrow-label">{arrow.label}</span>
      <svg viewBox="0 0 24 36" width="24" height="36" aria-hidden="true">
        <line className="ag-map-arrow-shaft" x1="12" y1={up ? 30 : 2} x2="12" y2={up ? 12 : 22} />
        <polyline className="ag-map-arrow-head" points={up ? '6,16 12,6 18,16' : '6,16 12,28 18,16'} />
      </svg>
      <span className="sr-only">{arrow.text}</span>
    </span>
  );
}

function ArrowGap({ after, arrows, columns, reduced }: { after: ActivityLevel; arrows: MapArrow[]; columns: MapColumn[]; reduced: boolean }) {
  const band = arrows.filter((a) => a.after === after && a.place === 'band');
  const per = arrows.filter((a) => a.after === after && a.place === 'column');
  if (!band.length && !per.length) return null;
  const style = { '--ag-cols': columns.length } as CSSProperties;
  return (
    <>
      {band.length > 0 && (
        <div className="ag-map-gap ag-map-gap-band" data-after={after} data-has-columns={per.length > 0}>
          {band.map((a) => (
            <Arrow key={a.id} arrow={a} reduced={reduced} />
          ))}
        </div>
      )}
      {per.length > 0 && (
        <div className="ag-map-gap ag-map-gap-cols" style={style} data-after={after}>
          {columns.map((column) => (
            <div key={column.id} className="ag-map-gap-cell">
              {per
                .filter((a) => a.columnId === column.id)
                .map((a) => (
                  <Arrow key={a.id} arrow={a} reduced={reduced} />
                ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const AgentNode = memo(function AgentNode({
  agent,
  agents,
  now,
  open,
  onOpen,
  onClose,
}: {
  agent: ActivityAgent;
  agents: ActivityAgent[];
  now: number;
  open: boolean;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const popId = `ag-pop-${agent.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const model = popoverOf(agent, agents, now);
  const time = elapsedMs(agent, now);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = rect.bottom + 8;
      const top = below + 220 > window.innerHeight ? Math.max(8, rect.top - 8 - 220) : below;
      setBox({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const pop = (
    <div id={popId} role="tooltip" className="ag-map-pop" style={box ? { top: box.top, left: box.left } : { top: -9999, left: 0 }}>
      <p className="ag-map-pop-name">{model.name}</p>
      <p className="ag-map-pop-status">
        {model.status} · <span className="tabular-nums">{model.elapsed}</span>
      </p>
      <p className="ag-map-pop-doing">{model.doing}</p>
      <dl className="ag-map-pop-dl">
        <div>
          <dt>Task</dt>
          <dd>{model.task}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{model.target ?? 'None'}</dd>
        </div>
        <div>
          <dt>Results</dt>
          <dd>{model.results.join(' · ')}</dd>
        </div>
      </dl>
      {model.recent.length > 0 && (
        <>
          <p className="ag-map-pop-label">Recent</p>
          <ol className="ag-map-pop-recent">
            {model.recent.map((line) => (
              <li key={`${line.at}-${line.text}`}>{line.text}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );

  return (
    <div className="ag-map-node-wrap">
      <button
        ref={ref}
        type="button"
        className="ag-map-node"
        data-status={agent.status}
        data-kind={agent.kind}
        aria-expanded={open}
        aria-controls={popId}
        aria-describedby={open ? popId : undefined}
        aria-label={rowLabel(agent, now)}
        onMouseEnter={() => onOpen(agent.id)}
        onMouseLeave={(e) => {
          if (e.currentTarget === document.activeElement) return;
          onClose(agent.id);
        }}
        onFocus={() => onOpen(agent.id)}
        onBlur={() => onClose(agent.id)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose(agent.id);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            onOpen(agent.id);
          }
        }}
      >
        <span className="ag-map-icon" data-status={agent.status}>
          <GrokBot level={botLevel(agent.level)} status={botStatus(agent.status)} size={40} seed={agent.id} />
        </span>
        <span className="ag-map-badge">{kindLabel(agent.kind)}</span>
        <span className="ag-map-name">{agent.name}</span>
        <span className="ag-map-action">{actionText(agent)}</span>
        <span className="ag-map-time tabular-nums">{formatDuration(time)}</span>
      </button>
      {open && typeof document !== 'undefined' ? createPortal(pop, document.body) : null}
    </div>
  );
});

function GroupScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = () => {
    const el = ref.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useLayoutEffect(check);
  return (
    <div ref={ref} className="ag-map-box-scroll" data-more={more} onScroll={check}>
      {children}
    </div>
  );
}

export function LiveMap({ state, now, reduced, actions, hasHistory, tell, onRetry }: LiveMapProps) {
  const { live } = state;
  const run = live?.run ?? null;
  const loading = state.status === 'connecting' && !live;
  const failedToLoad = state.status === 'error' && !live;
  const agents = live?.agents ?? [];
  const columns = managerColumns(agents);
  const layers = layersOf(agents);
  const arrows = arrowsOf(agents, live?.flows ?? []);
  const stats = mapStats(agents, live?.flows ?? []);
  const message = useAnnouncer(live);
  const [openId, setOpenId] = useState<string | null>(null);
  const broken = (live?.counts.failed ?? 0) + (live?.counts.timed_out ?? 0);
  const runTime = run ? formatDuration(elapsedMs(run, now)) : null;
  const cols = { '--ag-cols': Math.max(columns.length, 1) } as CSSProperties;

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

  const honest = !run ? (state.status === 'live' ? 'Connected to your agent server. Nothing is running yet.' : 'Waiting for your agent server.') : sourceLabel(run.mode === 'live' ? 'grok' : 'simulated');

  const open = (id: string) => setOpenId(id);
  const close = (id: string) => setOpenId((cur) => (cur === id ? null : cur));
  const node = (agent: ActivityAgent) => <AgentNode key={agent.id} agent={agent} agents={agents} now={now} open={openId === agent.id} onOpen={open} onClose={close} />;

  return (
    <section className="ag-hero ag-live" aria-labelledby="ag-live-title" data-stale={state.status === 'reconnecting'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="ag-live-title" className="font-display text-3xl leading-none">
            {run ? (
              <>
                Live run <span className="text-white/55">#{run.number}</span>
              </>
            ) : (
              'Live view'
            )}
          </h2>
          {runChip}
          {connection}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Run controls">
          {actions}
        </div>
      </div>
      <p className="ag-honest mt-2">{honest}</p>
      <p className="ag-live-request">
        <span className="ag-live-label">Request</span>
        <span className="min-w-0">{request}</span>
      </p>
      {tell && !failedToLoad && <div className="ag-tell">{tell}</div>}

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
          {broken} {broken === 1 ? 'agent' : 'agents'} failed or timed out. The rest finished; the reason is on each agent.
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
        <dl className="mt-5 grid grid-cols-3 gap-4 border-y border-white/10 py-4 sm:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dd className="ag-stat-num">
                <AnimatedNumber value={stat.value} reduced={reduced} />
              </dd>
              <dt className="ag-stat-label">{stat.label}</dt>
            </div>
          ))}
        </dl>
      )}

      {!failedToLoad && (
        <div className="ag-map" data-reduced={reduced} aria-busy={loading}>
          <p className="ag-map-goal">
            <span>Goal</span>
            {run ? run.request : 'No search yet'}
          </p>
          {loading
            ? (['master', 'manager', 'worker', 'validation', 'presentation'] as const).map((level) => (
                <div key={level} className="ag-map-band" data-level={level}>
                  <div className="ag-map-skeleton" />
                </div>
              ))
            : layers.map((layer) => {
                const centred = layer.level === 'master' || layer.level === 'presentation';
                const boxed = layer.level === 'worker' || layer.level === 'validation';
                return (
                  <div key={layer.level}>
                    <section className="ag-map-band" aria-labelledby={`ag-map-${layer.level}`} data-level={layer.level}>
                      <header className="ag-map-band-head">
                        <h3 id={`ag-map-${layer.level}`}>{layer.title}</h3>
                        <p>{layer.counts}</p>
                      </header>
                      {centred ? (
                        <div className="ag-map-centre">
                          {layer.groups[0]!.agents.length ? layer.groups[0]!.agents.map(node) : <p className="ag-map-empty">{layer.empty}</p>}
                        </div>
                      ) : (
                        <div className="ag-map-cols" style={cols}>
                          {layer.groups.map((group) => (
                            <div key={group.id} className="ag-map-col" data-column={group.id}>
                              {boxed ? (
                                <div className="ag-map-box">
                                  <p className="ag-map-box-title">
                                    {group.title || layer.title}
                                    <span className="tabular-nums"> · {group.agents.length}</span>
                                  </p>
                                  <GroupScroll>
                                    {group.agents.length ? (
                                      group.agents.map(node)
                                    ) : (
                                      <p className="ag-map-empty">{layer.groups.some((g) => g.agents.length) ? 'None yet' : layer.empty}</p>
                                    )}
                                  </GroupScroll>
                                </div>
                              ) : group.agents.length ? (
                                group.agents.map(node)
                              ) : (
                                <p className="ag-map-empty">{layer.groups.some((g) => g.agents.length) ? 'None yet' : layer.empty}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                    <ArrowGap after={layer.level} arrows={arrows} columns={columns} reduced={reduced} />
                  </div>
                );
              })}
          {!loading && (
            <div className="ag-map-centre">
              <Link to="/" className="ag-map-feed">
                Your feed
                <span className="tabular-nums">{savedCount(agents)}</span>
              </Link>
            </div>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
