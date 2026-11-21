// Reads a résumé into the profile fields the app stores. Live Grok (the API or the CLI, whichever
// grok.ts is using) fills the schema. With no Grok connection, a deterministic reader does, so
// tests and offline runs still return the same shape. A field the résumé does not state comes
// back empty. Nothing here is guessed.
import { z } from 'zod';
import { config, provider } from './config.ts';
import { grokJson, type GrokResult } from './grok.ts';

const confidence = z.number().min(0).max(1);

const textFact = z.object({
  found: z.boolean(),
  value: z.string().nullable(),
  confidence,
});

const listFact = z.object({
  found: z.boolean(),
  value: z.array(z.string()),
  confidence,
});

const entryFact = z.object({
  kind: z.string(),
  role: z.string(),
  organization: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  current: z.boolean(),
  summary: z.string(),
  skills: z.array(z.string()),
  link: z.string(),
  confidence,
});

const entriesFact = z.object({
  found: z.boolean(),
  value: z.array(entryFact),
  confidence,
});

/** What the agent must return. Every key is required so a missing fact is explicit. */
export const ResumeProfileSchema = z.object({
  fullName: textFact,
  email: textFact,
  phone: textFact,
  school: textFact,
  major: textFact,
  /** Freshman, Sophomore, Junior, Senior, or Graduate student. */
  year: textFact,
  graduation: textFact,
  gpa: textFact,
  location: textFact,
  about: textFact,
  skills: listFact,
  interests: listFact,
  targetRoles: listFact,
  careerInterests: listFact,
  linkedin: textFact,
  links: listFact,
  experience: entriesFact,
  projects: entriesFact,
});

export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;
export type ResumeEntry = z.infer<typeof entryFact>;
type TextFact = z.infer<typeof textFact>;
type ListFact = z.infer<typeof listFact>;

export type ResumeProvider = 'grok' | 'simulated';

export interface ResumeExtraction {
  extraction: ResumeProfile;
  provider: ResumeProvider;
}

const CLASS_YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate student'] as const;

const YEAR_WORDS: Record<string, (typeof CLASS_YEARS)[number]> = {
  freshman: 'Freshman',
  'first year': 'Freshman',
  'first-year': 'Freshman',
  '1st year': 'Freshman',
  sophomore: 'Sophomore',
  'second year': 'Sophomore',
  '2nd year': 'Sophomore',
  junior: 'Junior',
  'third year': 'Junior',
  '3rd year': 'Junior',
  senior: 'Senior',
  'fourth year': 'Senior',
  '4th year': 'Senior',
  'graduate student': 'Graduate student',
  graduate: 'Graduate student',
  masters: 'Graduate student',
  "master's": 'Graduate student',
};

const KINDS = ['Internship', 'Job', 'Research', 'Project', 'Club or leadership', 'Volunteering', 'Competition or hackathon', 'Teaching or tutoring', 'Other'];

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

const noneText = (): TextFact => ({ found: false, value: null, confidence: 0 });
const noneList = (): ListFact => ({ found: false, value: [], confidence: 0 });
const noneEntries = (): ResumeProfile['experience'] => ({ found: false, value: [], confidence: 0 });

export function emptyResume(): ResumeProfile {
  return {
    fullName: noneText(),
    email: noneText(),
    phone: noneText(),
    school: noneText(),
    major: noneText(),
    year: noneText(),
    graduation: noneText(),
    gpa: noneText(),
    location: noneText(),
    about: noneText(),
    skills: noneList(),
    interests: noneList(),
    targetRoles: noneList(),
    careerInterests: noneList(),
    linkedin: noneText(),
    links: noneList(),
    experience: noneEntries(),
    projects: noneEntries(),
  };
}

const clamp = (n: number) => {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
};

const short = (value: string | null, max: number): string | null => {
  if (!value) return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
};

function cleanYear(value: string | null): string | null {
  if (!value) return null;
  const lead = value.trim().toLowerCase().split(/[,.(]/)[0]?.trim() ?? '';
  return YEAR_WORDS[lead] ?? null;
}

function cleanEmail(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 120 ? text : null;
}

function cleanPhone(value: string | null): string | null {
  const text = value?.trim() ?? '';
  const digits = text.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 && text.length <= 40 ? text : null;
}

function cleanGpa(value: string | null): string | null {
  const match = value?.trim().match(/^(\d(?:\.\d{1,2})?)(?:\s*\/\s*\d(?:\.\d{1,2})?)?$/);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return n >= 0 && n <= 5 ? match[1] : null;
}

function cleanGraduation(value: string | null): string | null {
  const text = short(value, 40);
  return text && /\b(19|20)\d{2}\b/.test(text) ? text : null;
}

function cleanLinkedin(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return /linkedin\.com\//i.test(text) && text.length <= 200 && !/\s/.test(text) ? text : null;
}

function cleanLink(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 200 || /\s/.test(text)) return null;
  if (/^https?:\/\//i.test(text) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(text)) return text;
  return null;
}

/** "Jun 2025" or "2025-06" becomes "2025-06". A year alone is not a month. */
export function parseMonthYear(value: string): string {
  const text = value.trim();
  const iso = text.match(/\b((?:19|20)\d{2})-(\d{2})\b/);
  if (iso?.[1] && iso[2] && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return `${iso[1]}-${iso[2]}`;
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+((?:19|20)\d{2})\b/i);
  const month = named?.[1]?.slice(0, 3).toLowerCase();
  return named?.[2] && month && MONTHS[month] ? `${named[2]}-${MONTHS[month]}` : '';
}

function cleanKind(value: string): string {
  const text = value.trim().toLowerCase();
  if (!text) return '';
  const exact = KINDS.find((kind) => kind.toLowerCase() === text);
  if (exact) return exact;
  if (/intern/.test(text)) return 'Internship';
  if (/research/.test(text)) return 'Research';
  if (/hackathon|competition/.test(text)) return 'Competition or hackathon';
  if (/project/.test(text)) return 'Project';
  if (/club|leader/.test(text)) return 'Club or leadership';
  if (/volunt/.test(text)) return 'Volunteering';
  if (/teach|tutor/.test(text)) return 'Teaching or tutoring';
  if (/^jobs?$|employment/.test(text)) return 'Job';
  return '';
}

const asText = (value: string | null, confidence: number, clean: (value: string | null) => string | null): TextFact => {
  if (!value?.trim()) return noneText();
  const kept = clean(value);
  if (!kept) return noneText();
  const score = clamp(confidence);
  return { found: true, value: kept, confidence: score > 0 ? score : 0.5 };
};

function asList(value: string[], confidence: number, max: number, clean: (value: string) => string | null = (item) => short(item, 60)): ListFact {
  const items: string[] = [];
  for (const raw of value) {
    const item = clean(raw);
    if (item && !items.some((have) => have.toLowerCase() === item.toLowerCase())) items.push(item);
    if (items.length >= max) break;
  }
  if (!items.length) return noneList();
  const score = clamp(confidence);
  return { found: true, value: items, confidence: score > 0 ? score : 0.5 };
}

function asEntries(value: ResumeEntry[], confidence: number): ResumeProfile['experience'] {
  const entries: ResumeEntry[] = [];
  for (const raw of value.slice(0, 20)) {
    const role = short(raw.role, 100) ?? '';
    const organization = short(raw.organization, 100) ?? '';
    const summary = short(raw.summary, 1500) ?? '';
    if (!role && !organization && !summary) continue;
    const score = clamp(raw.confidence);
    entries.push({
      kind: cleanKind(raw.kind) || (/\bintern\b/i.test(role) ? 'Internship' : ''),
      role,
      organization,
      location: short(raw.location, 100) ?? '',
      start: parseMonthYear(raw.start),
      end: raw.current ? '' : parseMonthYear(raw.end),
      current: raw.current === true,
      summary,
      skills: asList(raw.skills ?? [], 1, 12).value,
      link: cleanLink(raw.link) ?? '',
      confidence: score > 0 ? score : 0.5,
    });
  }
  if (!entries.length) return noneEntries();
  const score = clamp(confidence);
  return { found: true, value: entries, confidence: score > 0 ? score : Math.min(...entries.map((entry) => entry.confidence)) };
}

/**
 * Zod has already checked the types. This drops anything the résumé did not actually state:
 * a value marked not found is cleared, and a value that is not the kind of fact it claims to
 * be (a GPA that is a sentence, a class year that is not one) is marked not found.
 */
export function normalizeResume(raw: ResumeProfile): ResumeProfile {
  const text = (fact: TextFact, clean: (value: string | null) => string | null) => (fact.found ? asText(fact.value, fact.confidence, clean) : noneText());
  const list = (fact: ListFact, max: number, clean?: (value: string) => string | null) => (fact.found ? asList(fact.value, fact.confidence, max, clean) : noneList());
  return {
    fullName: text(raw.fullName, (value) => short(value, 80)),
    email: text(raw.email, cleanEmail),
    phone: text(raw.phone, cleanPhone),
    school: text(raw.school, (value) => short(value, 80)),
    major: text(raw.major, (value) => short(value, 80)),
    year: text(raw.year, cleanYear),
    graduation: text(raw.graduation, cleanGraduation),
    gpa: text(raw.gpa, cleanGpa),
    location: text(raw.location, (value) => short(value, 80)),
    about: text(raw.about, (value) => short(value, 500)),
    skills: list(raw.skills, 12),
    interests: list(raw.interests, 12),
    targetRoles: list(raw.targetRoles, 12),
    careerInterests: list(raw.careerInterests, 12),
    linkedin: text(raw.linkedin, cleanLinkedin),
    links: list(raw.links, 8, cleanLink),
    experience: raw.experience.found ? asEntries(raw.experience.value, raw.experience.confidence) : noneEntries(),
    projects: raw.projects.found ? asEntries(raw.projects.value, raw.projects.confidence) : noneEntries(),
  };
}

const SYSTEM = `You extract a student profile from one résumé. Copy only facts the résumé states.

For every field return found, value, and confidence.
- found is false when the résumé does not state that fact. Then value is null for a single value, or an empty list, and confidence is 0.
- Do not guess. Do not infer a class year from a graduation date, a school from an email domain, a skill that is not written down, or a phone number from an id.
- confidence is a number from 0 to 1 for how clearly the résumé states the value. Use below 0.75 when the wording is ambiguous.
- year is exactly Freshman, Sophomore, Junior, Senior, or Graduate student, or null.
- graduation keeps the résumé's own wording when it includes a year, such as "May 2028".
- gpa is the number only, such as "3.7", or null.
- start and end are YYYY-MM when a month is given, otherwise an empty string. current is true only when the résumé says the role is ongoing.
- experience is jobs, internships, research, clubs, and volunteering. projects are projects, hackathons, and class builds. Do not put the same item in both.
- A line like "Campus Eats — Personal project" is the role, then the organization. The sentences under it go in summary.
- targetRoles are roles the student wants, not roles they already hold.
- kind is Internship, Job, Research, Project, Club or leadership, Volunteering, Competition or hackathon, Teaching or tutoring, Other, or an empty string.`;

type Ask = (opts: { name: string; system: string; user: string; schema: typeof ResumeProfileSchema; model?: string; timeoutMs?: number }) => Promise<GrokResult<ResumeProfile>>;

/**
 * Live Grok when `live` is true (or when this process's provider is Grok and `live` is omitted).
 * Otherwise the simulated reader. `ask` replaces the Grok call in tests.
 */
export async function extractResumeProfile(text: string, opts: { live?: boolean; ask?: Ask } = {}): Promise<ResumeExtraction> {
  const live = opts.live ?? provider() === 'grok';
  if (!live) return { extraction: simulateResume(text), provider: 'simulated' };
  const ask = opts.ask ?? grokJson;
  const model = config.grokTransport === 'cli' ? config.grokCli.models.normal : config.xaiModels.normal;
  const timeoutMs = config.grokTransport === 'cli' ? config.grokCli.timeoutMs : config.grokTimeoutMs;
  const { data } = await ask({
    name: 'resume_profile',
    model,
    timeoutMs,
    schema: ResumeProfileSchema,
    system: SYSTEM,
    user: `Résumé:\n"""${text.slice(0, 20_000)}"""`,
  });
  return { extraction: normalizeResume(ResumeProfileSchema.parse(data)), provider: 'grok' };
}

// --- Simulated reader. Labels and section headings only. No inference. -----------------------

type Section = 'header' | 'experience' | 'projects' | 'education' | 'skills' | 'links';

const SECTION_OF: Record<string, Section> = {
  experience: 'experience',
  'work experience': 'experience',
  'professional experience': 'experience',
  employment: 'experience',
  'work history': 'experience',
  projects: 'projects',
  'personal projects': 'projects',
  'selected projects': 'projects',
  project: 'projects',
  education: 'education',
  skills: 'skills',
  links: 'links',
  contact: 'links',
};

const LABEL_OF: Record<string, keyof ResumeProfile | 'type' | 'entrySkills' | 'entryLink'> = {
  name: 'fullName',
  'full name': 'fullName',
  email: 'email',
  'e-mail': 'email',
  phone: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  school: 'school',
  university: 'school',
  college: 'school',
  major: 'major',
  'field of study': 'major',
  'class year': 'year',
  year: 'year',
  graduation: 'graduation',
  'graduation date': 'graduation',
  'expected graduation': 'graduation',
  gpa: 'gpa',
  location: 'location',
  'based in': 'location',
  about: 'about',
  summary: 'about',
  skills: 'skills',
  interests: 'interests',
  'target roles': 'targetRoles',
  'target role': 'targetRoles',
  roles: 'targetRoles',
  'career interests': 'careerInterests',
  careers: 'careerInterests',
  linkedin: 'linkedin',
  github: 'links',
  portfolio: 'links',
  website: 'links',
  link: 'entryLink',
  links: 'links',
  type: 'type',
};

interface OpenEntry {
  kind: string;
  role: string;
  organization: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  summary: string[];
  skills: string[];
  link: string;
  confidence: number;
}

const splitList = (value: string) => value.split(/\s*[,;·|]\s*/).map((item) => item.trim()).filter(Boolean);

const looksLikeName = (line: string) => {
  const words = line.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 4 && line.length <= 40 && !/[@\d]/.test(line) && words.every((word) => /^[A-Z][A-Za-z'’.-]+$/.test(word));
};

const sectionOf = (line: string): Section | null => SECTION_OF[line.trim().toLowerCase().replace(/:$/, '').replace(/\s+/g, ' ')] ?? null;

const isRange = (line: string) => /\b(present|current|now)\b/i.test(line) || Boolean(parseMonthYear(line));

function rangeOf(line: string): { start: string; end: string; current: boolean } | null {
  if (!isRange(line)) return null;
  const current = /\b(present|current|now)\b/i.test(line);
  const parts = line.split(/\s+(?:–|—|to|-)\s+/i);
  const start = parseMonthYear(parts[0] ?? line);
  const end = current ? '' : parseMonthYear(parts[1] ?? '');
  if (!start && !end && !current) return null;
  return { start, end, current };
}

function metaOf(line: string): { location: string; range: string } | null {
  const parts = line.split(/\s*[·•|]\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const range = parts.find((part) => rangeOf(part));
    if (!range) return null;
    return { location: parts.filter((part) => part !== range).join(', '), range };
  }
  return rangeOf(line) ? { location: '', range: line } : null;
}

function finish(entry: OpenEntry): ResumeEntry {
  return {
    kind: entry.kind,
    role: entry.role,
    organization: entry.organization,
    location: entry.location,
    start: entry.start,
    end: entry.current ? '' : entry.end,
    current: entry.current,
    summary: entry.summary.join('\n').trim(),
    skills: entry.skills,
    link: entry.link,
    confidence: entry.confidence,
  };
}

/** The offline reader. The same résumé always produces the same profile. */
export function simulateResume(text: string): ResumeProfile {
  const out = emptyResume();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headerEnd = lines.findIndex((line) => sectionOf(line));
  const header = lines.slice(0, headerEnd < 0 ? lines.length : headerEnd);
  const first = header.map((line) => line.trim()).find(Boolean) ?? '';
  if (looksLikeName(first) && header.some((line) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(line))) {
    out.fullName = { found: true, value: first, confidence: 0.7 };
  }

  let section: Section = 'header';
  // A box, not a `let`, so assignments inside the helpers are not narrowed to `null`.
  const cursor: { entry: OpenEntry | null } = { entry: null };
  let bucket: ResumeEntry[] = [];

  // A later reading replaces an earlier one only when it is the more explicit of the two.
  const putText = (key: 'fullName' | 'email' | 'phone' | 'school' | 'major' | 'year' | 'graduation' | 'gpa' | 'location' | 'about' | 'linkedin', value: string, score: number) => {
    if (out[key].found && out[key].confidence >= score) return;
    out[key] = { found: true, value, confidence: score };
  };
  const putList = (key: 'skills' | 'interests' | 'targetRoles' | 'careerInterests' | 'links', items: string[], score: number) => {
    const have = out[key].value;
    const next = [...have];
    for (const item of items) {
      if (item && !next.some((own) => own.toLowerCase() === item.toLowerCase())) next.push(item);
    }
    if (next.length) out[key] = { found: true, value: next, confidence: out[key].found ? Math.min(out[key].confidence, score) : score };
  };
  const storeBucket = (from: Section) => {
    if (from !== 'experience' && from !== 'projects') return;
    const fact = bucket.length ? { found: true, value: bucket, confidence: Math.min(...bucket.map((item) => item.confidence)) } : noneEntries();
    if (from === 'experience') out.experience = fact;
    else out.projects = fact;
    bucket = [];
  };
  const closeEntry = () => {
    if (!cursor.entry) return;
    bucket.push(finish(cursor.entry));
    cursor.entry = null;
  };
  const openEntry = (role: string, organization: string) => {
    closeEntry();
    cursor.entry = { kind: section === 'projects' ? 'Project' : '', role, organization, location: '', start: '', end: '', current: false, summary: [], skills: [], link: '', confidence: organization ? 0.86 : 0.7 };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const nextSection = line ? sectionOf(line) : null;
    if (nextSection) {
      closeEntry();
      storeBucket(section);
      section = nextSection;
      continue;
    }
    if (!line) {
      closeEntry();
      continue;
    }

    const labeled = line.match(/^([A-Za-z][A-Za-z /'-]{0,40}):\s*(.+)$/);
    const label = labeled?.[1]?.trim().toLowerCase().replace(/\s+/g, ' ');
    const labeledValue = labeled?.[2]?.trim() ?? '';
    const field = label ? LABEL_OF[label] : undefined;

    if (cursor.entry && field === 'entrySkills') {
      cursor.entry.skills.push(...splitList(labeledValue));
      continue;
    }
    if (cursor.entry && field === 'entryLink') {
      cursor.entry.link = labeledValue;
      continue;
    }
    if (cursor.entry && field === 'type') {
      cursor.entry.kind = labeledValue;
      continue;
    }
    // "Skills:" inside an experience block belongs to that role, not the profile.
    if (cursor.entry && field === 'skills') {
      cursor.entry.skills.push(...splitList(labeledValue));
      continue;
    }
    if (cursor.entry && field === 'location') {
      cursor.entry.location = labeledValue;
      continue;
    }
    if (cursor.entry && field === 'about') {
      cursor.entry.summary.push(labeledValue);
      continue;
    }
    if (field && field !== 'type' && field !== 'entryLink' && field !== 'entrySkills') {
      if (field === 'skills' || field === 'interests' || field === 'targetRoles' || field === 'careerInterests' || field === 'links') putList(field, splitList(labeledValue), 0.95);
      else if (field !== 'experience' && field !== 'projects') putText(field, labeledValue, 0.95);
      continue;
    }

    if (section === 'skills') {
      putList('skills', splitList(line.replace(/^[-•]\s*/, '')), 0.9);
      continue;
    }
    if (section === 'links') {
      if (/linkedin\.com\//i.test(line) && !/\s/.test(line)) putText('linkedin', line, 0.9);
      else putList('links', [line], 0.9);
      continue;
    }
    if (section === 'header' || section === 'education') {
      if (section === 'header' && /@/.test(line) && line.length <= 160) {
        for (const part of line.split(/\s*[·•|]\s*/)) {
          const bit = part.trim();
          if (/@/.test(bit)) putText('email', bit, 0.84);
          else if (cleanPhone(bit)) putText('phone', bit, 0.72);
          else if (bit && !out.location.found && bit.length <= 40) putText('location', bit, 0.72);
        }
      }
      continue;
    }

    const meta = metaOf(line);
    if (cursor.entry && meta && !cursor.entry.start && !cursor.entry.end && !cursor.entry.current) {
      const range = rangeOf(meta.range);
      if (range) {
        cursor.entry.location = cursor.entry.location || meta.location;
        cursor.entry.start = range.start;
        cursor.entry.end = range.end;
        cursor.entry.current = range.current;
        continue;
      }
    }
    const headed = line.split(/\s+[–—]\s+|\s+-\s+/);
    if (headed.length >= 2 && headed[0] && headed[1] && !isRange(line)) {
      openEntry(headed[0].trim(), headed[1].trim());
      continue;
    }
    // A date with no role under it is not an experience.
    if (isRange(line)) continue;
    if (!cursor.entry) openEntry(line, '');
    else cursor.entry.summary.push(line);
  }
  closeEntry();
  storeBucket(section);
  return normalizeResume(out);
}
