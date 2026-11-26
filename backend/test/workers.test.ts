// The old POST /api/searches worker, against a stand-in model. Nothing here calls a live model.
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Brief, WorkerBrief } from '../src/types.ts';

process.env.XAI_API_KEY = 'test-key-not-live';
process.env.XAI_BASE_URL = 'https://api.x.ai/v1';
delete process.env.XAI_X_SEARCH;

const { discover } = await import('../src/workers.ts');
const { config } = await import('../src/config.ts');

const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
  config.xSearch = false;
});

type Body = {
  max_turns?: number;
  tools?: { type: string }[];
  text: { format: { name: string } };
  input: { role: string; content: unknown }[];
};

const calls: Body[] = [];

function install(data: unknown) {
  calls.length = 0;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Body);
    return new Response(JSON.stringify({ output_text: JSON.stringify(data), citations: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function textOf(body: Body, role: string): string {
  const item = body.input.find((part) => part.role === role);
  assert.equal(typeof item?.content, 'string');
  return item!.content as string;
}

const brief: Brief = {
  interests: ['coding'],
  dateFrom: '2026-12-01',
  dateTo: '2026-12-31',
  context: ['Berkeley'],
  workers: [],
};

const club: WorkerBrief = {
  type: 'club',
  lookingFor: 'a beginner coding club',
  requirements: ['beginner-friendly'],
  preferences: ['weekly meetings'],
  format: 'in_person',
  location: 'Berkeley',
};

const event: WorkerBrief = {
  type: 'event',
  lookingFor: 'an online hackathon',
  requirements: ['online'],
  preferences: ['beginner-friendly'],
  format: 'online',
  location: null,
};

const lead = {
  type: 'event',
  title: 'Winter Hack',
  organizer: 'Hack Org',
  sourceUrl: 'https://hack.example/winter',
  actionUrl: null,
  format: 'online',
  location: null,
  fitExplanation: 'It is an online hackathon.',
  meetingSchedule: null,
  membershipIntake: null,
  acceptingMembers: null,
  startTime: '2026-12-05T09:00:00-08:00',
  endTime: null,
  timeZone: 'America/Los_Angeles',
  registrationDeadline: null,
  registrationOpen: true,
  evidence: [{ field: 'startTime', quote: 'Starts Dec 5 at 9am PT', url: 'https://hack.example/winter' }],
  uncertainties: [],
};

describe('discover', { concurrency: false }, () => {
  test('runs one capped search for the student request and keeps club and event field rules', async () => {
    install({ candidates: [lead] });
    const found = await discover(club, brief, new Date('2026-11-18T20:00:00Z'));
    assert.equal(calls.length, 1);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.type, 'club');

    const body = calls[0]!;
    assert.equal(body.text.format.name, 'discovery');
    assert.deepEqual(body.tools, [{ type: 'web_search' }]);
    assert.equal(body.max_turns, 2);

    const system = textOf(body, 'system');
    assert.match(system, /Run one search for the student's request/);
    assert.match(system, /Open a page only to confirm it is still open/);
    assert.match(system, /Then stop/);
    assert.match(system, /meetingSchedule, membershipIntake \(how to join\) and acceptingMembers; leave the event fields null/);
    assert.match(system, /fitExplanation: one sentence on why this matches the student's request/);
    assert.match(system, /Every factual field you fill in needs an evidence entry/);
    assert.doesNotMatch(system, /Return up to/);
    assert.doesNotMatch(system, /Luma|Devpost|MLH|Discord|Reddit|student organization directories/);

    const user = textOf(body, 'user');
    assert.match(user, /Today is 2026-11-18/);
    assert.match(user, /a beginner coding club/);
    assert.match(user, /beginner-friendly/);

    calls.length = 0;
    await discover(event, brief, new Date('2026-11-18T20:00:00Z'));
    assert.equal(calls.length, 1);
    const eventSystem = textOf(calls[0]!, 'system');
    assert.match(eventSystem, /Run one search for the student's request\. Open a page only to confirm it is still open\. Then stop\./);
    assert.match(eventSystem, /startTime, endTime, timeZone, registrationDeadline and registrationOpen; leave the club fields null/);
    assert.doesNotMatch(eventSystem, /leave the event fields null/);
    assert.match(textOf(calls[0]!, 'user'), /Date window: 2026-12-01 to 2026-12-31/);
    assert.equal(calls[0]!.max_turns, 2);
    assert.deepEqual(calls[0]!.tools, [{ type: 'web_search' }]);
  });

  test('adds x search only when config.xSearch is true, still in one call', async () => {
    const previous = config.xSearch;
    config.xSearch = true;
    try {
      install({ candidates: [{ ...lead, type: 'club' }] });
      const found = await discover(club, brief, new Date('2026-11-18T20:00:00Z'));
      assert.equal(calls.length, 1);
      assert.equal(found[0]!.type, 'club');
      assert.deepEqual(calls[0]!.tools, [{ type: 'web_search' }, { type: 'x_search' }]);
      assert.equal(calls[0]!.max_turns, 2);
      assert.match(textOf(calls[0]!, 'system'), /Then stop/);
    } finally {
      config.xSearch = previous;
    }
  });
});
