// Usage tracking: reactions, runs and visits become rows that hold no account id, the same memory
// saved twice adds nothing, and the summary gives the return, save and apply numbers.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Hono } from 'hono';
import type { StudentMemory } from '../src/agents/types.ts';
import { openEmbedded, type Sql } from '../src/opportunities/db.ts';
import { anonymous, eventsIn, mountMetrics, trackUsage, UsageLog } from '../src/usage.ts';

let sql: Sql;
let usage: UsageLog;
const problems: string[] = [];
before(async () => {
  sql = await openEmbedded(null);
  usage = await UsageLog.open(sql, (m) => problems.push(m));
});
after(() => sql.close());

const LINK = 'example.com/jobs/swe-intern';
/** A memory with one real posting, one sample, and the reactions and runs given. */
const memory = (interactions: { opportunityId: string; action: string; at: string }[], runs: unknown[] = [], lastRun: unknown = null) =>
  ({
    learned: {
      opportunities: [
        { id: 'real', origin: 'live', sourceUrl: `https://www.${LINK}?utm_source=x` },
        { id: 'made-up', origin: 'prepared', sourceUrl: 'https://sample.example/posting' },
      ],
      interactions,
      runs,
      lastRun,
    },
  }) as unknown as StudentMemory;

const rows = async () => (await sql.query<{ student: string; action: string; subject: string; data: string; amount: number }>('select student, action, subject, data, amount from usage_events order by at, key')).rows;

test('a memory becomes events that name the posting and never the account', () => {
  const run = { number: 3, status: 'complete', startedAt: '2026-11-02T09:00:00.000Z', finishedAt: '2026-11-02T09:05:00.000Z', stats: { added: 6 } };
  const events = eventsIn(
    'uid-ana',
    memory(
      [
        { opportunityId: 'real', action: 'save', at: '2026-11-02T10:00:00.000Z' },
        { opportunityId: 'made-up', action: 'like', at: '2026-11-02T10:01:00.000Z' },
        { opportunityId: 'gone', action: 'open', at: '2026-11-02T10:02:00.000Z' },
        { opportunityId: 'real', action: 'save', at: 'not a time' },
      ],
      [run, { ...run, number: 2, startedAt: '2026-11-01T09:00:00.000Z' }, { ...run, number: 4, status: 'running', finishedAt: null }],
      { number: 3, startedAt: run.startedAt, mode: 'live' },
    ),
  );
  assert.deepEqual(
    events.map((e) => [e.action, e.subject, e.data, e.amount]),
    [
      ['save', LINK, 'live', 1],
      ['like', 'sample.example/posting', 'sample', 1],
      ['open', 'gone', 'unknown', 1],
      ['run', '3', 'live', 6],
      ['run', '2', 'unknown', 6],
    ],
  );
  assert.ok(events.every((e) => e.student === anonymous('uid-ana') && !JSON.stringify(e).includes('uid-ana')));
  assert.deepEqual(eventsIn('guest:demo', memory([{ opportunityId: 'real', action: 'save', at: '2026-11-02T10:00:00.000Z' }])), []);
});

test('saving a memory writes its events once, and the save does not wait on the table', async () => {
  const saved: string[] = [];
  const store = {
    loadStudent: async () => null,
    saveStudent: async (id: string) => void saved.push(id),
    deleteStudent: async (id: string) => void saved.push(`deleted ${id}`),
  };
  const tracked = trackUsage(store, usage);
  const m = memory([{ opportunityId: 'real', action: 'save', at: '2026-11-02T10:00:00.000Z' }]);
  await tracked.saveStudent('uid-temp', m);
  await tracked.saveStudent('uid-temp', m);
  await tracked.saveStudent('guest:demo', m);
  await usage.idle();
  assert.deepEqual(saved, ['uid-temp', 'uid-temp', 'guest:demo']);
  assert.deepEqual(await rows(), [{ student: anonymous('uid-temp'), action: 'save', subject: LINK, data: 'live', amount: 1 }]);

  // A second copy of the backend that has not seen the event stores nothing new either.
  const other = await UsageLog.open(sql);
  await other.record(eventsIn('uid-temp', m));
  assert.equal((await rows()).length, 1);

  // Deleting the account removes the student's rows.
  await tracked.deleteStudent('uid-temp');
  await usage.idle();
  assert.deepEqual(await rows(), []);
  assert.deepEqual(problems, []);
});

test('a visit counts once a day, and the summary gives return, save and apply numbers', async () => {
  const day = (d: string, h = 12) => new Date(`2026-11-${d}T${String(h).padStart(2, '0')}:00:00.000Z`);
  // Ana: first day Nov 1, back on Nov 9 (her second week). Ben: first day Nov 2, back only on Nov 20.
  // Cam: first day Nov 18, too recent to say anything about a second week.
  usage.visit('uid-ana', day('01'));
  usage.visit('uid-ana', day('01', 18));
  usage.visit('uid-ana', day('09'));
  usage.visit('uid-ben', day('02'));
  usage.visit('uid-ben', day('20'));
  usage.visit('uid-cam', day('18'));
  usage.visit('guest:demo', day('18'));
  usage.queue(
    eventsIn(
      'uid-ana',
      memory(
        [
          { opportunityId: 'real', action: 'save', at: '2026-11-01T12:00:00.000Z' },
          { opportunityId: 'real', action: 'save', at: '2026-11-03T12:00:00.000Z' },
          { opportunityId: 'real', action: 'apply', at: '2026-11-09T12:00:00.000Z' },
          { opportunityId: 'made-up', action: 'save', at: '2026-11-09T12:05:00.000Z' },
        ],
        [{ number: 1, status: 'complete', startedAt: '2026-11-01T11:00:00.000Z', finishedAt: '2026-11-01T11:10:00.000Z', stats: { added: 4 } }],
        { number: 1, startedAt: '2026-11-01T11:00:00.000Z', mode: 'live' },
      ),
    ),
  );
  usage.queue(eventsIn('uid-ben', memory([{ opportunityId: 'real', action: 'save', at: '2026-11-02T12:00:00.000Z' }])));
  await usage.idle();

  const s = await usage.summary(day('21'));
  assert.equal(s.students, 3);
  assert.equal(s.activeThisWeek, 2, 'Ben on the 20th and Cam on the 18th');
  assert.equal(s.activeThisMonth, 3);
  assert.deepEqual(s.weekTwoReturn, { eligible: 2, returned: 1, rate: 0.5 });
  // Two students saved the real posting (Ana twice, counted once); one of them applied. Samples stay out.
  assert.deepEqual(s.postings, { found: 4, saved: 2, applied: 1, savedPerFound: 0.5, appliedPerSaved: 0.5 });
  assert.deepEqual(s.actions.live, { visit: 5, save: 3, apply: 1, run: 1 });
  assert.deepEqual(s.actions.sample, { save: 1 });
  assert.deepEqual(problems, []);
});

test('with nothing to divide by, a rate is unknown, not zero', async () => {
  const empty = await UsageLog.open(await openEmbedded(null));
  const s = await empty.summary();
  assert.equal(s.students, 0);
  assert.equal(s.weekTwoReturn.rate, null);
  assert.equal(s.postings.savedPerFound, null);
  assert.equal(s.postings.appliedPerSaved, null);
});

test('the numbers are served only to a request that carries the team token', async () => {
  const open = new Hono();
  mountMetrics(open, usage, null);
  assert.equal((await open.request('/api/metrics')).status, 404);

  const app = new Hono();
  mountMetrics(app, usage, 'team-token-for-this-test');
  assert.equal((await app.request('/api/metrics')).status, 401);
  assert.equal((await app.request('/api/metrics', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const res = await app.request('/api/metrics', { headers: { authorization: 'Bearer team-token-for-this-test' } });
  assert.equal(res.status, 200);
  assert.equal(typeof (await res.json()).activeThisWeek, 'number');
});
