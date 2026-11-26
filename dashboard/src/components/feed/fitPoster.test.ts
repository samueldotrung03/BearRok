// The For You poster measures itself after drawing: nothing may overlap or run off, and a large
// empty gap is filled by growing the picture or the words.
import { describe, expect, it } from 'vitest';
import { fitPoster } from './ReelPoster.tsx';

/** A drawn poster as plain boxes (pixels): a 400 x 640 card, a top row, a caption, and the column's parts. */
function drawn({ parts, topBottom = 60, captionTop = 500, scrollExtra = 0, context = 'reel', spill = 0 }: { parts: [number, number][]; topBottom?: number; captionTop?: number; scrollExtra?: number; context?: 'reel' | 'details'; spill?: number }) {
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 400, height: bottom - top, width: 400 });
  const caption = { getBoundingClientRect: () => rect(captionTop, 640) };
  const poster = {
    dataset: { context },
    clientWidth: 400,
    getBoundingClientRect: () => rect(0, 640),
    querySelector: (s: string) => (s === '.poster-top' ? { getBoundingClientRect: () => rect(0, topBottom) } : null),
    closest: () => ({ querySelector: () => caption }),
  };
  const body = {
    parentElement: poster,
    style: { top: '', bottom: '' },
    clientHeight: 400,
    scrollHeight: 400 + scrollExtra,
    children: parts.map(([t, b]) => ({ getBoundingClientRect: () => rect(t, b) })),
    // One line of words: as wide as its box, or wider by `spill` pixels.
    querySelectorAll: () => [{ clientWidth: 300, scrollWidth: 300 + spill }],
  };
  return body as unknown as HTMLElement;
}

describe('fitPoster', () => {
  it('moves the column clear of the top row and the caption', () => {
    const body = drawn({ parts: [[100, 480]], topBottom: 90, captionTop: 520 });
    fitPoster(body, { trim: 0, grow: 0, narrow: 0, done: false }, 'top');
    expect(body.style.top).toBe('102px');
    expect(body.style.bottom).toBe('128px');
  });

  it('in the details window, runs the column to just above the bottom edge, with no caption to keep clear of', () => {
    const body = drawn({ parts: [[100, 480]], topBottom: 90, captionTop: 520, context: 'details' });
    fitPoster(body, { trim: 0, grow: 0, narrow: 0, done: false }, 'top');
    expect(body.style.bottom).toBe('28px');
  });

  it('counts the parts\' own heights, so parts spread apart still leave room to grow', () => {
    expect(fitPoster(drawn({ parts: [[80, 150], [400, 470]] }), { trim: 0, grow: 0, narrow: 0, done: false }, 'top')).toEqual({ trim: 0, grow: 1, narrow: 0, done: false });
  });

  it('makes the type smaller when a word is wider than its line, rather than letting it spill', () => {
    expect(fitPoster(drawn({ parts: [[100, 300]], spill: 40 }), { trim: 0, grow: 0, narrow: 0, done: false }, 'side')).toEqual({ trim: 0, grow: 0, narrow: 1, done: false });
    expect(fitPoster(drawn({ parts: [[100, 300]], spill: 40 }), { trim: 0, grow: 2, narrow: 0, done: false }, 'side')).toEqual({ trim: 0, grow: 1, narrow: 0, done: true });
  });

  it('trims when the words and picture run past the column', () => {
    expect(fitPoster(drawn({ parts: [[80, 520]], scrollExtra: 40 }), { trim: 0, grow: 0, narrow: 0, done: false }, 'top')).toEqual({ trim: 1, grow: 0, narrow: 0, done: true });
  });

  it('steps back one grow when growing made it run past, and stops there', () => {
    expect(fitPoster(drawn({ parts: [[80, 520]], scrollExtra: 20 }), { trim: 0, grow: 3, narrow: 0, done: false }, 'side')).toEqual({ trim: 0, grow: 2, narrow: 0, done: true });
  });

  it('grows while more than a tenth of the column is empty', () => {
    expect(fitPoster(drawn({ parts: [[100, 300]] }), { trim: 0, grow: 0, narrow: 0, done: false }, 'top')).toEqual({ trim: 0, grow: 1, narrow: 0, done: false });
    expect(fitPoster(drawn({ parts: [[100, 470]] }), { trim: 0, grow: 1, narrow: 0, done: false }, 'top')).toBeNull();
  });

  it('leaves a photo under the words alone, and stops once settled', () => {
    expect(fitPoster(drawn({ parts: [[300, 480]] }), { trim: 0, grow: 0, narrow: 0, done: false }, 'overlay')).toBeNull();
    expect(fitPoster(drawn({ parts: [[100, 300]] }), { trim: 0, grow: 2, narrow: 0, done: true }, 'top')).toBeNull();
  });
});
