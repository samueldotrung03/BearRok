// A card on the For You page drawn as a portrait poster, in the style of student event and
// recruiting posts: a hook line, a big headline with an accent part, a one-line pitch, stat
// blocks and chips. The card's picture is always part of it, sharp: for the organizer's flyer,
// the part the presentation agent chose (its illustration, not its printed words) sits beside,
// above, between or below the words, which are set in the flyer's own colours and kind of type.
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/oswald';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/space-grotesk';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { headlineSize, isLight, pitchParts, planArt, posterFor } from '../../lib/poster.ts';
import type { Opportunity } from '../../types.ts';

type Box = { x: number; y: number; w: number; h: number };

const FOCUS = { top: '50% 12%', center: '50% 45%', bottom: '50% 85%', left: '18% 45%', right: '82% 45%' } as const;
const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 };

/** The picture's own width and height once it has loaded; null before, false if it cannot load. */
function usePictureSize(src: string | null): { w: number; h: number } | null | false {
  const [size, setSize] = useState<{ src: string; value: { w: number; h: number } | false } | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setSize({ src, value: img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : false });
    img.onerror = () => live && setSize({ src, value: false });
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return size && size.src === src ? size.value : null;
}

/** One part of a picture, cut out and shown at the given size (in card widths). */
function Crop({ src, box, width, height, framed, credit }: { src: string; box: Box; width: number; height: number; framed: boolean; credit?: ReactNode }) {
  return (
    <div className="poster-crop" data-framed={framed} style={{ width: `${width}cqw`, height: `${height}cqw` }}>
      {credit}
      <img
        aria-hidden="true"
        src={src}
        alt=""
        style={{ width: `${100 / box.w}%`, height: `${100 / box.h}%`, left: `${(-box.x / box.w) * 100}%`, top: `${(-box.y / box.h) * 100}%` }}
      />
    </div>
  );
}

export function ReelPoster({
  opportunity: o,
  overVideo = false,
  context = 'reel',
  titleId,
}: {
  opportunity: Opportunity;
  overVideo?: boolean;
  /**
   * reel: a For You card, with its caption over the bottom quarter. details: the opportunity's
   * window, where the poster has the whole frame and that frame may be taller than a card.
   */
  context?: 'reel' | 'details';
  /** The headline's id, for a dialog labelled by it. */
  titleId?: string;
}) {
  // The frame's height in card widths, measured, so a taller frame is planned as one.
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameHeight, setFrameHeight] = useState(160);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => {
      if (frame.clientWidth) setFrameHeight(Math.round((frame.clientHeight / frame.clientWidth) * 100));
    });
    watch.observe(frame);
    return () => watch.disconnect();
  }, []);
  const room = context === 'details' ? frameHeight - 24 : (frameHeight * 104) / 160;
  const full = posterFor(o);
  // The poster measures itself after drawing (see fitPoster below). When the words and picture do
  // not fit, it gives up room step by step (`trim`): chips after the first two, then all chips,
  // then the pitch's third line, then picture size. When a large gap is left, it grows (`grow`):
  // the picture first, then the headline, until the next step would no longer fit.
  // A word too long for its line (a headline, a stat) never wraps mid-word: the type gets
  // smaller step by step instead (`narrow`), and a picture beside the words moves above them.
  const [fit, setFit] = useState<Fit>({ trim: 0, grow: 0, narrow: 0, done: false });
  const { trim, grow, narrow } = fit;
  const p = { ...full, chips: trim >= 2 ? [] : trim >= 1 ? full.chips.slice(0, 2) : full.chips };
  const bodyRef = useRef<HTMLDivElement>(null);
  const logo = o.image !== null && o.imageKind === 'logo';
  const size = usePictureSize(o.image && !logo ? o.image : null);
  const [logoFailed, setLogoFailed] = useState(false);
  const picture = o.image && !logo && size !== false ? o.image : null;
  const box = p.art ?? WHOLE;
  const aspect = size ? (box.w * size.w) / (box.h * size.h) : 1.4;
  const planned = picture ? planArt(p, aspect, room, narrow < 3) : null;
  const shrink = trim >= 4 ? 0.8 ** (trim - 3) : 1;
  // Growing keeps the picture inside the poster's width (86) or, beside the words, under half of it.
  const widest = planned?.placement === 'side' ? 46 : 86;
  const pictureGrow = planned ? Math.min(1 + 0.14 * grow, widest / Math.max(planned.width, 1)) : 1;
  const plan = planned ? { ...planned, width: planned.width * shrink * pictureGrow, height: planned.height * shrink * pictureGrow } : null;
  // Steps the picture could not take go to the headline.
  const pictureSteps = planned ? Math.max(0, Math.log(pictureGrow) / Math.log(1.14)) : 0;
  const textGrow = 1 + 0.06 * Math.max(0, grow - Math.round(pictureSteps));
  const overlay = overVideo || plan?.placement === 'overlay';
  const layout = p.layout === 'flyer' && !(picture && o.imageKind === 'event') ? 'bold' : p.layout;
  const headline = [p.headline, p.headlineAccent].filter(Boolean).join(' ');
  // Without a picture the words are the poster, so they may grow further.
  const scale = (plan && !overlay ? 0.9 : 1) * Math.min(textGrow, context === 'details' || !plan ? 1.6 : 1.35) * 0.9 ** narrow;

  const style = {
    '--p-bg': p.palette.background,
    // Words over a photo sit in dark caption boxes, so they are white.
    '--p-text': overlay ? '#ffffff' : p.palette.text,
    '--p-accent': p.palette.accent,
    '--p-focus': picture && p.art ? `${(box.x + box.w / 2) * 100}% ${(box.y + box.h / 2) * 100}%` : FOCUS[p.focus],
    '--p-headline': `${headlineSize(headline, p.typeface) * scale}cqw`,
    '--p-stat-scale': 0.9 ** narrow,
  } as CSSProperties;

  const words = (
    <>
      {p.kicker && <p className="poster-kicker">{p.kicker}</p>}
      <h2 id={titleId ?? `${o.id}-title`} className="poster-headline">
        <span>{p.headline}</span>
        {p.headlineAccent && <span className="poster-accent">{p.headlineAccent}</span>}
      </h2>
    </>
  );
  const pitch = p.pitch ? (
    <p className="poster-pitch" data-short={trim >= 3}>
      {pitchParts(p.pitch, p.highlight).map((part, i) => (part.strong ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>))}
    </p>
  ) : null;
  const stats =
    p.stats.length > 0 ? (
      <dl className="poster-stats">
        {p.stats.map((s) => (
          <div key={`${s.label}${s.value}`}>
            <dd>{s.value}</dd>
            <dt>{s.label}</dt>
          </div>
        ))}
      </dl>
    ) : null;
  const chips =
    p.chips.length > 0 ? (
      <ul className="poster-chips">
        {p.chips.map((chip) => (
          <li key={chip}>{chip}</li>
        ))}
      </ul>
    ) : null;
  const credit =
    o.imageCredit && picture && o.imageKind === 'stock' ? (
      <span className="poster-credit">
        {o.imageCreditUrl ? (
          <a href={o.imageCreditUrl} target="_blank" rel="noreferrer">
            {o.imageCredit}
          </a>
        ) : (
          o.imageCredit
        )}
      </span>
    ) : null;
  const crop = picture && plan && !overlay ? <Crop src={picture} box={box} width={plan.width} height={plan.height} framed={plan.placement === 'middle'} credit={credit} /> : null;

  // The parts of the poster from top to bottom, by where the picture goes.
  const placement = picture && !size ? 'loading' : overlay ? 'overlay' : (plan?.placement ?? 'none');
  const wordsBlock = (withPitch: boolean) => (
    <div className="poster-words">
      {words}
      {withPitch && pitch}
    </div>
  );
  let parts: ReactNode[];
  if (placement === 'loading') parts = [wordsBlock(false)];
  else if (placement === 'side')
    parts = [
      <div key="side" className="poster-side">
        {wordsBlock(true)}
        {crop}
      </div>,
      stats,
      chips,
    ];
  else if (placement === 'top') parts = [crop, wordsBlock(true), stats, chips];
  else if (placement === 'middle') parts = [wordsBlock(false), crop, pitch, stats, chips];
  else if (placement === 'bottom') parts = [wordsBlock(true), stats, chips, crop];
  else parts = [wordsBlock(true), stats, chips];

  // Measured after drawing, and again once the poster's fonts have loaded, since they change the height.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);
  // The caption under the poster can change height (a long reason, wrapped chips); measure again when it does.
  const [captionTick, setCaptionTick] = useState(0);
  useEffect(() => {
    const caption = bodyRef.current?.closest('.reel-card')?.querySelector('.reel-body');
    if (!caption || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => setCaptionTick((t) => t + 1));
    watch.observe(caption);
    return () => watch.disconnect();
  }, []);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || placement === 'loading') return;
    const next = fitPoster(body, fit, placement);
    if (next) setFit(next);
  });
  useEffect(() => setFit({ trim: 0, grow: 0, narrow: 0, done: false }), [o.id, fontsReady, size, captionTick, frameHeight]);

  return (
    <div
      ref={frameRef}
      className="poster"
      data-context={context}
      data-layout={layout}
      data-typeface={p.typeface}
      data-upper={p.uppercase ?? p.typeface === 'condensed'}
      data-details={p.details ?? (layout === 'formal' ? 'pill' : 'boxed')}
      data-light={!overlay && isLight(p.palette.background)}
      data-overlay={overlay}
      data-subject={(p.art ? p.art.y + p.art.h / 2 : p.focus === 'bottom' ? 0.8 : 0.4) > 0.6 ? 'low' : 'high'}
      data-video={overVideo}
      // The measuring steps taken (trim/grow/narrow), for checking a poster's layout.
      data-fit={`${trim}/${grow}/${narrow}${fit.done ? '/settled' : ''}`}
      style={style}
    >
      {/* A remade flyer keeps a faint, blurred trace of the flyer behind it, so its colours run on. */}
      {picture && layout === 'flyer' && !overlay && <img src={picture} alt="" aria-hidden="true" className="poster-trace" />}
      {picture && overlay && !overVideo && <img src={picture} alt="" aria-hidden="true" className="poster-full" />}
      {!picture && !overVideo && <div className="poster-glow" aria-hidden="true" />}

      <div className="poster-top">
        {logo && !logoFailed ? (
          <span className="poster-logo">
            <img src={o.image!} alt={`${o.organizer} logo`} onError={() => setLogoFailed(true)} />
          </span>
        ) : (
          <span className="poster-org">{o.organizer}</span>
        )}
        {p.badge && <span className="poster-badge">{p.badge}</span>}
        {/* A photo under the words carries its credit in the top row, which the words always start below. */}
        {overlay && credit}
      </div>

      <div ref={bodyRef} className="poster-body" data-placement={placement}>
        {parts.filter(Boolean).map((part, i) => (
          <PosterSlot key={i}>{part}</PosterSlot>
        ))}
      </div>


    </div>
  );
}

type Fit = { trim: number; grow: number; narrow: number; done: boolean };

/**
 * One measuring step after the poster is drawn. First the column is moved clear of the top row
 * (organizer, logo, badge) and of the card's caption, so nothing overlaps. Then: if the words and
 * picture run past the column, step back a grow or trim once more; if more than a tenth of the
 * column is left empty, grow once more. Returns the next fit, or null when it is settled.
 */
export function fitPoster(body: HTMLElement, fit: Fit, placement: string): Fit | null {
  const poster = body.parentElement!;
  const unit = poster.clientWidth / 100;
  const top = poster.querySelector('.poster-top');
  const details = poster.dataset.context === 'details';
  const caption = details ? null : poster.closest('.reel-card')?.querySelector('.reel-body');
  const box = poster.getBoundingClientRect();
  if (!unit || !box.height) return null;
  const topEdge = top ? top.getBoundingClientRect().bottom - box.top + 3 * unit : 17 * unit;
  // In the details window there is no caption: the column runs to just above the bottom edge.
  const bottomEdge = details ? 7 * unit : caption ? box.bottom - caption.getBoundingClientRect().top + 2 * unit : box.height * 0.24;
  const wantTop = `${Math.max(topEdge, 15 * unit)}px`;
  const wantBottom = `${details ? bottomEdge : Math.max(bottomEdge, box.height * 0.18)}px`;
  if (body.style.top !== wantTop) body.style.top = wantTop;
  if (body.style.bottom !== wantBottom) body.style.bottom = wantBottom;

  const parts = [...body.children] as HTMLElement[];
  if (!parts.length || !body.clientHeight) return null;
  // The parts' own heights and the gaps between them, so spreading them out does not count as filling.
  let gap = 0;
  try {
    gap = parseFloat(getComputedStyle(body).rowGap) || 0;
  } catch {
    // Not drawn by a browser (tests): no gap.
  }
  const used = parts.reduce((sum, part) => sum + part.getBoundingClientRect().height, 0) + gap * (parts.length - 1);
  // A word wider than its line spills sideways, under the picture or off the edge.
  const lines = typeof body.querySelectorAll === 'function' ? [...body.querySelectorAll<HTMLElement>('.poster-headline > span, .poster-stats dd, .poster-kicker, .poster-chips li')] : [];
  if (lines.some((line) => line.scrollWidth > line.clientWidth + 1)) {
    if (fit.grow > 0) return { ...fit, grow: fit.grow - 1, done: true };
    // Smaller type leaves the picture free to grow again afterwards.
    return fit.narrow < 8 ? { ...fit, narrow: fit.narrow + 1 } : null;
  }
  // The parts' heights decide; the scroll height only counts beyond a small margin, since letters
  // that hang below their line (g, p, y in a big stat) add a few pixels without anything overlapping.
  const overflow = used > body.clientHeight + 1 || body.scrollHeight > body.clientHeight + Math.max(8, 2 * unit);
  if (overflow) {
    if (fit.grow > 0) return { ...fit, grow: fit.grow - 1, done: true };
    return fit.trim < 6 ? { ...fit, trim: fit.trim + 1, done: true } : null;
  }
  // A photo under the words is meant to show around them; only the other layouts fill gaps.
  if (!fit.done && placement !== 'overlay' && body.clientHeight - used > body.clientHeight * 0.1 && fit.grow < 12) return { ...fit, grow: fit.grow + 1 };
  return null;
}

function PosterSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
