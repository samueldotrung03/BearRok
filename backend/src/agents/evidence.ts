// Host checks for a live agent run: the posting page must be there, and a deadline is stored only
// when the quote behind it is actually on that page. Simulated runs never fetch.
import { checkLink } from '../validate.ts';
import type { Candidate } from './types.ts';

const FETCH_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; link-check)', accept: 'text/html,*/*' };

/** Strip tags, drop emoji, collapse whitespace. Used on both the quote and the page. */
export function pageText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.!?])/g, '$1')
    .trim();
}

/** Every sentence of 12 or more characters in the quote must appear in the page text. */
export function quoteSupported(quote: string, body: string): boolean {
  const page = pageText(body);
  const text = pageText(quote);
  if (!text || !page) return false;
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  if (!sentences.length) return page.includes(text);
  return sentences.every((s) => page.includes(s));
}

export type LiveGate = { keep: false; reason: string } | { keep: true; record: Candidate; host: 'ok' | 'blocked' };

const NOT_FOUND = 'The posting page was not found.';

function withoutDeadline(c: Candidate): Candidate {
  return {
    ...c,
    deadline: null,
    deadlineSource: null,
    evidence: c.evidence.filter((e) => e.field !== 'deadline'),
  };
}

async function readPage(url: string, fetchImpl: typeof fetch): Promise<{ status: 'ok' | 'blocked' | 'unreachable'; body: string }> {
  const status = await checkLink(url, fetchImpl);
  // A link that was not checked is handled like a blocked page: the card stays, its deadline unknown.
  if (status !== 'ok') return { status: status === 'skipped' ? 'blocked' : status, body: '' };
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: FETCH_HEADERS });
    return { status: 'ok', body: await res.text() };
  } catch {
    return { status: 'ok', body: '' };
  }
}

/** Open `url` and test whether `quote` is on that page. False when the page cannot be read. */
export async function quoteOnPage(quote: string, url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const page = await readPage(url, fetchImpl);
  if (page.status !== 'ok') return false;
  return quoteSupported(quote, page.body);
}

/**
 * Before a live card is kept: unreachable pages are dropped; blocked pages stay with an unknown
 * deadline; an ok page is fetched and a deadline is kept only when its quote is on that page.
 */
export async function gateLiveCard(candidate: Candidate, fetchImpl: typeof fetch = fetch): Promise<LiveGate> {
  const page = await readPage(candidate.sourceUrl, fetchImpl);
  if (page.status === 'unreachable') return { keep: false, reason: NOT_FOUND };
  if (page.status === 'blocked') return { keep: true, record: withoutDeadline(candidate), host: 'blocked' };
  if (!candidate.deadline) return { keep: true, record: candidate, host: 'ok' };
  const quote = candidate.evidence.find((e) => e.field === 'deadline')?.quote ?? '';
  if (quoteSupported(quote, page.body)) return { keep: true, record: candidate, host: 'ok' };
  return { keep: true, record: withoutDeadline(candidate), host: 'ok' };
}
