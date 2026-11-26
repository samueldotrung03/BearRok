// Every For You card is a poster: the agents' design when there is one, else one from the facts,
// and always readable.
import { describe, expect, it } from 'vitest';
import type { Opportunity, Poster } from '../types.ts';
import { contrast, pitchParts, planArt, posterFor, posterFromFacts, readablePalette } from './poster.ts';

const card = (over: Partial<Opportunity> = {}): Opportunity =>
  ({
    id: 'c1', type: 'internship', origin: 'live', title: 'Software Engineering Intern', organizer: 'Stripe', sourceUrl: 'https://stripe.com', actionUrl: null,
    format: 'in_person', location: 'San Francisco, CA', fitExplanation: '', deadline: null, startTime: null, image: null, video: null, imageAspect: 1,
    tags: [], unknowns: [], foundAt: '', lastCheckedAt: '', baseScore: 0.5, ...over,
  }) as Opportunity;

describe('posterFromFacts', () => {
  it('uses only the card\'s own facts', () => {
    const p = posterFromFacts(card({ deadline: '2026-12-05T12:00:00Z' }));
    expect(p.headline).toBe('Software Engineering Intern');
    expect(p.stats).toEqual([{ value: 'Dec 5', label: 'Deadline' }]);
    expect(p.chips).toEqual(['In person', 'San Francisco, CA']);
    expect(p.pitch).toBe('');
  });

  it('puts a photo full-bleed and a logo on a coloured backdrop', () => {
    expect(posterFromFacts(card({ image: 'https://x/p.jpg', imageKind: 'stock' })).layout).toBe('photo');
    expect(posterFromFacts(card({ image: 'https://x/l.png', imageKind: 'logo' })).layout).toBe('bold');
    expect(posterFromFacts(card({ type: 'scholarship' })).layout).toBe('formal');
  });
});

describe('posterFor', () => {
  it('prefers the poster the agents designed', () => {
    const designed = { ...posterFromFacts(card()), headline: 'Ship real code at Stripe' } as Poster;
    expect(posterFor(card({ poster: designed })).headline).toBe('Ship real code at Stripe');
    expect(posterFor(card({ poster: null })).headline).toBe('Software Engineering Intern');
  });
});

describe('readablePalette', () => {
  it('swaps text that would be hard to read on its background', () => {
    const p = readablePalette({ background: '#0b2350', text: '#13254a', accent: '#0c2452' });
    expect(contrast(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(p.accent).toBe(p.text);
  });

  it('keeps colours that already read well', () => {
    expect(readablePalette({ background: '#1f1e2a', text: '#ffffff', accent: '#f4471f' })).toEqual({ background: '#1f1e2a', text: '#ffffff', accent: '#f4471f' });
  });
});

describe('pitchParts', () => {
  it('marks the highlighted words', () => {
    expect(pitchParts('Build AI apps with small open models.', 'small open models')).toEqual([
      { text: 'Build AI apps with ', strong: false },
      { text: 'small open models', strong: true },
      { text: '.', strong: false },
    ]);
    expect(pitchParts('Plain.', 'missing')).toEqual([{ text: 'Plain.', strong: false }]);
  });
});

describe('planArt', () => {
  const poster = (over: Partial<Poster> = {}) => ({ ...posterFromFacts(card()), pitch: 'Build AI apps with small open models.', ...over }) as Poster;

  it('stands a tall picture beside the words', () => {
    const plan = planArt(poster({ arrangement: 'image-top' }), 0.35);
    expect(plan.placement).toBe('side');
    expect(plan.width / plan.height).toBeCloseTo(0.35);
  });

  it('puts a wide picture where the agent asked, keeping its shape and the card\'s width', () => {
    for (const [arrangement, placement] of [['image-top', 'top'], ['image-middle', 'middle'], ['image-bottom', 'bottom']] as const) {
      const plan = planArt(poster({ arrangement }), 2.4);
      expect(plan.placement).toBe(placement);
      expect(plan.width).toBeLessThanOrEqual(86);
      expect(plan.width / plan.height).toBeCloseTo(2.4);
    }
  });

  it('lays a photo under the words only when asked to', () => {
    expect(planArt(poster({ arrangement: 'overlay' }), 1.5).placement).toBe('overlay');
  });

  it('shows the event\'s own picture whole above the words when no agent has designed the poster', () => {
    const p = posterFromFacts(card({ image: 'https://x/flyer.jpg', imageKind: 'event' }));
    expect(p.arrangement).toBe('image-top');
    expect(p.art).toBeNull();
  });
});
