// Asks the backend to read the résumé that was just uploaded.

import { isResumeProfile, type ResumeProfile } from './types.ts';

export interface ResumeReading {
  extraction: ResumeProfile;
  provider: string;
}

/** Reads the uploaded résumé. Throws the server's message when the reading fails. */
export async function readResumeProfile(apiUrl: string, student: 'me' | 'demo', token: string | null): Promise<ResumeReading> {
  const res = await fetch(`${apiUrl}/api/students/${student}/resume/extract`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = (await res.json().catch(() => ({}))) as { extraction?: unknown; provider?: unknown; error?: unknown };
  if (!res.ok || !isResumeProfile(body.extraction)) {
    throw new Error(typeof body.error === 'string' ? body.error : 'The résumé could not be read. Try again.');
  }
  return { extraction: body.extraction, provider: typeof body.provider === 'string' ? body.provider : 'simulated' };
}
