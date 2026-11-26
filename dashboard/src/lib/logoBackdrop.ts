// The colour round a logo's edge, so a tile can be filled with it and the logo looks as if it
// runs to the tile's edges. Read from a small copy of the logo drawn on a canvas, fetched through
// the backend (GET /api/picture) since most logo servers do not let pages read pixels. A logo
// whose edge is see-through or mixed, or that cannot be read, gets no colour (the tile is white).
import { useEffect, useState } from 'react';
import { API_URL } from '../auth/firebase.ts';

/** What a logo's edge is: one colour, see-through, or mixed (a photo labelled as a logo). */
export type Edge = { kind: 'solid'; colour: string } | { kind: 'clear' } | { kind: 'mixed' };

/** The one colour of a logo's outer ring of pixels, or null when the ring is see-through or mixed. */
export function edgeColour(pixels: Uint8ClampedArray, width: number, height: number): string | null {
  const edge = readEdge(pixels, width, height);
  return edge.kind === 'solid' ? edge.colour : null;
}

export function readEdge(pixels: Uint8ClampedArray, width: number, height: number): Edge {
  const ring: [number, number, number][] = [];
  let clear = 0;
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (pixels[i + 3]! < 200) clear++;
    else ring.push([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]);
  };
  for (let x = 0; x < width; x++) {
    take(x, 0);
    take(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    take(0, y);
    take(width - 1, y);
  }
  const total = ring.length + clear;
  // Mostly see-through: a transparent logo, best on white.
  if (!total || ring.length < total * 0.6) return { kind: 'clear' };
  const mean = [0, 1, 2].map((c) => ring.reduce((sum, p) => sum + p[c]!, 0) / ring.length) as [number, number, number];
  // A mixed edge (a photo, a gradient) is no single colour to fill with.
  const spread = ring.reduce((sum, p) => sum + Math.abs(p[0] - mean[0]) + Math.abs(p[1] - mean[1]) + Math.abs(p[2] - mean[2]), 0) / ring.length;
  if (spread > 36) return { kind: 'mixed' };
  return { kind: 'solid', colour: `rgb(${mean.map(Math.round).join(' ')})` };
}

/** The edge of the logo at `src`, once read; null until then or when it cannot be read. */
export function useLogoBackdrop(src: string | null): Edge | null {
  const [colour, setColour] = useState<{ src: string; value: Edge | null } | null>(null);
  useEffect(() => {
    if (!src || typeof document === 'undefined') return;
    let live = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // Through the backend, which lets the page read the pixels; most logo servers do not.
    img.onload = () => {
      let value: Edge | null = null;
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, size, size);
          value = readEdge(ctx.getImageData(0, 0, size, size).data, size, size);
        }
      } catch {
        // The logo's server does not let pages read its pixels.
      }
      if (live) setColour({ src, value });
    };
    img.onerror = () => live && setColour({ src, value: null });
    // A drawn icon is already on the page (a data URL) and is read directly.
    img.src = src.startsWith('data:') ? src : `${API_URL}/api/picture?url=${encodeURIComponent(src)}`;
    return () => {
      live = false;
    };
  }, [src]);
  return colour && colour.src === src ? colour.value : null;
}
