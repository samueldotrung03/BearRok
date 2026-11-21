// Double-click on a card photo likes it the way the Like button does, without turning a
// like off again. The first click still does what the photo already did (open the details,
// pause the clip) once it is clear the click is not the start of a double-click.

/** How long a lone click waits before it counts as a single click, not half of a double-click.
 *  Matches a typical system double-click interval, so the second press lands before the
 *  single-click action (opening the details) can cover the photo. */
export const PHOTO_CLICK_DELAY_MS = 500;

export type PhotoPhase = 'idle' | 'waiting' | 'done';

/** `click` is the first press. `click-again` is the second press of a double-click. */
export type PhotoEvent = 'click' | 'click-again' | 'double' | 'timeout';

export type PhotoEffect = 'none' | 'arm' | 'single' | 'like';

/**
 * One photo gesture. A double-click reports `like` once. The second press and the
 * `dblclick` event both arrive, and a slow second press still likes after the single
 * action has already run. A later event in that same gesture does not like again.
 */
export function stepPhotoGesture(phase: PhotoPhase, event: PhotoEvent): { phase: PhotoPhase; effect: PhotoEffect } {
  if (event === 'click') return { phase: 'waiting', effect: 'arm' };
  if (event === 'click-again' || event === 'double') {
    return phase === 'done' ? { phase: 'done', effect: 'none' } : { phase: 'done', effect: 'like' };
  }
  if (phase === 'waiting') return { phase: 'idle', effect: 'single' };
  return { phase: 'idle', effect: 'none' };
}

/** A double-click likes a card that is not liked yet, and leaves one that is already liked. */
export function photoDoubleClickLikes(alreadyLiked: boolean): boolean {
  return !alreadyLiked;
}
