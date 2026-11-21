import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Fleet } from '../src/agents/fleet.ts';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';

const NOW = new Date('2026-11-21T22:00:00Z');

for (const maxJobs of [12, 24, 30]) {
  test(`budget: with ${maxJobs} jobs for 4 managers, every lead a scout brings back is read`, async () => {
    const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, typingPauseMs: 300, feedTarget: 0, maxJobs, slots: 4 });
    await s.trigger('manual');
    await s.idle();
    const run = s.currentRun()!;
    assert.equal(run.status, 'complete');
    const readers = run.jobs.filter((j) => j.kind === 'extract');
    assert.deepEqual(readers.filter((j) => j.status === 'skipped').map((j) => j.result), [], 'no reader is skipped for budget');
    const f = run.stats.funnel!;
    assert.equal(f.readers.skipped, 0);
    // Every lead is either read or a duplicate another worker already had.
    assert.equal(f.readers.done + f.readers.failed, f.leads - f.duplicates);
    assert.ok(f.readers.done > 0, 'readers ran');
    // No manager goes over its share of the run.
    const perManager = Math.floor(maxJobs / 4);
    for (const a of run.assignments) {
      const used = run.jobs.filter((j) => j.managerId === a.managerId && (j.kind === 'scout' || j.kind === 'extract') && j.status !== 'skipped').length;
      assert.ok(used <= perManager, `${a.name} used ${used} of ${perManager}`);
    }
  });
}

test('budget: follow-ups on kept postings (pictures, deadlines) do not use up the run budget', async () => {
  const fleet = new Fleet({ concurrency: 4, maxJobs: 2, onUpdate: () => {} });
  const ok = async () => ({ value: 1, summary: 'ok' });
  await fleet.run({ kind: 'image', managerId: 'Clubs manager', label: 'Picture', exempt: true }, ok);
  await fleet.run({ kind: 'deadline', managerId: 'Clubs manager', label: 'Deadline', exempt: true }, ok);
  assert.equal(await fleet.run({ kind: 'extract', managerId: 'm', label: 'Read 1' }, ok), 1);
  assert.equal(await fleet.run({ kind: 'extract', managerId: 'm', label: 'Read 2' }, ok), 1);
  assert.equal(await fleet.run({ kind: 'extract', managerId: 'm', label: 'Read 3' }, ok), null);
  assert.equal(fleet.jobs.at(-1)!.result, 'run budget reached');
});
