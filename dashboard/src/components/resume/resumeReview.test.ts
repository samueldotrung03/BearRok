import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyPreferences } from '../../data/preferences.ts';
import { initialReview, reviewReducer, type ReviewContext } from '../../lib/resume/review.ts';
import type { Profile } from '../../types.ts';
import type { ListFact, ResumeProfile, TextFact } from '../../lib/resume/types.ts';
import { ResumeReview, ResumeReviewView } from './ResumeReview.tsx';

const text = (value: string | null, confidence = 0.95): TextFact => (value ? { found: true, value, confidence } : { found: false, value: null, confidence: 0 });
const list = (value: string[] = []): ListFact => ({ found: value.length > 0, value, confidence: value.length ? 0.95 : 0 });
const none = { found: false, value: [], confidence: 0 };

function resume(partial: Partial<ResumeProfile> = {}): ResumeProfile {
  return {
    fullName: text(null),
    email: text(null),
    phone: text('(510) 555-0148', 0.4),
    school: text('UC Berkeley'),
    major: text(null),
    year: text(null),
    graduation: text(null),
    gpa: text(null),
    location: text(null),
    about: text(null),
    skills: list(),
    interests: list(),
    targetRoles: list(),
    careerInterests: list(),
    linkedin: text(null),
    links: none,
    experience: none,
    projects: none,
    ...partial,
  };
}

const student: Profile = { name: '', fullName: '', major: '', about: '', school: 'UCLA', year: 'Freshman', location: '', interests: [], skills: [], careerInterests: [], eventTypes: [] };

function ctx(): ReviewContext {
  return {
    extraction: resume(),
    snapshot: {
      fullName: '',
      email: '',
      phone: '',
      school: 'UCLA',
      major: '',
      year: 'Freshman',
      graduation: '',
      gpa: '',
      location: '',
      about: '',
      skills: [],
      interests: [],
      targetRoles: [],
      careerInterests: [],
      linkedin: '',
      links: [],
      experience: [],
      projects: [],
    },
  };
}

const htmlOf = (node: ReturnType<typeof createElement>) => renderToString(node).replace(/<!-- -->/g, '');

describe('résumé confirmation dialog', () => {
  it('shows the first step, a low-confidence value, and a conflict that blocks Next', () => {
    const context = ctx();
    const html = htmlOf(createElement(ResumeReviewView, { state: initialReview(context), ctx: context, profile: student, preferences: emptyPreferences, onAction: () => {}, onSave: () => {}, onClose: () => {} }));
    expect(html).toContain('Step 1 of 6');
    expect(html).toContain('Basics');
    expect(html).toContain('Low confidence');
    expect(html).toContain('rr-low');
    expect(html).toContain('On your profile');
    expect(html).toContain('On the résumé');
    expect(html).toContain('UCLA');
    expect(html).toContain('UC Berkeley');
    expect(html).toContain('Choose which value to keep before continuing.');
    expect(html).toContain('disabled=""');
    expect(html).toContain('This does not change the email you sign in with.');
  });

  it('asks before discarding', () => {
    const context = ctx();
    const state = reviewReducer(initialReview(context), { type: 'escape' }, context);
    const html = htmlOf(createElement(ResumeReviewView, { state, ctx: context, profile: student, preferences: emptyPreferences, onAction: () => {}, onSave: () => {}, onClose: () => {} }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('Close without saving?');
    expect(html).toContain('Nothing from this résumé has been added to your profile.');
    expect(html).toContain('Keep reviewing');
    expect(html).toContain('Discard');
    expect(html).not.toContain('Accept and continue');
  });

  it('ends on a summary of what will be saved', () => {
    const context = ctx();
    let state = initialReview(context);
    state = reviewReducer(state, { type: 'pickScalar', key: 'school', source: 'resume' }, context);
    for (let i = 0; i < 6; i++) state = reviewReducer(state, { type: 'next' }, context);
    const html = htmlOf(createElement(ResumeReviewView, { state, ctx: context, profile: student, preferences: emptyPreferences, onAction: () => {}, onSave: () => {}, onClose: () => {} }));
    expect(html).toContain('Add this to your profile');
    expect(html).toContain('School');
    expect(html).toContain('UC Berkeley');
    expect(html).toContain('Save to my profile');
    expect(html).not.toContain('Accept and continue');
  });

  it('renders inside a modal dialog', () => {
    const context = ctx();
    const html = htmlOf(createElement(ResumeReview, { ctx: context, profile: student, preferences: emptyPreferences, onSave: () => {}, onClose: () => {} }));
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-labelledby="rr-title"');
    expect(html).toContain('class="rr-dialog"');
  });
});
