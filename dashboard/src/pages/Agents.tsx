// The Agents page: the agent backend's real run, drawn as the live board (every agent by level,
// src/components/agents/live) with a report of each past run. With no model connected (Claude,
// ChatGPT or Grok) it sends the student to Settings to connect one first. Nothing on this page is simulated.
import { ArrowRight, Play, Plug, Square } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { AgentSettingsButton, autoLine } from '../components/agents/AgentSettings.tsx';
import { useReducedMotion } from '../components/agents/hooks.ts';
import { LiveMap } from '../components/agents/live/LiveMap.tsx';
import { RunHistory } from '../components/agents/live/RunHistory.tsx';
import { TellBar } from '../components/agents/TellAgents.tsx';
import { Page, StatusPill } from '../components/Page.tsx';
import { withDefaults } from '../data/preferences.ts';
import { useActivity, useNow, type ActivityState } from '../lib/activity/useActivity.ts';
import { withToldNote } from '../lib/agents/tell.ts';
import { anyConnected, useHarnesses } from '../lib/harnesses.ts';
import { useLive } from '../state/live.tsx';
import { useStore } from '../state/StoreProvider.tsx';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../styles/agents.css';

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

export function Agents() {
  const harnesses = useHarnesses();
  const live = useLive();
  // A connected harness, or a deployed copy's xAI key (the backend then reports Grok).
  const ready = anyConnected(harnesses.state) || (live.status === 'connected' && live.provider !== 'simulated');
  if (harnesses.state === 'loading') return <AgentsFrame aside="Checking your models" />;
  if (!ready) return <AgentsFrame aside={harnesses.state === 'offline' ? 'Agent backend not reachable' : 'No model connected'}><ConnectFirst offline={harnesses.state === 'offline'} /></AgentsFrame>;
  return (
    <div className="ag-xai">
      <AgentsLive />
    </div>
  );
}

type TellStatus = { tone: 'quiet' | 'warn'; text: string } | null;

/** The live board for a real backend run: the map, failure reasons in the history, and tell-your-agents. */
export function AgentsLive() {
  const activity = useActivity(true);
  return <LiveBoard activity={activity} />;
}

function LiveBoard({ activity }: { activity: ActivityState & { retry: () => void } }) {
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
      <LiveMap
        state={activity}
        now={now}
        reduced={reduced}
        actions={actions}
        hasHistory={activity.history.length > 0}
        tell={<TellBar live onSend={tell} status={told} />}
        onRetry={activity.retry}
        provider={live.provider}
      />
      <RunHistory history={activity.history} status={activity.status} onRetry={activity.retry} />
    </Page>
  );
}
