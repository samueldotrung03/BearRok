// The For You poster for a card: the one the presentation agent designed, or, until it has, one
// built here from the card's own facts, so every card in the reel is a poster from the start.
// Also keeps the poster readable whatever colours it was given.
import { formatLabel, typeMeta } from '../components/meta.ts';
import type { Opportunity, Poster } from '../types.ts';
import { daysUntil } from './time.ts';

/** Colours per kind of opportunity for a poster built from facts. */
const LOOKS: Record<Opportunity['type'], { layout: Poster['layout']; typeface: Poster['typeface']; palette: Poster['palette'] }> = {
  hackathon: { layout: 'bold', typeface: 'sans', palette: { background: '#11132b', text: '#ffffff', accent: '#ffb020' } },
  internship: { layout: 'bold', typeface: 'sans', palette: { background: '#0b2350', text: '#ffffff', accent: '#5fa8ff' } },
  event: { layout: 'bold', typeface: 'condensed', palette: { background: '#5a0f1f', text: '#ffffff', accent: '#ffcf4d' } },
  club: { layout: 'bold', typeface: 'sans', palette: { background: '#0f2e2a', text: '#ffffff', accent: '#6ee7b7' } },
  research: { layout: 'formal', typeface: 'serif', palette: { background: '#f3efe6', text: '#14244d', accent: '#c8102e' } },
  scholarship: { layout: 'formal', typeface: 'serif', palette: { background: '#f3efe6', text: '#14244d', accent: '#c8102e' } },
};

const short = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** A poster from the card's facts alone: its kind, title, format, place and dates. */
export function posterFromFacts(o: Opportunity): Poster {
  const look = LOOKS[o.type];
  const photo = o.image && (o.imageKind === 'stock' || o.imageKind === 'generated') && look.layout !== 'formal';
  const stats: Poster['stats'] = [];
  if (o.deadline) stats.push({ value: short(o.deadline), label: 'Deadline' });
  if (o.startTime) stats.push({ value: short(o.startTime), label: 'Starts' });
  const chips = [o.format ? formatLabel[o.format] : null, o.location].filter((c): c is string => Boolean(c)).slice(0, 3);
  const kicker = [o.format === 'online' ? 'Online' : null, typeMeta[o.type].label].filter(Boolean).join(' ').toUpperCase();
  return {
    layout: photo ? 'photo' : look.layout,
    typeface: look.typeface,
    uppercase: look.typeface === 'condensed',
    details: look.layout === 'formal' ? 'pill' : 'boxed',
    // A general photo can sit under the words; the event's own picture may be a flyer with words
    // printed on it, so it is shown whole above them.
    arrangement: photo ? 'overlay' : 'image-top',
    art: null,
    palette: look.palette,
    kicker,
    headline: o.title,
    headlineAccent: null,
    pitch: '',
    highlight: null,
    stats,
    chips,
    badge: o.deadline && daysUntil(o.deadline) >= 0 && daysUntil(o.deadline) <= 7 ? 'CLOSING SOON' : null,
    focus: 'center',
  };
}

/** The poster to draw for a card. */
export function posterFor(o: Opportunity): Poster {
  const p = o.poster ?? posterFromFacts(o);
  return { ...p, palette: readablePalette(p.palette) };
}

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How far apart two colours are for reading, from 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text that is hard to read on its background becomes white or near-black, whichever reads
 * better; an accent too close to the background takes the text colour.
 */
export function readablePalette(p: Poster['palette']): Poster['palette'] {
  const background = HEX.test(p.background) ? p.background : '#11132b';
  let text = HEX.test(p.text) ? p.text : '#ffffff';
  if (contrast(text, background) < 4.5) text = contrast('#ffffff', background) >= contrast('#111111', background) ? '#ffffff' : '#111111';
  let accent = HEX.test(p.accent) ? p.accent : text;
  if (contrast(accent, background) < 2.5) accent = text;
  return { background, text, accent };
}

/** True when the background is light, so the poster's own shading is light too. */
export const isLight = (hex: string) => luminance(hex) > 0.45;

/** The pitch cut into plain and highlighted parts. */
export function pitchParts(pitch: string, highlight: string | null): { text: string; strong: boolean }[] {
  if (!highlight) return [{ text: pitch, strong: false }];
  const at = pitch.indexOf(highlight);
  if (at < 0) return [{ text: pitch, strong: false }];
  return [
    { text: pitch.slice(0, at), strong: false },
    { text: highlight, strong: true },
    { text: pitch.slice(at + highlight.length), strong: false },
  ].filter((part) => part.text);
}

export type Placement = 'top' | 'middle' | 'bottom' | 'side' | 'overlay';

export interface ArtPlan {
  placement: Placement;
  /** Size of the picture's frame in card widths (cqw). Zero for overlay, which fills the card. */
  width: number;
  height: number;
}

/** Room for the poster's words and picture, in card widths: the card is 160 high, the caption takes the bottom quarter. */
export const ROOM = 104;
const INNER_WIDTH = 86;

/** About how tall the poster's words will be, in card widths. */
export function wordsHeight(p: Poster, columnWidth = INNER_WIDTH): number {
  const size = headlineSize([p.headline, p.headlineAccent].filter(Boolean).join(' '), p.typeface) * 0.9;
  const perLine = Math.max(6, Math.floor(columnWidth / (size * (p.uppercase || p.typeface === 'condensed' ? 0.5 : 0.56))));
  const lines = [p.headline, p.headlineAccent].filter((t): t is string => Boolean(t)).reduce((n, t) => n + Math.ceil(t.length / perLine), 0);
  const pitchLines = p.pitch ? Math.min(3, Math.ceil(p.pitch.length / Math.floor(columnWidth / 2.1))) : 0;
  const chipRows = p.chips.length ? Math.ceil(p.chips.length / 2) : 0;
  return (p.kicker ? 6 : 0) + lines * size * 1.02 + pitchLines * 5.4 + (p.stats.length ? 15 : 0) + chipRows * 8.5 + 12;
}

/**
 * Where the picture goes and how big its frame is. A tall picture stands beside the words; a
 * wide one is a band above, between or below them, as large as the words leave room for.
 * `aspect` is the shown part's width over its height.
 */
export function planArt(p: Poster, aspect: number, room = ROOM): ArtPlan {
  if (p.arrangement === 'overlay') return { placement: 'overlay', width: 0, height: 0 };
  // A taller frame (the details window) gives the picture proportionally more room.
  const tall = room / ROOM;
  // Beside the words: as tall as the room left by the stats and chips under it, at most 42 wide.
  const sideRoom = Math.min(72 * tall, room - (p.stats.length ? 24 : 6) - (p.chips.length ? 10 : 0));
  const sideWidth = Math.min(42, sideRoom * aspect);
  const side: ArtPlan = { placement: 'side', width: sideWidth, height: sideWidth / aspect };
  // Above, between or below the words: as tall as the words leave room for.
  const placement: Placement = p.arrangement === 'image-bottom' ? 'bottom' : p.arrangement === 'image-middle' ? 'middle' : 'top';
  const bandHeight = Math.max(22, Math.min((placement === 'middle' ? 48 : 58) * tall, room - wordsHeight(p)));
  const bandWidth = Math.min(INNER_WIDTH, bandHeight * aspect);
  const band: ArtPlan = { placement, width: bandWidth, height: bandWidth / aspect };
  // The agent's arrangement unless the picture would come out much bigger beside the words.
  return side.width * side.height > 1.4 * band.width * band.height ? side : band;
}

/** Headline size in card widths, by length, so a long name still fits in a few lines. */
export function headlineSize(text: string, typeface: Poster['typeface']): number {
  const n = text.length;
  const base = n <= 14 ? 12.5 : n <= 22 ? 10 : n <= 32 ? 8.4 : 7;
  return typeface === 'serif' ? base * 1.1 : typeface === 'condensed' ? base * 1.05 : base;
}
