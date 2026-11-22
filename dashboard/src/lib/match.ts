// The match score as the pages show it, and the student's minimum match.
import type { MatchFactor, Opportunity } from '../types.ts';

/** Kept when the match is at or above this, unless the student sets their own. Same as the backend. */
export const DEFAULT_MATCH_THRESHOLD = 30;

export const FACTOR_LABEL: Record<MatchFactor, string> = {
  notes: 'Your notes',
  interests: 'Interests',
  roles: 'Target roles',
  category: 'Kind of opportunity',
  location: 'Location or remote',
  year: 'Class year',
  skills: 'Skills',
};

/** The agents' match for a card, 0 to 100: its match score, or for older cards the fit score. */
export function matchPercent(o: Pick<Opportunity, 'match' | 'baseScore'>): number {
  const raw = o.match ? o.match.score : o.baseScore * 100;
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(raw) ? raw : 0)));
}

/** A word for how strong a match is, and the chip tint it gets. */
export function matchLevel(score: number): { label: string; tint: string } {
  if (score >= 75) return { label: 'Strong match', tint: 'bg-emerald-50 text-emerald-700' };
  if (score >= 50) return { label: 'Good match', tint: 'bg-blue-50 text-blue-700' };
  return { label: 'Partial match', tint: 'bg-slate-50 text-slate-700' };
}

/** A minimum match typed or slid by the student, as a whole percent from 0 to 100. */
export function cleanThreshold(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : DEFAULT_MATCH_THRESHOLD;
}

/** One line on what the minimum does, for the setting. */
export function thresholdLine(threshold: number): string {
  if (threshold === 0) return 'Every posting that passes the checks reaches your feed, however weak the match.';
  if (threshold >= 90) return `Only postings matching at least ${threshold}% of what you asked for. Expect very few.`;
  return `Postings matching at least ${threshold}% of what you asked for reach your feed. Lower it to see more, raise it to see fewer.`;
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;

/** The saved minimum match from the preferences endpoint, or null when it could not be read. */
export async function loadThreshold(request: Request): Promise<number | null> {
  const res = await request('/preferences').catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { matchThreshold?: unknown };
  return typeof body.matchThreshold === 'number' ? cleanThreshold(body.matchThreshold) : DEFAULT_MATCH_THRESHOLD;
}

/**
 * Save the minimum match when it changed from what was loaded. True when nothing needed saving or
 * the save went through. Nothing is sent when the saved value never loaded, so a default never
 * overwrites what the student set.
 */
export async function saveThreshold(request: Request, value: number, saved: number | null): Promise<boolean> {
  if (saved === null || value === saved) return true;
  const res = await request('/preferences', { method: 'PUT', body: JSON.stringify({ matchThreshold: cleanThreshold(value) }) }).catch(() => null);
  return Boolean(res?.ok);
}
