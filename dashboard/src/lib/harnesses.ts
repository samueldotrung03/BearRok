// The model harnesses the agents can run on: Claude, ChatGPT (through Codex) and Grok, each the
// company's app for the command line on this computer, signed in with the student's own account.
// The backend finds the apps, checks them and keeps which one is connected (backend/src/harness.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../auth/firebase.ts';
import { desktopBridge } from './desktopBridge.ts';

export type HarnessId = 'claude' | 'codex' | 'grok';

export interface Harness {
  id: HarnessId;
  /** What the student knows it as: Claude, ChatGPT, Grok. */
  name: string;
  /** The app for the command line: Claude Code, Codex, Grok Build. */
  cli: string;
  installed: boolean;
  connected: boolean;
  /** The agents run on this one. */
  active: boolean;
  install: string;
  login: string;
  loginHint: string;
  models: { id: string; label: string }[];
  defaults: { normal: string; low: string };
}

export interface HarnessStatus {
  active: HarnessId | null;
  harnesses: Harness[];
}

export type HarnessState = HarnessStatus | 'loading' | 'offline';

/**
 * Where a one-click connect is: "terminal" while the student installs and signs in in the Terminal
 * window BearRok opened, "testing" while the backend sends its test prompt afterwards.
 */
export type SetupPhase = 'terminal' | 'testing';

/** How often the page looks at the Terminal window's progress. */
const SETUP_POLL_MS = 2000;

async function call(path: string, method = 'GET', body?: unknown): Promise<HarnessStatus & { error?: string }> {
  const res = await fetch(`${API_URL}/api/harnesses${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as (HarnessStatus & { error?: string }) | null;
  if (!data?.harnesses) throw new Error(data?.error ?? `The backend answered ${res.status}.`);
  return data;
}

/** The harnesses on this computer, with connect, disconnect and choosing the one in use. */
export function useHarnesses() {
  const [state, setState] = useState<HarnessState>('loading');
  const [busy, setBusy] = useState<HarnessId | null>(null);
  const [errors, setErrors] = useState<Partial<Record<HarnessId, string>>>({});
  const [phase, setPhase] = useState<Partial<Record<HarnessId, SetupPhase>>>({});
  const polls = useRef(new Map<HarnessId, number>());
  useEffect(() => {
    const timers = polls.current;
    return () => timers.forEach((t) => window.clearInterval(t));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setState(await call(''));
    } catch {
      setState('offline');
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const act = async (id: HarnessId, run: () => Promise<HarnessStatus & { error?: string }>) => {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: undefined }));
    try {
      const next = await run();
      setState(next);
      if (next.error) setErrors((e) => ({ ...e, [id]: next.error }));
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: e instanceof Error ? e.message : 'Something went wrong.' }));
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const setPhaseOf = (id: HarnessId, next: SetupPhase | null) =>
    setPhase((p) => {
      const copy = { ...p };
      if (next) copy[id] = next;
      else delete copy[id];
      return copy;
    });
  const fail = (id: HarnessId, text: string) => setErrors((e) => ({ ...e, [id]: text }));

  /** The backend's test prompt. True when the harness answered and is now connected. */
  const tryConnect = async (id: HarnessId): Promise<boolean> => {
    try {
      const next = await call(`/${id}/connect`, 'POST');
      setState(next);
      if (next.error) {
        fail(id, next.error);
        return false;
      }
      return true;
    } catch (e) {
      fail(id, e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    }
  };

  /**
   * One click: if the app is installed, try connecting straight away; if that does not work (or it
   * is not installed), open Terminal to install it and sign in through the browser, then connect on
   * its own once Terminal reports it is done. Without the desktop shell it only tries to connect.
   */
  const oneClick = async (id: HarnessId) => {
    const setup = desktopBridge?.harness;
    const harness = typeof state === 'object' ? state.harnesses.find((h) => h.id === id) : undefined;
    setErrors((e) => ({ ...e, [id]: undefined }));
    if (!setup || harness?.installed) {
      setPhaseOf(id, 'testing');
      const ok = await tryConnect(id);
      setPhaseOf(id, null);
      if (ok || !setup) return;
      setErrors((e) => ({ ...e, [id]: undefined }));
    }
    const opened = await setup.setup(id).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!opened.ok) return fail(id, opened.error ?? 'Terminal could not be opened.');
    setPhaseOf(id, 'terminal');
    window.clearInterval(polls.current.get(id));
    const timer = window.setInterval(async () => {
      const { state: progress, error } = await setup.setupStatus(id).catch(() => ({ state: 'running' as const, error: undefined }));
      if (progress === 'running') return;
      window.clearInterval(timer);
      polls.current.delete(id);
      void setup.setupClear(id);
      if (progress === 'done') {
        setPhaseOf(id, 'testing');
        await tryConnect(id);
      } else if (progress === 'failed') {
        fail(id, error ?? 'Set-up did not finish.');
      }
      setPhaseOf(id, null);
    }, SETUP_POLL_MS);
    polls.current.set(id, timer);
  };

  /** Stop waiting for a Terminal window the student gave up on. */
  const cancelSetup = (id: HarnessId) => {
    window.clearInterval(polls.current.get(id));
    polls.current.delete(id);
    void desktopBridge?.harness?.setupClear(id);
    setPhaseOf(id, null);
  };

  return {
    state,
    busy,
    errors,
    phase,
    oneClick,
    cancelSetup,
    oneClickAvailable: Boolean(desktopBridge?.harness),
    refresh,
    connect: (id: HarnessId) => act(id, () => call(`/${id}/connect`, 'POST')),
    disconnect: (id: HarnessId) => act(id, () => call(`/${id}/disconnect`, 'POST')),
    use: (id: HarnessId) => act(id, () => call('/active', 'PUT', { id })),
  };
}

/** Whether any model is connected, so the agents can run for real. */
export const anyConnected = (s: HarnessState) => typeof s === 'object' && s.active !== null;
