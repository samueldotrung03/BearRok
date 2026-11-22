// The student's own Google Calendar, read into BearRok's calendar so their classes, shifts and
// plans sit next to their application deadlines, and what they add here written back to it.
// The page never holds a Google token: every read and write is a request to the backend, which
// makes the Google call with the student's lasting connection (connected in Settings).
// Events BearRok made itself are left out, since the deadline is already shown.
import { useEffect, useState } from 'react';
import { useLive } from '../../state/live.tsx';
import { dayKey } from '../calendar.ts';
import { addDays, dayDate } from './days.ts';
import type { CxItem } from './items.ts';

export interface GoogleEvent {
  id: string;
  /** The calendar it is on, and that calendar's name, for any calendar besides the main one. */
  calendarId?: string;
  calendarName?: string | null;
  title: string;
  /** All-day events: YYYY-MM-DD, with `end` the day after the last day. Timed ones: ISO times. */
  start: string;
  end: string;
  allDay: boolean;
  link: string | null;
  location: string | null;
}

export type GoogleSyncState = 'off' | 'loading' | 'ok' | 'expired' | 'error';

/** Something to put on the calendar: a whole day, or a time on that day ("HH:MM"). */
export interface EventDraft {
  title: string;
  day: string;
  time?: string | null;
  endTime?: string | null;
  description?: string;
}

/** A call to the student's own part of the backend (live.request). */
export type Requester = (path: string, init?: RequestInit) => Promise<Response>;

const EVENTS = '/google/calendar/events';
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The backend's answer, or an error; `expired` when Google's access ran out or was taken back. */
async function answer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; reason?: string };
  if (res.status === 401 || body.reason === 'revoked' || body.reason === 'expired') throw Object.assign(new Error(body.error ?? 'Google access has run out'), { expired: true });
  if (!res.ok) throw new Error(body.error ?? `Google Calendar ${res.status}`);
  return body;
}

export async function insertGoogleEvent(request: Requester, d: EventDraft): Promise<{ eventId: string; link: string | null }> {
  return answer(await request(EVENTS, { method: 'POST', body: JSON.stringify({ ...d, timeZone: zone() }) }));
}

export async function updateGoogleEvent(request: Requester, eventId: string, d: EventDraft): Promise<void> {
  await answer(await request(`${EVENTS}/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify({ ...d, timeZone: zone() }) }));
}

/** Removing an event that is already gone is not an error (the backend treats it so). */
export async function deleteGoogleEvent(request: Requester, eventId: string): Promise<void> {
  await answer(await request(`${EVENTS}/${encodeURIComponent(eventId)}`, { method: 'DELETE' }));
}

export interface GoogleCalendarRead extends Array<GoogleEvent> {
  /** The Google account the calendars belong to. */
  account?: string;
  /** How many calendars were read. */
  calendars?: number;
  /** False when only the main calendar could be read: seeing the others needs one more permission. */
  allCalendars?: boolean;
}

/**
 * Events on every calendar the student shows in Google Calendar between two days. The range is
 * worked out here, in the student's own time zone, and sent as times.
 */
export async function fetchGoogleEvents(request: Requester, from: string, to: string): Promise<GoogleCalendarRead> {
  const params = new URLSearchParams({ from: dayDate(from).toISOString(), to: dayDate(to).toISOString() });
  const body = await answer<{ events: GoogleEvent[]; account: string | null; calendars: number; allCalendars: boolean }>(await request(`${EVENTS}?${params}`));
  const out: GoogleCalendarRead = [...body.events];
  out.account = body.account ?? undefined;
  out.calendars = body.calendars;
  out.allCalendars = body.allCalendars;
  return out;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** Google events as calendar items: one per day they cover (up to two weeks for a long one). */
export function googleItems(events: GoogleEvent[], hideIds: Set<string> = new Set()): CxItem[] {
  const items: CxItem[] = [];
  for (const e of events) {
    if (hideIds.has(e.id)) continue;
    const where = e.calendarName ? [e.calendarName] : [];
    const key = e.calendarId ? `${e.calendarId}-${e.id}` : e.id;
    const base = { title: e.title, kind: 'google' as const, priority: 'should' as const, opportunityId: null, stepId: null, done: false, personalId: null, note: '', hours: null, link: e.link };
    if (e.allDay) {
      // The end date of an all-day event is the day after it ends.
      for (let day = e.start, n = 0; day < e.end && n < 14; day = addDays(day, 1), n++) {
        items.push({ ...base, id: `google-${key}-${day}`, day, date: dayDate(day).toISOString(), why: ['All day', e.location, ...where].filter(Boolean).join(' · ') });
      }
    } else {
      const day = dayKey(e.start);
      items.push({ ...base, id: `google-${key}`, day, date: new Date(e.start).toISOString(), timed: true, end: new Date(e.end).toISOString(), why: [`${time(e.start)} – ${time(e.end)}`, e.location, ...where].filter(Boolean).join(' · ') });
    }
  }
  return items;
}

/**
 * The student's Google events for a range of days, kept fresh: read again when the range or the
 * connection changes, every five minutes, and when the window comes back into focus.
 */
export function useGoogleEvents(
  from: string,
  to: string,
): { events: GoogleEvent[]; state: GoogleSyncState; updatedAt: number | null; account: string | null; calendars: number; allCalendars: boolean; refresh: () => void } {
  const live = useLive();
  const connected = live.google.services.includes('calendar');
  const [events, setEvents] = useState<GoogleEvent[]>([]);
  const [state, setState] = useState<GoogleSyncState>(connected ? 'loading' : 'off');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [calendars, setCalendars] = useState({ count: 0, all: false });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    const timer = window.setInterval(refresh, 5 * 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  useEffect(() => {
    if (!connected || live.status !== 'connected') {
      setState('off');
      setEvents([]);
      return;
    }
    let stale = false;
    setState((s) => (s === 'ok' ? s : 'loading'));
    fetchGoogleEvents(live.request, from, to)
      .then((list) => {
        if (stale) return;
        setEvents(list);
        setAccount(list.account ?? null);
        setCalendars({ count: list.calendars ?? 1, all: list.allCalendars === true });
        setState('ok');
        setUpdatedAt(Date.now());
      })
      .catch((e: { expired?: boolean }) => !stale && setState(e?.expired ? 'expired' : 'error'));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, live.status, live.google.connectedAt, from, to, tick]);

  return { events, state, updatedAt, account, calendars: calendars.count, allCalendars: calendars.all, refresh: () => setTick((n) => n + 1) };
}
