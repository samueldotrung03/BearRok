// The match score: how well one posting fits one student, 0 to 100, with a short breakdown.
// The criteria reviewer gives it; the student's minimum match decides what reaches the feed.
// Whether a posting is real, open and linked is not part of the score: hardCheck drops those
// whatever they score.
import type { Candidate } from './types.ts';

/** What a match is judged on, in the order the breakdown lists them. */
export const MATCH_FACTORS = ['notes', 'interests', 'roles', 'category', 'location', 'year', 'skills'] as const;
export type MatchFactor = (typeof MATCH_FACTORS)[number];

export const FACTOR_LABEL: Record<MatchFactor, string> = {
  notes: 'Your notes',
  interests: 'Interests',
  roles: 'Target roles',
  category: 'Kind of opportunity',
  location: 'Location or remote',
  year: 'Class year',
  skills: 'Skills',
};

/** How much each factor counts when the overall score has to be worked out from the breakdown. */
const WEIGHT: Record<MatchFactor, number> = { notes: 3, interests: 2, roles: 2, category: 1, location: 1, year: 1, skills: 1 };

export interface MatchPart {
  factor: MatchFactor;
  /** 0 to 100. */
  score: number;
  /** A few words on why, from the reviewer. */
  note: string;
}

export interface Match {
  /** 0 to 100, a whole number. */
  score: number;
  factors: MatchPart[];
  /** One line on why it scored this. */
  reason: string;
}

/** Kept when the match is at or above this, unless the student sets their own. */
export const DEFAULT_MATCH_THRESHOLD = 30;

/** A whole percent from 0 to 100, or `fallback` when the value is not a number. */
export function clampPercent(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * A minimum match the student sent, as a whole percent from 0 to 100, or null when it is not one
 * (not a number, or outside 0 to 100). A fraction is rounded.
 */
export function cleanThreshold(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n >= 0 && n <= 100 ? n : null;
}

/** The minimum match in force: the student's own, or the default. */
export function thresholdOf(profile: { matchThreshold?: number | null }): number {
  return cleanThreshold(profile.matchThreshold) ?? DEFAULT_MATCH_THRESHOLD;
}

/** Kept when the match is at or above the minimum. */
export const meetsThreshold = (score: number, threshold: number) => score >= threshold;

/** Neutral: what a review that gave no usable score at all counts as, so a glitch never drops a posting quietly. */
const NO_SCORE = 50;

/**
 * The reviewer's answer as a match: scores clamped to whole percents, unknown factors and repeats
 * left out, and an overall score worked out from the factors when the reviewer gave none.
 */
export function normalizeMatch(raw: { score?: unknown; factors?: unknown; reason?: unknown } | null | undefined): Match {
  const seen = new Set<MatchFactor>();
  const factors: MatchPart[] = [];
  for (const f of Array.isArray(raw?.factors) ? raw.factors : []) {
    const factor = typeof f?.factor === 'string' ? (f.factor.trim().toLowerCase() as MatchFactor) : null;
    if (!factor || !MATCH_FACTORS.includes(factor) || seen.has(factor)) continue;
    const score = clampPercent(f.score, NaN);
    if (Number.isNaN(score)) continue;
    seen.add(factor);
    factors.push({ factor, score, note: typeof f.note === 'string' ? f.note.trim().slice(0, 140) : '' });
  }
  factors.sort((a, b) => MATCH_FACTORS.indexOf(a.factor) - MATCH_FACTORS.indexOf(b.factor));
  const weighted = factors.length ? factors.reduce((s, f) => s + WEIGHT[f.factor] * f.score, 0) / factors.reduce((s, f) => s + WEIGHT[f.factor], 0) : NO_SCORE;
  const score = clampPercent(raw?.score, Math.round(weighted));
  const reason = typeof raw?.reason === 'string' && raw.reason.trim() ? raw.reason.trim().split('\n')[0]!.slice(0, 240) : `Matches about ${score}% of what you asked for`;
  return { score, factors, reason };
}

/** A match from an old 0-to-1 fit, for reviews and records from before match scores. */
export function matchFromFit(fit: number, reason: string): Match {
  return { score: clampPercent(fit * 100, NO_SCORE), factors: [], reason };
}

/**
 * Why a posting is dropped whatever it scores, or null when it passes: the status reviewer found it
 * fake or closed, its deadline has passed, or it has no real web link.
 */
export function hardCheck(record: Pick<Candidate, 'sourceUrl' | 'deadline'>, status: { keep: boolean; reason: string } | undefined, now: Date): string | null {
  if (status && !status.keep) return status.reason;
  if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(record.sourceUrl?.trim() ?? '')) return 'No real web link to the posting';
  const due = record.deadline ? Date.parse(record.deadline) : NaN;
  if (!Number.isNaN(due) && due < now.getTime()) return `Expired: the deadline passed on ${new Date(due).toISOString().slice(0, 10)}`;
  return null;
}

/** "Below your minimum match: 24% (minimum 30%)". */
export const belowThresholdReason = (score: number, threshold: number) => `Below your minimum match: ${score}% (minimum ${threshold}%)`;
