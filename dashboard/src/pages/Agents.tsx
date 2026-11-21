// The Agents page. With an agent server it shows the live view of the current run (every agent by
// level, src/components/agents/live) and a report of each past run. Without one it plays a
// simulated run of the agent system on sample data: the pure engine in src/lib/agents, with this
// page owning the clock (how fast beats arrive), the student's standing instructions, and which
// agent is selected.
import { Pause, Play, RotateCcw, Server, SkipForward, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { AgentSettingsButton, autoLine } from '../components/agents/AgentSettings.tsx';
import { AnimatedNumber, clockText, compact } from '../components/agents/AnimatedNumber.tsx';
import { Funnel } from '../components/agents/Funnel.tsx';
import { useBackendStatus, useReducedMotion, type BackendState } from '../components/agents/hooks.ts';
import { LiveBoard } from '../components/agents/live/LiveBoard.tsx';
import { RunHistory } from '../components/agents/live/RunHistory.tsx';
import { TeamAbout, TeamMap } from '../components/agents/TeamMap.tsx';
import type { TeamId } from '../lib/agents/team.ts';
import { BriefCard, TellBar, type StandingInstruction } from '../components/agents/TellAgents.tsx';
import { MemoryCard, UsageCard } from '../components/agents/UsageMemory.tsx';
import { Page, StatusPill } from '../components/Page.tsx';
import { withDefaults } from '../data/preferences.ts';
import { opportunities } from '../data/sample.ts';
import { useActivity, useNow, type ActivityState } from '../lib/activity/useActivity.ts';
import { assignSlots, buildBrief, memoryFrom } from '../lib/agents/brief.ts';
import { funnel, idleRun, runReducer, totals, type RunInput } from '../lib/agents/engine.ts';
import { sourceLabel } from '../lib/agents/fromLive.ts';
import { withToldNote } from '../lib/agents/tell.ts';
import { fromRun } from '../lib/agents/view.ts';
import { useLocal } from '../lib/useLocal.ts';
import { SAMPLE_FEED, useLive } from '../state/live.tsx';
import { useStore } from '../state/StoreProvider.tsx';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../styles/agents.css';

const SPEEDS = [0.5, 1, 2, 4] as const;
/** Real time per beat at 1x. A full run is about 17 beats, so roughly 22 seconds. */
const BEAT_MS = 1300;

export function Agents() {
  const backend = useBackendStatus();
  // The public showcase has no agent server, so it never asks for one.
  const activity = useActivity(!SAMPLE_FEED);
  // The live view replaces the demo whenever an agent server answers, and stays (dimmed, reconnecting)
  // if it drops after answering. The demo plays only when no server is reachable.
  const showLive = !SAMPLE_FEED && (backend.kind !== 'offline' || activity.status === 'live' || activity.status === 'reconnecting');
  return (
    // .ag-xai gives this page xAI's type and buttons (styles at the end of agents.css).
    <div className="ag-xai">{showLive ? <LiveAgents activity={activity} /> : <DemoAgents backend={backend} />}</div>
  );
}

type TellStatus = { tone: 'quiet' | 'warn'; text: string } | null;

function LiveAgents({ activity }: { activity: ActivityState & { retry: () => void } }) {
  const reduced = useReducedMotion();
  const live = useLive();
  const auth = useAuth();
  const { state, dispatch } = useStore();
  const [told, setTold] = useState<TellStatus>(null);

  // What the student tells the agents becomes a profile note: the master reads notes first at
  // the start of every search, and saving one starts a new search shortly after.
  const tell = (text: string) => {
    const next = withToldNote(withDefaults(state.preferences), text);
    if (!next) {
      setTold({ tone: 'warn', text: 'Not sent: your profile already has 20 notes. Remove one on the Profile page, then try again.' });
      return;
    }
    dispatch({ type: 'setPreferences', preferences: next });
    setTold({ tone: 'quiet', text: 'Saving to your profile notes…' });
    void auth
      .saveProfile({ preferences: next })
      .then((ok) =>
        setTold(
          ok
            ? { tone: 'quiet', text: `Saved to your profile notes: “${text}”. The master reads it first; a new search starts in a moment.` }
            : { tone: 'warn', text: 'Kept on this computer only: the agent server did not save it, so the agents will not see it yet.' },
        ),
      );
  };
  const run = activity.live?.run ?? null;
  const running = run?.outcome === 'running';
  const now = useNow(running, activity.skew);
  const connected = activity.status === 'live';
  const why = connected ? undefined : 'Waiting for the connection to your agents.';
  const auto = autoLine(live.auto);

  const actions = (
    <>
      {running ? (
        // Stops the real search. Postings already checked stay in the feed.
        <button type="button" className="ag-btn" data-primary="true" disabled={!connected} title={why} onClick={() => void live.stopRun()}>
          <Square className="size-4" fill="currentColor" aria-hidden="true" />
          Stop search
        </button>
      ) : (
        <button type="button" className="ag-btn" data-primary="true" disabled={!connected} title={why} onClick={() => void live.runNow()}>
          <Play className="size-4" aria-hidden="true" />
          Run now
        </button>
      )}
      <AgentSettingsButton />
      {auto && <span className="ag-auto-note">{auto}</span>}
    </>
  );

  return (
    <Page title="Your agents" subtitle="Every agent of the current run, what it is doing and for how long, and a report of each past run.">
      <LiveBoard
        state={activity}
        now={now}
        reduced={reduced}
        actions={actions}
        hasHistory={activity.history.length > 0}
        tell={<TellBar live onSend={tell} status={told} />}
        onRetry={activity.retry}
      />
      <RunHistory history={activity.history} status={activity.status} onRetry={activity.retry} />
    </Page>
  );
}

function BackendChip({ status }: { status: BackendState }) {
  // The public showcase has no agent server behind it, so it says so instead of checking one.
  if (SAMPLE_FEED)
    return (
      <span className="ag-chip-dark" title="This public copy has no agent server. The run below is a simulation on sample data.">
        <Server className="size-3.5" aria-hidden="true" />
        <span className="size-1.5 rounded-full bg-white/40" aria-hidden="true" />
        Sample mode: no agent server
      </span>
    );
  return (
    <span className="ag-chip-dark" title="The agent server. Without it, this page plays its own simulation." aria-live="polite">
      <Server className="size-3.5" aria-hidden="true" />
      <span className={`size-1.5 rounded-full ${status.kind === 'checking' ? 'bg-[#f5c451]' : 'bg-white/40'}`} aria-hidden="true" />
      {status.kind === 'checking' ? 'Backend: checking…' : 'Backend: not running'}
    </span>
  );
}

/** The simulated run on sample data, shown while no agent server is reachable. */
function DemoAgents({ backend }: { backend: BackendState }) {
  const { state } = useStore();
  const reduced = useReducedMotion();
  const [instructions, setInstructions] = useLocal<StandingInstruction[]>('bearrok.agents.instructions', []);
  const [storedSpeed, setSpeed] = useLocal<number>('bearrok.agents.speed', 1);
  const speed = (SPEEDS as readonly number[]).includes(storedSpeed) ? storedSpeed : 1;
  // The agent picked in the team picture.
  const [teamSelected, setTeamSelected] = useState<TeamId>('manager');

  const memory = useMemo(() => memoryFrom(state, opportunities), [state]);
  const texts = useMemo(() => instructions.map((i) => i.text), [instructions]);
  const inputFor = useCallback(
    (list: string[], trigger: string): RunInput => ({ profile: state.profile, memory, instructions: list, dismissed: state.dismissed, trigger }),
    [state.profile, state.dismissed, memory],
  );

  const [run, dispatch] = useReducer(runReducer, undefined, () => idleRun(inputFor(texts, 'Scheduled run.')));

  // Open the page on a run already moving, the way a scheduled run would be. The ref keeps
  // React's development double-mount from starting two runs.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    dispatch({ type: 'start', input: inputFor(texts, 'Scheduled run. The demo starts one when you open this page.') });
  }, [inputFor, texts]);

  // The clock: one beat per tick while running. Cleared on pause, on every beat and on unmount.
  const beatMs = BEAT_MS / speed;
  useEffect(() => {
    if (run.status !== 'running') return;
    const timer = window.setTimeout(() => dispatch({ type: 'tick' }), beatMs);
    return () => window.clearTimeout(timer);
  }, [run.status, run.cursor, beatMs]);

  const start = (list: string[], trigger: string) => dispatch({ type: 'start', input: inputFor(list, trigger) });

  const send = (text: string) => {
    const next = [...instructions.filter((i) => i.text.toLowerCase() !== text.toLowerCase()), { id: `${Date.now()}`, text }];
    setInstructions(next);
    // Per the design a student request is a trigger. Restarting at once lets the student watch
    // their instruction become the brief and flow down the tree.
    start(
      next.map((i) => i.text),
      `You said: "${text}"`,
    );
  };

  const nextBrief = useMemo(() => buildBrief(state.profile, memory, texts), [state.profile, memory, texts]);
  const nextSlots = useMemo(() => assignSlots(nextBrief), [nextBrief]);
  const stale = run.status !== 'idle' && (nextBrief.summary !== run.brief.summary || JSON.stringify(nextSlots) !== JSON.stringify(run.slots));

  const t = totals(run);
  const { counts } = funnel(run.candidates);
  const shown = counts[4] ?? 0;
  const view = useMemo(() => fromRun(run, shown), [run, shown]);
  const stats: [string, number, ((n: number) => string) | undefined][] = [
    ['agents working', t.working, undefined],
    ['Grok calls', t.calls, undefined],
    ['tokens', t.tokens, compact],
    ['pages read', run.pages, undefined],
    ['found', counts[0] ?? 0, undefined],
    ['in your feed', shown, undefined],
  ];

  const runLabel = run.status === 'idle' ? 'Ready' : run.status === 'paused' ? 'Paused' : run.status === 'done' ? 'Done' : 'Running';
  const chipStatus = run.status === 'running' ? 'working' : run.status === 'paused' ? 'waiting' : run.status === 'done' ? 'done' : 'idle';

  return (
    <Page
      title="Your agents"
      subtitle="A demonstration on sample data until your agents run their first search: the master briefs the managers, workers read the web, and validators decide what reaches you."
      aside={
        <StatusPill>
          {run.status === 'running'
            ? `Run ${run.run} · ${t.working} of ${t.agents} agents working`
            : run.status === 'done'
              ? `Run ${run.run} done · ${shown} new in your feed`
              : `${runLabel} · ${t.agents} agents`}
        </StatusPill>
      }
    >
      <section className="ag-hero" aria-labelledby="ag-run-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="ag-run-title" className="font-display text-3xl leading-none">
              {SAMPLE_FEED ? 'Sample run' : 'Live run'}
              {run.run > 0 && <span className="text-white/55"> #{run.run}</span>}
            </h2>
            <span className="ag-chip-dark">
              <span className="ag-dot" data-status={chipStatus} aria-hidden="true" />
              {runLabel} · <span className="tabular-nums">{clockText(run.clock)}</span> simulated
            </span>
            <BackendChip status={backend} />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Run controls">
            <button type="button" className="ag-btn" data-primary="true" onClick={() => start(texts, 'Started by hand with Run now.')}>
              <Play className="size-4" aria-hidden="true" />
              Run now
            </button>
            <button
              type="button"
              className="ag-btn"
              disabled={run.status !== 'running' && run.status !== 'paused'}
              onClick={() => dispatch({ type: run.status === 'paused' ? 'resume' : 'pause' })}
            >
              {run.status === 'paused' ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
              {run.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <AgentSettingsButton />
            <div className="ag-seg" role="group" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                  {s === 0.5 ? '½' : s}×
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ag-btn"
              disabled={run.status !== 'running' && run.status !== 'paused'}
              onClick={() => dispatch({ type: 'finish' })}
              aria-label="Skip to the end of the run"
              title="Skip to the end"
            >
              <SkipForward className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ag-btn"
              onClick={() => dispatch({ type: 'reset', input: inputFor(texts, 'Nothing yet. Press Run now.') })}
              aria-label="Reset the run"
              title="Reset"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="ag-honest mt-2">{sourceLabel(null)}</p>

        {/* Standing instructions feed the local simulation only; they cannot reach the backend's agents. */}
        <div className="mt-4">
          <TellBar onSend={send} standing={instructions.length} />
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-4 border-y border-white/10 py-4 sm:grid-cols-6">
          {stats.map(([label, value, format]) => (
            <div key={label}>
              <dd className="ag-stat-num">
                <AnimatedNumber value={value} format={format} reduced={reduced} />
              </dd>
              <dt className="ag-stat-label">{label}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
          {/* A simplified picture of the team: one manager and four workers toward one goal. */}
          <TeamMap view={view} selected={teamSelected} onSelect={setTeamSelected} />
          <div className="h-[420px] min-h-0 xl:h-[540px]">
            <TeamAbout selected={teamSelected} onSelect={setTeamSelected} />
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Funnel run={run} reduced={reduced} />
        <BriefCard
          instructions={instructions}
          onRemove={(id) => setInstructions((list) => list.filter((i) => i.id !== id))}
          onClear={() => setInstructions([])}
          brief={nextBrief}
          slots={nextSlots}
          stale={stale}
          onApply={() => start(texts, 'Started with your updated instructions.')}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <UsageCard run={run} reduced={reduced} />
        <MemoryCard profile={state.profile} memory={memory} instructions={instructions.length} />
      </div>
    </Page>
  );
}
