// The student's own Google Calendar as the backend reads and writes it for the Calendar page, with
// Google faked: every page read, cancelled and hidden things left out, the main calendar alone
// when the list may not be read, and events built in the student's own time zone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteStudentEvent, draftBody, insertStudentEvent, readStudentCalendar, updateStudentEvent } from '../src/calendar.ts';

const page = (items: unknown[], next?: string, summary?: string) => new Response(JSON.stringify({ items, nextPageToken: next, summary }), { status: 200 });

test('reads every page of the main calendar, leaves out cancelled events, and says when access ran out', async () => {
  const asked: string[] = [];
  const fake = (async (url: string | URL | Request) => {
    const u = String(url);
    asked.push(u);
    // Without the permission to list calendars, the main calendar is read on its own.
    if (u.includes('/users/me/calendarList')) return new Response('{}', { status: 403 });
    if (u.includes('pageToken=p2'))
      return page([{ id: 'b', summary: 'Shift', start: { dateTime: '2026-11-20T18:00:00-08:00' }, end: { dateTime: '2026-11-20T22:00:00-08:00' }, htmlLink: 'https://calendar.google.com/b' }]);
    return page(
      [
        { id: 'a', summary: 'CS 61A midterm', start: { date: '2026-11-23' }, end: { date: '2026-11-24' }, location: 'Wheeler 150' },
        { id: 'x', status: 'cancelled', start: { date: '2026-11-25' } },
        { id: 'z', summary: 'Webinar', start: { date: '2026-11-26' }, end: { date: '2026-11-27' }, location: 'https://zoom.example/123' },
      ],
      'p2',
      'me@example.com',
    );
  }) as typeof fetch;
  const read = await readStudentCalendar('tok', '2026-11-15T08:00:00.000Z', '2027-01-15T08:00:00.000Z', fake);
  assert.deepEqual(
    read.events.map((e) => e.title),
    ['CS 61A midterm', 'Webinar', 'Shift'],
  );
  assert.match(asked[1]!, /\/calendars\/primary\/events\?/);
  assert.match(asked[1]!, /singleEvents=true/);
  assert.match(asked[1]!, /timeMin=2026-11-15T08%3A00%3A00.000Z/);
  assert.equal(read.allCalendars, false);
  assert.equal(read.calendars, 1);
  assert.equal(read.account, 'me@example.com');
  assert.equal(read.events[0]!.allDay, true);
  assert.equal(read.events[0]!.location, 'Wheeler 150');
  // A web address is not a place.
  assert.equal(read.events[1]!.location, null);

  const expiredFetch = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(readStudentCalendar('old', '2026-11-15T00:00:00Z', '2026-12-15T00:00:00Z', expiredFetch), (e: unknown) => (e as { expired?: boolean }).expired === true);
});

test('reads every calendar ticked in Google Calendar, names the ones besides the main calendar, and skips hidden ones', async () => {
  const fake = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/users/me/calendarList'))
      return new Response(
        JSON.stringify({
          items: [
            { id: 'school@berkeley.edu', summary: 'bCourses', selected: true },
            { id: 'me@gmail.com', summary: 'me@gmail.com', primary: true, selected: true },
            { id: 'hidden-cal', summary: 'Old', selected: false },
          ],
        }),
      );
    if (u.includes(encodeURIComponent('school@berkeley.edu')))
      return page([{ id: 'm1', summary: 'CS 61A lecture', start: { dateTime: '2026-11-20T10:00:00-08:00' }, end: { dateTime: '2026-11-20T11:00:00-08:00' } }], undefined, 'bCourses');
    if (u.includes(encodeURIComponent('me@gmail.com'))) return page([{ id: 'p1', summary: 'Dentist', start: { date: '2026-11-21' }, end: { date: '2026-11-22' } }]);
    throw new Error(`hidden calendar was read: ${u}`);
  }) as typeof fetch;
  const read = await readStudentCalendar('tok', '2026-11-15T00:00:00Z', '2026-12-15T00:00:00Z', fake);
  assert.equal(read.allCalendars, true);
  assert.equal(read.calendars, 2);
  assert.equal(read.account, 'me@gmail.com');
  assert.equal(read.events.find((e) => e.title === 'CS 61A lecture')!.calendarName, 'bCourses');
  assert.equal(read.events.find((e) => e.title === 'Dentist')!.calendarName, null);
});

test('builds all-day and timed events in the student’s time zone, with an hour when no end is given', () => {
  assert.deepEqual(draftBody({ title: 'Career fair', day: '2026-11-24' }).start, { date: '2026-11-24' });
  assert.deepEqual(draftBody({ title: 'Career fair', day: '2026-11-24' }).end, { date: '2026-11-25' });
  const study = draftBody({ title: 'Study', day: '2026-11-24', time: '14:30', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(study.start, { dateTime: '2026-11-24T14:30:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(study.end, { dateTime: '2026-11-24T15:30:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(draftBody({ title: 'Lab', day: '2026-11-24', time: '09:00', endTime: '12:00', timeZone: 'UTC' }).end, { dateTime: '2026-11-24T12:00:00', timeZone: 'UTC' });
  // An end before the start is ignored rather than sent to Google.
  assert.deepEqual(draftBody({ title: 'x', day: '2026-11-24', time: '18:00', endTime: '09:00', timeZone: 'UTC' }).end, { dateTime: '2026-11-24T19:00:00', timeZone: 'UTC' });
});

test('adds, changes and removes the event, and does not mind one that is already gone', async () => {
  const calls: string[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(url).replace('https://www.googleapis.com/calendar/v3/calendars/primary/events', '')}`);
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer tok');
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'ev1', htmlLink: 'https://calendar.google.com/ev1' }));
    if (init?.method === 'DELETE') return new Response('', { status: 410 });
    return new Response('{}');
  }) as typeof fetch;
  assert.deepEqual(await insertStudentEvent('tok', { title: 'Midterm', day: '2026-12-01', time: '10:00' }, fake), { eventId: 'ev1', link: 'https://calendar.google.com/ev1' });
  await updateStudentEvent('tok', 'ev1', { title: 'Midterm', day: '2026-12-02' }, fake);
  await deleteStudentEvent('tok', 'ev1', fake);
  assert.deepEqual(calls, ['POST ', 'PATCH /ev1', 'DELETE /ev1']);
});
