// The Agents page: the agent backend's real run, drawn as the whole system (master, search
// managers, worker fleet, validators, presentation, feed) with what each agent is doing and the
// activity log (src/lib/agents/fromLive.ts). Before the first search it shows the team that will
// run, idle. With no model connected (Claude, ChatGPT or Grok) it sends the student to Settings to
// connect one first. Nothing on this page is simulated.
import { ArrowRight, Play, Plug, Server, Square } from 'lucide-react';
import { Link } from 'react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { AgentSettingsButton, autoLine } from '../components/agents/AgentSettings.tsx';
import { AnimatedNumber } from '../components/agents/AnimatedNumber.tsx';
import { useBackendStatus, useReducedMotion, type BackendState } from '../components/agents/hooks.ts';
import { ActivityStream, LiveNodeDetail } from '../components/agents/NodeDetail.tsx';
import { RunGraph } from '../components/agents/RunGraph.tsx';
import { Page, StatusPill } from '../components/Page.tsx';
import { fromLive, liveStats, sourceLabel, type Provider } from '../lib/agents/fromLive.ts';
import { anyConnected, useHarnesses } from '../lib/harnesses.ts';
import { useLive, withNextManagers, type LiveAgents } from '../state/live.tsx';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../styles/agents.css';

/** Says more about a run after its label, without ever calling Claude output Grok. */
const sourceNote: Record<Provider, string> = {
  grok: 'Your agents\u2019 latest run, as it happens.',
  claude: 'Your agents\u2019 latest run, on the Claude account signed in on this computer.',
  gpt: 'Your agents\u2019 latest run, on the ChatGPT account signed in on this computer.',
  simulated: 'No model is connected to the agent backend, so a run here uses simulated agents and invented postings.',
};

const providerName: Record<Provider, string> = { grok: 'Grok', claude: 'Claude', gpt: 'ChatGPT', simulated: 'no model' };

/** The team before its first search: the master, idle, and the managers the next search will have. */
const NO_RUN: LiveAgents = {
  master: { id: 'master', name: 'Master agent', role: 'Reads your profile, background and memory, and briefs the managers', status: 'idle', detail: 'Waiting for the first search.' },
  managers: [],
  workers: [],
  validators: [],
  presenter: null,
  events: [],
  running: false,
  summary: 'No search yet',
};

function BackendChip({ status, provider }: { status: BackendState; provider: Provider }) {
  const text =
    status.kind === 'checking' ? 'Backend: checking\u2026' : status.kind === 'connected' ? `Backend: connected, on ${providerName[provider]}` : 'Backend: not running';
  return (
    <span className="ag-chip-dark" title="The agent backend on port 8787. This page shows its latest run." aria-live="polite">
      <Server className="size-3.5" aria-hidden="true" />
      <span className={`size-1.5 rounded-full ${status.kind === 'connected' ? 'bg-[#34c759]' : status.kind === 'offline' ? 'bg-white/40' : 'bg-[#f5c451]'}`} aria-hidden="true" />
      {text}
    </span>
  );
}

/** Shown instead of the agents while no model is connected. */
export function ConnectFirst({ offline }: { offline: boolean }) {
  return (
    <section className="ag-hero" aria-labelledby="ag-connect-title">
      <div className="mx-auto max-w-xl py-10 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white/10 text-white" aria-hidden="true">
          <Plug className="size-6" />
        </span>
        <h2 id="ag-connect-title" className="mt-5 font-display text-3xl leading-tight">
          {offline ? 'The agent backend is not running' : 'Connect a model first'}
        </h2>
        <p className="ag-honest mt-3">
          {offline
            ? 'Your agents run in the BearRok backend on this computer. Start it, then open this page again.'
            : 'Your agents run on Claude, ChatGPT or Grok, through that company\u2019s app for the command line on this computer and your own account. Connect one in Settings, then come back to run your first search.'}
        </p>
        {!offline && (
          <Link to="/settings#models" className="ag-btn mt-6 inline-flex" data-primary="true">
            Connect Claude, ChatGPT or Grok
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
    </section>
  );
}

export function Agents() {
  const harnesses = useHarnesses();
  const live = useLive();
  // A connected harness, or a deployed copy's xAI key (the backend then reports Grok).
  const ready = anyConnected(harnesses.state) || (live.status === 'connected' && live.provider !== 'simulated');
  if (harnesses.state === 'loading') return <AgentsFrame aside="Checking your models" />;
  if (!ready) return <AgentsFrame aside={harnesses.state === 'offline' ? 'Agent backend not reachable' : 'No model connected'}><ConnectFirst offline={harnesses.state === 'offline'} /></AgentsFrame>;
  return <AgentsLive />;
}

function AgentsFrame({ aside, children }: { aside: string; children?: ReactNode }) {
  return (
    <div className="ag-xai">
      <Page
        title="Your agents"
        subtitle="Watch your agents search for you: the master briefs the managers, workers read the web, and validators decide what reaches you."
        aside={<StatusPill>{aside}</StatusPill>}
      >
        {children}
      </Page>
    </div>
  );
}

export function AgentsLive() {
  const reduced = useReducedMotion();
  const backend = useBackendStatus();
  const [selected, setSelected] = useState('master');
  const live = useLive();
  const connected = live.status === 'connected';
  const hasRun = live.agents !== null;
  // Between searches, the managers the next search will have (they follow the kinds chosen in Agent settings).
  const real = useMemo(() => withNextManagers(live.agents ?? NO_RUN, live.nextManagers), [live.agents, live.nextManagers]);
  const view = useMemo(() => fromLive(real), [real]);
  const node = view.nodes.find((n) => n.id === selected) ?? view.nodes[0];
  const stats = liveStats(real);
  const runLabel = !connected ? 'Offline' : real.running ? 'Running' : hasRun ? 'Done' : 'Ready';
  const chipStatus = !connected ? 'idle' : real.running ? 'working' : hasRun ? 'done' : 'idle';

  return (
    // .ag-xai gives this page xAI's type and buttons (styles at the end of agents.css).
    <div className="ag-xai">
    <Page
      title="Your agents"
      subtitle="Watch your agents search for you: the master briefs the managers, workers read the web, and validators decide what reaches you."
      aside={<StatusPill>{!connected ? 'Agent backend not reachable' : real.summary}</StatusPill>}
    >
      <section className="ag-hero" aria-labelledby="ag-run-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="ag-run-title" className="font-display text-3xl leading-none">
              {hasRun ? 'Latest run' : 'Your agent team'}
            </h2>
            <span className="ag-chip-dark">
              <span className="ag-dot" data-status={chipStatus} aria-hidden="true" />
              {runLabel}
            </span>
            <BackendChip status={backend} provider={live.provider} />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Run controls">
            {real.running ? (
              // Stops the real search. Postings already checked stay in the feed.
              <button type="button" className="ag-btn" data-primary="true" onClick={() => void live.stopRun()}>
                <Square className="size-4" fill="currentColor" aria-hidden="true" />
                Stop search
              </button>
            ) : (
              <button type="button" className="ag-btn" data-primary="true" disabled={!connected} onClick={() => void live.runNow()}>
                <Play className="size-4" aria-hidden="true" />
                Run now
              </button>
            )}
            <AgentSettingsButton />
            {connected && autoLine(live.auto) && <span className="ag-auto-note">{autoLine(live.auto)}</span>}
          </div>
        </div>
        <p className="ag-honest mt-2">
          {connected ? (
            <>
              <strong className="font-semibold text-white">{sourceLabel(live.provider)}.</strong> {sourceNote[live.provider]}
            </>
          ) : (
            'The agent backend is not reachable, so there is no run to show. Start it with npm run dev in backend/.'
          )}
        </p>

        <dl className="mt-5 grid grid-cols-3 gap-4 border-y border-white/10 py-4 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dd className="ag-stat-num">
                <AnimatedNumber value={value} reduced={reduced} />
              </dd>
              <dt className="ag-stat-label">{label}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
          {/* The whole system as it runs: master, search managers, worker fleet, validators, presentation, feed. */}
          <RunGraph view={view} selected={node?.id ?? ''} onSelect={setSelected} reduced={reduced} pulseMs={1400} />
          <div className="grid gap-4 md:h-[420px] md:grid-cols-2 xl:h-[540px] xl:grid-cols-1 xl:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {!node ? (
              <section className="ag-panel p-4 text-[13px] text-white/60">The run has not reported any agents yet.</section>
            ) : (
              <LiveNodeDetail node={node} agent={view.agents[node.id]!} info={view.info[node.id]} />
            )}
            <div className="h-[300px] min-h-0 md:h-auto">
              <ActivityStream log={view.log} nodes={view.nodes} empty={hasRun ? 'The backend has not reported any activity for this run yet.' : 'No search yet. Press Run now to start one.'} />
            </div>
          </div>
        </div>
      </section>
    </Page>
    </div>
  );
}
