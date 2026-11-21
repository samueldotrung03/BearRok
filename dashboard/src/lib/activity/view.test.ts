import { describe, expect, it } from 'vitest';
import { agent, at, liveOf, report, runOf, T0 } from './fixtures.ts';
import { backoffMs } from './useActivity.ts';
import { announcements, columnsOf, countsText, dayKey, elapsedMs, failureLine, formatDuration, funnelSteps, historyDays, outlineLine, rowDetail, rowTitle, visibleHistory } from './view.ts';

describe('columnsOf', () => {
  it('puts every agent in one of five level columns, in the order work flows', () => {
    const live = liveOf();
    const cols = columnsOf(live);
    expect(cols.map((c) => c.level)).toEqual(['master', 'manager', 'worker', 'validation', 'presentation']);
    expect(cols.flatMap((c) => c.agents)).toHaveLength(live.agents.length);
    expect(cols[4]!.agents).toEqual([]);
    expect(cols[4]!.counts).toBe('none yet');
    expect(cols[4]!.flow).toBeNull();
  });

  it('groups workers under the manager that sent them, and collects the rest under Other work', () => {
    const live = liveOf();
    live.agents.push(agent('job:9', { managerId: null, name: 'Picture finder' }));
    const workers = columnsOf(live)[2]!;
    expect(workers.groups!.map((g) => [g.title, g.agents.length])).toEqual([
      ['Clubs manager', 2],
      ['Internships manager', 2],
      ['Other work', 1],
    ]);
    expect(workers.counts).toBe('2 running · 1 queued · 1 done · 1 timed out');
  });

  it('gives each column the hand-off to the next level', () => {
    const cols = columnsOf(liveOf());
    expect(cols[1]!.flow).toMatchObject({ from: 'manager', to: 'worker', count: 4, active: true });
    expect(cols[3]!.flow).toMatchObject({ from: 'validation', active: false });
  });

  it('shows empty columns with their hint before any run', () => {
    const cols = columnsOf(null);
    expect(cols.every((c) => c.agents.length === 0 && c.empty.length > 0 && c.flow === null)).toBe(true);
  });
});

describe('rows', () => {
  it('titles workers by what they work on and reviewers by their focus', () => {
    expect(rowTitle(agent('j', { name: 'Reader', task: 'Read: Data Science Society' }))).toBe('Reader · Data Science Society');
    expect(rowTitle(agent('r', { level: 'validation', kind: 'status', target: 'DSS' }))).toBe('Status · DSS');
    expect(rowTitle(agent('m', { level: 'master', name: 'Master' }))).toBe('Master');
  });

  it('says why a queued agent waits and otherwise shows its detail or task', () => {
    expect(rowDetail(agent('q', { status: 'queued', detail: null }))).toBe('Waiting for a free worker');
    expect(rowDetail(agent('t', { status: 'timed_out', detail: 'grok CLI timed out after 120s' }))).toBe('grok CLI timed out after 120s');
    expect(rowDetail(agent('r', { detail: null, task: 'Read: DSS' }))).toBe('Read: DSS');
  });

  it('counts elapsed time from start to finish, or to now while running', () => {
    expect(elapsedMs(agent('a', { startedAt: null }), T0)).toBeNull();
    expect(elapsedMs(agent('a', { startedAt: at(0), finishedAt: at(42) }), T0 + 999_999)).toBe(42_000);
    expect(elapsedMs(agent('a', { startedAt: at(0), finishedAt: null }), T0 + 5_000)).toBe(5_000);
  });

  it('formats durations as m:ss and h:mm:ss', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(42_000)).toBe('0:42');
    expect(formatDuration(268_000)).toBe('4:28');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });

  it('counts only the statuses present', () => {
    expect(countsText([])).toBe('none yet');
    expect(countsText([{ status: 'done' }, { status: 'done' }, { status: 'failed' }])).toBe('2 done · 1 failed');
  });
});

describe('announcements', () => {
  it('announces a run starting, agents failing and the run ending, and nothing else', () => {
    const first = liveOf({ changed: [] });
    expect(announcements(null, first)).toEqual(['Run 3 started.']);

    const failing = liveOf({ changed: ['job:2'] });
    failing.agents = failing.agents.map((a) => (a.id === 'job:2' ? { ...a, status: 'failed', detail: 'Page not found' } : a));
    expect(announcements(first, failing)).toEqual(['Reader · Data Science Society failed: Page not found']);

    const done = liveOf({ run: runOf({ outcome: 'partly_failed', status: 'complete' }), changed: [] });
    expect(announcements(failing, done)).toEqual(['Run 3 partly failed.']);
    expect(announcements(done, done)).toEqual([]);
  });
});

describe('history', () => {
  const ten = Array.from({ length: 10 }, (_, i) => report(i + 1));

  it('shows five runs, and up to ten after Show more', () => {
    expect(visibleHistory(ten, null, false)).toMatchObject({ total: 10, canShowMore: true });
    expect(visibleHistory(ten, null, false).shown).toHaveLength(5);
    expect(visibleHistory(ten, null, true).shown).toHaveLength(10);
    expect(visibleHistory(ten, null, true).canShowMore).toBe(false);
    expect(visibleHistory(ten.slice(0, 4), null, false).canShowMore).toBe(false);
  });

  it('filters by the local day a run started', () => {
    const day = dayKey(ten[0]!.startedAt);
    const sameDay = ten.filter((r) => dayKey(r.startedAt) === day);
    expect(visibleHistory(ten, day, true).shown).toEqual(sameDay);
    expect(visibleHistory(ten, '1999-01-01', false)).toMatchObject({ shown: [], total: 0 });
    expect(historyDays(ten)[0]).toBe(day);
    expect(new Set(historyDays(ten)).size).toBe(historyDays(ten).length);
  });

  it('sums up what went wrong in a run, most important first', () => {
    expect(failureLine(report(1, { results: { found: 2, validated: 2, rejected: 0, saved: 2 } }))).toBeNull();
    const bad = report(2, {
      error: null,
      outcomes: [
        { id: 'a', level: 'worker', name: 'Reader', task: 'Read: A', status: 'timed_out', outcome: 'grok CLI timed out after 120s', durationMs: 120_000 },
        { id: 'b', level: 'worker', name: 'Reader', task: 'Read: B', status: 'failed', outcome: 'Page not found', durationMs: 3_000 },
      ],
      skipped: { count: 8, reasons: [{ reason: 'Search budget reached', count: 8 }] },
      results: { found: 3, validated: 0, rejected: 3, saved: 0 },
    });
    expect(failureLine(bad)).toBe('1 failed · 1 timed out · 8 skipped: Search budget reached · 3 rejected by validation');
    expect(failureLine(report(3, { error: 'Grok is not signed in', outcome: 'failed' }))).toMatch(/^Run failed: Grok is not signed in/);
  });

  it('labels runs from before reports were kept as outline only', () => {
    const old = report(4, { outlineOnly: true, agents: null, failures: null, request: null, skipped: { count: 12, reasons: [{ reason: 'budget', count: 12 }] } });
    expect(failureLine(old)).toBeNull();
    expect(outlineLine(old)).toMatch(/outline only · 12 skipped: budget/);
  });
});

describe('backoffMs', () => {
  it('waits 1, 2, 4 and 8 seconds, then every 15', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
  });
});

describe('funnelSteps', () => {
  it('reads as five stages from searching to the feed, each saying what dropped and why', () => {
    const steps = funnelSteps({
      jobs: 24,
      scouts: { done: 8, failed: 0, skipped: 0 },
      leads: 22,
      duplicates: 2,
      readers: { done: 10, empty: 3, failed: 1, skipped: 6, skippedReasons: [{ reason: 'manager budget reached', count: 6 }] },
      noLink: 1,
      alreadyRejected: 0,
      reviewed: 6,
      rejected: 4,
      rejectedReasons: [{ reason: 'Status reviewer: Closed: the deadline passed', count: 3 }, { reason: 'Criteria reviewer: not open to freshmen', count: 1 }],
      unfinishedReviews: 0,
      kept: 2,
      saved: 1,
    });
    expect(steps.map((s) => [s.label, s.value])).toEqual([
      ['Searched', 22],
      ['Read', 10],
      ['Reviewed', 6],
      ['Kept', 2],
      ['Saved', 1],
    ]);
    expect(steps[0]!.notes).toEqual(['from 8 searches', '2 duplicates already taken by another worker']);
    expect(steps[1]!.notes).toEqual(['6 not read: manager budget reached', '3 with no posting', '1 failed']);
    expect(steps[2]!.notes).toEqual(['1 dropped with no usable link']);
    expect(steps[3]!.notes).toEqual(['4 rejected: Status reviewer: Closed: the deadline passed and others']);
    expect(steps[4]!.notes).toEqual(['1 already in your feed']);
  });
});
