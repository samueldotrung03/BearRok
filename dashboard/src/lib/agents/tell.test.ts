import { describe, expect, it } from 'vitest';
import { emptyPreferences, type Note } from '../../data/preferences.ts';
import { MAX_NOTES, TOLD_TITLE, withToldNote } from './tell.ts';

const NOW = new Date('2026-11-21T22:30:00.000Z');
const own = (i: number): Note => ({ id: `n${i}`, title: `Note ${i}`, body: `Body ${i}`, updatedAt: NOW.toISOString() });

describe('withToldNote', () => {
  it('adds the text as a note the master reads, keeping the rest of the preferences', () => {
    const prefs = { ...emptyPreferences, fields: ['software'], notes: [own(1)] };
    const next = withToldNote(prefs, '  Only remote  ', NOW)!;
    expect(next.fields).toEqual(['software']);
    expect(next.notes).toEqual([own(1), { id: `told-${NOW.getTime()}`, title: TOLD_TITLE, body: 'Only remote', updatedAt: NOW.toISOString() }]);
  });

  it('moves a repeated instruction to the end instead of adding a copy', () => {
    const once = withToldNote(emptyPreferences, 'More hackathons', NOW)!;
    const twice = withToldNote({ ...once, notes: [...once.notes, own(2)] }, 'more hackathons', new Date(NOW.getTime() + 1000))!;
    expect(twice.notes.map((n) => n.body)).toEqual(['Body 2', 'more hackathons']);
  });

  it('makes room by dropping its own oldest note, never one the student wrote', () => {
    const notes = [{ ...own(0), title: TOLD_TITLE, body: 'old' }, ...Array.from({ length: MAX_NOTES - 1 }, (_, i) => own(i + 1))];
    const next = withToldNote({ ...emptyPreferences, notes }, 'new', NOW)!;
    expect(next.notes).toHaveLength(MAX_NOTES);
    expect(next.notes.some((n) => n.body === 'old')).toBe(false);
    expect(next.notes.at(-1)?.body).toBe('new');
  });

  it('refuses when twenty notes of the student own leave no room', () => {
    const notes = Array.from({ length: MAX_NOTES }, (_, i) => own(i));
    expect(withToldNote({ ...emptyPreferences, notes }, 'new', NOW)).toBeNull();
  });
});
