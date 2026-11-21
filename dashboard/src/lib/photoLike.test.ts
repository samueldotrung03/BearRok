import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { initialState } from '../data/sample.ts';
import { reducer } from '../state/store.ts';
import { PHOTO_CLICK_DELAY_MS, photoDoubleClickLikes, stepPhotoGesture, type PhotoEffect, type PhotoEvent, type PhotoPhase } from './photoLike.ts';

function play(events: PhotoEvent[]): PhotoEffect[] {
  let phase: PhotoPhase = 'idle';
  const effects: PhotoEffect[] = [];
  for (const event of events) {
    const next = stepPhotoGesture(phase, event);
    phase = next.phase;
    effects.push(next.effect);
  }
  return effects;
}

describe('photo double-click', () => {
  it('treats one click as the photo\'s existing action', () => {
    expect(play(['click', 'timeout'])).toEqual(['arm', 'single']);
  });

  it('likes once when the second press and the double-click event both arrive', () => {
    expect(play(['click', 'click-again', 'double', 'timeout'])).toEqual(['arm', 'like', 'none', 'none']);
    expect(play(['click', 'double'])).toEqual(['arm', 'like']);
    // A dblclick with no earlier click, and a second press after the single action already ran.
    expect(play(['double'])).toEqual(['like']);
    expect(play(['click', 'timeout', 'click-again', 'double'])).toEqual(['arm', 'single', 'like', 'none']);
  });

  it('does not run the single-click action on a double-click', () => {
    expect(play(['click', 'click-again'])).not.toContain('single');
  });

  it('accepts another single click after a double-click', () => {
    expect(play(['click', 'double', 'click', 'timeout'])).toEqual(['arm', 'like', 'arm', 'single']);
  });

  it('likes through the same action as the Like button, and does not unlike', () => {
    const id = 'opp-northwind-swe';
    expect(photoDoubleClickLikes(false)).toBe(true);
    const liked = reducer(initialState, { type: 'toggleLiked', id });
    expect(liked.liked).toContain(id);
    // Already liked: the button would toggle it off. A second double-click must not.
    expect(photoDoubleClickLikes(liked.liked.includes(id))).toBe(false);
    expect(reducer(liked, { type: 'toggleLiked', id }).liked).not.toContain(id);
  });

  it('waits long enough to tell a double-click from a single click', () => {
    expect(PHOTO_CLICK_DELAY_MS).toBeGreaterThanOrEqual(300);
    expect(PHOTO_CLICK_DELAY_MS).toBeLessThanOrEqual(500);
  });
});

describe('feed row layout', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

  it('stacks the text under the photo from the card\'s own width', () => {
    const block = css.slice(css.indexOf('@container feed-row (max-width: 560px)'));
    const rule = block.slice(0, block.indexOf('.photo-like-burst'));
    expect(css).toContain('container-name: feed-row');
    expect(rule).toContain('.feed-row-media');
    expect(rule).toContain('.feed-row-body');
    expect(rule).toContain('width: 100%');
    expect(rule.match(/width: 100%/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('fades the heart instead of bursting it when motion is reduced', () => {
    expect(css).toContain('.photo-like-burst');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.photo-like-heart \{[^}]*photo-like-fade/s);
  });
});
