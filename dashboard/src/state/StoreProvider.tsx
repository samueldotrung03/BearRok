import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { API_URL } from '../auth/firebase.ts';
import { initialState } from '../data/sample.ts';
import { SAMPLE_FEED } from './live.tsx';
import { goalForProfile } from '../lib/personalize.ts';
import { fromBackendProfile, isSampleStudent, loadState, reducer, saveState, startingState, type Action, type AppState } from './store.ts';

const StoreContext = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

/**
 * The saved state for this account (or the guest), or a fresh start when there is none. In the
 * public showcase the sample student starts with their tracked postings saved, so Saved has samples.
 */
const openState = (uid: string | null) =>
  loadState(startingState(SAMPLE_FEED ? { ...initialState, saved: Object.keys(initialState.applications) } : initialState, uid !== null), uid);

export function StoreProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const uid = auth.status === 'signedIn' && auth.user ? auth.user.uid : null;
  const [state, dispatch] = useReducer(reducer, uid, openState);

  // Signing in, out or into another account swaps in that account's state during this render,
  // so nothing is ever saved under the wrong account.
  const [loadedFor, setLoadedFor] = useState(uid);
  if (loadedFor !== uid) {
    setLoadedFor(uid);
    dispatch({ type: 'load', state: openState(uid) });
  }

  useEffect(() => {
    if (loadedFor === uid) saveState(state, uid);
  }, [state, uid, loadedFor]);

  // A signed-in student with no profile on this device (a new device, or after a clean demo):
  // take the profile the backend already has for them, or at least the name on their account.
  const blank = uid !== null && !state.profile.name.trim();
  const accountName = auth.user?.displayName?.trim() ?? '';
  useEffect(() => {
    if (!blank || auth.backend === 'checking') return;
    let cancelled = false;
    const fromAccount = () => {
      if (accountName) dispatch({ type: 'adoptProfile', profile: { name: accountName.split(/\s+/)[0], fullName: accountName } });
    };
    if (auth.backend !== 'connected') {
      fromAccount();
      return;
    }
    void (async () => {
      try {
        const token = await auth.getToken();
        const res = await fetch(`${API_URL}/api/students/me/state`, { headers: { Authorization: `Bearer ${token}` } });
        const own = res.ok ? fromBackendProfile(((await res.json()) as { student?: { profile?: unknown } }).student?.profile) : null;
        if (cancelled) return;
        if (!own) return fromAccount();
        const goalId = goalForProfile({
          major: own.profile.major,
          topField: own.preferences?.topField,
          fields: own.preferences?.fields,
          careerInterests: own.profile.careerInterests,
        });
        dispatch({ type: 'adoptProfile', ...own, goalId });
      } catch {
        if (!cancelled) fromAccount();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blank, uid, auth.backend, accountName]);

  // With sign-in off, this machine's user is the backend's guest student. The invented sample
  // student (a different Maya, with sample applications) is not loaded over that record, and a
  // blank profile takes the one the agents already search with, demo seed included.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (SAMPLE_FEED || auth.signInEnabled !== false || auth.status !== 'guest') return;
    const current = stateRef.current;
    const sample = isSampleStudent(current);
    const blank = !current.profile.name.trim();
    if (!sample && !blank) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/api/students/demo/state`);
        if (!res.ok || cancelled) return;
        const own = fromBackendProfile(((await res.json()) as { student?: { profile?: unknown } }).student?.profile, { includeDemo: true });
        if (cancelled) return;
        const base = sample ? startingState(initialState, true) : stateRef.current;
        const next = own ? reducer(base, { type: 'adoptProfile', ...own }) : base;
        if (next !== stateRef.current) dispatch({ type: 'load', state: next });
      } catch {
        // The feed still comes from the live connection. The profile stays as it is on this device.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.signInEnabled, auth.status]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext value={value}>{children}</StoreContext>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
