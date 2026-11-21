// Confirms a résumé reading before anything is written onto the profile.
// Each step is accepted or skipped. Nothing is saved until the summary.

import type { ExperienceEntry, Preferences } from '../../data/preferences.ts';
import type { ClassYear, Profile } from '../../types.ts';
import type { EntryFact, EntryListFact, ListFact, ResumeProfile, TextFact } from './types.ts';

export const LOW_CONFIDENCE = 0.75;

const CLASS_YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior'] as const;

export type ScalarKey = 'fullName' | 'email' | 'phone' | 'school' | 'location' | 'about' | 'major' | 'year' | 'graduation' | 'gpa' | 'linkedin';
export type ListKey = 'skills' | 'interests' | 'targetRoles' | 'careerInterests' | 'links';
export type BlockKey = 'experience' | 'projects';
export type CompareStatus = 'missing' | 'fill' | 'same' | 'differ';
export type ChoiceSource = 'profile' | 'resume' | 'edit' | null;

export interface DraftEntry {
  id: string;
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

export interface Choice<T> {
  source: ChoiceSource;
  value: T;
}

export interface Snapshot {
  fullName: string;
  email: string;
  phone: string;
  school: string;
  major: string;
  year: string;
  graduation: string;
  gpa: string;
  location: string;
  about: string;
  skills: string[];
  interests: string[];
  targetRoles: string[];
  careerInterests: string[];
  linkedin: string;
  links: string[];
  experience: DraftEntry[];
  projects: DraftEntry[];
}

export interface ReviewContext {
  extraction: ResumeProfile;
  snapshot: Snapshot;
}

interface StepDef {
  id: string;
  title: string;
  scalars: readonly ScalarKey[];
  lists: readonly ListKey[];
  blocks: readonly BlockKey[];
}

export const STEPS: readonly StepDef[] = [
  { id: 'basics', title: 'Basics', scalars: ['fullName', 'email', 'phone', 'school', 'location', 'about'], lists: [], blocks: [] },
  { id: 'education', title: 'Education', scalars: ['major', 'year', 'graduation', 'gpa'], lists: [], blocks: [] },
  { id: 'experience', title: 'Experience', scalars: [], lists: [], blocks: ['experience'] },
  { id: 'projects', title: 'Projects', scalars: [], lists: [], blocks: ['projects'] },
  { id: 'skills', title: 'Skills and interests', scalars: [], lists: ['skills', 'interests', 'targetRoles', 'careerInterests'], blocks: [] },
  { id: 'links', title: 'Links', scalars: ['linkedin'], lists: ['links'], blocks: [] },
];

const SCALAR_LABEL: Record<ScalarKey, string> = {
  fullName: 'Name',
  email: 'Email',
  phone: 'Phone',
  school: 'School',
  location: 'Location',
  about: 'About',
  major: 'Major',
  year: 'Class year',
  graduation: 'Graduation',
  gpa: 'GPA',
  linkedin: 'LinkedIn',
};

const LIST_LABEL: Record<ListKey, string> = {
  skills: 'Skills',
  interests: 'Interests',
  targetRoles: 'Target roles',
  careerInterests: 'Career interests',
  links: 'Links',
};

const BLOCK_LABEL: Record<BlockKey, string> = { experience: 'Experience', projects: 'Projects' };

const SCALAR_STEP: Record<ScalarKey, number> = {
  fullName: 0,
  email: 0,
  phone: 0,
  school: 0,
  location: 0,
  about: 0,
  major: 1,
  year: 1,
  graduation: 1,
  gpa: 1,
  linkedin: 5,
};

const LIST_STEP: Record<ListKey, number> = { skills: 4, interests: 4, targetRoles: 4, careerInterests: 4, links: 5 };
const BLOCK_STEP: Record<BlockKey, number> = { experience: 2, projects: 3 };

const LIST_CAP: Record<ListKey, number> = { skills: 12, interests: 12, targetRoles: 12, careerInterests: 12, links: 8 };
const LIST_ITEM: Record<ListKey, number> = { skills: 80, interests: 80, targetRoles: 80, careerInterests: 60, links: 200 };

export interface ReviewState {
  step: number;
  skipped: boolean[];
  scalars: Record<ScalarKey, Choice<string>>;
  lists: Record<ListKey, Choice<string[]>>;
  blocks: Record<BlockKey, Choice<DraftEntry[]>>;
  discard: boolean;
  closed: boolean;
}

export type ReviewAction =
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'back' }
  | { type: 'escape' }
  | { type: 'confirmDiscard' }
  | { type: 'pickScalar'; key: ScalarKey; source: 'profile' | 'resume' }
  | { type: 'editScalar'; key: ScalarKey; value: string }
  | { type: 'pickList'; key: ListKey; source: 'profile' | 'resume' }
  | { type: 'editList'; key: ListKey; value: string[] }
  | { type: 'pickBlock'; key: BlockKey; source: 'profile' | 'resume' }
  | { type: 'editBlock'; key: BlockKey; value: DraftEntry[] };

export interface ScalarView {
  key: ScalarKey;
  label: string;
  status: CompareStatus;
  profile: string;
  resume: string;
  confidence: number;
  low: boolean;
  resolved: boolean;
  choice: Choice<string>;
}

export interface ListView {
  key: ListKey;
  label: string;
  status: CompareStatus;
  profile: string[];
  resume: string[];
  confidence: number;
  low: boolean;
  resolved: boolean;
  choice: Choice<string[]>;
}

export interface BlockView {
  key: BlockKey;
  label: string;
  status: CompareStatus;
  profile: DraftEntry[];
  resume: DraftEntry[];
  confidence: number;
  low: boolean;
  resolved: boolean;
  choice: Choice<DraftEntry[]>;
}

export interface SummaryLine {
  label: string;
  detail: string;
}

export interface ReviewApply {
  profile: Partial<Profile>;
  preferences: Preferences;
  lines: SummaryLine[];
  /** No accepted step changes the profile, so the caller should not save. */
  empty: boolean;
}

const SCALAR_KEYS = Object.keys(SCALAR_LABEL) as ScalarKey[];
const LIST_KEYS = Object.keys(LIST_LABEL) as ListKey[];
const BLOCK_KEYS: BlockKey[] = ['experience', 'projects'];

/** The profile as it stands when the résumé is read. Later edits on the page do not move the comparison. */
export function snapshotFrom(profile: Profile, prefs: Preferences, signInEmail = ''): Snapshot {
  const answers = prefs.answers ?? {};
  const exp = prefs.experience;
  const toDraft = (entry: ExperienceEntry): DraftEntry => ({
    id: entry.id,
    kind: entry.kind,
    role: entry.role,
    organization: entry.organization,
    location: entry.location,
    start: entry.start,
    end: entry.end,
    current: entry.current,
    summary: entry.summary,
    skills: [...entry.skills],
    link: entry.link,
    confidence: 1,
  });
  return {
    fullName: profile.fullName.trim() || profile.name.trim(),
    email: (answers.email ?? '').trim() || signInEmail.trim(),
    phone: (answers.phone ?? '').trim(),
    school: profile.school.trim(),
    major: profile.major.trim(),
    year: profile.year,
    graduation: (answers.graduationYear ?? '').trim(),
    gpa: (answers.gpa ?? '').trim(),
    location: profile.location.trim(),
    about: profile.about.trim(),
    skills: [...(profile.skills ?? [])],
    interests: [...(profile.interests ?? [])],
    targetRoles: [...(prefs.lists.rolesWanted ?? [])],
    careerInterests: [...(profile.careerInterests ?? [])],
    linkedin: exp.linkedin ?? '',
    links: [...(exp.links ?? [])],
    experience: exp.entries.filter((entry) => entry.kind !== 'Project').map(toDraft),
    projects: exp.entries.filter((entry) => entry.kind === 'Project').map(toDraft),
  };
}

export function initialReview(ctx: ReviewContext): ReviewState {
  const scalars = {} as Record<ScalarKey, Choice<string>>;
  for (const key of SCALAR_KEYS) {
    const resume = resumeScalar(ctx, key).value;
    const status = scalarStatus(ctx.snapshot[key], resume, key);
    scalars[key] = { source: status === 'fill' || status === 'same' ? 'resume' : null, value: resume || ctx.snapshot[key] };
  }
  const lists = {} as Record<ListKey, Choice<string[]>>;
  for (const key of LIST_KEYS) {
    const resume = resumeList(ctx, key).value;
    const status = listStatus(ctx.snapshot[key], resume);
    lists[key] = { source: status === 'fill' || status === 'same' ? 'resume' : null, value: [...(resume.length ? resume : ctx.snapshot[key])] };
  }
  const blocks = {} as Record<BlockKey, Choice<DraftEntry[]>>;
  for (const key of BLOCK_KEYS) {
    const resume = resumeBlock(ctx, key).value;
    const status = blockStatus(ctx.snapshot[key], resume);
    blocks[key] = { source: status === 'fill' || status === 'same' ? 'resume' : null, value: cloneEntries(resume.length ? resume : ctx.snapshot[key]) };
  }
  return { step: 0, skipped: STEPS.map(() => false), scalars, lists, blocks, discard: false, closed: false };
}

export function reviewReducer(state: ReviewState, action: ReviewAction, ctx: ReviewContext): ReviewState {
  if (state.closed) return state;
  switch (action.type) {
    case 'escape':
      return { ...state, discard: !state.discard };
    case 'confirmDiscard':
      return { ...state, discard: false, closed: true };
    case 'back':
      if (state.discard) return { ...state, discard: false };
      return state.step > 0 ? { ...state, step: state.step - 1 } : state;
    case 'skip': {
      if (state.discard || state.step >= STEPS.length) return state;
      return { ...state, step: state.step + 1, skipped: state.skipped.map((skipped, index) => (index === state.step ? true : skipped)) };
    }
    case 'next': {
      if (state.discard || state.step >= STEPS.length || !canAdvance(state, ctx)) return state;
      return { ...state, step: state.step + 1, skipped: state.skipped.map((skipped, index) => (index === state.step ? false : skipped)) };
    }
    case 'pickScalar':
      return {
        ...state,
        scalars: { ...state.scalars, [action.key]: { source: action.source, value: action.source === 'profile' ? ctx.snapshot[action.key] : resumeScalar(ctx, action.key).value } },
      };
    case 'editScalar':
      return { ...state, scalars: { ...state.scalars, [action.key]: { source: 'edit', value: action.value } } };
    case 'pickList':
      return {
        ...state,
        lists: { ...state.lists, [action.key]: { source: action.source, value: [...(action.source === 'profile' ? ctx.snapshot[action.key] : resumeList(ctx, action.key).value)] } },
      };
    case 'editList':
      return { ...state, lists: { ...state.lists, [action.key]: { source: 'edit', value: action.value } } };
    case 'pickBlock':
      return {
        ...state,
        blocks: { ...state.blocks, [action.key]: { source: action.source, value: cloneEntries(action.source === 'profile' ? ctx.snapshot[action.key] : resumeBlock(ctx, action.key).value) } },
      };
    case 'editBlock':
      return { ...state, blocks: { ...state.blocks, [action.key]: { source: 'edit', value: action.value } } };
    default:
      return state;
  }
}

export function canAdvance(state: ReviewState, ctx: ReviewContext): boolean {
  const step = STEPS[state.step];
  if (!step) return true;
  return step.scalars.every((key) => scalarView(state, ctx, key).resolved) && step.lists.every((key) => listView(state, ctx, key).resolved) && step.blocks.every((key) => blockView(state, ctx, key).resolved);
}

export function scalarView(state: ReviewState, ctx: ReviewContext, key: ScalarKey): ScalarView {
  const read = resumeScalar(ctx, key);
  const profile = ctx.snapshot[key];
  const status = scalarStatus(profile, read.value, key);
  const choice = state.scalars[key];
  return {
    key,
    label: SCALAR_LABEL[key],
    status,
    profile,
    resume: read.value,
    confidence: read.confidence,
    low: read.confidence > 0 && read.confidence < LOW_CONFIDENCE && normScalar(key, choice.value) === normScalar(key, read.value) && read.value !== '',
    resolved: status !== 'differ' || choice.source !== null,
    choice,
  };
}

export function listView(state: ReviewState, ctx: ReviewContext, key: ListKey): ListView {
  const read = resumeList(ctx, key);
  const profile = ctx.snapshot[key];
  const status = listStatus(profile, read.value);
  const choice = state.lists[key];
  return {
    key,
    label: LIST_LABEL[key],
    status,
    profile,
    resume: read.value,
    confidence: read.confidence,
    low: read.confidence > 0 && read.confidence < LOW_CONFIDENCE && normList(choice.value) === normList(read.value) && read.value.length > 0,
    resolved: status !== 'differ' || choice.source !== null,
    choice,
  };
}

export function blockView(state: ReviewState, ctx: ReviewContext, key: BlockKey): BlockView {
  const read = resumeBlock(ctx, key);
  const profile = ctx.snapshot[key];
  const status = blockStatus(profile, read.value);
  const choice = state.blocks[key];
  const low = choice.value.some((entry) => entryLow(entry, read.value));
  return {
    key,
    label: BLOCK_LABEL[key],
    status,
    profile,
    resume: read.value,
    confidence: read.confidence,
    low,
    resolved: status !== 'differ' || choice.source !== null,
    choice,
  };
}

/** What the summary will save. Skipped steps and values the user left on the profile are absent. */
export function applyReview(state: ReviewState, ctx: ReviewContext, base: { profile: Profile; preferences: Preferences }): ReviewApply {
  const profile: Partial<Profile> = {};
  const preferences = clonePreferences(base.preferences);
  const lines: SummaryLine[] = [];

  for (const key of SCALAR_KEYS) {
    const written = scalarWrite(state, ctx, key);
    if (written === null) continue;
    if (key === 'fullName') {
      const full = written.slice(0, 80);
      const first = full.split(/\s+/).filter(Boolean)[0] ?? full;
      profile.fullName = full;
      profile.name = first.slice(0, 80);
      lines.push({ label: 'Name', detail: full });
    } else if (key === 'email') {
      preferences.answers.email = written.slice(0, 80);
      lines.push({ label: 'Email', detail: `${written.slice(0, 80)}. This does not change the email you sign in with.` });
    } else if (key === 'phone') {
      preferences.answers.phone = written.slice(0, 80);
      lines.push({ label: 'Phone', detail: written.slice(0, 80) });
    } else if (key === 'gpa') {
      preferences.answers.gpa = written.slice(0, 20);
      lines.push({ label: 'GPA', detail: written.slice(0, 20) });
    } else if (key === 'graduation') {
      preferences.answers.graduationYear = written;
      lines.push({ label: 'Graduation', detail: written });
    } else if (key === 'year') {
      if (written === 'Graduate student') {
        preferences.answers.classYear = written;
        lines.push({ label: 'Class year', detail: `${written}. Saved with your restrictions. Your profile year stays ${base.profile.year}.` });
      } else if (isClassYear(written)) {
        profile.year = written;
        preferences.answers.classYear = written;
        lines.push({ label: 'Class year', detail: written });
      }
    } else if (key === 'linkedin') {
      preferences.experience.linkedin = written.slice(0, 200);
      lines.push({ label: 'LinkedIn', detail: written.slice(0, 200) });
    } else if (key === 'about') {
      profile.about = written.slice(0, 2000);
      lines.push({ label: 'About', detail: written.slice(0, 2000) });
    } else if (key === 'school' || key === 'major' || key === 'location') {
      profile[key] = written.slice(0, 80);
      lines.push({ label: SCALAR_LABEL[key], detail: written.slice(0, 80) });
    }
  }

  for (const key of LIST_KEYS) {
    const written = listWrite(state, ctx, key);
    if (written === null) continue;
    const detail = written.length ? written.join(', ') : 'Cleared';
    if (key === 'skills') profile.skills = written;
    else if (key === 'interests') profile.interests = written;
    else if (key === 'targetRoles') preferences.lists = { ...preferences.lists, rolesWanted: written };
    else if (key === 'careerInterests') {
      profile.careerInterests = written;
      preferences.lists = { ...preferences.lists, careersConsidering: written };
    } else preferences.experience.links = written;
    lines.push({ label: LIST_LABEL[key], detail });
  }

  const experience = blockWrite(state, ctx, 'experience');
  const projects = blockWrite(state, ctx, 'projects');
  if (experience !== null || projects !== null) {
    let entries = preferences.experience.entries.map(cloneExperience);
    if (experience !== null) {
      const kept = entries.filter((entry) => entry.kind === 'Project');
      entries = [...experience, ...kept];
      lines.push({ label: 'Experience', detail: experience.length ? experience.map(entryTitle).filter(Boolean).join(', ') || 'Updated' : 'Cleared' });
    }
    if (projects !== null) {
      const kept = entries.filter((entry) => entry.kind !== 'Project');
      entries = [...kept, ...projects];
      lines.push({ label: 'Projects', detail: projects.length ? projects.map(entryTitle).filter(Boolean).join(', ') || 'Updated' : 'Cleared' });
    }
    preferences.experience = { ...preferences.experience, entries };
  }

  return { profile, preferences, lines, empty: lines.length === 0 };
}

function scalarWrite(state: ReviewState, ctx: ReviewContext, key: ScalarKey): string | null {
  if (state.skipped[SCALAR_STEP[key]]) return null;
  const read = resumeScalar(ctx, key).value;
  const current = ctx.snapshot[key];
  const status = scalarStatus(current, read, key);
  const choice = state.scalars[key];
  if (status === 'missing' && choice.source !== 'edit') return null;
  if (status === 'same' && choice.source !== 'edit') return null;
  if (status === 'differ' && (choice.source === null || choice.source === 'profile')) return null;
  const raw = choice.value.trim();
  if (!raw) return null;
  const value = key === 'graduation' ? yearOf(raw) : key === 'year' ? canonYear(raw) : key === 'gpa' ? canonGpa(raw) : raw;
  if (!value) return null;
  if (normScalar(key, value) === normScalar(key, current)) return null;
  return value;
}

function listWrite(state: ReviewState, ctx: ReviewContext, key: ListKey): string[] | null {
  if (state.skipped[LIST_STEP[key]]) return null;
  const read = resumeList(ctx, key).value;
  const current = ctx.snapshot[key];
  const status = listStatus(current, read);
  const choice = state.lists[key];
  if (status === 'missing' && choice.source !== 'edit') return null;
  if (status === 'same' && choice.source !== 'edit') return null;
  if (status === 'differ' && (choice.source === null || choice.source === 'profile')) return null;
  const value = cleanList(choice.value, LIST_CAP[key], LIST_ITEM[key]);
  if (normList(value) === normList(current)) return null;
  return value;
}

function blockWrite(state: ReviewState, ctx: ReviewContext, key: BlockKey): ExperienceEntry[] | null {
  if (state.skipped[BLOCK_STEP[key]]) return null;
  const read = resumeBlock(ctx, key).value;
  const current = ctx.snapshot[key];
  const status = blockStatus(current, read);
  const choice = state.blocks[key];
  if (status === 'missing' && choice.source !== 'edit') return null;
  if (status === 'same' && choice.source !== 'edit') return null;
  if (status === 'differ' && (choice.source === null || choice.source === 'profile')) return null;
  const entries = choice.value.map((entry, index) => clipEntry(key === 'projects' ? { ...entry, kind: 'Project' } : entry, entry.id || `resume-${key}-${index}`)).filter(entryKept);
  if (normEntries(entries) === normEntries(current)) return null;
  return entries;
}

function resumeScalar(ctx: ReviewContext, key: ScalarKey): { value: string; confidence: number } {
  return textOf(ctx.extraction[key]);
}

function resumeList(ctx: ReviewContext, key: ListKey): { value: string[]; confidence: number } {
  return listOf(ctx.extraction[key]);
}

function resumeBlock(ctx: ReviewContext, key: BlockKey): { value: DraftEntry[]; confidence: number } {
  return entriesOf(ctx.extraction[key], key);
}

function textOf(fact: TextFact): { value: string; confidence: number } {
  if (!fact.found || !fact.value?.trim()) return { value: '', confidence: 0 };
  return { value: fact.value.trim(), confidence: fact.confidence };
}

function listOf(fact: ListFact): { value: string[]; confidence: number } {
  if (!fact.found) return { value: [], confidence: 0 };
  const value = fact.value.map((item) => item.trim()).filter(Boolean);
  return { value, confidence: value.length ? fact.confidence : 0 };
}

function entriesOf(fact: EntryListFact, prefix: string): { value: DraftEntry[]; confidence: number } {
  if (!fact.found) return { value: [], confidence: 0 };
  return {
    value: fact.value.map((entry, index) => fromFact(entry, `resume-${prefix}-${index}`)),
    confidence: fact.confidence,
  };
}

function fromFact(entry: EntryFact, id: string): DraftEntry {
  return {
    id,
    kind: entry.kind,
    role: entry.role,
    organization: entry.organization,
    location: entry.location,
    start: entry.start,
    end: entry.end,
    current: entry.current,
    summary: entry.summary,
    skills: [...entry.skills],
    link: entry.link,
    confidence: entry.confidence,
  };
}

function scalarStatus(profile: string, resume: string, key: ScalarKey): CompareStatus {
  if (!resume.trim()) return 'missing';
  if (!profile.trim()) return 'fill';
  return normScalar(key, profile) === normScalar(key, resume) ? 'same' : 'differ';
}

function listStatus(profile: string[], resume: string[]): CompareStatus {
  if (resume.length === 0) return 'missing';
  if (profile.length === 0) return 'fill';
  return normList(profile) === normList(resume) ? 'same' : 'differ';
}

function blockStatus(profile: DraftEntry[], resume: DraftEntry[]): CompareStatus {
  if (resume.length === 0) return 'missing';
  if (profile.length === 0) return 'fill';
  return normEntries(profile) === normEntries(resume) ? 'same' : 'differ';
}

function normScalar(key: ScalarKey, value: string): string {
  const trimmed = value.trim();
  if (key === 'email' || key === 'linkedin') return trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
  if (key === 'phone') return trimmed.replace(/\D/g, '');
  if (key === 'graduation') return yearOf(trimmed) ?? trimmed.toLowerCase();
  if (key === 'gpa') return canonGpa(trimmed).toLowerCase();
  if (key === 'year') return (canonYear(trimmed) ?? trimmed).toLowerCase();
  return trimmed.toLowerCase();
}

function normList(items: string[]): string {
  return [...items]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('\n');
}

function normEntries(entries: Array<DraftEntry | ExperienceEntry>): string {
  return entries
    .map((entry) => [entry.kind, entry.role, entry.organization, entry.summary, entry.start, entry.end, entry.current ? '1' : '0', entry.location].map((part) => String(part).trim().toLowerCase()).join('|'))
    .sort()
    .join('\n');
}

function yearOf(value: string): string | null {
  return value.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null;
}

function canonYear(value: string): string | null {
  const options = [...CLASS_YEARS, 'Graduate student'];
  return options.find((option) => option.toLowerCase() === value.trim().toLowerCase()) ?? null;
}

function canonGpa(value: string): string {
  const match = value.trim().match(/^(\d(?:\.\d{1,2})?)/);
  return match?.[1] ?? value.trim();
}

function isClassYear(value: string): value is ClassYear {
  return (CLASS_YEARS as readonly string[]).includes(value);
}

function cleanList(items: string[], cap: number, itemMax: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim().slice(0, itemMax);
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

function clipEntry(entry: DraftEntry, id: string): ExperienceEntry {
  const text = (value: string, max: number) => value.trim().slice(0, max);
  const month = (value: string) => (/^\d{4}-\d{2}$/.test(value) ? value : '');
  return {
    id,
    kind: text(entry.kind, 40),
    role: text(entry.role, 100),
    organization: text(entry.organization, 100),
    location: text(entry.location, 100),
    start: month(entry.start),
    end: entry.current ? '' : month(entry.end),
    current: entry.current === true,
    summary: text(entry.summary, 1500),
    skills: cleanList(entry.skills, 12, 40),
    link: text(entry.link, 200),
  };
}

function entryKept(entry: ExperienceEntry): boolean {
  return Boolean(entry.role || entry.organization || entry.summary || entry.skills.length || entry.link || entry.start || entry.location);
}

function entryTitle(entry: ExperienceEntry): string {
  return [entry.role, entry.organization].filter(Boolean).join(' — ');
}

function entryLow(entry: DraftEntry, resume: DraftEntry[]): boolean {
  if (!(entry.confidence > 0 && entry.confidence < LOW_CONFIDENCE)) return false;
  const original = resume.find((item) => item.id === entry.id);
  if (!original) return false;
  return normEntries([entry]) === normEntries([original]);
}

function cloneEntries(entries: DraftEntry[]): DraftEntry[] {
  return entries.map((entry) => ({ ...entry, skills: [...entry.skills] }));
}

function cloneExperience(entry: ExperienceEntry): ExperienceEntry {
  return { ...entry, skills: [...entry.skills] };
}

function clonePreferences(prefs: Preferences): Preferences {
  return {
    ...prefs,
    fields: [...prefs.fields],
    customFields: [...prefs.customFields],
    kinds: [...prefs.kinds],
    answers: { ...prefs.answers },
    lists: Object.fromEntries(Object.entries(prefs.lists).map(([key, value]) => [key, [...value]])),
    checks: { ...prefs.checks },
    notes: prefs.notes.map((note) => ({ ...note })),
    experience: {
      linkedin: prefs.experience.linkedin,
      links: [...prefs.experience.links],
      entries: prefs.experience.entries.map(cloneExperience),
    },
  };
}
