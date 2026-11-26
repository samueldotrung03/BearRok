// Saving does not create an application. A save made before that change stays a save, an
// application the student already has is left as it is, and a new save still reaches the agents.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { StudentMemory } from '../src/agents/types.ts';
import { createApp } from '../src/app.ts';
import { LocalStore } from '../src/store/local.ts';

const NOW = new Date('2026-11-19T12:00:00Z');
const fresh = () => new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0 });
const savedIds = (m: StudentMemory) => {
  const on = new Map<string, boolean>();
  for (const i of m.learned.interactions) if (i.action === 'save') on.set(i.opportunityId, !on.get(i.opportunityId));
  return [...on].filter(([, v]) => v).map(([id]) => id);
};

/**
 * Saves made the way an older version kept them: a save in the interactions and no application.
 * One is saved and still only that, one was saved then unsaved, one was saved then disliked, and
 * one is already an application the student is working on.
 */
function addLegacySaves(memory: StudentMemory) {
  const [a, b, c, d] = memory.learned.opportunities.map((o) => o.id);
  const at = NOW.toISOString();
  memory.learned.interactions.push(
    { opportunityId: a!, action: 'save', at },
    { opportunityId: b!, action: 'save', at },
    { opportunityId: b!, action: 'save', at },
    { opportunityId: c!, action: 'save', at },
    { opportunityId: c!, action: 'dislike', at },
    { opportunityId: d!, action: 'save', at },
  );
  // d is already an application the student moved on, with something written.
  const working = structuredClone(memory);
  const s = fresh();
  s.restore(working);
  s.setApplication(d!, { status: 'applying', drafts: { 0: 'My draft' } });
  memory.learned.applications = s.memorySnapshot().learned.applications.filter((x) => x.opportunityId === d);
  return { saved: a!, unsaved: b!, disliked: c!, working: d! };
}

/** Load a store file the way the backend does, migrate, save it back, and load it again. */
async function migrateFile(file: string, key: string) {
  const store = new LocalStore(file);
  const before = (await store.loadStudent(key))!;
  const s = fresh();
  let saves = 0;
  s.onChange(() => saves++);
  s.restore(structuredClone(before));
  await store.saveStudent(key, s.memorySnapshot());
  const again = fresh();
  again.restore((await new LocalStore(file).loadStudent(key))!);
  return { before, s, again, saves };
}

function checkNoLoss(before: StudentMemory, s: AgentSystem) {
  const after = s.memorySnapshot();
  // Nothing the student did or the agents found is dropped or changed.
  assert.deepEqual(after.learned.interactions, before.learned.interactions, 'every save, like and open kept, in order');
  assert.deepEqual(after.learned.opportunities.map((o) => o.id), before.learned.opportunities.map((o) => o.id));
  for (const a of before.learned.applications ?? []) {
    const kept = s.getApplication(a.opportunityId)!;
    assert.equal(kept.status, a.status, 'an existing status is not changed');
    assert.deepEqual(kept.drafts, a.drafts, 'what was written is kept');
  }
  // A save on its own is not turned into an application.
  const listed = new Set(s.listApplications().map((a) => a.opportunityId));
  for (const id of savedIds(before)) {
    const existing = (before.learned.applications ?? []).find((a) => a.opportunityId === id);
    if (!existing) assert.equal(listed.has(id), false, `saved ${id} is not listed`);
  }
}

test('migration: legacy saves stay saves; nothing else changes, and it adds nothing', async () => {
  const seed = fresh();
  await seed.trigger('first');
  const memory = seed.memorySnapshot();
  memory.learned.applications = [];
  const ids = addLegacySaves(memory);
  const dir = mkdtempSync(join(tmpdir(), 'bearrok-migrate-'));
  const file = join(dir, 'store.json');
  await new LocalStore(file).saveStudent('guest:demo', memory);

  const { before, s, again } = await migrateFile(file, 'guest:demo');
  checkNoLoss(before, s);
  assert.equal(s.getApplication(ids.saved), null, 'a legacy save is not turned into an application');
  assert.equal(s.getApplication(ids.unsaved), null, 'unsaved before: not brought back');
  assert.equal(s.getApplication(ids.disliked), null, 'disliked after saving: not brought back');
  assert.equal(s.getApplication(ids.working)?.status, 'applying');
  assert.deepEqual(s.student().saved.sort(), [ids.saved, ids.working].sort(), 'the saved list itself is unchanged');
  assert.deepEqual(again.listApplications().map((a) => [a.opportunityId, a.status]).sort(), s.listApplications().map((a) => [a.opportunityId, a.status]).sort());
  assert.equal(again.migrateSaved(), 0, 'nothing is migrated');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).students['guest:demo'].learned.applications.length, 1);
});

// The student's real store, copied into backend/.data (gitignored) for this check. Skipped when no
// copy is there. It is copied again to a temp folder first, so even the copy is never changed.
const COPY = process.env.BEARROK_STORE_COPY ?? fileURLToPath(new URL('../.data/store.json', import.meta.url));
test('migration: on a copy of the real store, with legacy saves added, nothing saved is lost', { skip: !existsSync(COPY) && 'no copied store in backend/.data' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bearrok-copy-'));
  const file = join(dir, 'store.json');
  copyFileSync(COPY, file);
  const data = JSON.parse(readFileSync(file, 'utf8')) as { students: Record<string, StudentMemory> };
  for (const [key, memory] of Object.entries(data.students)) {
    if ((memory.learned?.opportunities?.length ?? 0) < 4) continue;
    const ids = addLegacySaves(memory);
    const store = new LocalStore(file);
    await store.saveStudent(key, memory);
    const { before, s, again } = await migrateFile(file, key);
    checkNoLoss(before, s);
    assert.equal(s.getApplication(ids.saved), null);
    assert.equal(again.getApplication(ids.saved), null, 'still not an application after a restart');
    assert.equal(s.student().profile.name, before.profile.profile.name, 'the profile is untouched');
  }
});

test('save: the memory signal reaches the agents, and saving does not create an application', async () => {
  const s = fresh();
  await s.trigger('first');
  const { app } = createApp(new LocalStore(null), {}, { demo: s });
  const o = s.student().feed[0]!.opportunity;
  const post = (action: string) =>
    app.request('/api/students/demo/interactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opportunityId: o.id, action }) });

  assert.equal((await post('save')).status, 200);
  const memory = s.memorySnapshot().learned.interactions;
  assert.deepEqual(memory.at(-1), { opportunityId: o.id, action: 'save', at: NOW.toISOString() }, 'kept in what the agents learn from');
  assert.equal(s.student().memory.counts.save, 1, 'the ranking counts it');
  assert.ok(s.student().saved.includes(o.id));
  const apps = (await (await app.request('/api/students/demo/applications')).json()) as { applications: { opportunityId: string }[] };
  assert.equal(apps.applications.some((a) => a.opportunityId === o.id), false, 'a save is not an application');

  // Setting To apply creates the application. Unsaving the first posting does not remove it.
  const other = s.student().feed[1]!.opportunity;
  s.interact(other.id, 'save');
  await app.request(`/api/students/demo/applications/${other.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'to_apply' }) });
  assert.equal(s.getApplication(other.id)?.status, 'to_apply');
  await post('save');
  assert.equal(s.getApplication(o.id), null, 'unsaved while only saved: still no application');
  assert.equal(s.getApplication(other.id)?.status, 'to_apply', 'To apply stays after another posting is unsaved');
  assert.equal(s.student().memory.counts.save, 3, 'two saves and the unsave all reach memory');
});
