// Contracts between the dashboard and the agent memory: a career the student asked for, a like,
// and a standing note are stored on guest:demo and handed to the master on the next run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MasterInput } from '../src/agents/brain.ts';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import { createApp } from '../src/app.ts';
import { LocalStore } from '../src/store/local.ts';

const NOW = new Date('2026-11-18T20:00:00Z');

class RecordingBrain extends SimBrain {
  seen: MasterInput[] = [];
  override async master(input: MasterInput) {
    this.seen.push(structuredClone(input));
    return super.master(input);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function demoApp() {
  const brain = new RecordingBrain({ speed: 0, now: () => NOW });
  const demo = new AgentSystem(brain, { now: () => NOW, feedTarget: 0, typingPauseMs: 20 });
  const store = new LocalStore(null);
  const { app } = createApp(store, {}, { demo, saveDelayMs: 5 });
  return { brain, demo, store, app };
}

const json = async (app: ReturnType<typeof demoApp>['app'], method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

test('sign-in off: the demo student is guest:demo and a career interest reaches the master', async () => {
  const { brain, demo, store, app } = demoApp();
  assert.deepEqual((await json(app, 'GET', '/api/auth/config')).body, { enabled: false });

  const put = await json(app, 'PUT', '/api/students/demo/profile', { careerInterests: ['AI Engineer'] });
  assert.equal(put.status, 200);
  assert.equal(put.body.student.profile.careerInterests[0], 'AI Engineer');

  // A career change starts a run after a short pause. The master is given the profile it saved.
  await wait(800);
  await demo.idle();
  await wait(40);

  const saved = await store.loadStudent('guest:demo');
  assert.ok(saved);
  assert.deepEqual(saved.profile.profile.careerInterests, ['AI Engineer']);
  assert.equal(await store.loadStudent('demo'), null);
  assert.ok(brain.seen.some((input) => input.profile.careerInterests.includes('AI Engineer')));

  const memory = await json(app, 'GET', '/api/students/demo/memory');
  assert.equal(memory.status, 200);
  assert.deepEqual(memory.body.profile.profile.careerInterests, ['AI Engineer']);
});

test('a like is stored in memory and the next run is told about it', async () => {
  const { brain, demo, store, app } = demoApp();
  assert.equal((await json(app, 'POST', '/api/students/demo/runs')).status, 202);
  await demo.idle();
  const state = await json(app, 'GET', '/api/students/demo/state');
  const id = state.body.student.feed[0].opportunity.id as string;

  const liked = await json(app, 'POST', '/api/students/demo/interactions', { opportunityId: id, action: 'like' });
  assert.equal(liked.status, 200);
  await wait(40);
  const memory = await json(app, 'GET', '/api/students/demo/memory');
  assert.equal(memory.body.learned.counts.likes, 1);
  const stored = await store.loadStudent('guest:demo');
  assert.equal(stored?.learned.interactions.filter((item) => item.action === 'like').length, 1);

  const before = brain.seen.length;
  assert.equal((await json(app, 'POST', '/api/students/demo/runs')).status, 202);
  await demo.idle();
  const next = brain.seen.at(-1);
  assert.ok(next);
  assert.ok(brain.seen.length > before);
  assert.ok(next.memory.likes.length > 0);
});

test('a standing note is stored on the profile and the master is given it', async () => {
  const { brain, demo, store, app } = demoApp();
  const put = await json(app, 'PUT', '/api/students/demo/profile', {
    preferences: { notes: [{ title: 'For your agents', body: 'Look for AI engineering internships' }] },
  });
  assert.equal(put.status, 200);
  await wait(80);
  await demo.idle();
  await wait(40);

  const saved = await store.loadStudent('guest:demo');
  assert.equal(saved?.profile.profile.preferences?.notes[0]?.body, 'Look for AI engineering internships');
  assert.ok(brain.seen.some((input) => input.profile.preferences?.notes.some((note) => note.body.includes('AI engineering'))));
});
