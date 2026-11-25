/* The "busy" badge: an orange dot with a dark ring in the bottom-right corner, drawn over the pixels of an icon. */
import { describe, expect, it } from 'vitest';
import { BADGE_FILL, BADGE_RING, drawBadge } from '../../src/shared/badge';

/** BGRA bytes of one pixel. */
const at = (bmp: Uint8Array, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4;
  return { b: bmp[i]!, g: bmp[i + 1]!, r: bmp[i + 2]!, a: bmp[i + 3]! };
};
const filled = (size: number, bgra: [number, number, number, number]) => {
  const bmp = new Uint8Array(size * size * 4);
  for (let i = 0; i < bmp.length; i += 4) bmp.set(bgra, i);
  return bmp;
};

describe('busy badge', () => {
  it('on a transparent 16 px icon: an orange dot of 8 px in the bottom-right corner, with a dark ring, the rest untouched', () => {
    const before = new Uint8Array(16 * 16 * 4);
    const after = drawBadge(before, 16, 16);
    expect(before.every((v) => v === 0)).toBe(true); // a copy: the icon itself is not changed
    expect(at(after, 16, 11, 11)).toEqual({ r: BADGE_FILL[0], g: BADGE_FILL[1], b: BADGE_FILL[2], a: 255 }); // the middle of the dot
    // the ring: at 16 px it falls between two pixels, so it is a soft dark line (orange and ring mixed)
    const ring = at(after, 16, 11, 14);
    expect(ring.a).toBe(255);
    expect(ring.r).toBe(Math.round((BADGE_RING[0] + BADGE_FILL[0]) / 2));
    expect(ring.g).toBe(Math.round((BADGE_RING[1] + BADGE_FILL[1]) / 2));
    expect(at(after, 16, 11, 15).a).toBe(128); // the edge, half covered: smooth
    expect(at(after, 16, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(at(after, 16, 6, 11)).toEqual({ r: 0, g: 0, b: 0, a: 0 }); // left of the dot
    const touched = new Set<number>();
    for (let p = 0; p < 256; p++) if (after[p * 4 + 3]) touched.add(p);
    expect(Math.min(...[...touched].map((p) => p % 16))).toBe(7);
    expect(Math.min(...[...touched].map((p) => Math.floor(p / 16)))).toBe(7);
  });

  it('over an opaque icon the dot covers it, its soft edge mixes with it', () => {
    const white = drawBadge(filled(16, [255, 255, 255, 255]), 16, 16);
    expect(at(white, 16, 11, 11)).toEqual({ r: 255, g: 140, b: 0, a: 255 });
    const edge = at(white, 16, 11, 15);
    expect(edge.a).toBe(255);
    expect(edge.r).toBe(Math.round(BADGE_RING[0] * 0.5 + 255 * 0.5));
    expect(at(white, 16, 2, 2)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it('scales with the icon (32 px on HiDPI) and uses the smaller side of a wide one; tiny icons work too', () => {
    const big = drawBadge(new Uint8Array(32 * 32 * 4), 32, 32);
    expect(at(big, 32, 23, 23)).toMatchObject({ r: 255, g: 140, b: 0, a: 255 });
    expect(at(big, 32, 23, 29)).toMatchObject({ r: BADGE_RING[0], g: BADGE_RING[1], b: BADGE_RING[2], a: 255 }); // 2 px of ring: a full one
    const wide = drawBadge(new Uint8Array(20 * 16 * 4), 20, 16);
    expect(at(wide, 20, 15, 11)).toMatchObject({ r: 255, g: 140, b: 0, a: 255 });
    expect(at(wide, 20, 4, 11).a).toBe(0);
    const tiny = drawBadge(new Uint8Array(2 * 2 * 4), 2, 2);
    expect(at(tiny, 2, 1, 1).a).toBeGreaterThan(0);
    expect(at(tiny, 2, 0, 0).a).toBe(0);
  });
});
