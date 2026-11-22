import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MinimumMatch } from '../components/agents/MinimumMatch.tsx';
import type { Opportunity } from '../types.ts';
import { funnelSteps } from './activity/view.ts';
import { cleanThreshold, DEFAULT_MATCH_THRESHOLD, loadThreshold, matchLevel, matchPercent, saveThreshold, thresholdLine } from './match.ts';

/** A stand-in for the backend's preferences endpoint: it keeps what it is sent and refuses out-of-range values. */
function fakeBackend(start: number | null, opts: { failGet?: boolean } = {}) {
  const calls: { method: string; body: unknown }[] = [];
  let stored = start;
  const request = async (path: string, init: RequestInit = {}) => {
    expect(path).toBe('/preferences');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, body });
    if (method === 'GET') {
      if (opts.failGet) return new Response('{}', { status: 503 });
      return Response.json(stored === null ? { reminderDays: [7, 2, 0] } : { reminderDays: [7, 2, 0], matchThreshold: stored });
    }
    const n = body.matchThreshold;
    if (typeof n !== 'number' || n < 0 || n > 100) return Response.json({ error: 'matchThreshold must be a whole percent from 0 to 100' }, { status: 400 });
    stored = n;
    return Response.json({ matchThreshold: stored });
  };
  return { request, calls, stored: () => stored };
}

// The first card render pulls in the feed components and takes about eight seconds here, past Vitest's five-second default.
describe('match score on cards', { timeout: 20_000 }, () => {
  it('reads the agents’ match, falls back to the fit score for older cards, and clamps', () => {
    expect(matchPercent({ baseScore: 0.4, match: { score: 72, factors: [], reason: '' } })).toBe(72);
    expect(matchPercent({ baseScore: 0.456, match: null })).toBe(46);
    expect(matchPercent({ baseScore: 1.4 })).toBe(100);
    expect(matchPercent({ baseScore: 0, match: { score: -4, factors: [], reason: '' } })).toBe(0);
  });

  it('names how strong a match is', () => {
    expect(matchLevel(90).label).toBe('Strong match');
    expect(matchLevel(75).label).toBe('Strong match');
    expect(matchLevel(74).label).toBe('Good match');
    expect(matchLevel(50).label).toBe('Good match');
    expect(matchLevel(31).label).toBe('Partial match');
  });

  it('shows "N% match" on a scored card and the breakdown in its details', async () => {
    const { MatchChip } = await import('../components/OpportunityCard.tsx');
    const o = { id: 'o1', match: { score: 64, factors: [{ factor: 'interests', score: 88, note: 'your interest in data' }], reason: 'Strong on data' }, baseScore: 0.64 } as Opportunity;
    const chip = renderToString(createElement(MatchChip, { opportunity: o }));
    expect(chip).toContain('64<!-- -->% match');
    expect(chip).toContain('Good match: Strong on data');
    // A card the agents never scored shows no chip.
    expect(renderToString(createElement(MatchChip, { opportunity: { ...o, match: null } }))).toBe('');
  });
});

describe('minimum match setting', { timeout: 20_000 }, () => {
  it('keeps a typed or slid value a whole percent from 0 to 100', () => {
    expect(DEFAULT_MATCH_THRESHOLD).toBe(30);
    expect(cleanThreshold('45')).toBe(45);
    expect(cleanThreshold(29.6)).toBe(30);
    expect(cleanThreshold(-5)).toBe(0);
    expect(cleanThreshold(250)).toBe(100);
    expect(cleanThreshold('')).toBe(30);
    expect(cleanThreshold('abc')).toBe(30);
  });

  it('explains what the value does', () => {
    expect(thresholdLine(30)).toMatch(/at least 30% of what you asked for/);
    expect(thresholdLine(0)).toMatch(/Every posting that passes the checks/);
    expect(thresholdLine(95)).toMatch(/Expect very few/);
  });

  it('renders a slider and a number box with the value, a plain explanation, and a reset only when changed', () => {
    const at45 = renderToString(createElement(MinimumMatch, { value: 45, onChange: () => {} }));
    expect(at45).toContain('Minimum match');
    expect(at45).toContain('type="range"');
    expect(at45).toContain('type="number"');
    expect(at45).toContain('value="45"');
    expect(at45).toContain('Reset to <!-- -->30<!-- -->%');
    expect(at45).toContain('dropped whatever it scores');
    const at30 = renderToString(createElement(MinimumMatch, { value: 30, onChange: () => {} }));
    expect(at30).not.toContain('Reset to');
    // Disabled until the saved value has loaded.
    expect(renderToString(createElement(MinimumMatch, { value: 30, onChange: () => {}, disabled: true }))).toContain('disabled=""');
  });

  it('loads the saved value, saves a change through the preferences endpoint, and loads it back', async () => {
    const backend = fakeBackend(30);
    const loaded = await loadThreshold(backend.request);
    expect(loaded).toBe(30);
    // Unchanged: nothing is sent.
    expect(await saveThreshold(backend.request, 30, loaded)).toBe(true);
    expect(backend.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    // Changed: sent once, and the next load reads it.
    expect(await saveThreshold(backend.request, 55, loaded)).toBe(true);
    expect(backend.calls.filter((c) => c.method === 'PUT')).toEqual([{ method: 'PUT', body: { matchThreshold: 55 } }]);
    expect(await loadThreshold(backend.request)).toBe(55);
  });

  it('never overwrites the saved value when it could not be loaded, and reports a refused save', async () => {
    const down = fakeBackend(70, { failGet: true });
    const loaded = await loadThreshold(down.request);
    expect(loaded).toBeNull();
    expect(await saveThreshold(down.request, 30, loaded)).toBe(true);
    expect(down.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(down.stored()).toBe(70);
    // A backend that has never stored one: the default.
    expect(await loadThreshold(fakeBackend(null).request)).toBe(30);
    // A refused save is reported as not saved.
    const refusing = async () => new Response('{}', { status: 400 });
    expect(await saveThreshold(refusing, 40, 30)).toBe(false);
  });
});

describe('run history funnel', { timeout: 20_000 }, () => {
  it('says how many postings fell under the minimum match, apart from rejections', () => {
    const base = {
      jobs: 24, scouts: { done: 8, failed: 0, skipped: 0 }, leads: 22, duplicates: 0,
      readers: { done: 22, empty: 0, failed: 0, skipped: 0, skippedReasons: [] }, noLink: 0, alreadyRejected: 0,
      reviewed: 22, rejected: 2, rejectedReasons: [{ reason: 'Status reviewer: Closed', count: 2 }], unfinishedReviews: 0, kept: 17, saved: 17,
    };
    const kept = funnelSteps({ ...base, belowThreshold: 3, threshold: 30, alreadyBelowThreshold: 1 });
    expect(kept.find((s) => s.label === 'Kept')!.notes).toEqual(['2 rejected: Status reviewer: Closed', '3 below your minimum match of 30%']);
    expect(kept.find((s) => s.label === 'Reviewed')!.notes).toContain('1 still below your minimum match from an earlier run');
    // Runs from before the minimum match say nothing about it.
    expect(funnelSteps(base).find((s) => s.label === 'Kept')!.notes).toEqual(['2 rejected: Status reviewer: Closed']);
  });
});
