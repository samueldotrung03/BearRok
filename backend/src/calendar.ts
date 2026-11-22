// Google Calendar: put an application deadline on the student's own calendar, and read and write
// the student's events for the Calendar page. Every call uses an access token the backend makes
// from the student's lasting Google connection; no token is sent to or taken from a page.

export interface DeadlineEvent {
  title: string;
  /** ISO time of the deadline. The event is placed on that calendar day. */
  deadline: string;
  description: string;
}

export interface CalendarResult {
  eventId: string;
  htmlLink: string | null;
}

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const DAY = 86_400_000;
const day = (iso: string, addDays = 0) => new Date(Date.parse(iso) + addDays * DAY).toISOString().slice(0, 10);

/** Pop-up reminders Google shows before an all-day event: a week before, two days before, and that morning. */
const REMINDER_MINUTES = [7 * 24 * 60, 2 * 24 * 60, 0];

export function eventBody(e: DeadlineEvent) {
  return {
    summary: e.title,
    description: e.description,
    start: { date: day(e.deadline) },
    end: { date: day(e.deadline, 1) },
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: REMINDER_MINUTES.map((minutes) => ({ method: 'popup', minutes })) },
  };
}

export async function createDeadlineEvent(accessToken: string, e: DeadlineEvent, fetchImpl: typeof fetch = fetch): Promise<CalendarResult> {
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(eventBody(e)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { id: string; htmlLink?: string };
  return { eventId: body.id, htmlLink: body.htmlLink ?? null };
}

export async function deleteEvent(accessToken: string, eventId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${API}/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  // Already gone counts as deleted.
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google Calendar ${res.status}`);
}

/** A link that opens Google Calendar with the event filled in. Works without any permission. */
export function addToCalendarUrl(e: DeadlineEvent): string {
  const compact = (d: string) => d.replaceAll('-', '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${compact(day(e.deadline))}/${compact(day(e.deadline, 1))}`,
    details: e.description,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// ---- the student's own calendar, read and written for the Calendar page ---------------------
// The page never holds a Google token: it asks the backend, which uses the lasting connection.

/** One event from the student's Google Calendar, as the Calendar page draws it. */
export interface StudentEvent {
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

export interface StudentCalendarRead {
  events: StudentEvent[];
  /** The Google account the calendars belong to. */
  account: string | null;
  calendars: number;
  /** False when only the main calendar could be read: seeing the others needs one more permission. */
  allCalendars: boolean;
}

/** Something the student adds in BearRok: a whole day, or a time on that day ("HH:MM"). */
export interface EventDraft {
  title: string;
  day: string;
  time?: string | null;
  endTime?: string | null;
  description?: string;
  timeZone?: string;
}

/** Google said the access is no longer good: the connection has to be made again. */
export const expired = (e: unknown) => (e as { expired?: boolean })?.expired === true;

const V3 = 'https://www.googleapis.com/calendar/v3';
const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
const hourAfter = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** The event as Google Calendar wants it, in the student's own time zone. */
export function draftBody(d: EventDraft) {
  const base = { summary: d.title, description: d.description ?? 'Added from BearRok.', source: { title: 'BearRok', url: 'https://bearrok.app' } };
  if (!d.time) return { ...base, start: { date: d.day }, end: { date: addDay(d.day) } };
  const timeZone = d.timeZone ?? 'UTC';
  const end = d.endTime && d.endTime > d.time ? d.endTime : hourAfter(d.time);
  return { ...base, start: { dateTime: `${d.day}T${d.time}:00`, timeZone }, end: { dateTime: `${d.day}T${end}:00`, timeZone } };
}

async function googleCall(token: string, url: string, init: RequestInit, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) throw Object.assign(new Error('Google access has run out'), { expired: true });
  return res;
}

export async function insertStudentEvent(token: string, d: EventDraft, fetchImpl: typeof fetch = fetch): Promise<{ eventId: string; link: string | null }> {
  const res = await googleCall(token, `${V3}/calendars/primary/events`, { method: 'POST', body: JSON.stringify(draftBody(d)) }, fetchImpl);
  if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
  const body = (await res.json()) as { id: string; htmlLink?: string };
  return { eventId: body.id, link: body.htmlLink ?? null };
}

export async function updateStudentEvent(token: string, eventId: string, d: EventDraft, fetchImpl: typeof fetch = fetch) {
  const res = await googleCall(token, `${V3}/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(draftBody(d)) }, fetchImpl);
  if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
}

/** Removing an event that is already gone is not an error. */
export async function deleteStudentEvent(token: string, eventId: string, fetchImpl: typeof fetch = fetch) {
  const res = await googleCall(token, `${V3}/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, fetchImpl);
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google Calendar ${res.status}`);
}

/**
 * Events on one calendar between two times (ISO, worked out by the page in the student's own time
 * zone), repeating ones expanded.
 */
async function eventsOn(token: string, calendarId: string, from: string, to: string, fetchImpl: typeof fetch): Promise<{ events: StudentEvent[]; name?: string }> {
  const events: StudentEvent[] = [];
  let name: string | undefined;
  let page: string | undefined;
  for (let i = 0; i < 4; i++) {
    const params = new URLSearchParams({
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      ...(page ? { pageToken: page } : {}),
    });
    const res = await googleCall(token, `${V3}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {}, fetchImpl);
    if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
    const body = (await res.json()) as { items?: any[]; nextPageToken?: string; summary?: string };
    name ??= body.summary;
    for (const e of body.items ?? []) {
      if (e.status === 'cancelled' || !e.start) continue;
      const allDay = Boolean(e.start.date);
      events.push({
        id: String(e.id),
        title: typeof e.summary === 'string' && e.summary.trim() ? e.summary.trim() : '(No title)',
        start: allDay ? e.start.date : e.start.dateTime,
        end: allDay ? (e.end?.date ?? e.start.date) : (e.end?.dateTime ?? e.start.dateTime),
        allDay,
        link: typeof e.htmlLink === 'string' ? e.htmlLink : null,
        // Some feeds put a web address where the place goes; that is not somewhere to be.
        location: typeof e.location === 'string' && e.location.trim() && !/^(https?|webcal):\/\//i.test(e.location.trim()) ? e.location.trim() : null,
      });
    }
    page = body.nextPageToken;
    if (!page) break;
  }
  return { events, name };
}

/**
 * Events on every calendar the student shows in Google Calendar (their own, shared ones, school,
 * holidays) between two ISO times. Without the permission to list calendars, the main calendar only.
 */
export async function readStudentCalendar(token: string, from: string, to: string, fetchImpl: typeof fetch = fetch): Promise<StudentCalendarRead> {
  const list = await googleCall(token, `${V3}/users/me/calendarList?minAccessRole=reader&maxResults=100`, {}, fetchImpl);
  if (!list.ok) {
    // No permission to see the list: the main calendar is still readable.
    const { events, name } = await eventsOn(token, 'primary', from, to, fetchImpl);
    return { events, account: name ?? null, calendars: 1, allCalendars: false };
  }
  const body = (await list.json()) as { items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean; hidden?: boolean }[] };
  // The calendars ticked in Google Calendar's own sidebar, main one first.
  const calendars = (body.items ?? []).filter((c) => c.selected !== false && !c.hidden).sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
  const results = await Promise.all(
    calendars.map((c) =>
      eventsOn(token, c.id, from, to, fetchImpl)
        .then((r) => ({ c, ...r }))
        .catch((e) => {
          if (expired(e)) throw e;
          return { c, events: [] as StudentEvent[], name: undefined };
        }),
    ),
  );
  const events = results.flatMap(({ c, events }) => events.map((e) => ({ ...e, calendarId: c.id, calendarName: c.primary ? null : (c.summaryOverride ?? c.summary ?? null) })));
  return { events, account: calendars.find((c) => c.primary)?.id ?? null, calendars: calendars.length, allCalendars: true };
}
