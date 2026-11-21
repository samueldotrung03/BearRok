// A double-click on a card's photo. It dispatches the same `toggleLiked` action as the Like
// button, so the account and the agents hear it through the same path, and it never removes a like.
import { Heart } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { PHOTO_CLICK_DELAY_MS, photoDoubleClickLikes, stepPhotoGesture, type PhotoPhase } from '../lib/photoLike.ts';
import { useStore } from '../state/StoreProvider.tsx';

export type PhotoPointerHandlers = {
  onClick: (event: MouseEvent) => void;
  onDoubleClick: (event: MouseEvent) => void;
};

/**
 * Pointer handlers for one photo. `onSingle` is what a click on that photo already did.
 * `undoSingle` runs only when that action already happened and the gesture turns out to be
 * a double-click, so opening the details or pausing the clip does not stick.
 */
export function usePhotoLike(id: string, onSingle: () => void, undoSingle?: () => void): { burst: number; photoHandlers: PhotoPointerHandlers } {
  const { state, dispatch } = useStore();
  const [burst, setBurst] = useState(0);
  const phase = useRef<PhotoPhase>('idle');
  const timer = useRef<number | null>(null);
  const singleRan = useRef(false);
  const likedRef = useRef(false);
  const singleRef = useRef(onSingle);
  const undoRef = useRef(undoSingle);
  const dispatchRef = useRef(dispatch);
  const idRef = useRef(id);
  likedRef.current = state.liked.includes(id);
  singleRef.current = onSingle;
  undoRef.current = undoSingle;
  dispatchRef.current = dispatch;
  idRef.current = id;

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clearTimer, []);

  const like = () => {
    clearTimer();
    if (singleRan.current) {
      singleRan.current = false;
      undoRef.current?.();
    }
    if (photoDoubleClickLikes(likedRef.current)) {
      // The ref updates before the next render, so a second event in this turn cannot toggle it off.
      likedRef.current = true;
      dispatchRef.current({ type: 'toggleLiked', id: idRef.current });
    }
    setBurst((n) => n + 1);
  };

  const apply = (event: 'click' | 'click-again' | 'double') => {
    const next = stepPhotoGesture(phase.current, event);
    phase.current = next.phase;
    if (next.effect === 'arm') {
      singleRan.current = false;
      clearTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const done = stepPhotoGesture(phase.current, 'timeout');
        phase.current = done.phase;
        if (done.effect === 'single') {
          singleRan.current = true;
          singleRef.current();
        }
      }, PHOTO_CLICK_DELAY_MS);
    } else if (next.effect === 'like') {
      like();
    }
  };

  return {
    burst,
    photoHandlers: {
      // Do not cancel mousedown. In Chromium that also drops the click and the dblclick,
      // so the like never runs. Text selection is stopped with user-select on the photo.
      onClick: (event) => {
        if (event.detail > 1) event.preventDefault();
        apply(event.detail > 1 ? 'click-again' : 'click');
      },
      onDoubleClick: (event) => {
        event.preventDefault();
        apply('double');
      },
    },
  };
}

/** The heart that flashes on the photo. `tick` restarts it; zero shows nothing. */
export function PhotoLikeBurst({ tick }: { tick: number }) {
  if (tick === 0) return null;
  return (
    <span key={tick} className="photo-like-burst" aria-hidden="true">
      <Heart className="photo-like-heart" fill="currentColor" strokeWidth={1.75} />
    </span>
  );
}
