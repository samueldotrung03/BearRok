// Settings > Connections on the backend, with every Google API faked: whether the server is set up,
// connecting and disconnecting, Calendar for the Calendar page, and linking, making and writing a
// Google Sheet. No token ever leaves the backend.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import { createApp } from '../src/app.ts';
import { emailFromIdToken, OAUTH_ENV, oauthSetup } from '../src/googleOAuth.ts';
import { parseSheetId, STATUS_LABEL, TRACKER_HEADER, trackerRows, writeTracker } from '../src/sheets.ts';
import { LocalStore } from '../src/store/local.ts';
import { connectGoogle, fakeGoogle } from './googleFake.ts';

const NOW = new Date('2026-11-19T12:00:00Z');
async function student() {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  await s.trigger('first');
  return s;
}
const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

test('setup: the server says plainly whether Google is set up, and what to set when it is not', () => {
  assert.equal(oauthSetup({}).client, null);
  assert.equal(oauthSetup({}).problem, null, 'nothing set: not configured, not an error');
  assert.match(oauthSetup({ GOOGLE_OAUTH_CLIENT_ID: 'id' }).problem!, /GOOGLE_OAUTH_CLIENT_SECRET is not set/);
  assert.match(oauthSetup({ GOOGLE_OAUTH_CLIENT_SECRET: 'shh' }).problem!, /GOOGLE_OAUTH_CLIENT_ID is not set/);
  assert.ok(!oauthSetup({ GOOGLE_OAUTH_CLIENT_SECRET: 'shh' }).problem!.includes('shh'), 'the secret is never repeated');
  assert.match(oauthSetup({ GOOGLE_OAUTH_CLIENT_FILE: join(tmpdir(), 'no-such-client.json') }).problem!, /cannot be read/);
  const dir = mkdtempSync(join(tmpdir(), 'bearrok-oauth-'));
  writeFileSync(join(dir, 'empty.json'), '{"installed":{}}');
  assert.match(oauthSetup({ GOOGLE_OAUTH_CLIENT_FILE: join(dir, 'empty.json') }).problem!, /no client_id/);
  writeFileSync(join(dir, 'client.json'), JSON.stringify({ installed: { client_id: 'cid.apps.googleusercontent.com', client_secret: 'GOCSPX-x' } }));
  assert.deepEqual(oauthSetup({ GOOGLE_OAUTH_CLIENT_FILE: join(dir, 'client.json') }), { client: { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'GOCSPX-x' }, problem: null });
  assert.deepEqual(oauthSetup({ GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b' }).client, { clientId: 'a', clientSecret: 'b' });
});

test('not configured: every Google action answers 503 with the reason, and the status lists the env vars', async () => {
  const s = await student();
  const { app } = createApp(new LocalStore(null), {}, { demo: s, googleProblem: 'GOOGLE_OAUTH_CLIENT_SECRET is not set; both are needed.' });
  const json = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init);
    return { status: res.status, body: (await res.json()) as any };
  };
  assert.deepEqual((await json('/api/google/config')).body, { enabled: false, problem: 'GOOGLE_OAUTH_CLIENT_SECRET is not set; both are needed.', needs: OAUTH_ENV, redirectUri: null });
  const status = (await json('/api/students/demo/google')).body;
  assert.deepEqual([status.enabled, status.connected, status.needs], [false, false, OAUTH_ENV]);
  const connect = await json('/api/students/demo/google/connect', { method: 'POST' });
  assert.deepEqual([connect.status, connect.body.reason], [503, 'not_configured']);
  for (const path of ['/calendar/sync', '/sheet/sync']) {
    const r = await json(`/api/students/demo${path}`, { method: 'POST' });
    assert.deepEqual([r.status, r.body.reason], [503, 'not_configured'], path);
  }
  assert.equal((await json('/api/students/demo/google/calendar/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z')).body.reason, 'not_configured');
});

test('connect states: not connected, a permission left unticked, access taken back at Google', async () => {
  const s = await student();
  let revokeAtGoogle = false;
  const { google } = fakeGoogle();
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token') && revokeAtGoogle) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return google.fetch(url, init);
  }) as typeof fetch;
  const { app } = createApp(new LocalStore(null), {}, { demo: s, google: { ...google, fetch: fetchImpl }, tracker: async () => ({ spreadsheetId: SHEET_ID, url: 'u', title: 't', tab: 'Applications' }) });
  const post = async (path: string) => {
    const res = await app.request(`/api/students/demo${path}`, { method: 'POST' });
    return { status: res.status, body: (await res.json()) as any };
  };
  assert.equal((await post('/sheet/sync')).body.reason, 'not_connected');

  connectGoogle(s, ['calendar']);
  const notGranted = await post('/sheet/sync');
  assert.deepEqual([notGranted.status, notGranted.body.reason], [400, 'not_granted']);
  assert.match(notGranted.body.error, /Google Sheets was not allowed/);
  assert.equal((await post('/calendar/sync')).status, 200, 'what was allowed works');

  // Access taken back at Google: seen the next time a fresh token is needed (a new start here).
  connectGoogle(s, ['calendar', 'sheets']);
  revokeAtGoogle = true;
  const { app: restarted } = createApp(new LocalStore(null), {}, { demo: s, google: { ...google, fetch: fetchImpl } });
  const res = await restarted.request('/api/students/demo/sheet/sync', { method: 'POST' });
  const revoked = { status: res.status, body: (await res.json()) as any };
  assert.deepEqual([revoked.status, revoked.body.reason], [401, 'revoked']);
  assert.equal(s.getGoogle(), null, 'the dead grant is forgotten, so Settings shows Not connected');
});

test('email: read from the id_token Google returns, or null when there is none', () => {
  const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  assert.equal(emailFromIdToken(token({ email: 'a@b.org', sub: '1' })), 'a@b.org');
  assert.equal(emailFromIdToken(token({ sub: '1' })), null);
  assert.equal(emailFromIdToken(undefined), null);
  assert.equal(emailFromIdToken('not-a-jwt'), null);
});

test('calendar page: events are read and written through the backend with the stored grant', async () => {
  const s = await student();
  connectGoogle(s);
  let expiredOnce = false;
  const seen: { method: string; url: string; auth: string | null; body: any }[] = [];
  const { google, calls } = fakeGoogle(async (url, init) => {
    seen.push({ method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (expiredOnce) {
      expiredOnce = false;
      return new Response('{}', { status: 401 });
    }
    if (url.includes('/users/me/calendarList')) return Response.json({ items: [{ id: 'me@gmail.com', primary: true }, { id: 'school', summary: 'Classes' }, { id: 'hidden', hidden: true }] });
    if (url.includes('/calendars/me%40gmail.com/events')) return Response.json({ items: [{ id: 'e1', summary: 'Shift', start: { dateTime: '2026-11-20T17:00:00Z' }, end: { dateTime: '2026-11-20T19:00:00Z' }, location: 'https://zoom.example' }] });
    if (url.includes('/calendars/school/events')) return Response.json({ items: [{ id: 'e2', summary: 'Midterm', start: { date: '2026-11-21' }, end: { date: '2026-11-22' } }, { id: 'gone', status: 'cancelled', start: { date: '2026-11-21' } }] });
    if (init?.method === 'POST') return Response.json({ id: 'new-1', htmlLink: 'https://calendar.google.com/e/new-1' });
    return Response.json({});
  });
  const { app } = createApp(new LocalStore(null), {}, { demo: s, google });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/students/demo${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };

  const read = await call('GET', '/google/calendar/events?from=2026-11-16T08:00:00.000Z&to=2026-11-23T08:00:00.000Z');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.events.map((e: any) => [e.id, e.calendarName, e.allDay, e.location]), [['e1', null, false, null], ['e2', 'Classes', true, null]]);
  assert.deepEqual([read.body.account, read.body.calendars, read.body.allCalendars], ['me@gmail.com', 2, true]);
  assert.ok(seen.every((c) => c.auth === 'Bearer tok'), 'every call uses the token the backend made');
  assert.ok(seen.some((c) => c.url.includes('timeMin=2026-11-16T08%3A00%3A00.000Z')), 'the range the page worked out in its own time zone');

  const made = await call('POST', '/google/calendar/events', { title: 'Study', day: '2026-11-24', time: '14:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(made.body, { eventId: 'new-1', link: 'https://calendar.google.com/e/new-1' });
  assert.deepEqual(seen.at(-1)!.body.start, { dateTime: '2026-11-24T14:00:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(seen.at(-1)!.body.end, { dateTime: '2026-11-24T15:00:00', timeZone: 'America/Los_Angeles' }, 'an hour by default');
  assert.equal((await call('POST', '/google/calendar/events', { title: '' })).status, 400);
  assert.equal((await call('PATCH', '/google/calendar/events/new-1', { title: 'Study', day: '2026-11-25' })).body.ok, true);
  assert.equal((await call('DELETE', '/google/calendar/events/new-1')).body.ok, true);

  expiredOnce = true;
  const expired = await call('GET', '/google/calendar/events?from=2026-11-16T08:00:00Z&to=2026-11-23T08:00:00Z');
  assert.deepEqual([expired.status, expired.body.reason], [401, 'expired']);
  // The next call makes a fresh token rather than reusing the one Google refused.
  const tokenCalls = () => calls.filter((c) => c.includes('oauth2.googleapis.com/token')).length;
  const before = tokenCalls();
  await call('GET', '/google/calendar/events?from=2026-11-16T08:00:00Z&to=2026-11-23T08:00:00Z');
  assert.equal(tokenCalls(), before + 1);
});

test('sheets: export mapping, one row per application with its stage in the app’s words', async () => {
  assert.deepEqual(STATUS_LABEL, { interested: 'Saved', to_apply: 'To apply', applying: 'Applying', applied: 'Applied' });
  const s = await student();
  const [a, b, c, d] = s.student().feed.map((f) => f.opportunity);
  s.interact(a!.id, 'save');
  s.setApplication(b!.id, { status: 'to_apply' });
  s.setApplication(c!.id, { status: 'applying', deadline: '2026-11-25T23:59:00.000Z' });
  s.setApplication(d!.id, { status: 'applied' });
  const [header, ...rows] = trackerRows(s.trackerItems(), NOW);
  const col = (name: string) => TRACKER_HEADER.indexOf(name);
  assert.deepEqual(header, TRACKER_HEADER);
  const byTitle = new Map(rows.map((r) => [r[col('Opportunity')], r]));
  assert.equal(byTitle.get(a!.title)![col('Status')], 'Saved');
  assert.equal(byTitle.get(b!.title)![col('Status')], 'To apply');
  assert.equal(byTitle.get(d!.title)![col('Status')], 'Applied');
  const applying = byTitle.get(c!.title)!;
  assert.deepEqual([applying[col('Status')], applying[col('Deadline')], applying[col('Days left')]], ['Applying', '2026-11-25', '7']);
  assert.equal(applying[col('Calendar')], 'Added once Google Calendar is connected');
  assert.equal(byTitle.get(a!.title)![col('Saved on')], '2026-11-19', 'when it was saved');
  assert.equal(byTitle.get(b!.title)![col('Saved on')], '', 'never saved, started straight away');
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(r.length, TRACKER_HEADER.length, 'every row fills every column');
});

test('sheets: a pasted link is parsed to its id, and anything else is refused', () => {
  assert.equal(parseSheetId(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`), SHEET_ID);
  assert.equal(parseSheetId(`  ${SHEET_ID} `), SHEET_ID);
  assert.equal(parseSheetId('https://example.org/not-a-sheet'), null);
  assert.equal(parseSheetId('short'), null);
});

test('sheets: pick an existing sheet (its tab is added), sync now, make a new one, and a lost tab comes back', async () => {
  const s = await student();
  s.interact(s.student().feed[0]!.opportunity.id, 'save');
  connectGoogle(s);
  const requests: string[] = [];
  let tabs = ['Budget'];
  let made = 0;
  const { google } = fakeGoogle(async (url, init) => {
    const path = url.replace('https://sheets.googleapis.com/v4/spreadsheets', '');
    requests.push(`${init?.method ?? 'GET'} ${path.split('?')[0]}`);
    if (path.startsWith(`/${SHEET_ID}?fields=`)) return Response.json({ spreadsheetId: SHEET_ID, properties: { title: 'My job hunt' }, sheets: tabs.map((title) => ({ properties: { title } })) });
    if (path.startsWith('/missing')) return new Response('{}', { status: 404 });
    if (path.endsWith(':batchUpdate')) {
      tabs = [...tabs, JSON.parse(String(init!.body)).requests[0].addSheet.properties.title];
      return Response.json({});
    }
    if (path.includes(':clear')) return new Response('{}', { status: tabs.includes('Applications') ? 200 : 400 });
    if (init?.method === 'PUT') return Response.json({});
    if (path === '' && init?.method === 'POST') return Response.json({ spreadsheetId: `made-${++made}`, properties: { title: 'BearRok applications (2026-11-19)' } });
    return new Response('{}', { status: 500 });
  });
  const { app } = createApp(new LocalStore(null), {}, { demo: s, google });
  const post = async (path: string, body?: unknown) => {
    const res = await app.request(`/api/students/demo${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: res.status, body: (await res.json()) as any };
  };

  assert.equal((await post('/sheet/link', { sheet: 'nonsense' })).status, 400);
  const missing = await post('/sheet/link', { sheet: 'https://docs.google.com/spreadsheets/d/missing0000000000000000000/edit' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /not found/, 'said plainly; no new file is made instead');
  assert.equal(s.student().sheet, null);

  const linked = await post('/sheet/link', { sheet: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit` });
  assert.equal(linked.status, 200);
  assert.deepEqual({ ...linked.body.linked, syncedAt: 'x' }, { spreadsheetId: SHEET_ID, url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`, title: 'My job hunt', tab: 'Applications', syncedAt: 'x' });
  assert.ok(Date.parse(linked.body.linked.syncedAt), 'written straight away, with the time');
  assert.deepEqual(tabs, ['Budget', 'Applications'], "the student's own tab is left alone; BearRok's is added");
  assert.ok(requests.includes(`PUT /${SHEET_ID}/values/Applications!A1`));

  // Sync now writes the same sheet again.
  requests.length = 0;
  const again = await post('/sheet/sync');
  assert.equal(again.body.linked.spreadsheetId, SHEET_ID);
  assert.deepEqual(requests, [`POST /${SHEET_ID}/values/Applications!A1%3AZ:clear`, `PUT /${SHEET_ID}/values/Applications!A1`]);

  // The student deleted BearRok's tab: it is added back and written, the sheet stays linked.
  tabs = ['Budget'];
  const back = await post('/sheet/sync');
  assert.equal(back.body.linked.spreadsheetId, SHEET_ID);
  assert.deepEqual(tabs, ['Budget', 'Applications']);

  // Create a new sheet on purpose.
  const fresh = await post('/sheet/sync', { create: true });
  assert.deepEqual([fresh.body.linked.spreadsheetId, fresh.body.linked.title, fresh.body.linked.tab], ['made-1', 'BearRok applications (2026-11-19)', 'Applications']);
  assert.equal(s.student().sheet?.spreadsheetId, 'made-1');
  // Status for Settings carries the sheet and nothing secret.
  const status = (await (await app.request('/api/students/demo/google')).json()) as any;
  assert.equal(status.sheet.spreadsheetId, 'made-1');
  assert.equal(status.email, 'student@example.org');
  assert.ok(!JSON.stringify(status).includes('refresh-secret') && !JSON.stringify(status).includes('"tok"'));
});

test('sheets: writing a linked sheet whose tab is gone adds it back rather than making a new file', async () => {
  const calls: string[] = [];
  let hasTab = false;
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url).replace('https://sheets.googleapis.com/v4/spreadsheets', '');
    calls.push(`${init?.method} ${u.split('?')[0]}`);
    if (u.endsWith(':batchUpdate')) {
      hasTab = true;
      return Response.json({});
    }
    if (u.includes(':clear')) return new Response('{}', { status: hasTab ? 200 : 400 });
    return Response.json({});
  }) as typeof fetch;
  const out = await writeTracker('tok', { spreadsheetId: 'mine', tab: 'Applications', title: 'Mine' }, [TRACKER_HEADER], NOW, fake);
  assert.deepEqual(out, { spreadsheetId: 'mine', url: 'https://docs.google.com/spreadsheets/d/mine', title: 'Mine', tab: 'Applications' });
  assert.deepEqual(calls, ['POST /mine/values/Applications!A1%3AZ:clear', 'POST /mine:batchUpdate', 'POST /mine/values/Applications!A1%3AZ:clear', 'PUT /mine/values/Applications!A1']);
});
