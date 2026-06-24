// Geometric / IFS fractals, generated in TypeScript.
//
// These are cheap enough that WASM buys nothing; they run plenty fast in JS.
// Each generator returns an 8-bit brightness buffer (255 background, 0 ink)
// to feed the shared `quantize` pipeline.

import { whiteBuffer, plot, fitPath, fitSegments } from "./render.js";

/** Small, fast, seedable PRNG (mulberry32) for the chaos-game fractals. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Sierpinski triangle (chaos game) -------------------------------------

export function sierpinski(size: number, detail: number, seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const pad = size * 0.06;
  const verts: Array<[number, number]> = [
    [size / 2, pad],
    [pad, size - pad],
    [size - pad, size - pad],
  ];
  const rng = mulberry32(seed);
  const iterations = Math.floor(size * size * (0.4 + detail / 20));
  let x = size / 2;
  let y = size / 2;
  for (let i = 0; i < iterations; i++) {
    const v = verts[(rng() * 3) | 0];
    x = (x + v[0]) * 0.5;
    y = (y + v[1]) * 0.5;
    if (i > 10) plot(buf, size, x, y);
  }
  return buf;
}

// --- Barnsley fern (chaos game / IFS) -------------------------------------

export function fern(size: number, detail: number, seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const rng = mulberry32(seed);
  const iterations = Math.floor(size * size * (0.8 + detail / 10));
  // Native fern bounds: x in [-2.182, 2.658], y in [0, 9.999].
  const minX = -2.182, maxX = 2.658, maxY = 9.9983;
  const spanX = maxX - minX;
  const pad = 0.06;
  const inner = 1 - 2 * pad;
  let x = 0, y = 0;
  for (let i = 0; i < iterations; i++) {
    const r = rng();
    let nx: number, ny: number;
    if (r < 0.01) {
      nx = 0; ny = 0.16 * y;
    } else if (r < 0.86) {
      nx = 0.85 * x + 0.04 * y;
      ny = -0.04 * x + 0.85 * y + 1.6;
    } else if (r < 0.93) {
      nx = 0.2 * x - 0.26 * y;
      ny = 0.23 * x + 0.22 * y + 1.6;
    } else {
      nx = -0.15 * x + 0.28 * y;
      ny = 0.26 * x + 0.24 * y + 0.44;
    }
    x = nx; y = ny;
    if (i > 20) {
      // Normalise to [0,1], flip Y (fern grows upward), then fit to square.
      const u = (x - minX) / spanX;
      const v = y / maxY;
      plot(buf, size, (pad + u * inner) * size, (pad + (1 - v) * inner) * size);
    }
  }
  return buf;
}

// --- Sierpinski carpet (deterministic, resolution-independent) ------------

export function carpet(size: number, detail: number, _seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const levels = Math.max(1, Math.min(7, Math.round(detail)));
  let pow = 1;
  for (let k = 0; k < levels; k++) pow *= 3;
  const pad = Math.floor(size * 0.04);
  const span = size - 2 * pad;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let gx = Math.floor(((px - pad) / span) * pow);
      let gy = Math.floor(((py - pad) / span) * pow);
      if (gx < 0 || gy < 0 || gx >= pow || gy >= pow) continue;
      let solid = true;
      for (let k = 0; k < levels; k++) {
        if (gx % 3 === 1 && gy % 3 === 1) { solid = false; break; }
        gx = (gx / 3) | 0;
        gy = (gy / 3) | 0;
      }
      if (solid) buf[py * size + px] = 0;
    }
  }
  return buf;
}

// --- Koch snowflake -------------------------------------------------------

export function koch(size: number, detail: number, _seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const iters = Math.max(0, Math.min(6, Math.round(detail)));
  const h = Math.sqrt(3) / 2;
  let pts: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0.5, h],
  ];
  for (let it = 0; it < iters; it++) {
    const next: Array<[number, number]> = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = (b[0] - a[0]) / 3;
      const dy = (b[1] - a[1]) / 3;
      const p1: [number, number] = [a[0] + dx, a[1] + dy];
      const p2: [number, number] = [a[0] + 2 * dx, a[1] + 2 * dy];
      // Peak: rotate (p2 - p1) by +60deg around p1 (outward bump).
      const ang = Math.PI / 3;
      const vx = p2[0] - p1[0];
      const vy = p2[1] - p1[1];
      const peak: [number, number] = [
        p1[0] + vx * Math.cos(ang) - vy * Math.sin(ang),
        p1[1] + vx * Math.sin(ang) + vy * Math.cos(ang),
      ];
      next.push(a, p1, peak, p2);
    }
    pts = next;
  }
  fitPath(buf, size, pts, true);
  return buf;
}

// --- Dragon curve (Heighway) ----------------------------------------------

export function dragon(size: number, detail: number, _seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const iters = Math.max(2, Math.min(16, Math.round(detail)));
  let pts: Array<[number, number]> = [
    [0, 0],
    [1, 0],
  ];
  for (let it = 0; it < iters; it++) {
    const c = pts[pts.length - 1];
    const tail: Array<[number, number]> = [];
    for (let j = pts.length - 2; j >= 0; j--) {
      const vx = pts[j][0] - c[0];
      const vy = pts[j][1] - c[1];
      // Rotate 90deg CCW around the endpoint.
      tail.push([c[0] - vy, c[1] + vx]);
    }
    pts = pts.concat(tail);
  }
  fitPath(buf, size, pts, false);
  return buf;
}

// --- Hilbert curve (space-filling) ----------------------------------------

export function hilbert(size: number, detail: number, _seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const order = Math.max(1, Math.min(7, Math.round(detail)));
  const pts: Array<[number, number]> = [];
  const recurse = (
    x: number, y: number,
    xi: number, xj: number, yi: number, yj: number, n: number,
  ): void => {
    if (n <= 0) {
      pts.push([x + (xi + yi) / 2, y + (xj + yj) / 2]);
      return;
    }
    recurse(x, y, yi / 2, yj / 2, xi / 2, xj / 2, n - 1);
    recurse(x + xi / 2, y + xj / 2, xi / 2, xj / 2, yi / 2, yj / 2, n - 1);
    recurse(x + xi / 2 + yi / 2, y + xj / 2 + yj / 2, xi / 2, xj / 2, yi / 2, yj / 2, n - 1);
    recurse(x + xi / 2 + yi, y + xj / 2 + yj, -yi / 2, -yj / 2, -xi / 2, -xj / 2, n - 1);
  };
  recurse(0, 0, 1, 0, 0, 1, order);
  fitPath(buf, size, pts, false);
  return buf;
}

// --- Lévy C curve ---------------------------------------------------------

export function levy(size: number, detail: number, _seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const iters = Math.max(0, Math.min(15, Math.round(detail)));
  let pts: Array<[number, number]> = [
    [0, 0],
    [1, 0],
  ];
  for (let it = 0; it < iters; it++) {
    const next: Array<[number, number]> = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      // Apex of a right-isosceles triangle on segment ab (right angle at apex).
      const mx = (a[0] + b[0]) / 2 - dy / 2;
      const my = (a[1] + b[1]) / 2 + dx / 2;
      next.push([mx, my], b);
    }
    pts = next;
  }
  fitPath(buf, size, pts, false);
  return buf;
}

// --- Vicsek fractal (deterministic plus/cross) ----------------------------

export function vicsek(size: number, detail: number, _seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const levels = Math.max(1, Math.min(6, Math.round(detail)));
  let pow = 1;
  for (let k = 0; k < levels; k++) pow *= 3;
  const pad = Math.floor(size * 0.04);
  const span = size - 2 * pad;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let gx = Math.floor(((px - pad) / span) * pow);
      let gy = Math.floor(((py - pad) / span) * pow);
      if (gx < 0 || gy < 0 || gx >= pow || gy >= pow) continue;
      let solid = true;
      for (let k = 0; k < levels; k++) {
        // Keep only the central plus of each 3x3 block.
        if (gx % 3 !== 1 && gy % 3 !== 1) { solid = false; break; }
        gx = (gx / 3) | 0;
        gy = (gy / 3) | 0;
      }
      if (solid) buf[py * size + px] = 0;
    }
  }
  return buf;
}

// --- Pythagoras tree ------------------------------------------------------

export function pythagoras(size: number, detail: number, _seed: number): Uint8Array {
  const buf = whiteBuffer(size);
  const depth = Math.max(1, Math.min(12, Math.round(detail)));
  const segs: Array<[number, number, number, number]> = [];
  // Build from a base square edge a->b; the square sits to the +perp side.
  const grow = (ax: number, ay: number, bx: number, by: number, level: number): void => {
    const dx = bx - ax;
    const dy = by - ay;
    // Square corners (perp points "up": (-dy, dx)).
    const cx = bx - dy, cy = by + dx; // top-right
    const dx2 = ax - dy, dy2 = ay + dx; // top-left
    segs.push([ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, dx2, dy2], [dx2, dy2, ax, ay]);
    if (level <= 0) return;
    // Apex of the right-isosceles triangle on the top edge (dx2,dy2)->(cx,cy).
    const ex = (dx2 + cx) / 2 - (cy - dy2) / 2;
    const ey = (dy2 + cy) / 2 + (cx - dx2) / 2;
    grow(dx2, dy2, ex, ey, level - 1);
    grow(ex, ey, cx, cy, level - 1);
  };
  // Base square near the bottom centre, growing upward (note: y grows down on
  // canvas, so we grow toward -y by orienting the base edge right-to-left).
  grow(0.6, 1, 0.4, 1, depth);
  fitSegments(buf, size, segs);
  return buf;
}

export type GeometricKind =
  | "sierpinski" | "fern" | "carpet" | "koch" | "dragon"
  | "hilbert" | "levy" | "vicsek" | "pythagoras";

export const GEOMETRIC: Record<
  GeometricKind,
  (size: number, detail: number, seed: number) => Uint8Array
> = {
  sierpinski,
  fern,
  carpet,
  koch,
  dragon,
  hilbert,
  levy,
  vicsek,
  pythagoras,
};
