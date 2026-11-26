import { describe, expect, it } from 'vitest';
import { emptyFeedCopy } from './feedCopy.ts';

const base = { offline: false, searching: false, shown: 0, target: 2, outcome: null };

describe('emptyFeedCopy', () => {
  it('keeps the offline sentence', () => {
    expect(emptyFeedCopy({ ...base, offline: true })).toMatch(/cannot be reached/);
  });

  it('says how many leads a real run kept and turned down when the feed is empty', () => {
    const text = emptyFeedCopy({ ...base, outcome: { found: 0, rejected: 6, searches: 40, runs: 5 } });
    expect(text).toMatch(/found 0 of the 2/);
    expect(text).toMatch(/5 searches ran 40 queries and kept 0/);
    expect(text).toMatch(/6 leads were turned down/);
  });

  it('does not quote a finished run while a search is still going', () => {
    const text = emptyFeedCopy({ ...base, searching: true, outcome: { found: 0, rejected: 6, searches: 40, runs: 5 } });
    expect(text).toMatch(/searching for more/);
    expect(text).not.toMatch(/turned down/);
  });
});
