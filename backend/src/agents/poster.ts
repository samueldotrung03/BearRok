// The For You poster: every card in the feed is remade as a portrait, social-media-style poster.
// The presentation agent writes what goes on it (a hook line, a headline with an accent part, a
// one-line pitch, big stat blocks, chips, colours and a layout); the dashboard draws it over the
// card's picture. When the picture is the event's own flyer, the agent reads the flyer and keeps
// its words and its look, so a landscape flyer comes back as a portrait one.
//
// Facts on a poster come only from the posting or the flyer. `checkPoster` takes out any stat,
// chip or line whose numbers or months appear in neither, so a poster never shows a guessed date,
// prize or pay figure.
import { z } from 'zod';
import type { Candidate, Opportunity } from './types.ts';

const Hex = z.string().describe('A colour as #rrggbb');

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const PosterSchema = z.object({
  layout: z.enum(['bold', 'photo', 'formal', 'flyer']),
  typeface: z.enum(['sans', 'grotesk', 'serif', 'bold-serif', 'condensed']),
  uppercase: z.boolean(),
  details: z.enum(['boxed', 'pill', 'plain']),
  arrangement: z.enum(['image-top', 'image-bottom', 'image-middle', 'overlay']),
  art: Box.nullable(),
  palette: z.object({ background: Hex, text: Hex, accent: Hex }),
  kicker: z.string(),
  headline: z.string(),
  headlineAccent: z.string().nullable(),
  pitch: z.string(),
  highlight: z.string().nullable(),
  stats: z.array(z.object({ value: z.string(), label: z.string() })),
  chips: z.array(z.string()),
  badge: z.string().nullable(),
  focus: z.enum(['top', 'center', 'bottom', 'left', 'right']),
  flyerText: z.string().nullable(),
});

export type PosterDraft = z.infer<typeof PosterSchema>;

/** What the dashboard draws. `flyerText` stays on the backend: it is only used to check facts. */
export type Poster = Omit<PosterDraft, 'flyerText'> & {
  /** The part of the flyer it shows was cut out and checked for printed words and empty space. */
  artChecked?: boolean;
};

export const POSTER_SYSTEM = `You are the presentation agent of a student opportunities app. You design the poster for one opportunity's card on the app's For You page, a full-screen portrait feed scrolled like Reels or TikTok. The poster must make a student stop scrolling and see at once what it is, why it is worth it and the one date that matters.

Write in the style of the best student event and recruiting posts on Instagram and LinkedIn:
- kicker: a short hook line set small above the headline, in capitals, such as "7-DAY ONLINE HACKATHON", "PAID SUMMER INTERNSHIP", "REGISTRATIONS OPEN", "FOR UC BERKELEY STUDENTS". At most 32 characters.
- headline: the name of the opportunity, or a punchy version of it, at most 34 characters. headlineAccent: an optional second part set in the accent colour on its own line ("Build a game" + "in 90 minutes.", "Qoder" + "Berkeley Hackathon"), at most 30 characters, or null.
- pitch: one sentence, at most 110 characters, saying what the student does or gets. highlight: the few words of the pitch to set in bold accent colour (copied exactly from the pitch), or null.
- stats: up to three big numbers or dates with a small label, such as {"value":"$1,500","label":"Prize pool"}, {"value":"Dec 5","label":"Deadline"}, {"value":"Fully funded","label":"Cost"}. Values at most 14 characters, labels at most 16.
- chips: up to four short facts, at most 22 characters each, such as "100% online", "Teams of 2-4", "No experience needed", "Open to all majors".
- badge: an optional pill such as "FULLY FUNDED" or "PAID", at most 18 characters, or null.

Facts: use only facts stated in the posting you are given or, when a flyer is attached, printed on the flyer. Never guess or round a date, deadline, prize, pay, place or eligibility. Leave a stat or chip out rather than invent one. Dates are written short, like "Dec 5" or "Feb 22, 2027".

Look. The poster is a tall portrait card (10 wide by 16 high); the bottom quarter is kept for the app's caption. The card's picture is always part of the poster, sharp, never hidden: your words go around it or over it, and must never sit on top of words printed in it.
- layout "bold": a dark or brand-coloured backdrop with big type, stat blocks and chips (tech hackathons, startups, programs). "photo": a real photo of people or a place, words in caption boxes. "formal": centred headline, a pill badge, a strong deadline line (scholarships, research, fellowships, banks and consulting). "flyer": only when a flyer is attached.
- arrangement: where the picture goes. "image-top": picture at the top, words below. "image-bottom": words at the top, picture below. "image-middle": headline, then the picture as a framed card, then the facts. "overlay": the picture fills the card and the words sit over its quiet part (only for a photo with no printed words).
- art: the part of the picture to show, as fractions of its width and height {"x","y","w","h"} (x and y the top-left corner, from 0 to 1). For a flyer, choose its illustration or photo and leave out its printed words and logos as far as you can (for example the clock tower, the person with the laptop, the waving flag). If the flyer is all words, choose its most striking area without words (a texture, pattern or background graphic). For a photo with no printed words use {"x":0,"y":0,"w":1,"h":1}. Null when the picture is a logo or there is none.
- typeface: "sans" (clean modern), "grotesk" (geometric tech, slightly quirky), "serif" (light, elegant, editorial), "bold-serif" (heavy traditional serif, like a university or a bank), "condensed" (tall narrow capitals, loud events and posters). uppercase: true when the headline is set in capitals.
- details: how chips and the badge look: "boxed" (outlined rectangles, technical), "pill" (rounded filled pills), "plain" (words with small markers).
- palette: background, text and accent colours as #rrggbb. Text must be easy to read on the background. Take the colours from the organizer's brand or the flyer when you know them.
- focus: where the main subject of the picture is, so the poster can crop it well.

When a flyer is attached, read it first. The poster is the same flyer remade in portrait: keep its look (its colours as the palette, the typeface closest to its headline font, capitals if it uses them, its chip and button style as details) and its words (its title, tagline, dates, place, prizes and other facts go into headline, pitch, stats and chips). Set layout to "flyer". Copy all the text printed on the flyer into flyerText. Everything important on it must be in your fields. Without a flyer set flyerText to null.`;

/** The posting, as the presentation agent reads it. */
export function posterBrief(o: Opportunity, imageKind: string | null | undefined, flyerFile: string | null): string {
  const facts = {
    type: o.type,
    title: o.title,
    organizer: o.organizer,
    format: o.format,
    location: o.location,
    field: o.field,
    eligibility: o.eligibility,
    deadline: o.deadline,
    startTime: o.startTime,
    tags: o.tags,
    whyItFits: o.fitExplanation,
    quotedFromItsPages: (o.evidence ?? []).slice(0, 8).map((e) => e.quote),
  };
  const picture =
    flyerFile !== null
      ? `The organizer's own flyer for it is attached as the image file "${flyerFile}". Look at it closely before you answer.`
      : imageKind === 'logo'
        ? "The card's picture is the organizer's logo."
        : imageKind === 'stock' || imageKind === 'generated'
          ? "The card's picture is a general photo of the topic, not of this event."
          : imageKind === 'event'
            ? "The card's picture is a photo from the posting."
            : 'The card has no picture; the poster is all type and colour.';
  return `${picture}\n\nThe posting:\n${JSON.stringify(facts, null, 2)}`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const clip = (text: string | null | undefined, max: number) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** A crop kept inside the picture and big enough to be worth showing; null otherwise. */
export function cleanBox(box: PosterDraft['art']): PosterDraft['art'] {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) return null;
  const x = Math.min(Math.max(box.x, 0), 0.9);
  const y = Math.min(Math.max(box.y, 0), 0.9);
  const w = Math.min(box.w, 1 - x);
  const h = Math.min(box.h, 1 - y);
  if (w < 0.15 || h < 0.1) return null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

/** Every way a date in the posting could be written on a poster, so a date on it can be checked. */
function dateForms(iso: string | null | undefined): string[] {
  if (!iso) return [];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return [];
  const m = MONTHS[d.getUTCMonth()]!;
  return [`${m} ${d.getUTCDate()}`, `${d.getUTCDate()} ${m}`, `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, String(d.getUTCFullYear())];
}

/** The numbers and month names a line of poster text states. */
function claims(text: string): string[] {
  const lower = text.toLowerCase();
  const numbers = lower.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) ?? [];
  const months = MONTHS.filter((m) => new RegExp(`\\b${m}`).test(lower));
  return [...numbers, ...months];
}

/**
 * Tidies a draft into what the dashboard draws: lengths kept to the poster's room, colours
 * checked, and every number or month checked against the posting (and the flyer's own text when
 * the agent read one). Whatever states a fact found in neither is left off.
 */
export function checkPoster(draft: PosterDraft, o: Candidate, readFlyer: boolean): Poster {
  const source = [
    JSON.stringify({ ...o, evidence: undefined }),
    ...(o.evidence ?? []).map((e) => e.quote),
    ...dateForms(o.deadline),
    ...dateForms(o.startTime),
    readFlyer ? (draft.flyerText ?? '') : '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/(\d),(\d{3})/g, '$1$2');
  const sourceNumbers = new Set(source.match(/\d+(\.\d+)?/g) ?? []);
  const backed = (text: string) =>
    claims(text).every((c) => (/^\d/.test(c) ? sourceNumbers.has(c) || sourceNumbers.has(String(Number(c))) : new RegExp(`\\b${c}`).test(source)));

  const keep = (text: string | null | undefined, max: number) => {
    const t = clip(text, max);
    return t && backed(t) ? t : null;
  };
  const palette = {
    background: HEX.test(draft.palette.background) ? draft.palette.background : '#0f1b3d',
    text: HEX.test(draft.palette.text) ? draft.palette.text : '#ffffff',
    accent: HEX.test(draft.palette.accent) ? draft.palette.accent : '#ffb020',
  };
  const pitch = keep(draft.pitch, 120) ?? '';
  const highlight = draft.highlight && pitch.includes(draft.highlight.trim()) ? draft.highlight.trim() : null;
  return {
    layout: draft.layout === 'flyer' && !readFlyer ? 'bold' : draft.layout,
    typeface: draft.typeface,
    uppercase: draft.uppercase,
    details: draft.details,
    arrangement: draft.arrangement,
    art: cleanBox(draft.art),
    palette,
    kicker: keep(draft.kicker, 34) ?? '',
    headline: keep(draft.headline, 40) ?? clip(o.title, 40),
    headlineAccent: keep(draft.headlineAccent, 34),
    pitch,
    highlight,
    stats: draft.stats
      .map((s) => ({ value: clip(s.value, 16), label: clip(s.label, 18) }))
      .filter((s) => s.value && backed(`${s.value} ${s.label}`))
      .slice(0, 3),
    chips: draft.chips.map((c) => clip(c, 24)).filter((c) => c && backed(c)).slice(0, 4),
    badge: keep(draft.badge, 20),
    focus: draft.focus,
  };
}

/** The reviewer's look at the part of the picture a poster shows. */
export const ArtReviewSchema = z.object({
  hasWords: z.boolean(),
  cutsSubject: z.boolean(),
  mostlyEmpty: z.boolean(),
  art: Box.nullable(),
});

export type ArtReview = z.infer<typeof ArtReviewSchema>;

export const ART_REVIEW_SYSTEM = `You check the picture on a student opportunity poster before it is shown. Two images are attached: first the whole picture (usually the organizer's flyer), then the part of it the poster will show, cut out at the box you are given. The poster sets its own words around that part, so the part must not repeat the flyer's printed words.

Look at the cut-out part and answer:
- hasWords: true if it shows printed words, letters, numbers or logos, even partly or cut off at an edge (a few tiny letters far in the background do not count).
- cutsSubject: true if it cuts through the main thing in it (a building, a person, an illustration) so that it looks broken.
- mostlyEmpty: true if most of it is plain background with nothing to look at.
- art: when any of these is true, a better box as fractions of the WHOLE picture's width and height {"x","y","w","h"} (x and y the top-left corner) that shows the picture's illustration or photo whole, with no printed words and little empty background. If the flyer is all words, choose its most striking area without words (a texture or background graphic). When all three are false, repeat the box you were given. Null only if no part of the picture is free of words.`;

/** What the reviewer is told about the part it checks. */
export function artReviewBrief(full: string, part: string, box: { x: number; y: number; w: number; h: number }): string {
  return `Whole picture: "${full}". The part the poster shows: "${part}", cut out at x ${box.x}, y ${box.y}, w ${box.w}, h ${box.h} (fractions of the whole picture). Look at both images closely before you answer.`;
}

/** True when the reviewer found nothing wrong with the part. */
export const artIsClean = (r: ArtReview) => !r.hasWords && !r.cutsSubject && !r.mostlyEmpty;

/** The Feed tab's icon for a card with no logo: one square SVG the agent draws. */
export const IconSchema = z.object({ svg: z.string() });

export const ICON_SYSTEM = `You draw the icon for one opportunity in a student opportunities app. It is shown in the app's list beside the opportunity's name, like an app icon: it must be clear at small sizes and look professionally designed.

Rules: one <svg> element with viewBox="0 0 512 512" and no width or height. A background that fills the whole square (a rect or gradient; no rounded corners, the app rounds them), then one bold, simple symbol of what the opportunity is about, centred and about 60% of the square: for example a trophy or a laptop with a spark for a hackathon, a flask for a lab, a briefcase for an internship, a graduation cap for a scholarship, a microphone or stage for a talk, people for a club, or something more specific that fits its field (a robot arm, a chart, a DNA helix, a clock tower for a campus event). Flat shapes, paths and gradients only. No words, letters or numbers. No <image>, <use>, <style>, <script>, <text>, links, external references or data URLs. Under 6000 characters.

Style: when a flyer is attached, match it: its colours, and its graphic look (pixel blocks, thin gold line art, soft gradients, flat bold shapes, a starry night). Otherwise use the colours you are given, with the symbol in the accent colour or the text colour on the background colour.`;

/** What the icon drawer is told about the card. */
export function iconBrief(o: Opportunity, palette: { background: string; text: string; accent: string } | null, flyerFile: string | null): string {
  const look = flyerFile !== null ? `The organizer's flyer is attached as the image file "${flyerFile}". Look at it and draw in its style and colours.` : palette ? `Colours: background ${palette.background}, symbol ${palette.accent}, details ${palette.text}.` : 'Choose calm colours that suit the field.';
  return `${look}\n\nThe opportunity:\n${JSON.stringify({ type: o.type, title: o.title, organizer: o.organizer, field: o.field, tags: o.tags, whyItFits: o.fitExplanation }, null, 2)}`;
}
