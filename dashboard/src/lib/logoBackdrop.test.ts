// A Feed tab logo tile is filled with the colour round the logo's edge, or white.
import { describe, expect, it } from 'vitest';
import { edgeColour, readEdge } from './logoBackdrop.ts';

/** A size x size picture: one colour round the edge, another inside. */
function picture(size: number, edge: [number, number, number, number], inside: [number, number, number, number] = [255, 255, 255, 255]) {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) px.set(x === 0 || y === 0 || x === size - 1 || y === size - 1 ? edge : inside, (y * size + x) * 4);
  return px;
}

describe('edgeColour', () => {
  it('reads one solid colour round the edge', () => {
    expect(edgeColour(picture(8, [99, 91, 255, 255]), 8, 8)).toBe('rgb(99 91 255)');
  });

  it('gives none for a see-through edge, so the tile is white', () => {
    expect(edgeColour(picture(8, [0, 0, 0, 0]), 8, 8)).toBeNull();
  });

  it('gives none for a mixed edge', () => {
    const px = picture(8, [255, 255, 255, 255]);
    for (let x = 0; x < 8; x += 2) px.set([0, 0, 0, 255], x * 4);
    for (let x = 0; x < 8; x += 2) px.set([0, 0, 0, 255], (7 * 8 + x) * 4);
    expect(edgeColour(px, 8, 8)).toBeNull();
    expect(readEdge(px, 8, 8).kind).toBe('mixed');
    expect(readEdge(picture(8, [0, 0, 0, 0]), 8, 8).kind).toBe('clear');
  });
});
