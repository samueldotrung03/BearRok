// The Career discovery page says honestly where a guide is: none yet, being planned, researched
// part by part, partial, ready, a failed part with its reason, stopped by an empty Grok balance, or
// offline. Also: names of one career match like the backend's, and a career is kept in the
// student's career interests only when they ask, which the roadmap then ranks first.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CareerGuide } from '../../components/discover/CareerGuide.tsx';
import { initialState } from '../../data/sample.ts';
import { careerSearch } from '../roadmapx/journey.ts';
import { inCareerInterests, withCareerInterest, withoutCareerInterest } from './careerMemory.ts';
import { guideState, isOutOfBalance, partLine, stepLine, type Guide, type SectionId, type SectionState } from './guide.ts';
import { careerKey } from './names.ts';

const done = <T,>(data: T, over: Partial<SectionState<T>> = {}): SectionState<T> => ({ status: 'done', data, sample: false, error: null, failure: null, ...over });
const waiting: SectionState<never> = { status: 'waiting', data: null, sample: false, error: null };
const failed = (failure: SectionState<never>['failure'], error: string): SectionState<never> => ({ status: 'failed', data: null, sample: false, error, failure });

const basics = { summary: 'Data engineers build pipelines.', whatTheyDo: ['Build pipelines'], whereTheyWork: ['Banks'], skills: [{ name: 'SQL', kind: 'tool' as const }], pay: null, outlook: null, sources: [] };
const voices = { summary: 'Mostly reliability.', posts: [{ author: 'A senior data engineer', role: 'Senior data engineer', handle: null, text: 'Reliability is the job.', takeaway: 'Learn testing.', url: null, date: null }] };
const interview = { formats: [{ name: 'SQL screen', tests: 'Joins', howToPractice: 'Timed problems', url: null }], questions: [], sources: [] };
const start = { steps: [{ title: 'Learn SQL', detail: 'Joins first.', resource: null, prepares: ['SQL screen'] }], resources: [] };

const guide = (over: Partial<Guide> = {}): Guide => ({
  slug: 'ai-engineering',
  query: 'AI Engineering',
  title: 'AI Engineer',
  oneLine: 'Builds products on AI models.',
  field: 'ai',
  status: 'ready',
  provider: 'grok',
  startedAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:05:00Z',
  error: null,
  failure: null,
  aliases: ['ai-engineer'],
  sections: { basics: done(basics), voices: done(voices), interview: done(interview), start: done(start) },
  ...over,
});
const withParts = (parts: Partial<Guide['sections']>, over: Partial<Guide> = {}) => guide({ ...over, sections: { ...guide().sections, ...parts } as Guide['sections'] });

const render = (g: Guide, props: Partial<Parameters<typeof CareerGuide>[0]> = {}, firstPart: SectionId = 'basics') =>
  renderToString(createElement(MemoryRouter, null, createElement(CareerGuide, { guide: g, onSearchAgain: () => {}, onAddMore: async () => null, onRetryPart: async () => null, firstPart, ...props })));

describe('career names', () => {
  it('match the way the backend matches them', () => {
    for (const name of ['AI Engineering', 'AI Engineer', 'ai engineering', 'an AI engineer', 'AI engineers']) expect(careerKey(name)).toBe('ai-engineer');
    expect(careerKey('ML Engineer')).toBe(careerKey('Machine Learning Engineering'));
    expect(careerKey('Data Engineering')).not.toBe(careerKey('Data Science'));
    expect(careerKey('!!')).toBe('');
  });
});

describe('career interests', () => {
  it('are added only once per career, whatever name it goes by', () => {
    expect(withCareerInterest(['AI Engineering'], 'AI Engineer')).toBeNull();
    expect(withCareerInterest(['Data engineer'], 'AI Engineer')).toEqual(['Data engineer', 'AI Engineer']);
  });

  it('know which guide they name, by its title, slug or an alias, and can take it out', () => {
    expect(inCareerInterests(['ai engineering'], guide())).toBe(true);
    expect(inCareerInterests(['Machine Learning Engineer'], guide())).toBe(false);
    expect(withoutCareerInterest(['AI Engineering', 'Nurse'], guide())).toEqual(['Nurse']);
    expect(withoutCareerInterest(['Nurse'], guide())).toBeNull();
  });

  it('put the matching roadmap path first, as on the profile', () => {
    const state = { ...initialState, goalId: 'path-swe', profile: { ...initialState.profile, careerInterests: ['Machine Learning Engineer'] } };
    const hits = careerSearch(state, '');
    expect(hits[0]).toMatchObject({ id: 'path-swe', reason: 'Your goal' });
    expect(hits[1]).toMatchObject({ id: 'path-ml', reason: 'On your profile' });
  });

  it('are offered on the guide as one button that says whether the career is in them', () => {
    const off = render(guide(), { interest: { added: false, onToggle: () => {}, note: null } });
    expect(off).toContain('Add to my career interests');
    expect(off).toContain('aria-pressed="false"');
    const on = render(guide(), { interest: { added: true, onToggle: () => {}, note: 'AI Engineer is in your career interests. Your agents search for it from their next run, and your roadmap lists it first.' } });
    expect(on).toContain('In your career interests');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('Your agents search for it from their next run');
  });
});

describe('page states', () => {
  it('names each state of a guide', () => {
    expect(guideState(null)).toBe('none');
    expect(guideState(guide({ status: 'planning' }))).toBe('planning');
    expect(guideState(guide({ status: 'researching' }))).toBe('researching');
    expect(guideState(guide())).toBe('ready');
    expect(guideState(withParts({ interview: failed('timeout', 'The researcher timed out twice (each try may take 240s).') }))).toBe('partial');
    expect(guideState(withParts({ basics: failed('error', 'x'), voices: failed('error', 'x'), interview: failed('error', 'x'), start: failed('error', 'x') }, { status: 'failed' }))).toBe('failed');
    const empty = withParts({ start: failed('balance', 'Not researched: Grok usage balance exhausted; top up to continue.') }, { failure: 'balance' });
    expect(isOutOfBalance(empty)).toBe(true);
    expect(guideState(empty)).toBe('out-of-balance');
  });

  it('researching: each tab says where its part is, and the line counts the parts that are ready', () => {
    const g = withParts(
      { voices: { ...waiting, status: 'working', stage: 'validating', mode: 'research' }, interview: { ...waiting, status: 'working', stage: 'researching', mode: 'research' }, start: waiting },
      { status: 'researching' },
    );
    expect(partLine(g, 'basics')).toBe('Ready');
    expect(partLine(g, 'voices')).toBe('Checking what was found');
    expect(partLine(g, 'interview')).toBe('Researching');
    expect(partLine(g, 'start')).toBe('Waits for the interviews');
    expect(stepLine(g)).toBe('Checking what people in the job say · 1 of 4 ready');
    const html = render(g);
    expect(html).toContain('Checking what was found');
    expect(html).toContain('Waits for the interviews');
  });

  it('a failed part says why and offers to search only that part again', () => {
    const g = withParts({ interview: failed('timeout', 'The researcher timed out twice (each try may take 240s).') });
    const html = render(g, {}, 'interview');
    expect(html).toContain('Timed out');
    expect(html).toContain('The researcher timed out twice (each try may take 240s).');
    expect(html).toContain('Search this part again');
    expect(html).toContain('3 of 4 parts are ready. What the interviews ask: did not finish.');
  });

  it('a part a restart stopped says so, and a finished part can be searched again on its own', () => {
    const g = withParts({ voices: failed('interrupted', 'A restart stopped this part before it finished.') });
    expect(render(g, {}, 'voices')).toContain('Stopped by a restart');
    const ready = render(guide());
    expect(ready).toContain('aria-label="Search this part again"');
    expect(stepLine(withParts({ basics: done(basics, { status: 'working', mode: 'research', stage: 'researching' }) }))).toBe('Searching the basics again');
  });

  it('a part shown unchecked says the validator did not check it', () => {
    const html = render(withParts({ basics: done(basics, { unchecked: 'Not checked: the validator timed out twice (each try may take 240s).' }) }));
    expect(html).toContain('Not checked: the validator timed out twice');
  });

  it('an empty Grok balance is said plainly, with what to do', () => {
    const g = withParts({ start: failed('balance', 'Not researched: Grok usage balance exhausted; top up to continue.') }, { failure: 'balance', error: 'Grok usage balance exhausted; top up to continue.' });
    const html = render(g, {}, 'start');
    expect(html).toContain('role="alert"');
    expect(html).toContain('usage balance is used up (HTTP 402)');
    expect(html).toContain('Top up the Grok balance, then search the missing parts again.');
    expect(html).toContain('Grok balance used up');
  });

  it('offline: the last copy is shown and says so', () => {
    expect(render(guide(), { offline: true })).toContain('Your agents cannot be reached right now. This is the last copy they sent');
  });

  it('a simulated guide is labelled as simulated examples, not research', () => {
    const html = render(guide({ provider: 'simulated' }));
    expect(html).toContain('Simulated example');
    expect(html).toContain('not researched');
  });
});
