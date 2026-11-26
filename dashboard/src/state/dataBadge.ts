// The words in the top-bar badge. A connected model is named whenever the backend is on it,
// including before the first results arrive. "Simulated agents" is only for a backend that is actually simulated.
import { modelName } from '../lib/modelName.ts';

export interface BadgeInput {
  searching: boolean;
  status: 'connecting' | 'connected' | 'offline';
  usingLive: boolean;
  provider: 'grok' | 'claude' | 'gpt' | 'simulated';
  /** The last search failed because the Grok usage balance ran out. */
  outOfCredit?: boolean;
}

/** The backend's reason for a search that ran out of Grok credit. */
export const isOutOfCredit = (error: string | null | undefined) => /usage balance exhausted/i.test(error ?? '');

export function dataBadgeText(input: BadgeInput): { long: string; short: string } {
  const named = modelName(input.provider);
  if (input.searching) return named ? { long: `${named} is searching…`, short: named } : { long: 'Agents searching…', short: 'Searching' };
  if (input.outOfCredit && input.status === 'connected') return { long: 'Grok balance used up', short: 'No credit' };
  if (input.status === 'offline') return { long: 'Agents offline', short: 'Offline' };
  if (input.status === 'connecting') return { long: 'Connecting…', short: 'Connecting' };
  if (named) return input.usingLive ? { long: `Live · ${named}`, short: named } : { long: `${named} · no results yet`, short: named };
  if (!input.usingLive) return { long: 'No results yet', short: 'Empty' };
  return { long: 'Simulated agents', short: 'Simulated' };
}
