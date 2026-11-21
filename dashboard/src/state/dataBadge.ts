// The words in the top-bar badge. Grok is named whenever the backend is on Grok, including
// before the first results arrive. "Simulated agents" is only for a backend that is actually simulated.

export interface BadgeInput {
  searching: boolean;
  sampleFeed: boolean;
  status: 'connecting' | 'connected' | 'offline';
  usingLive: boolean;
  provider: 'grok' | 'simulated';
}

export function dataBadgeText(input: BadgeInput): { long: string; short: string } {
  if (input.searching) return input.provider === 'grok' ? { long: 'Grok is searching…', short: 'Grok' } : { long: 'Agents searching…', short: 'Searching' };
  if (input.sampleFeed && input.status !== 'connected') return { long: 'Sample postings', short: 'Samples' };
  if (input.status === 'offline') return { long: 'Agents offline', short: 'Offline' };
  if (input.status === 'connecting') return { long: 'Connecting…', short: 'Connecting' };
  if (input.provider === 'grok') return input.usingLive ? { long: 'Live · Grok', short: 'Grok' } : { long: 'Grok · no results yet', short: 'Grok' };
  if (!input.usingLive) return { long: 'No results yet', short: 'Empty' };
  return { long: 'Simulated agents', short: 'Simulated' };
}
