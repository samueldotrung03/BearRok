import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem, cleanRecord, placeholderRejection, unusableReview } from '../src/agents/system.ts';
import type { Candidate } from '../src/agents/types.ts';

const NOW = new Date('2026-11-18T20:00:00Z');
const TARGET = 'Software Engineering Intern';

test('placeholder: a blank or placeholder review is not a decision, however it is written', () => {
  for (const r of ['placeholder', 'Placeholder.', '"placeholder"', '  ', '', null, 'N/A', 'none', 'TBD']) assert.ok(unusableReview(r), String(r));
  for (const r of ['Open: the page is up', 'The page is a placeholder with no posting yet']) assert.ok(!unusableReview(r), r);
  // The stored rejections from the live run on 2026-11-21: two rest on a placeholder status review.
  assert.ok(placeholderRejection('Criteria reviewer: The page does not confirm freshmen may apply. Status reviewer: placeholder'));
  assert.ok(placeholderRejection('Criteria reviewer: placeholder Status reviewer: Closed: the deadline passed on 2026-11-14'));
  assert.ok(!placeholderRejection('Criteria reviewer: Not open to freshmen. Status reviewer: Closed: the deadline passed on 2026-11-14'));
  assert.ok(!placeholderRejection('Status reviewer: The page is a placeholder with no posting yet'));
});

test('placeholder: a field the CLI left as placeholder is taken from what the reader saw', () => {
  const read = { title: 'Data Intern', organizer: 'Harbor Health', location: 'Oakland, CA', deadline: null, tags: ['data'] } as unknown as Candidate;
  const reviewed = { title: 'Data Intern', organizer: 'placeholder', location: '', deadline: '2026-12-01', tags: [] } as unknown as Candidate;
  assert.deepEqual(cleanRecord(reviewed, read), { title: 'Data Intern', organizer: 'Harbor Health', location: 'Oakland, CA', deadline: '2026-12-01', tags: [] });
});

test('placeholder: the word never reaches the student, and the posting is not written off', async () => {
  class Blank extends SimBrain {
    override async validate(...args: Parameters<SimBrain['validate']>) {
      const [candidate, , , focus] = args;
      const verdict = await super.validate(...args);
      // The status reviewer answers with the empty schema for one posting, and leaves the organizer blank on the rest.
      if (focus === 'status' && candidate.title === TARGET) return { keep: false, reason: 'placeholder', fit: 0, record: { ...candidate, organizer: 'placeholder' } };
      return focus === 'status' ? { ...verdict, record: { ...verdict.record, organizer: 'placeholder' } } : verdict;
    }
  }
  const s = new AgentSystem(new Blank({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, typingPauseMs: 300, maxJobs: 40 });
  await s.trigger('first');
  await s.idle();
  const run = s.currentRun()!;
  assert.ok(run.validations.some((v) => v.title === TARGET), 'the posting was reviewed');
  assert.ok(s.student().feed.length > 0);
  // Nothing the student can see says placeholder: the run, its log, the reviews and the feed.
  // (The sample catalog has organizers really named "Placeholder ...", so only the bare word counts.)
  const reasons = [...run.validations.flatMap((v) => [v.reason, ...v.reviews.map((r) => r.reason)]), ...run.log.map((l) => l.text), ...run.agents.map((a) => a.detail)];
  assert.ok(!reasons.some((t) => t && /\bplaceholder\b(?! (University|Systems|Data))/i.test(t)), 'no reason or log line says placeholder');
  assert.doesNotMatch(JSON.stringify(s.student().feed), /"placeholder"/i, 'no feed field is the bare word');
  assert.match(run.validations.find((v) => v.title === TARGET)!.reason!, /Status reviewer: Could not be reviewed: the reviewer gave no answer/);
  // Not a permanent rejection.
  assert.ok(!s.memorySnapshot().learned.rejected.some((r) => r.reason.includes('Could not be reviewed')));
});

test('placeholder: a rejection stored on a placeholder review is dropped when memory loads, so it is reviewed again', async () => {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, typingPauseMs: 300 });
  await s.trigger('first');
  await s.idle();
  const memory = s.memorySnapshot();
  const url = 'https://example.org/software-engineering-intern';
  memory.learned.rejected = [
    { url, reason: 'Criteria reviewer: The page does not confirm freshmen may apply. Status reviewer: placeholder' },
    { url: 'https://example.org/closed', reason: 'Status reviewer: Closed: the deadline passed on 2026-11-14' },
  ];
  memory.learned.rejectedUrls = [url, 'https://example.org/closed'];
  const again = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, typingPauseMs: 300 });
  again.restore(memory);
  const learned = again.memorySnapshot().learned;
  assert.deepEqual(learned.rejected.map((r) => r.url), ['https://example.org/closed']);
  assert.deepEqual(learned.rejectedUrls, ['https://example.org/closed']);
});
