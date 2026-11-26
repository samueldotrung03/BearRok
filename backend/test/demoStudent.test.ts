// The demo student is John, and everything in his feed is a real posting: a link to its own page,
// nothing marked as a sample, and no date without the words it was read from.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECKED, DEMO_STUDENT_ID, demoMemory, JOHN, withDemoStudent } from '../src/agents/demoStudent.ts';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { StudentMemory } from '../src/agents/types.ts';
import { canonicalUrl } from '../src/validate.ts';

const postings = demoMemory().learned.opportunities;

test('John is a computer science major at UC Berkeley', () => {
  const { profile } = demoMemory().profile;
  assert.equal(profile.name, 'John');
  assert.equal(profile.school, 'UC Berkeley');
  assert.equal(profile.major, 'Computer Science');
});

test('every posting is real: its own link, read from a page, never a sample', () => {
  assert.ok(postings.length >= 12, 'enough cards that the agents do not start a search to fill the feed');
  const links = postings.map((o) => canonicalUrl(o.sourceUrl));
  assert.ok(links.every(Boolean));
  assert.equal(new Set(links).size, postings.length, 'no posting twice');
  assert.equal(new Set(postings.map((o) => o.id)).size, postings.length);
  for (const o of postings) {
    assert.equal(o.origin, 'live', o.title);
    assert.match(o.sourceUrl, /^https:\/\//, o.title);
    assert.ok(!/example\.|sample/i.test(o.sourceUrl), o.title);
    assert.ok(o.description && o.fitExplanation && o.organizer, o.title);
    assert.ok(o.baseScore > 0 && o.baseScore <= 1, o.title);
  }
  // The three places they were read from are all there.
  assert.ok(postings.some((o) => o.sourceUrl.includes('luma.com')));
  assert.ok(postings.some((o) => o.sourceUrl.includes('berkeley.edu')));
  assert.ok(postings.some((o) => o.type === 'internship'));
});

test('no date is guessed: a deadline or start time comes with the words it was read from, and a missing deadline is shown as unknown', () => {
  for (const o of postings) {
    const quoted = (field: string) => o.evidence.some((e) => e.field === field && e.quote.trim() && e.url === o.sourceUrl);
    if (o.deadline) {
      assert.match(o.deadline, /^\d{4}-\d{2}-\d{2}$/, o.title);
      assert.ok(o.deadline >= CHECKED, `${o.title}: the deadline had not passed when the page was read`);
      assert.ok(quoted('deadline'), o.title);
      assert.deepEqual(o.unknowns, [], o.title);
    } else {
      assert.deepEqual(o.unknowns.map((u) => u.field), ['deadline'], o.title);
    }
    if (o.startTime) {
      assert.ok(!Number.isNaN(Date.parse(o.startTime)) && o.startTime.slice(0, 10) >= CHECKED, o.title);
      assert.ok(quoted('startTime'), o.title);
    }
  }
});

test('loaded into the agents, John has a full feed and no simulated search starts on its own', async () => {
  const system = new AgentSystem(new SimBrain({ speed: 0 }), {});
  system.restore(demoMemory());
  const student = system.student();
  assert.equal(student.profile.name, 'John');
  assert.equal(student.feed.length, postings.length);
  assert.ok(student.feed.every((f) => f.opportunity.origin === 'live'));
  assert.ok(student.runCount > 0, 'opening the demo does not start a first search');
  system.fillIfShort();
  await system.idle();
  assert.ok(system.student().feed.every((f) => f.opportunity.origin === 'live'), 'no sample was added');
});

test('the demo student starts as John, replaces the earlier invented student, and leaves a changed profile alone', async () => {
  const saved = new Map<string, StudentMemory>();
  const store = {
    loadStudent: async (id: string) => saved.get(id) ?? null,
    saveStudent: async (id: string, m: StudentMemory) => void saved.set(id, m),
    deleteStudent: async (id: string) => void saved.delete(id),
  };
  const memory = withDemoStudent(store);
  assert.equal((await memory.loadStudent(DEMO_STUDENT_ID))?.profile.profile.name, 'John');
  assert.equal(await memory.loadStudent('some-account'), null, 'a signed-in student is never given John');

  const named = (name: string) => ({ ...demoMemory(), profile: { ...demoMemory().profile, profile: { ...JOHN, name } }, learned: { ...demoMemory().learned, opportunities: [] } });
  saved.set(DEMO_STUDENT_ID, named('Maya'));
  assert.equal((await memory.loadStudent(DEMO_STUDENT_ID))?.learned.opportunities.length, postings.length);
  saved.set(DEMO_STUDENT_ID, named('Priya'));
  const kept = await memory.loadStudent(DEMO_STUDENT_ID);
  assert.equal(kept?.profile.profile.name, 'Priya');
  assert.equal(kept?.learned.opportunities.length, 0);
});
