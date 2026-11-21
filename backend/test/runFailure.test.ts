import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';

const NOW = new Date('2026-11-21T22:00:00Z');
// The shape of an API error as the client throws it: a lead, then the provider's JSON body.
const RAW = 'grok API error 500: {"code":"internal","error":{"message":"The model is overloaded, try again later"}}';
const PLAIN = 'grok API error 500: The model is overloaded, try again later';

const settled = (s: AgentSystem) => {
  const run = s.currentRun()!;
  assert.equal(run.status, 'failed');
  assert.equal(run.error, PLAIN, 'the run says what went wrong in words');
  assert.deepEqual(run.agents.filter((a) => a.status === 'running' || a.status === 'idle').map((a) => a.name), [], 'no agent is left working');
  assert.deepEqual(run.jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.label), [], 'no job is left waiting');
  assert.equal(run.log.filter((l) => l.text.startsWith('Run failed')).length, 1);
  return run;
};

test('run failure: a master that fails shows the reason, not what it was doing', async () => {
  class Failing extends SimBrain {
    override async master(): Promise<never> {
      throw new Error(RAW);
    }
  }
  const s = new AgentSystem(new Failing({ speed: 0, now: () => NOW }), { now: () => NOW, typingPauseMs: 300, feedTarget: 0 });
  await s.trigger('manual');
  await s.idle();
  const run = settled(s);
  const master = run.agents.find((a) => a.level === 'master')!;
  assert.equal(master.status, 'failed');
  assert.equal(master.detail, PLAIN);
  assert.doesNotMatch(JSON.stringify(run.agents), /…"|"message"/, 'no agent keeps its progress text or the raw JSON');
});

test('run failure: when the presenter fails after the search, it shows the reason and the rest keep their outcome', async () => {
  class Failing extends SimBrain {
    override async present(): Promise<never> {
      throw new Error(RAW);
    }
  }
  const s = new AgentSystem(new Failing({ speed: 0, now: () => NOW }), { now: () => NOW, typingPauseMs: 300, feedTarget: 0 });
  await s.trigger('manual');
  await s.idle();
  const run = settled(s);
  const presenter = run.agents.find((a) => a.level === 'presentation')!;
  assert.equal(presenter.status, 'failed');
  assert.equal(presenter.detail, PLAIN, 'not "Writing why each card fits…"');
  // Agents that had finished keep what they did.
  const managers = run.agents.filter((a) => a.level === 'manager');
  assert.ok(managers.length > 0 && managers.every((m) => m.status === 'done' && /^Covered /.test(m.detail ?? '')));
  // Postings both reviewers kept are already in the feed.
  assert.ok(s.student().feed.length > 0);
});
