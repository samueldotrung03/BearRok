import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileRunHistory, MemoryRunHistory } from '../src/activity/history.ts';
import { ActivityHub } from '../src/activity/hub.ts';
import { outlineReport, plainError, reportOf, RunObserver } from '../src/activity/observer.ts';
import type { LiveActivity, RunReport } from '../src/activity/types.ts';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { Assignment, Lead, RunSnapshot } from '../src/agents/types.ts';
import { createApp } from '../src/app.ts';
import { LocalStore } from '../src/store/local.ts';

const NOW = new Date('2026-11-18T20:00:00Z');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A simulated brain whose first reader times out, as the Grok CLI does. */
class SlowReaderBrain extends SimBrain {
  private bad: string | null = null;
  override async extract(lead: Lead, a: Assignment) {
    this.bad ??= lead.url;
    if (lead.url === this.bad) throw new Error('grok CLI timed out after 120s');
    return super.extract(lead, a);
  }
}

const system = (brain = new SimBrain({ speed: 0, now: () => NOW })) => new AgentSystem(brain, { now: () => NOW, typingPauseMs: 300, feedTarget: 0 });

function snapshot(over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: 'run-1', number: 1, trigger: 'manual', mode: 'simulated', status: 'running', startedAt: NOW.toISOString(), finishedAt: null,
    brief: null, assignments: [], log: [{ seq: 1, at: NOW.toISOString(), agent: 'System', text: 'Run requested by hand', tone: 'info' }],
    agents: [
      { id: 'master', level: 'master', name: 'Master agent', role: 'Reads the profile', status: 'done', detail: 'Brief written' },
      { id: 'manager-1', level: 'manager', name: 'Internships manager', role: 'Internships, everything', status: 'running', detail: 'Planning' },
    ],
    jobs: [
      { id: 'job-1', kind: 'scout', managerId: 'manager-1', label: 'Search: CS internships', status: 'done', result: '4 leads', attempts: 1 },
      { id: 'job-2', kind: 'extract', managerId: 'manager-1', label: 'Read: Data Science Society', status: 'running', result: null, attempts: 1 },
      { id: 'job-3', kind: 'extract', managerId: 'manager-1', label: 'Read: CSUA', status: 'failed', result: 'grok CLI timed out after 120s', attempts: 2 },
      { id: 'job-4', kind: 'extract', managerId: 'manager-1', label: 'Read: CS Mentors', status: 'skipped', result: 'manager budget reached', attempts: 0 },
      { id: 'job-5', kind: 'image', managerId: 'Internships manager', label: 'Picture: DSS', status: 'queued', result: null, attempts: 0 },
    ],
    validations: [
      {
        id: 'opp-1', title: 'Data Science Society', managerId: 'manager-1', status: 'checking', reason: null, fit: null,
        reviews: [
          { focus: 'criteria', reviewer: 'Criteria reviewer', status: 'kept', reason: 'Fits CS and data', fit: 0.8 },
          { focus: 'status', reviewer: 'Status reviewer', status: 'rejected', reason: 'Could not be reviewed: grok CLI timed out after 90s', fit: null },
        ],
      },
    ],
    stats: { jobs: 4, skipped: 1, candidates: 1, merged: 0, kept: 0, rejected: 0, added: 0 },
    error: null,
    ...over,
  } as RunSnapshot;
}

test('activity: every agent of a snapshot by level, with timeouts told apart from failures', () => {
  const { live } = new RunObserver(() => NOW).update(snapshot());
  const by = (id: string) => live.agents.find((a) => a.id === id)!;
  assert.deepEqual(live.agents.map((a) => a.level), ['master', 'manager', 'worker', 'worker', 'worker', 'worker', 'worker', 'validation', 'validation']);
  assert.equal(by('job:job-3').status, 'timed_out');
  assert.equal(by('job:job-4').status, 'skipped');
  assert.equal(by('job:job-4').detail, 'manager budget reached');
  assert.equal(by('job:job-2').kind, 'reader');
  // A job that names its manager by display name is still grouped under it.
  assert.equal(by('job:job-5').managerId, 'manager-1');
  assert.equal(by('review:opp-1:criteria').verdict, 'kept');
  assert.equal(by('review:opp-1:criteria').status, 'done');
  // A review that could not run is the reviewer failing, not a verdict.
  assert.equal(by('review:opp-1:status').status, 'timed_out');
  assert.equal(by('review:opp-1:status').verdict, null);
  assert.equal(by('review:opp-1:status').target, 'Data Science Society');
  assert.equal(live.run?.request, 'Requested by hand');
  assert.equal(live.counts.timed_out, 2);
  assert.deepEqual(live.flows.map((f) => [f.from, f.to, f.count, f.active]), [
    ['master', 'manager', 1, true],
    ['manager', 'worker', 4, true],
    ['worker', 'validation', 1, false],
    ['validation', 'presentation', 0, false],
  ]);
});

test('activity: timing is stamped when an agent is first seen in each status', () => {
  let now = NOW.getTime();
  const observer = new RunObserver(() => new Date(now));
  const first = observer.update(snapshot()).live;
  const reader = () => first.agents.find((a) => a.id === 'job:job-2')!;
  assert.equal(reader().startedAt, NOW.toISOString());
  assert.equal(reader().finishedAt, null);
  assert.equal(first.agents.find((a) => a.id === 'job:job-5')!.startedAt, null);
  assert.ok(first.changed.includes('job:job-2'));

  now += 5_000;
  const run = snapshot();
  run.jobs[1] = { ...run.jobs[1]!, status: 'done', result: 'Data Science Society' };
  const next = observer.update(run).live;
  const done = next.agents.find((a) => a.id === 'job:job-2')!;
  assert.equal(done.startedAt, NOW.toISOString());
  assert.equal(done.finishedAt, new Date(now).toISOString());
  assert.deepEqual(next.changed, ['job:job-2']);

  // A run that ended: work still waiting never ran.
  const ended = observer.update(snapshot({ status: 'stopped', finishedAt: new Date(now).toISOString() })).live;
  assert.equal(ended.agents.find((a) => a.id === 'job:job-5')!.status, 'skipped');
  assert.equal(ended.run?.outcome, 'stopped');
  assert.ok(ended.flows.every((f) => !f.active));
});

test('activity: recent keeps the last 4 distinct action lines, newest first', () => {
  let now = NOW.getTime();
  const observer = new RunObserver(() => new Date(now));
  const run = snapshot();
  const reader = () => observer.update(run).live.agents.find((a) => a.id === 'job:job-2')!;
  assert.deepEqual(reader().recent, []);

  const lines = ['Reading posting at mlh.com', 'Found the form', 'Reading posting at mlh.com', 'Checking dates', 'Saved the draft', 'Done reading'];
  for (const text of lines) {
    now += 1000;
    run.jobs[1] = { ...run.jobs[1]!, result: text };
    observer.update(run);
  }
  const recent = reader().recent;
  assert.deepEqual(recent.map((r) => r.text), ['Done reading', 'Saved the draft', 'Checking dates', 'Reading posting at mlh.com']);
  assert.equal(recent[0]!.at, new Date(now).toISOString());

  // The same line, while it is still the latest, is not stored again.
  now += 1000;
  observer.update(run);
  assert.equal(reader().recent.length, 4);
  assert.equal(reader().recent[0]!.at, recent[0]!.at);
});

test('history: newest first, at most 10 runs per student', () => {
  const history = new MemoryRunHistory();
  for (let i = 1; i <= 12; i++) history.add('s', outlineReport({ number: i, trigger: 'fill', status: 'complete', startedAt: new Date(NOW.getTime() + i * 60_000).toISOString(), finishedAt: null, stats: { jobs: 1, skipped: 0, candidates: 0, merged: 0, kept: 0, rejected: 0, added: 0 } }));
  assert.deepEqual(history.list('s').map((r) => r.number), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.deepEqual(history.list('other'), []);
});

test('history: reports survive a restart in their file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bearrok-activity-'));
  try {
    const file = join(dir, 'agent-activity.json');
    new FileRunHistory(file).add('guest:demo', outlineReport({ number: 3, trigger: 'manual', status: 'failed', startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), stats: { jobs: 0, skipped: 0, candidates: 0, merged: 0, kept: 0, rejected: 0, added: 0 } }));
    const again = new FileRunHistory(file).list('guest:demo');
    assert.equal(again.length, 1);
    assert.equal(again[0]!.outcome, 'failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hub: watching the agents does not count as the app being open', () => {
  const s = system();
  new ActivityHub().attach('k', s);
  assert.equal((s as unknown as { listeners: Set<unknown> }).listeners.size, 0);
});

test('hub: runs recorded before reports were kept show as outlines', async () => {
  const s = system();
  const memory = s.memorySnapshot();
  memory.learned.runs = [{ number: 1, trigger: 'first', status: 'complete', startedAt: NOW.toISOString(), finishedAt: new Date(NOW.getTime() + 268_000).toISOString(), stats: { jobs: 24, skipped: 13, candidates: 0, merged: 1, kept: 0, rejected: 0, added: 0 } }];
  memory.learned.runCount = 1;
  s.restore(memory);
  const hub = new ActivityHub();
  hub.attach('k', s);
  const [r] = hub.reports(s);
  assert.equal(r!.outlineOnly, true);
  assert.equal(r!.durationMs, 268_000);
  assert.equal(r!.skipped.count, 13);
  assert.equal(r!.results.found, 0);
  // The run comes back after a restart as finished, without invented timings, and is not reported twice.
  const live = hub.live(s);
  assert.equal(live.run?.number, 1);
  assert.equal(live.run?.outcome, 'finished');
  assert.ok(live.agents.every((a) => a.startedAt === null));
  await s.trigger('manual');
  await s.idle();
  await sleep(200);
  const after = hub.reports(s);
  assert.equal(after.filter((x) => x.number === 1).length, 1);
  assert.equal(after.find((x) => x.number === 1)!.outlineOnly, true);
  assert.equal(after.find((x) => x.number === 2)!.outlineOnly, false);
});

test('hub: after a restart the last run is back on the board as finished, though memory loads after the hub attaches', async () => {
  // Before the restart: a finished run, reported once into the history file.
  const history = new MemoryRunHistory();
  const before = system();
  new ActivityHub({ history, throttleMs: 0 }).attach('k', before);
  await before.trigger('manual');
  await before.idle();
  await sleep(200);
  const saved = before.memorySnapshot();
  assert.equal(history.list('k').length, 1);

  // The server makes the agents, attaches the hub, then loads the student's memory.
  const after = system();
  const hub = new ActivityHub({ history, throttleMs: 0 });
  const seen: string[] = [];
  hub.attach('k', after);
  hub.watch(after, (m) => seen.push(m.event));
  assert.equal(hub.live(after).run, null);
  after.restore(saved);
  const live = hub.live(after);
  assert.equal(live.run?.number, 1);
  assert.equal(live.run?.outcome, 'finished');
  assert.ok(live.agents.length > 5, 'every agent of the run is back');
  assert.ok(live.agents.every((a) => a.status !== 'running' && a.startedAt === null), 'shown as it ended, without invented timings');
  assert.ok(seen.includes('activity'), 'open viewers are sent the restored run');
  // Not reported a second time, then or when the next run starts.
  await after.trigger('manual');
  await after.idle();
  await sleep(200);
  assert.deepEqual(hub.reports(after).map((r) => r.number), [2, 1]);
});

test('api: a simulated run shows live by level, then lands in the history with its report', async () => {
  const s = system(new SlowReaderBrain({ speed: 0, now: () => NOW }));
  const { app } = createApp(new LocalStore(null), {}, { demo: s });
  const empty = (await (await app.request('/api/students/demo/activity')).json()) as { live: LiveActivity; history: RunReport[] };
  assert.equal(empty.live.run, null);
  assert.deepEqual(empty.history, []);

  await s.trigger('manual');
  await s.idle();
  await sleep(400);
  const body = (await (await app.request('/api/students/demo/activity')).json()) as { live: LiveActivity; history: RunReport[] };
  const run = s.currentRun()!;
  assert.equal(body.live.run?.id, run.id);
  assert.equal(body.live.run?.outcome, 'partly_failed');
  for (const level of ['master', 'manager', 'worker', 'validation', 'presentation']) assert.ok(body.live.agents.some((a) => a.level === level), level);
  assert.ok(body.live.agents.some((a) => a.status === 'timed_out' && a.detail === 'grok CLI timed out after 120s'));
  assert.ok(body.live.agents.every((a) => a.status !== 'running' && a.status !== 'queued'));
  assert.ok(body.live.agents.filter((a) => a.status === 'done').every((a) => a.startedAt && a.finishedAt));

  assert.equal(body.history.length, 1);
  const report = body.history[0]!;
  assert.equal(report.number, run.number);
  assert.equal(report.outlineOnly, false);
  assert.equal(report.request, run.brief?.goal);
  assert.deepEqual(report.results, { found: run.stats.candidates || run.validations.length, validated: run.stats.kept, rejected: run.stats.rejected, saved: run.stats.added });
  assert.equal(report.failures?.reasons[0]?.reason, 'grok CLI timed out after 120s');
  assert.equal(report.outcomes[0]?.status, 'timed_out');
  assert.equal(report.agents?.byLevel.master, 1);
  assert.ok((report.durationMs ?? -1) >= 0);
});

test('api: the stream sends the activity and the history, then every change and the new report', async () => {
  // Slow enough that agents are seen running between messages.
  const s = system(new SimBrain({ speed: 40, now: () => NOW }));
  const { app } = createApp(new LocalStore(null), {}, { demo: s });
  const controller = new AbortController();
  const res = await app.request('/api/students/demo/activity/stream', { signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const until = async (pattern: RegExp, ms = 3000) => {
    const end = Date.now() + ms;
    while (!pattern.test(text) && Date.now() < end) {
      const chunk = await Promise.race([reader.read(), sleep(end - Date.now()).then(() => null)]);
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    return pattern.test(text);
  };
  try {
  assert.ok(await until(/event: activity[\s\S]*event: history/), 'first activity and history');
  // Opening the activity stream never starts a run by itself.
  await sleep(1200);
  assert.equal(s.currentRun(), null);
  const before = (text.match(/event: activity/g) ?? []).length;
  void s.trigger('manual');
  assert.ok(await until(/"status":"running"/, 8000), 'running agents arrive');
  assert.ok(await until(/event: history\ndata: \[\{/), 'the report arrives when the run ends');
  assert.ok((text.match(/event: activity/g) ?? []).length > before);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
    s.stop();
    await s.idle();
  }
});

test('activity: a run that fails gives the failed agent the run error, in words', () => {
  const error = 'grok CLI exited 1: Error: Internal error: {\n  "message": "API error (status 402 Payment Required): Grok Build usage balance exhausted",\n  "http_status": 402\n}';
  const plain = 'grok CLI exited 1: API error (status 402 Payment Required): Grok Build usage balance exhausted';
  assert.equal(plainError(error), plain);
  assert.equal(plainError('grok CLI timed out after 120s'), 'grok CLI timed out after 120s');
  assert.equal(plainError(null), null);

  const failed = snapshot({
    status: 'failed',
    finishedAt: NOW.toISOString(),
    error,
    agents: [{ id: 'master', level: 'master', name: 'Master agent', role: 'Reads the profile', status: 'failed', detail: 'Reading the student…' }],
    jobs: [],
    validations: [],
  });
  const { live, agents } = new RunObserver(() => NOW).update(failed);
  assert.equal(live.run?.outcome, 'failed');
  assert.equal(live.run?.error, plain);
  assert.equal(live.agents[0]?.detail, plain);
  const report = reportOf(failed, agents);
  assert.deepEqual(report.failures?.reasons, [{ reason: plain, count: 1 }]);
  assert.equal(report.error, plain);
});

test('activity: a finished run counts where postings dropped, stage by stage, and its report carries it', async () => {
  const s = system();
  await s.trigger('manual');
  await s.idle();
  const run = s.currentRun()!;
  const f = run.stats.funnel!;
  assert.ok(f, 'the run has a funnel');
  assert.equal(f.reviewed, run.validations.length);
  assert.equal(f.kept, run.stats.kept);
  assert.equal(f.rejected, run.stats.rejected);
  assert.equal(f.saved, run.stats.added);
  assert.equal(f.jobs, run.stats.jobs);
  assert.equal(f.scouts.done + f.scouts.failed + f.scouts.skipped, run.jobs.filter((j) => j.kind === 'scout').length);
  assert.equal(f.readers.done + f.readers.failed + f.readers.skipped, run.jobs.filter((j) => j.kind === 'extract').length);
  assert.equal(f.readers.skippedReasons.reduce((n, r) => n + r.count, 0), f.readers.skipped);
  assert.equal(f.rejectedReasons.reduce((n, r) => n + r.count, 0), f.rejected);
  // The log line stays for anyone reading the run log.
  assert.ok(run.log.some((l) => l.text.startsWith('Funnel: ')));
  const report = reportOf(run, new RunObserver(() => NOW).update(run).agents);
  assert.deepEqual(report.funnel, f);
  // Saved with the run's outline, so it survives a restart.
  assert.deepEqual(outlineReport(s.searchHistory().runs.at(-1)!).funnel, f);
});
