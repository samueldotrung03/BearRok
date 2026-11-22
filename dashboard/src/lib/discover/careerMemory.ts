// The careers a student keeps in their career interests: the list the opportunity agents read and
// the roadmap ranks first. A career is added only when the student says so ("Add to my career
// interests" on its guide), and names of the same career count once ("AI Engineer" is "AI
// Engineering"). Each helper returns null when nothing would change.
import { careerKey, keysOf } from './names.ts';

const MAX = 12;

export function withCareerInterest(current: string[] | undefined, career: string): string[] | null {
  const title = career.trim().slice(0, 60);
  if (title.length < 2 || !careerKey(title)) return null;
  const list = current ?? [];
  if (list.some((item) => careerKey(item) === careerKey(title))) return null;
  return [...list, title].slice(-MAX);
}

export function withoutCareerInterest(current: string[] | undefined, guide: { slug: string; query?: string; title: string; aliases?: string[] }): string[] | null {
  const list = current ?? [];
  const keys = keysOf(guide);
  const next = list.filter((item) => !keys.includes(careerKey(item)));
  return next.length === list.length ? null : next;
}

/** True when one of the student's career interests names this guide's career. */
export function inCareerInterests(current: string[] | undefined, guide: { slug: string; query?: string; title: string; aliases?: string[] }): boolean {
  const keys = keysOf(guide);
  return (current ?? []).some((item) => keys.includes(careerKey(item)));
}
