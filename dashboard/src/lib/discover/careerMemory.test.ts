import { describe, expect, it } from 'vitest';
import { withCareerInterest } from './careerMemory.ts';

describe('withCareerInterest', () => {
  it('adds a career the student asked to learn', () => {
    expect(withCareerInterest([], '  AI Engineer  ')).toEqual(['AI Engineer']);
    expect(withCareerInterest(['Data engineer'], 'AI Engineer')).toEqual(['Data engineer', 'AI Engineer']);
  });

  it('skips a blank title and one already on the list', () => {
    expect(withCareerInterest([], ' ')).toBeNull();
    expect(withCareerInterest(['AI Engineer'], 'ai engineer')).toBeNull();
  });

  it('keeps the twelve most recent', () => {
    const current = Array.from({ length: 12 }, (_, i) => `Career ${i}`);
    expect(withCareerInterest(current, 'Newest')).toEqual([...current.slice(1), 'Newest']);
  });
});
