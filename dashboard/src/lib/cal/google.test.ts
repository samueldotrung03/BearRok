// The Calendar page's side of Google Calendar: every read and write goes to the backend (which
// holds the connection), never to Google with a token, and Google's events become calendar items.
import { describe, expect, it } from 'vitest';
import { deleteGoogleEvent, fetchGoogleEvents, googleItems, insertGoogleEvent, updateGoogleEvent, type Requester } from './google.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeBackend(answer: (path: string, init?: RequestInit) => Response) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const request: Requester = async (path, init) => {
    calls.push({ path, init });
    return answer(path, init);
  };
  return { request, calls };
}

describe('Google Calendar through the backend', () => {
  it('asks the backend for the range as times, and passes on what was read', async () => {
    const { request, calls } = fakeBackend(() =>
      json({ events: [{ id: 'a', title: 'CS 61A midterm', start: '2026-11-23', end: '2026-11-24', allDay: true, link: null, location: 'Wheeler 150' }], account: 'me@example.com', calendars: 1, allCalendars: false }),
    );
    const events = await fetchGoogleEvents(request, '2026-11-15', '2027-01-15');
    expect(events.map((e) => e.title)).toEqual(['CS 61A midterm']);
    expect(events).toMatchObject({ account: 'me@example.com', calendars: 1, allCalendars: false });
    const url = new URL(calls[0]!.path, 'http://x');
    expect(url.pathname).toBe('/google/calendar/events');
    expect(new Date(url.searchParams.get('from')!).toISOString()).toBe(url.searchParams.get('from'));
    expect(new Date(url.searchParams.get('to')!).getTime()).toBeGreaterThan(new Date(url.searchParams.get('from')!).getTime());
    // No Google token is ever sent from the page.
    expect(JSON.stringify(calls)).not.toMatch(/access-token|Bearer/i);
  });

  it('says when Google access ran out or was taken back, so the page asks to reconnect', async () => {
    const expired = fakeBackend(() => json({ error: 'Google access has run out', reason: 'expired' }, 401));
    await expect(fetchGoogleEvents(expired.request, '2026-11-15', '2026-12-15')).rejects.toMatchObject({ expired: true });
    const revoked = fakeBackend(() => json({ error: 'Google took back access', reason: 'revoked' }, 401));
    await expect(insertGoogleEvent(revoked.request, { title: 'x', day: '2026-11-24' })).rejects.toMatchObject({ expired: true });
    const failed = fakeBackend(() => json({ error: 'Google Calendar 500' }, 502));
    await expect(fetchGoogleEvents(failed.request, '2026-11-15', '2026-12-15')).rejects.toThrow('Google Calendar 500');
  });

  it('adds, changes and removes an event with the student’s time zone', async () => {
    const { request, calls } = fakeBackend((path, init) => (init?.method === 'POST' ? json({ eventId: 'ev1', link: 'https://calendar.google.com/ev1' }) : json({ ok: true })));
    expect(await insertGoogleEvent(request, { title: 'Midterm', day: '2026-12-01', time: '10:00' })).toEqual({ eventId: 'ev1', link: 'https://calendar.google.com/ev1' });
    await updateGoogleEvent(request, 'ev/1', { title: 'Midterm', day: '2026-12-02' });
    await deleteGoogleEvent(request, 'ev1');
    expect(calls.map((c) => `${c.init?.method} ${c.path}`)).toEqual(['POST /google/calendar/events', 'PATCH /google/calendar/events/ev%2F1', 'DELETE /google/calendar/events/ev1']);
    const sent = JSON.parse(String(calls[0]!.init!.body)) as { title: string; time: string; timeZone: string };
    expect(sent).toMatchObject({ title: 'Midterm', time: '10:00' });
    expect(sent.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('Google events as calendar items', () => {
  it("one per day of an all-day event, timed ones with their hours, and none for BearRok's own", () => {
    const items = googleItems(
      [
        { id: 'trip', title: 'Family trip', start: '2026-11-26', end: '2026-11-29', allDay: true, link: null, location: null },
        { id: 'shift', title: 'Shift', start: '2026-11-20T18:00:00', end: '2026-11-20T22:00:00', allDay: false, link: 'https://calendar.google.com/s', location: 'Cafe' },
        { id: 'bearrok-made', title: 'Due: Goldwater', start: '2027-01-29T23:59:00', end: '2027-01-30T00:29:00', allDay: false, link: null, location: null },
      ],
      new Set(['bearrok-made']),
    );
    expect(items.filter((i) => i.title === 'Family trip').map((i) => i.day)).toEqual(['2026-11-26', '2026-11-27', '2026-11-28']);
    const shift = items.find((i) => i.title === 'Shift')!;
    expect(shift).toMatchObject({ kind: 'google', day: '2026-11-20', priority: 'should', opportunityId: null, link: 'https://calendar.google.com/s' });
    expect(shift.why).toBe('6:00 PM – 10:00 PM · Cafe');
    expect(items.some((i) => i.title === 'Due: Goldwater')).toBe(false);
  });

  it('names the calendar an event is on when it is not the main one', () => {
    const items = googleItems([
      { id: 'm1', calendarId: 'school', calendarName: 'bCourses', title: 'CS 61A lecture', start: '2026-11-20T10:00:00', end: '2026-11-20T11:00:00', allDay: false, link: null, location: null },
      { id: 'p1', calendarId: 'me', calendarName: null, title: 'Dentist', start: '2026-11-21', end: '2026-11-22', allDay: true, link: null, location: null },
    ]);
    expect(items.find((i) => i.title === 'CS 61A lecture')!.why).toContain('bCourses');
    expect(items.find((i) => i.title === 'Dentist')!.why).toBe('All day');
  });
});
