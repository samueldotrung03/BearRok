// The saved tracker: its rows, the app's endpoints, and writing it to a Google Sheet (faked).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import { createApp } from '../src/app.ts';
import { TRACKER_HEADER, trackerRows, writeTracker } from '../src/sheets.ts';
import { LocalStore } from '../src/store/local.ts';
import { connectGoogle, fakeGoogle as fakeGoogleApi } from './googleFake.ts';

const NOW = new Date('2026-11-19T12:00:00Z');

async function student() {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  await s.trigger('first');
  return s;
}

test('tracker: every saved posting is a row with its status, deadline, details and links; soonest first', async () => {
  const s = await student();
  const feed = s.student().feed.map((f) => f.opportunity);
  const dated = feed.filter((o) => o.deadline).sort((a, b) => Date.parse(b.deadline!) - Date.parse(a.deadline!));
  const [later, sooner] = dated;
  const undated = feed.find((o) => !o.deadline);
  for (const o of [later!, sooner!, ...(undated ? [undated] : [])]) s.interact(o.id, 'save');
  s.setApplication(later!.id, { status: 'applying' });

  const [header, ...rows] = trackerRows(s.trackerItems(), NOW);
  assert.deepEqual(header, TRACKER_HEADER);
  assert.equal(rows.length, undated ? 3 : 2);
  const col = (name: string) => TRACKER_HEADER.indexOf(name);
  assert.deepEqual(rows.map((r) => r[0]), [sooner!.title, later!.title, ...(undated ? [undated.title] : [])], 'soonest deadline first, none last');
  const row = rows[1]!;
  assert.equal(row[col('Status')], 'Applying');
  assert.equal(row[col('Deadline')], later!.deadline!.slice(0, 10));
  assert.equal(row[col('Organizer')], later!.organizer);
  assert.equal(row[col('Official page')], later!.sourceUrl);
  assert.ok(row[col('Apply link')]!.startsWith('http'));
  assert.equal(row[col('Calendar')], 'Added once Google Calendar is connected');
  assert.equal(row[col('Saved on')], NOW.toISOString().slice(0, 10));
  assert.equal(rows[0]![col('Status')], 'Interested', 'a save with no application is shown as Interested');
  if (undated) assert.equal(rows[2]![col('Deadline')], 'Not stated');
});

test('tracker: a linked sheet is updated in place, and replaced only if it was deleted', async () => {
  const calls: string[] = [];
  let gone = false;
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method} ${u.replace('https://sheets.googleapis.com/v4/spreadsheets', '')}`);
    if (u.endsWith(':clear')) return new Response('{}', { status: gone ? 404 : 200 });
    if (init?.method === 'PUT') return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ spreadsheetId: 'new-sheet', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-sheet' }), { status: 200 });
  }) as typeof fetch;
  const rows = [TRACKER_HEADER, ['A']];

  assert.deepEqual(await writeTracker('tok', null, rows, NOW, fake), { spreadsheetId: 'new-sheet', url: 'https://docs.google.com/spreadsheets/d/new-sheet', title: 'BearRok applications (2026-11-19)', tab: 'Applications' });
  assert.deepEqual(calls, ['POST ']);

  calls.length = 0;
  assert.equal((await writeTracker('tok', { spreadsheetId: 'mine' }, rows, NOW, fake)).spreadsheetId, 'mine');
  assert.deepEqual(calls, ['POST /mine/values/Saved!A1%3AZ:clear', 'PUT /mine/values/Saved!A1?valueInputOption=RAW'], 'a sheet linked before keeps its Saved tab: cleared and rewritten, no new file');

  calls.length = 0;
  assert.equal((await writeTracker('tok', { spreadsheetId: 'mine', tab: 'Applications' }, rows, NOW, fake)).tab, 'Applications');
  assert.deepEqual(calls, ['POST /mine/values/Applications!A1%3AZ:clear', 'PUT /mine/values/Applications!A1?valueInputOption=RAW']);

  calls.length = 0;
  gone = true;
  assert.equal((await writeTracker('tok', { spreadsheetId: 'mine' }, rows, NOW, fake)).spreadsheetId, 'new-sheet');
  assert.equal(calls.at(-1), 'POST ');

  // A sheet the connected Google account cannot open (made under another account) is replaced too.
  const forbidden = (async (url: string | URL | Request, init?: RequestInit) =>
    String(url).endsWith(':clear') ? new Response('{}', { status: 403 }) : fake(url, init)) as typeof fetch;
  assert.equal((await writeTracker('tok', { spreadsheetId: 'someone-elses' }, rows, NOW, forbidden)).spreadsheetId, 'new-sheet');
});

test('tracker: the app reads the rows, links a sheet on first sync, and keeps writing to it', async () => {
  const s = await student();
  const o = s.student().feed[0]!.opportunity;
  s.interact(o.id, 'save');
  const written: { linked: unknown; rows: string[][] }[] = [];
  const { app } = createApp(new LocalStore(null), {}, {
    demo: s,
    google: fakeGoogleApi().google,
    tracker: async (_token, linked, rows) => {
      written.push({ linked, rows });
      return { spreadsheetId: 'sheet-1', url: 'https://docs.google.com/spreadsheets/d/sheet-1', title: 'BearRok applications', tab: 'Applications' };
    },
  });
  const get = await (await app.request('/api/students/demo/sheet')).json() as any;
  assert.deepEqual(get.header, TRACKER_HEADER);
  assert.equal(get.rows[0][0], o.title);
  assert.deepEqual(get.ids, [o.id]);
  assert.equal(get.linked, null);

  assert.equal((await app.request('/api/students/demo/sheet/sync', { method: 'POST', headers: { 'x-google-access-token': 'tok' } })).status, 400, 'needs Google connected on the server');
  connectGoogle(s);
  const sync = async () => (await (await app.request('/api/students/demo/sheet/sync', { method: 'POST' })).json()) as any;
  assert.equal((await sync()).linked.spreadsheetId, 'sheet-1');
  await sync();
  assert.equal(written[0]!.linked, null);
  assert.deepEqual(written[1]!.linked, { spreadsheetId: 'sheet-1', url: 'https://docs.google.com/spreadsheets/d/sheet-1', title: 'BearRok applications', tab: 'Applications', syncedAt: (written[1]!.linked as any).syncedAt });
  assert.equal(s.student().sheet?.spreadsheetId, 'sheet-1');
  // The link is part of what the student set, so it is kept with their account.
  assert.equal(s.memorySnapshot().profile.sheet?.spreadsheetId, 'sheet-1');

  assert.equal(((await (await app.request('/api/students/demo/sheet', { method: 'DELETE' })).json()) as any).linked, null);
  assert.equal(s.student().sheet, null);
});

test('status: saving does not make an application; unsaving an Interested one that never got further stops tracking it', async () => {
  const s = await student();
  const [a, b] = s.student().feed.map((f) => f.opportunity);
  s.interact(a!.id, 'save');
  assert.equal(s.getApplication(a!.id), null, 'a save is not an application');
  s.setApplication(a!.id, { status: 'interested' });
  s.interact(a!.id, 'save');
  assert.equal(s.getApplication(a!.id), null, 'unsaved while still only Interested');
  // One the student moved on keeps its status when unsaved.
  s.interact(b!.id, 'save');
  s.setApplication(b!.id, { status: 'applying' });
  s.interact(b!.id, 'save');
  assert.equal(s.getApplication(b!.id)?.status, 'applying');
});

test('calendar: with Google Calendar connected, every To apply and Applying deadline gets one event, kept in step', async () => {
  const s = await student();
  const dated = s.student().feed.map((f) => f.opportunity).filter((o) => o.deadline);
  const [a, b, c] = dated;
  s.setApplication(a!.id, { status: 'applying' });
  s.setApplication(b!.id, { status: 'to_apply' });
  s.setApplication(c!.id, { status: 'interested' });
  const events = new Map<string, string>();
  let n = 0;
  const { app } = createApp(new LocalStore(null), {}, {
    demo: s,
    google: fakeGoogleApi().google,
    calendar: {
      create: async (_token, event) => {
        const id = `ev-${++n}`;
        events.set(id, event.deadline);
        return { eventId: id, htmlLink: `https://calendar.google.com/event?eid=${id}` };
      },
      remove: async (_token, id) => void events.delete(id),
    },
  });
  const sync = async () => (await (await app.request('/api/students/demo/calendar/sync', { method: 'POST' })).json()) as any;

  assert.equal((await app.request('/api/students/demo/calendar/sync', { method: 'POST', headers: { 'x-google-access-token': 'tok' } })).status, 400, 'needs Google connected on the server');
  connectGoogle(s);
  assert.deepEqual(await sync(), { added: 2, removed: 0, errors: [] });
  assert.equal(events.size, 2);
  assert.equal(s.getApplication(a!.id)!.calendar.state, 'synced');
  assert.equal(s.getApplication(c!.id)!.calendar.state === 'synced', false, 'Interested is not put on the calendar');

  // Nothing changed: nothing is added twice.
  assert.deepEqual(await sync(), { added: 0, removed: 0, errors: [] });
  // A new deadline moves the event; applied takes it off.
  s.setApplication(a!.id, { deadline: '2027-03-01T23:59:00.000Z' });
  s.setApplication(b!.id, { status: 'applied' });
  assert.deepEqual(await sync(), { added: 1, removed: 1, errors: [] });
  assert.deepEqual([...events.values()], ['2027-03-01T23:59:00.000Z']);
  // The last sync is kept for Settings to show.
  assert.deepEqual({ ...s.getCalendarSync(), at: 'x' }, { at: 'x', added: 1, removed: 1, errors: [] });
  assert.equal(s.student().calendarSync?.added, 1);
});

test('google: students connect once; the backend keeps fresh access from the stored refresh token and uses it for calendar writes', async () => {
  const s = await student();
  const o = s.student().feed.find((f) => f.opportunity.deadline)!.opportunity;
  const calls: string[] = [];
  let refreshes = 0;
  const fakeGoogle = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''));
    calls.push(`${String(url).split('?')[0]} ${body.get('grant_type') ?? ''}`);
    if (body.get('grant_type') === 'authorization_code') {
      assert.equal(body.get('code'), 'the-code');
      assert.ok(body.get('code_verifier'));
      const idToken = ['x', Buffer.from(JSON.stringify({ email: 'ana@gmail.com' })).toString('base64url'), 'sig'].join('.');
      return new Response(JSON.stringify({ access_token: 'acc-1', expires_in: 3600, refresh_token: 'refresh-1', id_token: idToken, scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets' }));
    }
    if (body.get('grant_type') === 'refresh_token') {
      refreshes++;
      return new Response(JSON.stringify({ access_token: `acc-r${refreshes}`, expires_in: 3600 }));
    }
    return new Response('{}');
  }) as typeof fetch;
  const used: string[] = [];
  const { app } = createApp(new LocalStore(null), {}, {
    demo: s,
    google: { client: { clientId: 'cid', clientSecret: 'secret' }, redirectBase: 'http://127.0.0.1:8787', fetch: fakeGoogle },
    calendar: {
      create: async (token) => {
        used.push(token);
        return { eventId: 'ev', htmlLink: 'https://calendar.google.com/e' };
      },
      remove: async () => {},
    },
  });
  const json = async (path: string, init?: RequestInit) => (await (await app.request(path, init)).json()) as any;

  assert.deepEqual(await json('/api/google/config'), { enabled: true, problem: null, needs: [], redirectUri: 'http://127.0.0.1:8787/auth/google/callback' });
  const before = await json('/api/students/demo/google');
  assert.deepEqual([before.connected, before.services, before.email], [false, [], null]);
  // With sign-in off, the local user is the demo student and may connect.
  assert.equal(before.mayConnect, true);
  assert.equal((await app.request('/api/students/demo/google/connect', { method: 'POST' })).status, 200);

  // Signed in, the consent screen asks for lasting access; Google's reply links the account.
  const user = { uid: 'u1', name: 'Ana', email: 'ana@example.org', picture: null, provider: 'google' as const, emailVerified: true };
  const ana = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  await ana.trigger('first');
  const { app: signedIn } = createApp(new LocalStore(null), {}, {
    demo: s,
    webConfig: { apiKey: 'k', projectId: 'p', authDomain: 'x' },
    verify: async () => user,
    forUser: () => ana,
    google: { client: { clientId: 'cid', clientSecret: 'secret' }, redirectBase: 'http://127.0.0.1:8787', fetch: fakeGoogle },
    calendar: {
      create: async (token) => {
        used.push(token);
        return { eventId: 'ev', htmlLink: 'https://calendar.google.com/e' };
      },
      remove: async () => {},
    },
  });
  const go = await signedIn.request('/api/students/me/google/connect', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: '{"services":["calendar","sheets"]}' });
  assert.equal(go.status, 200);
  const consent = new URL(((await go.json()) as any).url);
  assert.equal(consent.origin + consent.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(consent.searchParams.get('access_type'), 'offline');
  assert.equal(consent.searchParams.get('redirect_uri'), 'http://127.0.0.1:8787/auth/google/callback');
  assert.match(consent.searchParams.get('scope')!, /calendar\.events.*spreadsheets/);
  assert.match(consent.searchParams.get('scope')!, /^openid email /, 'asks who the account is, for Settings to show');
  // With sign-in on, the shared guest cannot connect.
  assert.equal((await signedIn.request('/api/students/demo/google/connect', { method: 'POST' })).status, 401);
  assert.equal(consent.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(consent.searchParams.get('login_hint'), 'ana@example.org');

  const back = await signedIn.request(`/auth/google/callback?code=the-code&state=${consent.searchParams.get('state')}`);
  assert.equal(back.status, 200);
  assert.match(await back.text(), /Google is connected/);
  assert.deepEqual(ana.getGoogle()?.services, ['calendar', 'sheets']);
  assert.equal(ana.memorySnapshot().profile.google?.refreshToken, 'refresh-1', 'kept with the account');
  assert.ok(!JSON.stringify(ana.student()).includes('refresh-1'), 'never sent to a page');
  assert.equal(ana.getGoogle()?.email, 'ana@gmail.com', 'the Google account, from the id_token');
  const status = (await (await signedIn.request('/api/students/me/google', { headers: { authorization: 'Bearer t' } })).json()) as any;
  assert.deepEqual([status.connected, status.email, status.services], [true, 'ana@gmail.com', ['calendar', 'sheets']]);
  for (const secret of ['refresh-1', 'acc-1', 'secret']) assert.ok(!JSON.stringify(status).includes(secret), `the status never carries ${secret}`);
  assert.deepEqual(ana.student().google, { email: 'ana@gmail.com', services: ['calendar', 'sheets'], connectedAt: ana.getGoogle()!.connectedAt, allCalendars: false });
  // A used link cannot be used again.
  assert.equal((await signedIn.request(`/auth/google/callback?code=x&state=${consent.searchParams.get('state')}`)).status, 400);

  // A status change puts the deadline on the calendar with no token from the page.
  const h = { authorization: 'Bearer t', 'content-type': 'application/json' };
  const target = ana.student().feed.find((f) => f.opportunity.deadline)!.opportunity;
  await signedIn.request(`/api/students/me/applications/${target.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ status: 'applying' }) });
  assert.deepEqual(used, ['acc-1']);
  assert.equal(ana.getApplication(target.id)!.calendar.state, 'synced');

  // After a restart the memory still holds the connection: a fresh token is made from it.
  const restarted = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  restarted.restore(JSON.parse(JSON.stringify(ana.memorySnapshot())));
  const { app: again } = createApp(new LocalStore(null), {}, {
    demo: s,
    webConfig: { apiKey: 'k', projectId: 'p', authDomain: 'x' },
    verify: async () => user,
    forUser: () => restarted,
    google: { client: { clientId: 'cid', clientSecret: 'secret' }, redirectBase: 'http://127.0.0.1:8787', fetch: fakeGoogle },
    calendar: {
      create: async (token) => {
        used.push(token);
        return { eventId: 'ev', htmlLink: 'https://calendar.google.com/e' };
      },
      remove: async () => {},
    },
  });
  // No route hands an access token to a page any more.
  assert.equal((await again.request('/api/students/me/google/token', { method: 'POST', headers: h, body: '{"service":"calendar"}' })).status, 404);
  const twice = restarted.student().feed.filter((f) => f.opportunity.deadline).slice(0, 2).map((f) => f.opportunity.id);
  for (const id of twice) await again.request(`/api/students/me/applications/${id}`, { method: 'PUT', headers: h, body: JSON.stringify({ status: 'to_apply' }) });
  assert.equal(refreshes, 1, 'one fresh token from the refresh token, reused until it is about to expire');
  assert.equal(used.at(-1), 'acc-r1');

  // Disconnecting forgets it, and Google is told to.
  await again.request('/api/students/me/google', { method: 'DELETE', headers: h });
  assert.equal(restarted.getGoogle(), null);
  assert.equal(restarted.student().google, null);
  assert.ok(calls.some((c) => c.startsWith('https://oauth2.googleapis.com/revoke')), 'the grant is revoked at Google');
  const after = (await (await again.request('/api/students/me/calendar/sync', { method: 'POST', headers: h })).json()) as any;
  assert.equal(after.reason, 'not_connected');
  void o;
  void json;
  void calls;
});

test('google: leaving the permission boxes unticked is caught and explained, not saved as a working connection', async () => {
  const ana = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  // Google gives back only the sign-in basics: the Calendar and Sheets boxes were not ticked.
  const fakeGoogle = (async () =>
    new Response(JSON.stringify({ access_token: 'a', expires_in: 3600, refresh_token: 'r', scope: 'openid https://www.googleapis.com/auth/userinfo.email' }))) as unknown as typeof fetch;
  const { app } = createApp(new LocalStore(null), {}, {
    demo: ana,
    webConfig: { apiKey: 'k', projectId: 'p', authDomain: 'x' },
    verify: async () => ({ uid: 'u1', name: 'Ana', email: null, picture: null, provider: 'google', emailVerified: true }),
    forUser: () => ana,
    google: { client: { clientId: 'cid', clientSecret: 'secret' }, redirectBase: 'http://127.0.0.1:8787', fetch: fakeGoogle },
  });
  const go = await app.request('/api/students/me/google/connect', { method: 'POST', headers: { authorization: 'Bearer t' } });
  const state = new URL(((await go.json()) as any).url).searchParams.get('state');
  const back = await app.request(`/auth/google/callback?code=c&state=${state}`);
  assert.equal(back.status, 400);
  const text = await back.text();
  assert.match(text, /Google Calendar and Google Sheets not allowed/);
  assert.match(text, /tick both permissions/);
  assert.deepEqual(ana.getGoogle()?.services, []);
  // The app sees the answer came back without Calendar, so it can say so instead of waiting.
  const status = (await (await app.request('/api/students/me/google', { headers: { authorization: 'Bearer t' } })).json()) as any;
  assert.deepEqual(status.services, []);
  assert.ok(status.connectedAt);
});

test('google: switching to another Google account shows the account picker and replaces the old connection', async () => {
  const ana = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  ana.setGoogle({ refreshToken: 'old-refresh', services: ['calendar', 'sheets'], connectedAt: NOW.toISOString() });
  const revoked: string[] = [];
  const fakeGoogle = (async (url: string | URL | Request) => {
    if (String(url).includes('/revoke')) {
      revoked.push(new URL(String(url)).searchParams.get('token')!);
      return new Response('{}');
    }
    return new Response(JSON.stringify({ access_token: 'a', expires_in: 3600, refresh_token: 'new-refresh', scope: 'https://www.googleapis.com/auth/calendar.events' }));
  }) as typeof fetch;
  const { app } = createApp(new LocalStore(null), {}, {
    demo: ana,
    webConfig: { apiKey: 'k', projectId: 'p', authDomain: 'x' },
    verify: async () => ({ uid: 'u1', name: 'Ana', email: 'ana@example.org', picture: null, provider: 'google', emailVerified: true }),
    forUser: () => ana,
    google: { client: { clientId: 'cid', clientSecret: 'secret' }, redirectBase: 'http://127.0.0.1:8787', fetch: fakeGoogle },
  });
  const go = await app.request('/api/students/me/google/connect', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ services: ['calendar'], switchAccount: true }) });
  const url = new URL(((await go.json()) as any).url);
  assert.equal(url.searchParams.get('prompt'), 'consent select_account');
  assert.equal(url.searchParams.get('login_hint'), null, 'no account is suggested when switching');
  await app.request(`/auth/google/callback?code=c&state=${url.searchParams.get('state')}`);
  assert.deepEqual(ana.getGoogle()?.services, ['calendar'], 'only what the new account allowed');
  assert.equal(ana.getGoogle()?.refreshToken, 'new-refresh');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(revoked, ['old-refresh'], "the old account's access is given back");
});
