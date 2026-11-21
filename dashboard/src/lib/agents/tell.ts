// "Tell your agents" with an agent server: the text becomes one of the student's profile notes,
// which the master agent reads before anything else at the start of each search.
import type { Note, Preferences } from '../../data/preferences.ts';

export const TOLD_TITLE = 'Told your agents';
/** The backend keeps the first 20 notes; a note past that would be dropped without a word. */
export const MAX_NOTES = 20;

/**
 * The preferences with `text` added as a note, or null when 20 notes of the student's own leave no
 * room. Saying the same thing again moves it to the end instead of adding a copy; when full, the
 * oldest note added here makes room, never one the student wrote on the Profile page.
 */
export function withToldNote(prefs: Preferences, text: string, now = new Date()): Preferences | null {
  const body = text.trim();
  if (!body) return prefs;
  const same = (n: Note) => n.title === TOLD_TITLE && n.body.trim().toLowerCase() === body.toLowerCase();
  const notes = prefs.notes.filter((n) => !same(n));
  while (notes.length >= MAX_NOTES) {
    const oldest = notes.findIndex((n) => n.title === TOLD_TITLE);
    if (oldest < 0) return null;
    notes.splice(oldest, 1);
  }
  const note: Note = { id: `told-${now.getTime()}`, title: TOLD_TITLE, body, updatedAt: now.toISOString() };
  return { ...prefs, notes: [...notes, note] };
}
