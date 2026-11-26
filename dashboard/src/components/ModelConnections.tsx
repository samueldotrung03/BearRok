// Settings rows for the models the agents run on: Connect Claude, Connect ChatGPT, Connect Grok.
// Each is the company's app for the command line on this computer, signed in with the student's
// own subscription. Connecting sends one short test prompt, so a row only says Connected once the
// app has answered. One connected model is the one the agents use.
import { ChatCircleDots, Lightning, Sparkle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { Harness, HarnessId } from '../lib/harnesses.ts';
import { useHarnesses } from '../lib/harnesses.ts';
import { ActionButton, Row, Status } from './settingsParts.tsx';

const ICON: Record<HarnessId, ReactNode> = { claude: <Sparkle weight="fill" />, codex: <ChatCircleDots weight="fill" />, grok: <Lightning weight="fill" /> };

function Command({ children }: { children: string }) {
  return <code className="block overflow-x-auto rounded-lg bg-slate-100 px-3 py-2 text-[13px] whitespace-pre text-ink">{children}</code>;
}

export function ModelConnections({ extra }: { extra?: (id: HarnessId) => ReactNode }) {
  const { state, busy, errors, phase, oneClick, cancelSetup, oneClickAvailable, refresh, disconnect, use } = useHarnesses();

  if (state === 'loading')
    return (
      <Row icon={<Sparkle weight="fill" />} title="Models" text="Claude, ChatGPT or Grok: the model behind every agent." status={<Status tone="wait">Checking</Status>} />
    );
  if (state === 'offline')
    return (
      <Row
        icon={<Sparkle weight="fill" />}
        title="Models"
        text="Claude, ChatGPT or Grok: the model behind every agent."
        status={<Status tone="warn">Backend not reachable</Status>}
        action={<ActionButton onClick={() => void refresh()}>Check again</ActionButton>}
      >
        <p className="text-sm text-ink-2">The agent backend is not running, so no model can be connected. Start it, then check again.</p>
      </Row>
    );

  const row = (h: Harness) => {
    const step = phase[h.id];
    const checking = busy === h.id || step === 'testing';
    const status = step === 'terminal' ? (
      <Status tone="wait">Finish in Terminal</Status>
    ) : checking ? (
      <Status tone="wait">{h.connected ? 'Working' : 'Sending a test prompt'}</Status>
    ) : h.active ? (
      <Status tone="on">Connected, in use</Status>
    ) : h.connected ? (
      <Status tone="on">Connected</Status>
    ) : h.installed ? (
      <Status tone="off">Not connected</Status>
    ) : (
      <Status tone="off">Not installed</Status>
    );
    return (
      <Row
        key={h.id}
        icon={ICON[h.id]}
        title={h.name}
        text={`Runs the agents on ${h.name} through ${h.cli}, its app for the command line, on your own ${h.name} account. Models: ${h.models.map((m) => m.label).join(', ')}.`}
        status={status}
        action={
          h.connected ? (
            <>
              {!h.active && (
                <ActionButton primary disabled={busy !== null} onClick={() => void use(h.id)}>
                  Use for agents
                </ActionButton>
              )}
              <ActionButton disabled={busy !== null} onClick={() => void disconnect(h.id)}>
                Disconnect
              </ActionButton>
            </>
          ) : (
            <>
              {step === 'terminal' && <ActionButton onClick={() => cancelSetup(h.id)}>Stop waiting</ActionButton>}
              <ActionButton primary disabled={busy !== null || step !== undefined} onClick={() => void oneClick(h.id)}>
                {step ? 'Connecting' : `Connect ${h.name}`}
              </ActionButton>
            </>
          )
        }
      >
        {step === 'terminal' && (
          <p className="text-sm text-ink-2">
            A Terminal window is open. {h.installed ? '' : `It installs ${h.cli}, then `}your browser opens to sign in with your {h.name} account. When it says Done, come back here: BearRok
            finishes connecting on its own.
          </p>
        )}
        {checking && !h.connected && <p className="text-sm text-ink-2">Sending one short test prompt to {h.cli}. This can take up to a minute.</p>}
        {h.connected && (
          <p className="text-sm text-ink-2">
            {h.active ? 'Your agents run on this.' : 'Connected, but your agents run on another model.'} By default the master, managers and validators use {h.defaults.normal} and the
            workers {h.defaults.low}; change them per group in Agent settings.
          </p>
        )}
        {!h.connected && !step && oneClickAvailable && (
          <p className="text-sm text-ink-2">
            {h.installed
              ? `${h.cli} is on this Mac. Connect ${h.name} checks it, and if you are not signed in yet, opens Terminal so you can sign in through your browser.`
              : `Connect ${h.name} opens Terminal to install ${h.cli}${h.id === 'codex' ? ' (it needs Node.js; if it is missing, the Node.js download page opens)' : ''}, then your browser to sign in with your ${h.name} account.`}
          </p>
        )}
        {!h.connected && !checking && !step && !oneClickAvailable && !h.installed && (
          <div className="space-y-2 text-sm text-ink-2">
            <p>Install {h.cli} in the Terminal app:</p>
            <Command>{h.install}</Command>
            <p>Then sign in with your {h.name} account:</p>
            <Command>{h.login}</Command>
            <p>
              {h.loginHint} Then press Connect {h.name}.
            </p>
          </div>
        )}
        {!h.connected && !checking && !step && !oneClickAvailable && h.installed && (
          <div className="space-y-2 text-sm text-ink-2">
            <p>{h.cli} is on this computer. If you have not signed in to it yet, do that first in the Terminal app:</p>
            <Command>{h.login}</Command>
            <p>{h.loginHint}</p>
          </div>
        )}
        {errors[h.id] && <p className="mt-2 text-sm text-amber-800">{errors[h.id]}</p>}
        {extra?.(h.id)}
      </Row>
    );
  };

  return <>{state.harnesses.map(row)}</>;
}
