// Every state of the live view and of History, rendered to markup the way the page renders them.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { agent, at, liveOf, report, runOf, T0 } from '../../../lib/activity/fixtures.ts';
import type { ActivityState } from '../../../lib/activity/useActivity.ts';
import { TellBar } from '../TellAgents.tsx';
import { LiveBoard } from './LiveBoard.tsx';
import { RunHistory } from './RunHistory.tsx';

type BoardState = Pick<ActivityState, 'status' | 'live' | 'attempt' | 'error'>;
const board = (state: Partial<BoardState>, extra: { reduced?: boolean; hasHistory?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(LiveBoard, {
      state: { status: 'live', live: null, attempt: 0, error: null, ...state },
      now: T0 + 30_000,
      reduced: extra.reduced ?? false,
      actions: createElement('button', { type: 'button' }, 'Run now'),
      hasHistory: extra.hasHistory ?? false,
      onRetry: () => {},
    }),
  );
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('LiveBoard', () => {
  it('connecting: skeleton rows in every column and no run yet', () => {
    const html = board({ status: 'connecting' });
    expect(html).toContain('Connecting to your agents');
    expect(count(html, 'ag-live-skeleton')).toBe(10);
    expect(html).not.toContain('ag-flow-track');
  });

  it('no run yet: five empty columns that say what starts them, pointing at History', () => {
    const html = board({ live: { ...liveOf(), run: null, agents: [], flows: [] } }, { hasHistory: true });
    expect(html).toContain('Live view');
    expect(html).toContain('No run yet');
    expect(count(html, 'class="ag-live-empty"')).toBe(5);
    expect(html).toContain('The last run is in History below.');
  });

  it('running: a row per agent with status, elapsed time and detail, grouped by manager', () => {
    const live = liveOf();
    const html = board({ live });
    expect(html).toContain('Run #3');
    expect(count(html, 'class="ag-live-row"')).toBe(live.agents.length);
    expect(html).toContain('Reader · Data Science Society');
    expect(html).toContain('data-status="timed_out"');
    expect(html).toContain('grok CLI timed out after 120s');
    expect(html).toContain('Clubs manager · 2');
    expect(html).toContain('Internships manager · 2');
    // Started 1 s after the run, now is 30 s in.
    expect(html).toContain('0:29');
    expect(html).toContain('Waiting for a free worker');
    // Failures so far are called out while the run goes on.
    expect(html).toContain('1 agent has failed or timed out so far');
  });

  it('flows move only where the receiving level has work, and hold still under reduced motion', () => {
    const html = board({ live: liveOf() });
    expect(count(html, 'data-active="true"')).toBe(2);
    expect(count(html, 'data-active="false"')).toBe(2);
    expect(html).toContain('handed to the workers, work moving now.');
    expect(board({ live: liveOf() }, { reduced: true })).toContain('data-reduced="true"');
  });

  it('partly failed: a warning banner with the count, the run chip says so', () => {
    const live = liveOf({ run: runOf({ outcome: 'partly_failed', status: 'complete', finishedAt: at(272) }) });
    const html = board({ live });
    expect(html).toContain('Partly failed');
    expect(html).toContain('1 agent failed or timed out. The rest finished');
    expect(html).toContain('4:32');
  });

  it('failed: a danger banner with the reason', () => {
    const live = liveOf({ run: runOf({ outcome: 'failed', status: 'failed', error: 'Grok is not signed in', finishedAt: at(12) }) });
    const html = board({ live });
    expect(html).toContain('role="alert"');
    expect(html).toContain('The run failed: Grok is not signed in');
  });

  it('stopped: a quiet note on what stays', () => {
    const html = board({ live: liveOf({ run: runOf({ outcome: 'stopped', status: 'stopped', finishedAt: at(40) }) }) });
    expect(html).toContain('Stopped by you.');
  });

  it('reconnecting: keeps the last view, dimmed, and says which try it is', () => {
    const html = board({ status: 'reconnecting', live: liveOf(), attempt: 3 });
    expect(html).toContain('data-stale="true"');
    expect(html).toContain('Reconnecting… (try 3)');
    expect(count(html, 'class="ag-live-row"')).toBe(liveOf().agents.length);
  });

  it('error: the reason and a Retry button instead of the board', () => {
    const html = board({ status: 'error', error: 'the agent server answered 503' });
    expect(html).toContain('Could not load your agents’ activity: the agent server answered 503.');
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(html).not.toContain('ag-live-board');
    expect(html).not.toContain('>Offline<');
  });

  it('a long column scrolls inside itself and every row keeps its full text in its label', () => {
    const live = liveOf();
    for (let i = 0; i < 40; i++) live.agents.push(agent(`job:x${i}`, { task: `Read: Club with a long and awkward name number ${i}` }));
    const html = board({ live });
    expect(count(html, 'class="ag-live-row"')).toBe(live.agents.length);
    expect(html).toContain('aria-label="Reader · Club with a long and awkward name number 39. Running, 0:29. Read: Club with a long and awkward name number 39"');
  });
});

const hist = (history: ReturnType<typeof report>[], status: ActivityState['status'] = 'live') =>
  renderToStaticMarkup(createElement(RunHistory, { history, status, onRetry: () => {} }));

describe('RunHistory', () => {
  it('loading: skeleton rows', () => {
    const html = hist([], 'connecting');
    expect(html).toContain('Loading…');
    expect(count(html, 'ag-hist-skeleton')).toBe(3);
  });

  it('empty: says what will appear here', () => {
    expect(hist([])).toContain('No runs yet. Each finished run is reported here');
  });

  it('error: says so with Retry', () => {
    const html = hist([], 'offline');
    expect(html).toContain('Could not load run history');
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
  });

  it('list: five newest runs with what was asked, counts, duration and outcome, and Show more', () => {
    const runs = Array.from({ length: 8 }, (_, i) => report(i + 1));
    const html = hist(runs);
    expect(count(html, 'class="ag-hist-row"')).toBe(5);
    expect(html).toContain('5 of 8 runs');
    expect(html).toContain('Request 1');
    expect(html).not.toContain('Request 6');
    expect(html).toContain('Show more (up to 10)');
    expect(html).toContain('4:32');
    expect(html).toContain('data-outcome="finished"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('a failed run shows why on its row; an old run is outline only and cannot open', () => {
    const failed = report(1, {
      outcome: 'partly_failed',
      outcomes: [{ id: 'a', level: 'worker', name: 'Reader', task: 'Read: A', status: 'timed_out', outcome: 'grok CLI timed out after 120s', durationMs: 120_000 }],
      failures: { count: 1, reasons: [{ reason: 'grok CLI timed out after 120s', count: 1 }] },
    });
    const old = report(2, { outlineOnly: true, agents: null, request: null, failures: null });
    const html = hist([failed, old]);
    expect(html).toContain('1 timed out');
    expect(html).toContain('Partly failed');
    expect(html).toContain('Request not recorded');
    expect(html).toContain('outline only');
    expect(count(html, '<button type="button" class="ag-hist-head"')).toBe(1);
  });
});

describe('Tell your agents in the live view', () => {
  const tellBoard = (status: 'live' | 'error', tellStatus: { tone: 'quiet' | 'warn'; text: string } | null) =>
    renderToStaticMarkup(
      createElement(LiveBoard, {
        state: { status, live: status === 'live' ? liveOf() : null, attempt: 0, error: status === 'error' ? 'the agent server answered 503' : null },
        now: T0,
        reduced: false,
        actions: null,
        hasHistory: false,
        tell: createElement(TellBar, { live: true, onSend: () => {}, status: tellStatus }),
        onRetry: () => {},
      }),
    );

  it('sits under the request line and says whether the note was saved, with no rule preview', () => {
    const html = tellBoard('live', { tone: 'quiet', text: 'Saved to your profile notes: “Only remote”.' });
    expect(html).toContain('class="ag-tell"');
    expect(html.indexOf('ag-live-request')).toBeLessThan(html.indexOf('ag-tell'));
    expect(html).toContain('Saved to your profile notes');
    expect(html).not.toContain('reads this as');
    expect(html).not.toContain('standing instruction');
  });

  it('warns when the note could not be sent, and is hidden when the board could not load', () => {
    expect(tellBoard('live', { tone: 'warn', text: 'Kept on this computer only' })).toContain('data-tone="warn"');
    expect(tellBoard('error', null)).not.toContain('ag-tell');
  });
});
