import { describe, expect, it } from 'vitest';
import { reactionSends, type Reactions } from './reactions.ts';

const empty: Reactions = { saved: [], liked: [], dismissed: [], opened: [] };

describe('reactionSends', () => {
  it('sends nothing until there is a previous set of reactions', () => {
    expect(reactionSends(null, { ...empty, saved: ['a'] }, new Set(['a']))).toEqual([]);
  });

  it('sends save, like, dislike and open for a known card even when that card is not in the feed', () => {
    const known = new Set(['saved-card']);
    const now: Reactions = { saved: ['saved-card'], liked: ['saved-card'], dismissed: ['saved-card'], opened: ['saved-card'] };
    expect(reactionSends(empty, now, known)).toEqual([
      { id: 'saved-card', action: 'save' },
      { id: 'saved-card', action: 'like' },
      { id: 'saved-card', action: 'dislike' },
      { id: 'saved-card', action: 'open' },
    ]);
  });

  it('drops a card the agents do not know, and sends the undo when a reaction is taken back', () => {
    const before: Reactions = { ...empty, saved: ['known', 'stranger'] };
    expect(reactionSends(before, empty, new Set(['known']))).toEqual([{ id: 'known', action: 'save' }]);
  });

  it('a new save is posted to the student interactions route, even when the feed is empty', async () => {
    expect(reactionSends(empty, { ...empty, saved: ['opp-kept'] }, new Set(['opp-kept']))).toEqual([{ id: 'opp-kept', action: 'save' }]);
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./live.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('const send = reactionSends');
    const block = source.slice(start, source.indexOf('const sample = SAMPLE_FEED', start));
    expect(block).toContain('reactionSends(before, now, known)');
    expect(block).toContain('/api/students/${who}/interactions');
    expect(block).toContain('JSON.stringify({ opportunityId: id, action })');
    expect(source).toContain('A saved card still counts when the feed itself is empty');
  });
});
