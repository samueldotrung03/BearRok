// One guide per career, whatever words the student types. "AI Engineering", "AI Engineer" and
// "ai engineering" are the same career, so they share one key. The key is only for matching; a
// guide keeps the slug it was first researched under, and every name it was asked by is an alias.
// The dashboard has a copy of careerKey (dashboard/src/lib/discover/names.ts); both are tested on
// the same cases.

/** The last word of a career name, folded to the name of the person who does the job. */
const ROLE_WORDS: Record<string, string> = {
  engineering: 'engineer',
  engineers: 'engineer',
  development: 'developer',
  developers: 'developer',
  science: 'scientist',
  sciences: 'scientist',
  scientists: 'scientist',
  analytics: 'analyst',
  analysis: 'analyst',
  analysts: 'analyst',
  design: 'designer',
  designers: 'designer',
  management: 'manager',
  managers: 'manager',
  nursing: 'nurse',
  nurses: 'nurse',
  accounting: 'accountant',
  accountants: 'accountant',
  economics: 'economist',
  economists: 'economist',
  research: 'researcher',
  researchers: 'researcher',
  teaching: 'teacher',
  teachers: 'teacher',
  consulting: 'consultant',
  consultants: 'consultant',
  architecture: 'architect',
  architects: 'architect',
  marketing: 'marketer',
  marketers: 'marketer',
  law: 'lawyer',
  lawyers: 'lawyer',
  medicine: 'doctor',
  doctors: 'doctor',
  physicians: 'physician',
  programming: 'programmer',
  programmers: 'programmer',
  writing: 'writer',
  writers: 'writer',
  photography: 'photographer',
  photographers: 'photographer',
};

/** Words that say nothing about which career it is. */
const FILLER = new Set(['a', 'an', 'the', 'career', 'careers', 'job', 'jobs', 'role', 'roles', 'in', 'as']);

/** Short forms students type for the same career. */
const SHORT: Record<string, string> = { ml: 'machine learning', swe: 'software engineer' };

/** The key two names of the same career share. Empty when the name has no letters or numbers. */
export function careerKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
    .flatMap((w) => (SHORT[w] ?? w).split(' '));
  if (!words.length) return '';
  const last = words[words.length - 1]!;
  words[words.length - 1] = ROLE_WORDS[last] ?? last;
  return words.join('-').slice(0, 60);
}

/** The slug a new guide is kept under: the words typed, made safe for a URL. */
export function slugFor(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Every key a guide answers to: its slug, the words it was first asked by, its title, and its aliases. */
export function keysOf(g: { slug: string; query: string; title: string; aliases?: string[] }): string[] {
  return [...new Set([g.slug, g.query, g.title, ...(g.aliases ?? [])].map(careerKey).filter(Boolean))];
}
