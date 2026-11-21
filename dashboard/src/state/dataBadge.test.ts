import { describe, expect, it } from 'vitest';
import { dataBadgeText, isOutOfCredit, type BadgeInput } from './dataBadge.ts';

const base = (over: Partial<BadgeInput> = {}): BadgeInput => ({
  searching: false,
  sampleFeed: false,
  status: 'connected',
  usingLive: true,
  provider: 'simulated',
  ...over,
});

describe('top-bar agent badge', () => {
  it('names Grok whenever the backend is on Grok', () => {
    expect(dataBadgeText(base({ provider: 'grok', usingLive: true }))).toEqual({ long: 'Live · Grok', short: 'Grok' });
    expect(dataBadgeText(base({ provider: 'grok', usingLive: false })).short).toBe('Grok');
    expect(dataBadgeText(base({ provider: 'grok', usingLive: false })).long).toBe('Grok · no results yet');
  });

  it('says simulated only when the backend is simulated and has results', () => {
    expect(dataBadgeText(base()).long).toBe('Simulated agents');
    expect(dataBadgeText(base({ usingLive: false })).long).toBe('No results yet');
  });

  it('says the Grok balance is used up after a search failed for it, until one runs again', () => {
    expect(dataBadgeText(base({ provider: 'grok', outOfCredit: true }))).toEqual({ long: 'Grok balance used up', short: 'No credit' });
    expect(dataBadgeText(base({ provider: 'grok', outOfCredit: true, searching: true })).long).toBe('Grok is searching…');
    expect(dataBadgeText(base({ provider: 'grok', outOfCredit: true, status: 'offline' })).long).toBe('Agents offline');
    // The backend's reason, word for word (backend/src/quota.ts).
    expect(isOutOfCredit('Grok usage balance exhausted; top up to continue')).toBe(true);
    expect(isOutOfCredit('grok CLI timed out after 120s')).toBe(false);
  });

  it('searching, offline and the public sample come before the provider', () => {
    expect(dataBadgeText(base({ searching: true, provider: 'grok' }))).toEqual({ long: 'Grok is searching…', short: 'Grok' });
    expect(dataBadgeText(base({ searching: true })).short).toBe('Searching');
    expect(dataBadgeText(base({ status: 'offline', provider: 'grok' })).long).toBe('Agents offline');
    expect(dataBadgeText(base({ status: 'connecting' })).short).toBe('Connecting');
    expect(dataBadgeText(base({ sampleFeed: true, status: 'offline' })).long).toBe('Sample postings');
  });
});
