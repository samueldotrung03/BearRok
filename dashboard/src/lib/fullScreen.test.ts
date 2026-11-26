// In full screen the desktop window hides its buttons, and the page drops the room it keeps for them.
import { describe, expect, it } from 'vitest';
import { followFullScreen } from './desktopBridge.ts';

function fakeRoot() {
  const classes = new Set<string>();
  return {
    classes,
    root: { classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) } } as unknown as HTMLElement,
  };
}

describe('followFullScreen', () => {
  it('sets is-fullscreen while the window is in full screen and clears it on leaving', () => {
    let send: (on: boolean) => void = () => {};
    let stopped = false;
    const bridge = {
      platform: 'darwin',
      onFullScreen: (cb: (on: boolean) => void) => {
        send = cb;
        return () => {
          stopped = true;
        };
      },
    } as unknown as Parameters<typeof followFullScreen>[0];
    const { root, classes } = fakeRoot();
    const stop = followFullScreen(bridge, root);
    send(true);
    expect(classes.has('is-fullscreen')).toBe(true);
    send(false);
    expect(classes.has('is-fullscreen')).toBe(false);
    stop();
    expect(stopped).toBe(true);
  });

  it('does nothing in a browser or an older desktop shell', () => {
    const { root, classes } = fakeRoot();
    followFullScreen(undefined, root)();
    followFullScreen({ platform: 'darwin' } as Parameters<typeof followFullScreen>[0], root)();
    expect(classes.size).toBe(0);
  });
});
