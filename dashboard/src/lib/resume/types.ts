// The profile read from a résumé. Same shape as backend/src/resumeExtract.ts.
// A fact the résumé did not state has found: false and an empty value.

export interface TextFact {
  found: boolean;
  value: string | null;
  confidence: number;
}

export interface ListFact {
  found: boolean;
  value: string[];
  confidence: number;
}

export interface EntryFact {
  kind: string;
  role: string;
  organization: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  summary: string;
  skills: string[];
  link: string;
  confidence: number;
}

export interface EntryListFact {
  found: boolean;
  value: EntryFact[];
  confidence: number;
}

export interface ResumeProfile {
  fullName: TextFact;
  email: TextFact;
  phone: TextFact;
  school: TextFact;
  major: TextFact;
  year: TextFact;
  graduation: TextFact;
  gpa: TextFact;
  location: TextFact;
  about: TextFact;
  skills: ListFact;
  interests: ListFact;
  targetRoles: ListFact;
  careerInterests: ListFact;
  linkedin: TextFact;
  links: ListFact;
  experience: EntryListFact;
  projects: EntryListFact;
}

const TEXT_KEYS = ['fullName', 'email', 'phone', 'school', 'major', 'year', 'graduation', 'gpa', 'location', 'about', 'linkedin'] as const;
const LIST_KEYS = ['skills', 'interests', 'targetRoles', 'careerInterests', 'links'] as const;

const isText = (value: unknown): value is TextFact => {
  if (!value || typeof value !== 'object') return false;
  const fact = value as TextFact;
  return typeof fact.found === 'boolean' && (typeof fact.value === 'string' || fact.value === null) && typeof fact.confidence === 'number';
};

const isList = (value: unknown): value is ListFact => {
  if (!value || typeof value !== 'object') return false;
  const fact = value as ListFact;
  return typeof fact.found === 'boolean' && Array.isArray(fact.value) && fact.value.every((item) => typeof item === 'string') && typeof fact.confidence === 'number';
};

const isEntry = (value: unknown): value is EntryFact => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as EntryFact;
  return typeof entry.role === 'string' && typeof entry.organization === 'string' && typeof entry.summary === 'string' && typeof entry.confidence === 'number' && Array.isArray(entry.skills);
};

const isEntries = (value: unknown): value is EntryListFact => {
  if (!value || typeof value !== 'object') return false;
  const fact = value as EntryListFact;
  return typeof fact.found === 'boolean' && Array.isArray(fact.value) && fact.value.every(isEntry) && typeof fact.confidence === 'number';
};

/** True when a response has every profile fact the confirmation steps expect. */
export function isResumeProfile(value: unknown): value is ResumeProfile {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return TEXT_KEYS.every((key) => isText(record[key])) && LIST_KEYS.every((key) => isList(record[key])) && isEntries(record.experience) && isEntries(record.projects);
}
