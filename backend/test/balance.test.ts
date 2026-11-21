import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BALANCE_MESSAGE, BalanceExhaustedError, isBalanceError } from '../src/quota.ts';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { Assignment, Lead } from '../src/agents/types.ts';

const NOW = new Date('2026-11-21T22:00:00Z');
// What the Grok CLI printed when the balance ran out (the live run of 2026-11-21).
const STDERR = readFileSync(new URL('./fixtures/grok-402-stderr.txt', import.meta.url), 'utf8');

/** The first page read finds the balance exhausted, as the CLI reports it; every later call would too. */
class BrokeBrain extends SimBrain {
  calls = 0;
  failedAt = -1;
  override async extract(lead: Lead, a: Assignment) {
    this.calls++;
    if (this.failedAt < 0 && isBalanceError(STDERR)) {
      this.failedAt = this.calls;
      throw new BalanceExhaustedError();
    }
    if (this.failedAt >= 0) throw new BalanceExhaustedError();
    return super.extract(lead, a);
  }
}

test('quota: the CLI 402 output is recognised as an exhausted balance', () => {
  assert.equal(isBalanceError(STDERR), true);
  assert.equal(isBalanceError('grok CLI timed out after 120s'), false);
  assert.equal(isBalanceError('not logged in'), false);
});

test('quota: an exhausted balance fails the run once, with one reason, and settles every agent', async () => {
  const brain = new BrokeBrain({ speed: 0, now: () => NOW });
  // A short feed would normally start a follow-up search; a run that failed for credit must not.
  const s = new AgentSystem(brain, { now: () => NOW, typingPauseMs: 300, feedTarget: 12, concurrency: 1 });
  await s.trigger('manual');
  await s.idle();
  const run = s.currentRun()!;
  assert.equal(run.status, 'failed');
  assert.equal(run.error, BALANCE_MESSAGE);
  // Only one run, and no follow-up.
  assert.equal(s.searchHistory().runs.length, 1);
  // The job that hit it was not retried, and no reader started after it.
  const failed = run.jobs.filter((j) => j.status === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.attempts, 1);
  assert.equal(failed[0]!.result, BALANCE_MESSAGE);
  assert.equal(brain.calls, brain.failedAt);
  // Nothing is left waiting or running, and nothing says it was stopped by the student.
  assert.deepEqual(run.agents.filter((a) => a.status === 'running' || a.status === 'idle'), []);
  assert.deepEqual(run.jobs.filter((j) => j.status === 'queued' || j.status === 'running'), []);
  assert.deepEqual(run.validations.filter((v) => v.status === 'checking' && !v.reason?.includes(BALANCE_MESSAGE)), []);
  assert.ok(!run.agents.some((a) => a.detail === 'Stopped.'));
  assert.ok(run.jobs.filter((j) => j.status === 'skipped' && j.result !== 'manager budget reached' && j.result !== 'run budget reached').every((j) => j.result === `Not run: ${BALANCE_MESSAGE}`));
  assert.ok(run.log.some((l) => l.text === `Run failed: ${BALANCE_MESSAGE}`));
  assert.equal(run.log.filter((l) => l.text.startsWith('Run failed')).length, 1);
});

test('quota: a master that finds the balance exhausted fails the run with the same reason', async () => {
  class BrokeMaster extends SimBrain {
    override async master(): ReturnType<SimBrain['master']> {
      throw new BalanceExhaustedError();
    }
  }
  const s = new AgentSystem(new BrokeMaster({ speed: 0, now: () => NOW }), { now: () => NOW, typingPauseMs: 300, feedTarget: 12 });
  await s.trigger('manual');
  await s.idle();
  const run = s.currentRun()!;
  assert.equal(run.status, 'failed');
  assert.equal(run.error, BALANCE_MESSAGE);
  assert.deepEqual(run.agents.map((a) => [a.name, a.status, a.detail]), [['Master agent', 'failed', BALANCE_MESSAGE]]);
  assert.equal(s.searchHistory().runs.length, 1);
});
