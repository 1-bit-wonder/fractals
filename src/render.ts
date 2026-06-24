// Shared 1-bit rendering pipeline.
//
// Every fractal generator produces an 8-bit `brightness` buffer (one byte per
// pixel, 0 = darkest). `quantize` is the single place that collapses those
// bytes to one bit of ink, so the whole app stays consistently 1-bit.

export type Quant = "threshold" | "bayer";

// Normalised 8x8 ordered-dither (Bayer) matrix, values 0..63.
// prettier-ignore
const BAYER8 = new Uint8Array([
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]);

/** A fresh brightness buffer filled with white (255 = background). */
export function whiteBuffer(size: number): Uint8Array {
  const buf = new Uint8Array(size * size);
  buf.fill(255);
  return buf;
}

/** Stamp a single ink pixel (clamped to bounds). */
export function plot(buf: Uint8Array, size: number, x: number, y: number, value = 0): void {
  const xi = x | 0;
  const yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
  buf[yi * size + xi] = value;
}

/** Bresenham line of ink between two points. */
export function drawLine(
  buf: Uint8Array, size: number,
  x0: number, y0: number, x1: number, y1: number, value = 0,
): void {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(buf, size, x0, y0, value);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * Fit a list of [x, y] points into the square (with padding) and draw them as
 * a connected path. Used by the geometric line fractals (Koch, dragon).
 */
export function fitPath(
  buf: Uint8Array, size: number,
  points: ReadonlyArray<readonly [number, number]>,
  closed = false, pad = 0.08,
): void {
  if (points.length < 2) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const inner = size * (1 - 2 * pad);
  const s = Math.min(inner / spanX, inner / spanY);
  // Centre the fitted bounding box inside the square.
  const offX = (size - spanX * s) / 2;
  const offY = (size - spanY * s) / 2;
  const tx = (x: number) => offX + (x - minX) * s;
  const ty = (y: number) => offY + (y - minY) * s;

  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    drawLine(buf, size, tx(a[0]), ty(a[1]), tx(b[0]), ty(b[1]));
  }
}

/**
 * Fit a list of independent line segments [x0, y0, x1, y1] into the square and
 * draw them. Used for fractals made of disjoint strokes (e.g. Pythagoras tree).
 */
export function fitSegments(
  buf: Uint8Array, size: number,
  segments: ReadonlyArray<readonly [number, number, number, number]>,
  pad = 0.06,
): void {
  if (segments.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x0, y0, x1, y1] of segments) {
    minX = Math.min(minX, x0, x1);
    minY = Math.min(minY, y0, y1);
    maxX = Math.max(maxX, x0, x1);
    maxY = Math.max(maxY, y0, y1);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const inner = size * (1 - 2 * pad);
  const s = Math.min(inner / spanX, inner / spanY);
  const offX = (size - spanX * s) / 2;
  const offY = (size - spanY * s) / 2;
  for (const [x0, y0, x1, y1] of segments) {
    drawLine(
      buf, size,
      offX + (x0 - minX) * s, offY + (y0 - minY) * s,
      offX + (x1 - minX) * s, offY + (y1 - minY) * s,
    );
  }
}

/** Collapse a brightness buffer to a 1-bit black/white ImageData. */
export function quantize(
  bright: Uint8Array, size: number, mode: Quant, invert: boolean,
): ImageData {
  const img = new ImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const threshold =
        mode === "bayer" ? ((BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64) * 255 : 128;
      let ink = bright[i] < threshold;
      if (invert) ink = !ink;
      const c = ink ? 0 : 255;
      const o = i * 4;
      d[o] = c;
      d[o + 1] = c;
      d[o + 2] = c;
      d[o + 3] = 255;
    }
  }
  return img;
}
