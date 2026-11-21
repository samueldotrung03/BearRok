// Follows the agents' live activity and run history from the backend's read-only feed.
// A first request tells "the server answered with an error" apart from "no server", then a live
// stream keeps the view current. A dropped stream keeps the last view and reconnects with backoff.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { API_URL } from '../../auth/firebase.ts';
import type { LiveActivity, RunReport } from './types.ts';

/**
 * connecting: nothing received yet. live: the stream is open. reconnecting: it dropped after data
 * arrived; the last view stays. error: the server answered with an error. offline: no server answered.
 */
export type ActivityStatus = 'connecting' | 'live' | 'reconnecting' | 'error' | 'offline';

export interface ActivityState {
  status: ActivityStatus;
  live: LiveActivity | null;
  history: RunReport[];
  /** Reconnect attempts since the stream last worked. */
  attempt: number;
  error: string | null;
  /** Server clock minus this computer's clock, in ms, so elapsed times follow the server. */
  skew: number;
}

const INITIAL: ActivityState = { status: 'connecting', live: null, history: [], attempt: 0, error: null, skew: 0 };

/** 1 s, 2 s, 4 s, 8 s, then every 15 s. */
export const backoffMs = (attempt: number) => Math.min(15_000, 1000 * 2 ** Math.max(0, attempt - 1));

export function useActivity(enabled = true): ActivityState & { retry: () => void } {
  const auth = useAuth();
  const who = auth.status === 'signedIn' ? 'me' : 'demo';
  const uid = auth.user?.uid ?? null;
  const [state, setState] = useState<ActivityState>(INITIAL);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled || auth.status === 'loading' || auth.status === 'signedOut') return;
    let closed = false;
    let source: EventSource | null = null;
    let timer: number | undefined;
    let attempt = 0;
    let received = false;
    const base = `${API_URL}/api/students/${who}/activity`;
    const take = (live: LiveActivity) => ({ live, skew: Date.parse(live.serverTime) - Date.now() });

    const retryLater = () => {
      attempt++;
      setState((s) => ({ ...s, status: received ? 'reconnecting' : 'offline', attempt }));
      timer = window.setTimeout(() => void connect(), backoffMs(attempt));
    };

    const connect = async () => {
      const token = await auth.getToken().catch(() => null);
      if (closed) return;
      const query = token ? `?token=${encodeURIComponent(token)}` : '';
      if (!received) {
        try {
          const res = await fetch(`${base}${query}`);
          if (closed) return;
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setState((s) => ({ ...s, status: 'error', error: body.error ?? `the agent server answered ${res.status}` }));
            return;
          }
          const body = (await res.json()) as { live: LiveActivity; history: RunReport[] };
          if (closed) return;
          received = true;
          setState({ ...INITIAL, status: 'live', history: body.history, ...take(body.live) });
        } catch {
          if (!closed) retryLater();
          return;
        }
      }
      source = new EventSource(`${base}/stream${query}`);
      source.addEventListener('activity', (e) => {
        received = true;
        attempt = 0;
        const live = JSON.parse((e as MessageEvent).data) as LiveActivity;
        setState((s) => ({ ...s, status: 'live', attempt: 0, error: null, ...take(live) }));
      });
      source.addEventListener('history', (e) => {
        const history = JSON.parse((e as MessageEvent).data) as RunReport[];
        setState((s) => ({ ...s, history }));
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed) retryLater();
      };
    };

    setState(INITIAL);
    void connect();
    return () => {
      closed = true;
      source?.close();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, who, uid, auth.status, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

/** The current time, ticking once a second while `running`; one clock for every elapsed time on screen. */
export function useNow(running: boolean, skew = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now + skew;
}
