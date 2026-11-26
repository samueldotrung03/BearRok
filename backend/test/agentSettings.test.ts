import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GrokBrain } from '../src/agents/grokBrain.ts';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import { createApp } from '../src/app.ts';
import { config } from '../src/config.ts';
import { activeHarness, setHarnessStateForTest } from '../src/harness.ts';
import { LocalStore } from '../src/store/local.ts';

const NOW = new Date('2026-11-19T12:00:00Z');

test('agent settings: only listed Grok models and whole-number minimums are kept, with the account', async () => {
  setHarnessStateForTest({ connected: ['grok'], active: 'grok' });
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 }, { categories: ['internship', 'program'] });
  const { app } = createApp(new LocalStore(null), {}, { demo: s, grok: { connected: true, mode: 'cli', detail: '' } });
  const get = (await (await app.request('/api/students/demo/agent-settings')).json()) as any;
  assert.deepEqual(get.settings, { models: {}, minimums: {}, kinds: [] });
  assert.deepEqual(get.profileKinds, ['internship', 'hackathon', 'research', 'scholarship']);
  assert.ok(get.models.includes(config.xaiModels.normal));
  assert.equal(get.groups.length, 6);
  assert.equal(get.applied, true);

  const put = await app.request('/api/students/demo/agent-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ models: { master: config.xaiModels.high, workers: 'gpt-5', nonsense: config.xaiModels.low }, minimums: { internship: 10, event: 0, club: 2.5, hackathon: 999, nope: 3 } }),
  });
  const saved = ((await put.json()) as any).settings;
  assert.deepEqual(saved, { models: { master: config.xaiModels.high }, minimums: { internship: 10, hackathon: 50 }, kinds: [] });
  assert.deepEqual(s.memorySnapshot().profile.agentSettings, saved, 'kept with the account');
  setHarnessStateForTest({ connected: [], active: null });
});

test('agent settings: the harness is chosen first, then a model within it', async () => {
  setHarnessStateForTest({ connected: ['grok'], active: 'grok' });
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  const { app } = createApp(new LocalStore(null), {}, { demo: s });
  const put = (body: unknown) => app.request('/api/students/demo/agent-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  // Claude is not connected on this computer, so it cannot be chosen.
  assert.equal((await put({ harness: 'claude' })).status, 409);
  assert.equal(activeHarness(), 'grok');

  setHarnessStateForTest({ connected: ['grok', 'claude'], active: 'grok' });
  assert.equal((await put({ harness: 'claude', models: { master: 'claude-haiku-5-5', workers: 'grok-4.3' } })).status, 200);
  assert.equal(activeHarness(), 'claude');
  const get = (await (await app.request('/api/students/demo/agent-settings')).json()) as any;
  assert.equal(get.harness, 'claude');
  assert.deepEqual(get.models, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], 'Claude models only, and no Fable');
  assert.equal(get.modelLabels['claude-haiku-5-5'], 'Claude Haiku 5.5');
  assert.deepEqual(get.settings.models, { master: 'claude-haiku-5-5' }, 'a Grok model is not taken while on Claude');
  assert.deepEqual(
    get.harnesses.map((h: any) => [h.id, h.connected]),
    [['claude', true], ['codex', false], ['grok', true]],
  );
  setHarnessStateForTest({ connected: [], active: null });
});

test('agent settings: each group uses its chosen model when it belongs to the harness in use', () => {
  const brain = new GrokBrain();
  brain.setModels({ master: 'grok-x', workers: 'claude-sonnet-5-5', managers: 'gpt-6-luna' });
  const model = (brain as any).model.bind(brain);
  setHarnessStateForTest({ connected: ['grok'], active: 'grok' });
  assert.equal(model('master', 'tier'), 'grok-x');
  assert.equal(model('workers', 'tier'), 'tier', 'a Claude model is not sent to Grok');
  assert.equal(model('validators', 'tier'), 'tier');
  setHarnessStateForTest({ connected: ['claude'], active: 'claude' });
  assert.equal(model('workers', 'tier'), 'claude-sonnet-5-5');
  assert.equal(model('master', 'tier'), 'tier');
  setHarnessStateForTest({ connected: ['codex'], active: 'codex' });
  assert.equal(model('managers', 'tier'), 'gpt-6-luna');
  setHarnessStateForTest({ connected: [], active: null });
});

test('agent settings: a minimum keeps the agents searching for that kind until it is met', async () => {
  // A few worker jobs a run, so one search finds too few internships.
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, maxJobs: 8 }, { categories: ['event'] });
  s.setAgentSettings({ models: {}, minimums: { internship: 5 }, kinds: ['event', 'internship'] });
  await s.trigger('first');
  await s.idle();
  const internships = s.student().feed.filter((f) => f.opportunity.type === 'internship').length;
  assert.ok(internships >= 5, `found ${internships}`);
  assert.ok(s.student().runCount > 1, 'more than one search was needed');
  const runs = s.student().runCount;
  await new Promise((r) => setTimeout(r, 30));
  await s.idle();
  assert.equal(s.student().runCount, runs, 'and it stopped once met');
});

test('agent settings: an unreachable minimum stops after the allowed number of searches', async () => {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, maxJobs: 8 });
  s.setAgentSettings({ models: {}, minimums: { scholarship: 50 }, kinds: ['scholarship'] });
  await s.trigger('first');
  await s.idle();
  assert.ok(s.student().runCount <= 13, `ran ${s.student().runCount} times`);
  assert.ok(s.currentRun()!.log.some((l) => /scholarships you asked for/.test(l.text)));
});

test('agent settings: the kinds ticked are the ones searches cover, and they show in the feed', async () => {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 }, { categories: ['internship'] });
  const { app } = createApp(new LocalStore(null), {}, { demo: s });
  await app.request('/api/students/demo/agent-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kinds: ['event', 'hackathon', 'nonsense', 'event', 'program'] }) });
  assert.deepEqual(s.getAgentSettings().kinds, ['event', 'hackathon']);
  await s.trigger('first');
  const run = s.currentRun()!;
  assert.deepEqual([...new Set(run.assignments.map((a) => a.category))].sort(), ['event', 'program']);
  // Only hackathons were ticked among the programs, so the program managers are told so.
  assert.ok(run.assignments.filter((a) => a.category === 'program').every((a) => a.focus.includes('hackathons') && !a.focus.includes('scholarships')));
  assert.ok(run.brief!.preferences.some((p) => p === 'Programs: look only for hackathons.'));
  assert.ok(s.student().feed.some((f) => f.opportunity.type === 'event' || f.opportunity.type === 'hackathon'));
  // Unticking every kind goes back to what the profile asks for.
  s.setAgentSettings({ models: {}, minimums: {}, kinds: [] });
  await s.trigger('manual');
  assert.deepEqual([...new Set(s.currentRun()!.assignments.map((a) => a.category))], ['internship']);
});

test('agent settings: a minimum is only kept for a kind being searched for', () => {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 }, { categories: ['event'] });
  s.setAgentSettings({ models: {}, minimums: { internship: 10, scholarship: 3 }, kinds: ['internship'] });
  assert.deepEqual(s.getAgentSettings().minimums, { internship: 10 }, 'only internships are searched, so no scholarships minimum');
  // Nothing ticked: the profile's kinds are the ones searched.
  s.setAgentSettings({ models: {}, minimums: { internship: 10, event: 4 }, kinds: [] });
  assert.deepEqual(s.getAgentSettings().minimums, { event: 4 });
});

test('agent settings: settings saved with "program" become its three kinds', () => {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  const snap = s.memorySnapshot();
  snap.profile.agentSettings = { models: {}, minimums: {}, kinds: ['internship', 'program' as never] };
  s.restore(snap);
  assert.deepEqual(s.getAgentSettings().kinds, ['internship', 'hackathon', 'research', 'scholarship']);
});

test('agent settings: a total counts any mix of the kinds searched for, and keeps the agents going until met', async () => {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, maxJobs: 8 });
  s.setAgentSettings({ models: {}, minimums: { any: 10, scholarship: 3 }, kinds: ['internship', 'event'] });
  assert.deepEqual(s.getAgentSettings().minimums, { any: 10 }, 'scholarships are not searched for; the total stays');
  await s.trigger('first');
  await s.idle();
  const counted = s.student().feed.filter((f) => f.opportunity.type === 'internship' || f.opportunity.type === 'event').length;
  assert.ok(counted >= 10, `found ${counted}`);
  assert.ok(s.student().runCount > 1, 'more than one search was needed');
  assert.deepEqual([...new Set(s.currentRun()!.assignments.map((a) => a.category))].sort(), ['event', 'internship'], 'the last search covered both kinds, not one');
});

test('agent settings: names like constructor are not taken as kinds', async () => {
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
  const { app } = createApp(new LocalStore(null), {}, { demo: s });
  await app.request('/api/students/demo/agent-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kinds: ['constructor', 'toString', 'internship'] }) });
  assert.deepEqual(s.getAgentSettings().kinds, ['internship']);
});
