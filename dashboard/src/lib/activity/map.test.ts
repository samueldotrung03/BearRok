// Layer grouping, the line under each icon, the popover, and which way each arrow points.
import { describe, expect, it } from 'vitest';
import { agent, at, liveOf } from './fixtures.ts';
import { actionText, arrowsOf, layersOf, popoverOf, resultCounts } from './map.ts';

describe('layers', () => {
  it('puts every agent in one layer, and groups workers and reviews under their manager', () => {
    const live = liveOf();
    const layers = layersOf(live.agents);
    expect(layers.map((l) => l.level)).toEqual(['master', 'manager', 'worker', 'validation', 'presentation']);
    const placed = layers.flatMap((l) => l.groups.flatMap((g) => g.agents.map((a) => a.id)));
    expect(placed.sort()).toEqual(live.agents.map((a) => a.id).sort());
    expect(new Set(placed).size).toBe(placed.length);

    const workers = layers.find((l) => l.level === 'worker')!;
    expect(workers.groups.map((g) => [g.title, g.agents.map((a) => a.id)])).toEqual([
      ['Clubs manager', ['job:1', 'job:2']],
      ['Internships manager', ['job:3', 'job:4']],
      ['Other work', []],
    ]);
    const reviews = layers.find((l) => l.level === 'validation')!;
    expect(reviews.groups.find((g) => g.id === 'other')!.agents.map((a) => a.id)).toEqual(['review:v1:criteria']);
    expect(layers.find((l) => l.level === 'master')!.groups).toHaveLength(1);
    expect(layers.find((l) => l.level === 'presentation')!.groups[0]!.agents).toEqual([]);
  });
});

describe('action text', () => {
  it('uses the latest detail, and a waiting line when the agent has not started', () => {
    expect(actionText(agent('job:2', { detail: 'Reading posting at mlh.com' }))).toBe('Reading posting at mlh.com');
    expect(actionText(agent('job:3', { status: 'done', detail: 'Rejected: closed', verdict: null }))).toBe('Rejected: closed');
    expect(actionText(agent('job:4', { status: 'queued', startedAt: null, detail: null }))).toBe('Waiting for a free worker');
    expect(actionText(agent('job:5', { status: 'running', detail: null, task: 'Read: CSUA' }))).toBe('Read: CSUA');
  });
});

describe('popover', () => {
  const now = at(30);
  const nowMs = Date.parse(now);

  it('includes the task, target, status, elapsed time, recent actions and result counts', () => {
    const reader = agent('job:2', {
      detail: 'Reading posting at mlh.com',
      target: 'https://mlh.com/posting',
      recent: [
        { at: at(20), text: 'Reading posting at mlh.com' },
        { at: at(12), text: 'Opened mlh.com' },
        { at: at(8), text: 'Queued' },
      ],
    });
    const pop = popoverOf(reader, [reader], nowMs);
    expect(pop.doing).toBe('Reading posting at mlh.com');
    expect(pop.task).toBe('Read: Data Science Society');
    expect(pop.target).toBe('https://mlh.com/posting');
    expect(pop.status).toBe('Running');
    expect(pop.elapsed).toBe('0:29');
    expect(pop.recent.map((r) => r.text)).toEqual(['Reading posting at mlh.com', 'Opened mlh.com', 'Queued']);
    expect(pop.results).toEqual(['Still reading']);
  });

  it('keeps at most four recent lines and counts a manager by what its workers brought back', () => {
    const manager = agent('manager:clubs', { level: 'manager', kind: 'manager', name: 'Clubs manager', task: 'Find clubs', target: null, managerId: 'manager:clubs', status: 'running' });
    const scout = agent('job:1', { kind: 'scout', name: 'Scout', status: 'done', detail: '4 leads', finishedAt: at(9) });
    const reader = agent('job:2', { status: 'done', detail: 'Data Science Society', finishedAt: at(12) });
    const kept = agent('review:1', { level: 'validation', kind: 'criteria', name: 'Criteria', target: 'DSS', status: 'done', verdict: 'kept', detail: 'Kept: fits' });
    const rejected = agent('review:2', { level: 'validation', kind: 'status', name: 'Status', target: 'DSS', status: 'done', verdict: 'rejected', detail: 'Rejected: closed' });
    const other = agent('review:3', { level: 'validation', kind: 'criteria', name: 'Criteria', managerId: 'manager:jobs', target: 'Other', status: 'done', verdict: 'kept' });
    const agents = [manager, scout, reader, kept, rejected, other];
    const recent = Array.from({ length: 6 }, (_, i) => ({ at: at(i), text: `Line ${i}` }));
    const pop = popoverOf({ ...manager, recent }, agents, nowMs);
    expect(pop.recent).toHaveLength(4);
    expect(pop.recent[0]!.text).toBe('Line 0');
    expect(resultCounts(manager, agents)).toEqual(['2 workers sent', '1 posting brought back', '1 kept · 1 rejected']);
    expect(resultCounts(scout, agents)).toEqual(['4 leads']);
    expect(resultCounts(rejected, agents)).toEqual(['Rejected']);
  });
});

describe('arrows', () => {
  it('points assignments down and results up to the manager, then down the pipeline', () => {
    const live = liveOf();
    const arrows = arrowsOf(live.agents, live.flows);
    const by = (id: string) => arrows.find((a) => a.id === id)!;

    expect(by('band-briefs')).toMatchObject({ direction: 'down', kind: 'task', after: 'master', active: true });
    expect(by('band-tasks')).toMatchObject({ direction: 'down', kind: 'task', after: 'manager', active: true });
    expect(by('band-back')).toMatchObject({ direction: 'up', kind: 'result', after: 'manager', active: true });
    expect(by('col-tasks-manager:clubs')).toMatchObject({ direction: 'down', kind: 'task', place: 'column', columnId: 'manager:clubs' });
    expect(by('col-back-manager:clubs')).toMatchObject({ direction: 'up', kind: 'result', place: 'column' });
    expect(by('col-back-manager:clubs').text).toContain('up to Clubs manager');
    expect(by('col-tasks-manager:clubs').text).toContain('down to Clubs manager\'s workers');
    expect(by('band-review')).toMatchObject({ direction: 'down', kind: 'result', after: 'worker' });
    expect(by('band-kept')).toMatchObject({ direction: 'down', kind: 'result', after: 'validation', active: false });
    expect(by('band-saved')).toMatchObject({ direction: 'down', kind: 'result', after: 'presentation', active: false });

    // The internships manager is running, so results pointing back up to it move.
    // Its queued worker has not brought a posting back, so the count stays 0.
    expect(by('col-back-manager:jobs')).toMatchObject({ direction: 'up', active: true, label: '0 brought back' });
    // Nobody is presenting, so the arrow into the feed holds still.
    expect(by('band-saved').active).toBe(false);
    expect(by('band-saved').text).not.toContain('work moving now');
    expect(by('band-tasks').text).toContain('work moving now');
  });

  it('holds every arrow still once the receivers have finished', () => {
    const done = agent('manager:clubs', { level: 'manager', kind: 'manager', name: 'Clubs manager', managerId: 'manager:clubs', status: 'done', finishedAt: at(4) });
    const worker = agent('job:1', { status: 'done', detail: '4 leads', finishedAt: at(9) });
    const arrows = arrowsOf([done, worker], []);
    expect(arrows.every((a) => a.active === false)).toBe(true);
    expect(arrows.find((a) => a.id === 'col-back-manager:clubs')!.direction).toBe('up');
    expect(arrows.find((a) => a.id === 'col-tasks-manager:clubs')!.direction).toBe('down');
  });
});
