// Small builders for activity feed data, shared by the view and component tests.
import type { ActivityAgent, ActivityFlow, ActivityRun, LiveActivity, RunReport } from './types.ts';

export const T0 = Date.parse('2026-11-21T17:00:00.000Z');
export const at = (s: number) => new Date(T0 + s * 1000).toISOString();

export function agent(id: string, over: Partial<ActivityAgent> = {}): ActivityAgent {
  return {
    id,
    level: 'worker',
    kind: 'reader',
    name: 'Reader',
    task: 'Read: Data Science Society',
    target: 'https://example.edu/dss',
    managerId: 'manager:clubs',
    status: 'running',
    detail: null,
    verdict: null,
    queuedAt: at(0),
    startedAt: at(1),
    finishedAt: null,
    ...over,
  };
}

export function runOf(over: Partial<ActivityRun> = {}): ActivityRun {
  return {
    id: 'run-3',
    number: 3,
    trigger: 'manual',
    triggerText: 'Started by you',
    request: 'Clubs and internships for a data science student',
    mode: 'simulated',
    status: 'running',
    outcome: 'running',
    startedAt: at(0),
    finishedAt: null,
    error: null,
    ...over,
  };
}

export const flow = (from: ActivityFlow['from'], to: ActivityFlow['to'], over: Partial<ActivityFlow> = {}): ActivityFlow => ({
  from,
  to,
  kind: to === 'validation' || to === 'presentation' ? 'result' : 'task',
  count: 2,
  unit: 'tasks',
  active: false,
  ...over,
});

/** A run in progress: one master, two managers with workers, a review and nothing presented yet. */
export function liveOf(over: Partial<LiveActivity> = {}): LiveActivity {
  const agents: ActivityAgent[] = [
    agent('master', { level: 'master', kind: 'master', name: 'Master', task: 'Brief the managers', target: null, managerId: null, status: 'done', finishedAt: at(3) }),
    agent('manager:clubs', { level: 'manager', kind: 'manager', name: 'Clubs manager', task: 'Find clubs', target: null, managerId: null, status: 'running' }),
    agent('manager:jobs', { level: 'manager', kind: 'manager', name: 'Internships manager', task: 'Find internships', target: null, managerId: null, status: 'running' }),
    agent('job:1', { kind: 'scout', name: 'Scout', task: 'Search: data science clubs', status: 'done', detail: '4 pages found', finishedAt: at(9) }),
    agent('job:2'),
    agent('job:3', { managerId: 'manager:jobs', status: 'timed_out', detail: 'grok CLI timed out after 120s', finishedAt: at(121) }),
    agent('job:4', { managerId: 'manager:jobs', status: 'queued', startedAt: null }),
    agent('review:v1:criteria', { level: 'validation', kind: 'criteria', name: 'Criteria reviewer', task: 'Check criteria', target: 'DSS', managerId: null, status: 'running' }),
  ];
  return {
    run: runOf(),
    agents,
    flows: [flow('master', 'manager', { unit: 'briefs' }), flow('manager', 'worker', { count: 4, active: true }), flow('worker', 'validation', { count: 1, unit: 'postings', active: true }), flow('validation', 'presentation', { count: 0, unit: 'kept' })],
    counts: { queued: 1, running: 4, done: 2, failed: 0, timed_out: 1, skipped: 0 },
    changed: [],
    serverTime: at(30),
    ...over,
  };
}

export function report(n: number, over: Partial<RunReport> = {}): RunReport {
  return {
    id: `run-${n}`,
    number: n,
    trigger: 'manual',
    triggerText: 'Started by you',
    request: `Request ${n}`,
    mode: 'simulated',
    status: 'complete',
    outcome: 'finished',
    startedAt: at(-n * 3600),
    finishedAt: at(-n * 3600 + 272),
    durationMs: 272_000,
    agents: { total: 12, byLevel: { master: 1, manager: 2, worker: 6, validation: 2, presentation: 1 } },
    results: { found: 5, validated: 3, rejected: 2, saved: 3 },
    failures: { count: 0, reasons: [] },
    skipped: { count: 0, reasons: [] },
    error: null,
    outcomes: [],
    outlineOnly: false,
    ...over,
  };
}
