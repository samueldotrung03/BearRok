import { describe, expect, it } from 'vitest';
import { emptyPreferences, type ExperienceEntry, type Preferences } from '../../data/preferences.ts';
import type { Profile } from '../../types.ts';
import { applyReview, initialReview, listView, reviewReducer, scalarView, snapshotFrom, type ReviewContext, type ReviewState } from './review.ts';
import type { EntryFact, EntryListFact, ListFact, ResumeProfile, TextFact } from './types.ts';

const text = (value: string | null, confidence = 0.95): TextFact => (value ? { found: true, value, confidence } : { found: false, value: null, confidence: 0 });
const list = (value: string[], confidence = 0.95): ListFact => ({ found: value.length > 0, value, confidence: value.length ? confidence : 0 });
const entries = (value: EntryFact[]): EntryListFact => ({ found: value.length > 0, value, confidence: value.length ? 0.9 : 0 });

function entry(partial: Partial<EntryFact> & Pick<EntryFact, 'role'>): EntryFact {
  return { kind: '', organization: '', location: '', start: '', end: '', current: false, summary: '', skills: [], link: '', confidence: 0.9, ...partial };
}

function profile(partial: Partial<Profile> = {}): Profile {
  return { name: '', fullName: '', major: '', about: '', school: '', year: 'Freshman', location: '', interests: [], skills: [], careerInterests: [], eventTypes: [], ...partial };
}

function prefs(partial: Partial<Preferences> = {}): Preferences {
  return {
    ...emptyPreferences,
    ...partial,
    answers: { ...emptyPreferences.answers, ...partial.answers },
    lists: { ...emptyPreferences.lists, ...partial.lists },
    experience: { ...emptyPreferences.experience, ...partial.experience, entries: partial.experience?.entries ?? [] },
  };
}

function extraction(partial: Partial<ResumeProfile> = {}): ResumeProfile {
  return {
    fullName: text('Jordan Hale'),
    email: text('jordan.hale@example.edu'),
    phone: text('(510) 555-0148'),
    school: text('UC Berkeley'),
    major: text('Computer Science'),
    year: text('Junior'),
    graduation: text('May 2028'),
    gpa: text('3.72'),
    location: text('Berkeley, CA'),
    about: text('Builds small tools for student clubs.'),
    skills: list(['Python', 'React', 'SQL']),
    interests: list(['compilers', 'student communities']),
    targetRoles: list(['Software engineering intern']),
    careerInterests: list(['Software engineering']),
    linkedin: text('linkedin.com/in/jordan-hale'),
    links: list(['github.com/jordanhale', 'jordanhale.example']),
    experience: entries([entry({ kind: 'Internship', role: 'Software engineering intern', organization: 'Northwind Labs', location: 'Berkeley, CA', start: '2025-06', end: '2025-08', summary: 'Built a ledger service the finance team still uses.', skills: ['Python', 'SQL'] })]),
    projects: entries([entry({ kind: 'Project', role: 'Campus Eats', organization: 'Personal project', start: '2024-09', end: '2024-12', summary: 'A meal planner for the dorm, used by 40 students.', skills: ['React'], link: 'https://github.com/jordanhale/campus-eats' })]),
    ...partial,
  };
}

const project = (id: string, role: string): ExperienceEntry => ({ id, kind: 'Project', role, organization: 'Club', location: '', start: '', end: '', current: false, summary: 'Kept', skills: [], link: '' });

function ctxOf(resume: ResumeProfile = extraction(), student = profile(), answers: Preferences = prefs(), email = ''): ReviewContext {
  return { extraction: resume, snapshot: snapshotFrom(student, answers, email) };
}

function baseOf(student = profile(), answers: Preferences = prefs()) {
  return { profile: student, preferences: answers };
}

function acceptUntil(state: ReviewState, ctx: ReviewContext, step: number): ReviewState {
  let current = state;
  while (current.step < step) current = reviewReducer(current, { type: 'next' }, ctx);
  return current;
}

describe('résumé review', () => {
  it('fills an empty profile, asks before replacing the class year, and keeps a skipped project', () => {
    const student = profile();
    const answers = prefs({ experience: { linkedin: '', links: [], entries: [project('p1', 'Old poster')] } });
    const ctx = ctxOf(extraction(), student, answers);
    let state = initialReview(ctx);

    expect(scalarView(state, ctx, 'school').status).toBe('fill');
    expect(scalarView(state, ctx, 'year').status).toBe('differ');
    expect(scalarView(state, ctx, 'year').profile).toBe('Freshman');
    expect(scalarView(state, ctx, 'year').resume).toBe('Junior');
    expect(scalarView(state, ctx, 'phone').low).toBe(false);

    state = reviewReducer(state, { type: 'next' }, ctx);
    expect(state.step).toBe(1);
    const blocked = reviewReducer(state, { type: 'next' }, ctx);
    expect(blocked.step).toBe(1);
    state = reviewReducer(state, { type: 'pickScalar', key: 'year', source: 'resume' }, ctx);
    state = reviewReducer(state, { type: 'next' }, ctx);
    expect(state.step).toBe(2);
    state = reviewReducer(state, { type: 'next' }, ctx);
    state = reviewReducer(state, { type: 'skip' }, ctx);
    expect(state.step).toBe(4);
    state = acceptUntil(state, ctx, 6);

    const applied = applyReview(state, ctx, baseOf(student, answers));
    expect(applied.lines.map((line) => line.label)).toContain('School');
    expect(applied.lines.map((line) => line.label)).toContain('Class year');
    expect(applied.lines.map((line) => line.label)).toContain('Experience');
    expect(applied.lines.map((line) => line.label)).not.toContain('Projects');
    expect(applied.profile.school).toBe('UC Berkeley');
    expect(applied.profile.year).toBe('Junior');
    expect(applied.preferences.experience.entries.some((entry) => entry.id === 'p1')).toBe(true);
    expect(applied.preferences.experience.entries.some((entry) => entry.organization === 'Northwind Labs')).toBe(true);
    expect(applied.preferences.experience.entries.some((entry) => entry.role === 'Campus Eats')).toBe(false);
    expect(applied.preferences.answers.graduationYear).toBe('2028');
    expect(applied.empty).toBe(false);
  });

  it('treats the same skills in a different order as unchanged', () => {
    const student = profile({ skills: ['Python', 'SQL'], year: 'Junior' });
    const resume = extraction({ skills: list(['SQL', 'Python']), year: text('Junior') });
    const ctx = ctxOf(resume, student);
    const state = initialReview(ctx);
    expect(listView(state, ctx, 'skills').status).toBe('same');
    const applied = applyReview(acceptUntil(state, ctx, 6), ctx, baseOf(student));
    expect(applied.lines.map((line) => line.label)).not.toContain('Skills');
    expect(applied.profile.skills).toBeUndefined();
  });

  it('keeps the profile school or the résumé school, whichever the student picks', () => {
    const student = profile({ school: 'UCLA', year: 'Junior' });
    const ctx = ctxOf(extraction({ year: text('Junior') }), student);
    const start = initialReview(ctx);
    expect(scalarView(start, ctx, 'school').status).toBe('differ');

    const keep = applyReview(applyPick(start, ctx, 'profile'), ctx, baseOf(student));
    expect(keep.profile.school).toBeUndefined();
    expect(keep.preferences).toBeDefined();

    const replace = applyReview(applyPick(start, ctx, 'resume'), ctx, baseOf(student));
    expect(replace.profile.school).toBe('UC Berkeley');
  });

  it('does not clear a phone the résumé never stated', () => {
    const answers = prefs({ answers: { phone: '(415) 555-0100' } });
    const student = profile({ year: 'Junior' });
    const ctx = ctxOf(extraction({ phone: text(null), year: text('Junior') }), student, answers);
    const applied = applyReview(acceptUntil(initialReview(ctx), ctx, 6), ctx, baseOf(student, answers));
    expect(applied.preferences.answers.phone).toBe('(415) 555-0100');
    expect(applied.lines.map((line) => line.label)).not.toContain('Phone');
  });

  it('saves an edited major instead of the text that was read', () => {
    const student = profile({ year: 'Junior' });
    const ctx = ctxOf(extraction({ year: text('Junior') }), student);
    let state = acceptUntil(initialReview(ctx), ctx, 1);
    state = reviewReducer(state, { type: 'editScalar', key: 'major', value: 'Data Science' }, ctx);
    state = acceptUntil(state, ctx, 6);
    const applied = applyReview(state, ctx, baseOf(student));
    expect(applied.profile.major).toBe('Data Science');
    expect(applied.lines.find((line) => line.label === 'Major')?.detail).toBe('Data Science');
  });

  it('asks before discarding, and a second Escape cancels that question', () => {
    const ctx = ctxOf();
    let state = initialReview(ctx);
    state = reviewReducer(state, { type: 'escape' }, ctx);
    expect(state.discard).toBe(true);
    expect(state.closed).toBe(false);
    state = reviewReducer(state, { type: 'escape' }, ctx);
    expect(state.discard).toBe(false);
    state = reviewReducer(state, { type: 'escape' }, ctx);
    state = reviewReducer(state, { type: 'confirmDiscard' }, ctx);
    expect(state.closed).toBe(true);
    expect(reviewReducer(state, { type: 'next' }, ctx).closed).toBe(true);
  });

  it('leaves the profile untouched when every step is skipped', () => {
    const student = profile({ school: 'UCLA' });
    const ctx = ctxOf(extraction(), student);
    let state = initialReview(ctx);
    for (let i = 0; i < 6; i++) state = reviewReducer(state, { type: 'skip' }, ctx);
    const applied = applyReview(state, ctx, baseOf(student));
    expect(state.step).toBe(6);
    expect(applied.lines).toEqual([]);
    expect(applied.empty).toBe(true);
    expect(applied.profile).toEqual({});
    expect(applied.preferences.experience.entries).toEqual([]);
  });

  it('replaces skills when the student picks the résumé list', () => {
    const student = profile({ skills: ['Java'], year: 'Junior' });
    const ctx = ctxOf(extraction({ skills: list(['Python', 'React']), year: text('Junior') }), student);
    let state = acceptUntil(initialReview(ctx), ctx, 4);
    expect(listView(state, ctx, 'skills').status).toBe('differ');
    const blocked = reviewReducer(state, { type: 'next' }, ctx);
    expect(blocked.step).toBe(4);
    state = reviewReducer(state, { type: 'pickList', key: 'skills', source: 'resume' }, ctx);
    state = acceptUntil(state, ctx, 6);
    const applied = applyReview(state, ctx, baseOf(student));
    expect(applied.profile.skills).toEqual(['Python', 'React']);
  });

  it('stores a graduate class year on restrictions and leaves the profile year', () => {
    const student = profile({ year: 'Senior' });
    const ctx = ctxOf(extraction({ year: text('Graduate student') }), student);
    let state = acceptUntil(initialReview(ctx), ctx, 1);
    state = reviewReducer(state, { type: 'pickScalar', key: 'year', source: 'resume' }, ctx);
    state = acceptUntil(state, ctx, 6);
    const applied = applyReview(state, ctx, baseOf(student));
    expect(applied.profile.year).toBeUndefined();
    expect(applied.preferences.answers.classYear).toBe('Graduate student');
    expect(applied.lines.find((line) => line.label === 'Class year')?.detail).toContain('stays Senior');
  });

  it('highlights a low-confidence phone until the student edits it', () => {
    const ctx = ctxOf(extraction({ phone: text('(510) 555-0148', 0.4) }));
    const state = initialReview(ctx);
    expect(scalarView(state, ctx, 'phone').low).toBe(true);
    const edited = reviewReducer(state, { type: 'editScalar', key: 'phone', value: '(510) 555-0199' }, ctx);
    expect(scalarView(edited, ctx, 'phone').low).toBe(false);
  });
});

function applyPick(state: ReviewState, ctx: ReviewContext, source: 'profile' | 'resume'): ReviewState {
  let current = reviewReducer(state, { type: 'pickScalar', key: 'school', source }, ctx);
  return acceptUntil(current, ctx, 6);
}
