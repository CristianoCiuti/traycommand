/**
 * The "busy" badge drawn over an icon while its entry runs: an orange dot with a dark ring in the
 * bottom-right corner, anti-aliased. Works on the raw pixels of the icon (BGRA, premultiplied alpha,
 * as Electron's NativeImage gives them), at any size: 16 px for the tray, 32 px on HiDPI screens.
 */

/** Colours of the badge (RGB). */
export const BADGE_FILL = [255, 140, 0] as const;
export const BADGE_RING = [28, 22, 18] as const;

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A copy of `bitmap` (width × height, 4 bytes per pixel, BGRA premultiplied) with the badge over it. */
export function drawBadge(bitmap: Uint8Array, width: number, height: number): Uint8Array {
  const out = Uint8Array.from(bitmap);
  const size = Math.min(width, height);
  const radius = size * 0.25; // 4 px on a 16 px icon
  const ring = size / 16; // 1 px on a 16 px icon
  const margin = size / 32;
  const cx = width - radius - margin;
  const cy = height - radius - margin;
  for (let y = Math.max(0, Math.floor(cy - radius - 1)); y < height; y++) {
    for (let x = Math.max(0, Math.floor(cx - radius - 1)); x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // how much of the pixel the dot covers, and how much of it is the orange inside the ring
      const alpha = clamp(radius - d + 0.5);
      if (alpha === 0) continue;
      const fill = clamp(radius - ring - d + 0.5);
      const i = (y * width + x) * 4;
      // BGRA: blue, green, red at 0, 1, 2; source over destination, premultiplied
      for (const [c, rgb] of [[0, 2], [1, 1], [2, 0]] as const) {
        const colour = BADGE_RING[rgb] * (1 - fill) + BADGE_FILL[rgb] * fill;
        out[i + c] = Math.round(colour * alpha + out[i + c]! * (1 - alpha));
      }
      out[i + 3] = Math.round(255 * alpha + out[i + 3]! * (1 - alpha));
    }
  }
  return out;
}
