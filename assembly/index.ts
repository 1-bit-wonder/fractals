// Escape-time fractal kernels for the 1-bit fractal generator.
//
// Each kernel fills a caller-provided linear-memory buffer with one u8 per
// pixel: a "brightness" value in [0, 255] that the TypeScript side later
// quantizes to a single bit (threshold or ordered dither). Interior points
// (never escape) are written as 0 (darkest -> becomes ink).
//
// The square `size` keeps avatars 1:1 by construction, so a single `scale`
// (the width of the viewport in the complex plane) covers both axes.

/** Allocate a raw byte buffer in WASM linear memory; returns its pointer. */
export function alloc(len: i32): usize {
  return heap.alloc(len);
}

/** Free a buffer previously returned by `alloc`. */
export function free(ptr: usize): void {
  heap.free(ptr);
}

// Smooth (continuous) escape value -> brightness byte.
// Boundary points stay dark; the field brightens with distance from the set,
// which gives the Bayer dither something gradient-like to work with.
// @inline
function shade(n: i32, zx: f64, zy: f64, maxIter: i32): u8 {
  if (n >= maxIter) return 0; // interior -> ink
  // mu = n + 1 - log2(log(|z|))   with log(|z|) = 0.5 * log(|z|^2)
  let logZn: f64 = Math.log(zx * zx + zy * zy) * 0.5;
  let sn: f64 = f64(n) + 1.0 - Math.log2(logZn);
  if (sn < 0.0) sn = 0.0;
  let v: f64 = 255.0 * Math.sqrt(sn / f64(maxIter));
  if (v > 255.0) v = 255.0;
  return <u8>v;
}

export function mandelbrot(
  ptr: usize, size: i32,
  cx: f64, cy: f64, scale: f64, maxIter: i32,
): void {
  let inv: f64 = 1.0 / f64(size);
  for (let py = 0; py < size; py++) {
    let im0: f64 = cy + ((f64(py) + 0.5) * inv - 0.5) * scale;
    let row: usize = ptr + py * size;
    for (let px = 0; px < size; px++) {
      let re0: f64 = cx + ((f64(px) + 0.5) * inv - 0.5) * scale;
      let zx: f64 = 0.0, zy: f64 = 0.0;
      let n = 0;
      while (n < maxIter) {
        let zx2 = zx * zx, zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) break;
        zy = 2.0 * zx * zy + im0;
        zx = zx2 - zy2 + re0;
        n++;
      }
      store<u8>(row + px, shade(n, zx, zy, maxIter));
    }
  }
}

export function julia(
  ptr: usize, size: i32,
  cx: f64, cy: f64, scale: f64,
  jx: f64, jy: f64, maxIter: i32,
): void {
  let inv: f64 = 1.0 / f64(size);
  for (let py = 0; py < size; py++) {
    let zy0: f64 = cy + ((f64(py) + 0.5) * inv - 0.5) * scale;
    let row: usize = ptr + py * size;
    for (let px = 0; px < size; px++) {
      let zx0: f64 = cx + ((f64(px) + 0.5) * inv - 0.5) * scale;
      let zx = zx0, zy = zy0;
      let n = 0;
      while (n < maxIter) {
        let zx2 = zx * zx, zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) break;
        zy = 2.0 * zx * zy + jy;
        zx = zx2 - zy2 + jx;
        n++;
      }
      store<u8>(row + px, shade(n, zx, zy, maxIter));
    }
  }
}

export function burningShip(
  ptr: usize, size: i32,
  cx: f64, cy: f64, scale: f64, maxIter: i32,
): void {
  let inv: f64 = 1.0 / f64(size);
  for (let py = 0; py < size; py++) {
    let im0: f64 = cy + ((f64(py) + 0.5) * inv - 0.5) * scale;
    let row: usize = ptr + py * size;
    for (let px = 0; px < size; px++) {
      let re0: f64 = cx + ((f64(px) + 0.5) * inv - 0.5) * scale;
      let zx: f64 = 0.0, zy: f64 = 0.0;
      let n = 0;
      while (n < maxIter) {
        let zx2 = zx * zx, zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) break;
        zy = Math.abs(2.0 * zx * zy) + im0;
        zx = zx2 - zy2 + re0;
        n++;
      }
      store<u8>(row + px, shade(n, zx, zy, maxIter));
    }
  }
}

// Tricorn / Mandelbar: like Mandelbrot but conjugates z each step
// (z -> conj(z)^2 + c), which just flips the sign of the imaginary update.
export function tricorn(
  ptr: usize, size: i32,
  cx: f64, cy: f64, scale: f64, maxIter: i32,
): void {
  let inv: f64 = 1.0 / f64(size);
  for (let py = 0; py < size; py++) {
    let im0: f64 = cy + ((f64(py) + 0.5) * inv - 0.5) * scale;
    let row: usize = ptr + py * size;
    for (let px = 0; px < size; px++) {
      let re0: f64 = cx + ((f64(px) + 0.5) * inv - 0.5) * scale;
      let zx: f64 = 0.0, zy: f64 = 0.0;
      let n = 0;
      while (n < maxIter) {
        let zx2 = zx * zx, zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) break;
        zy = -2.0 * zx * zy + im0; // conjugate -> negated imaginary part
        zx = zx2 - zy2 + re0;
        n++;
      }
      store<u8>(row + px, shade(n, zx, zy, maxIter));
    }
  }
}

// Newton fractal for z^3 - 1. Each pixel is a starting point for Newton's
// method; we shade by which of the three cube roots it converges to (giving
// three dither tones) and darken slow-converging boundary points.
const R3: f64 = 0.86602540378443864; // sqrt(3)/2

export function newton(
  ptr: usize, size: i32,
  cx: f64, cy: f64, scale: f64, maxIter: i32,
): void {
  let inv: f64 = 1.0 / f64(size);
  for (let py = 0; py < size; py++) {
    let zy0: f64 = cy + ((f64(py) + 0.5) * inv - 0.5) * scale;
    let row: usize = ptr + py * size;
    for (let px = 0; px < size; px++) {
      let zx0: f64 = cx + ((f64(px) + 0.5) * inv - 0.5) * scale;
      let a = zx0, b = zy0;
      let n = 0;
      while (n < maxIter) {
        let a2 = a * a, b2 = b * b;
        // f = z^3 - 1,  f' = 3 z^2
        let fx = a * a2 - 3.0 * a * b2 - 1.0;
        let fy = 3.0 * a2 * b - b * b2;
        let fpx = 3.0 * (a2 - b2);
        let fpy = 6.0 * a * b;
        let den = fpx * fpx + fpy * fpy;
        if (den < 1e-18) break;
        // delta = f / f'  (complex division)
        let dx = (fx * fpx + fy * fpy) / den;
        let dy = (fy * fpx - fx * fpy) / den;
        a -= dx;
        b -= dy;
        n++;
        if (dx * dx + dy * dy < 1e-12) break;
      }
      // Nearest cube root: (1,0), (-0.5, +R3), (-0.5, -R3).
      let d0 = (a - 1.0) * (a - 1.0) + b * b;
      let d1 = (a + 0.5) * (a + 0.5) + (b - R3) * (b - R3);
      let d2 = (a + 0.5) * (a + 0.5) + (b + R3) * (b + R3);
      let root = 0;
      if (d1 < d0 && d1 <= d2) root = 1;
      else if (d2 < d0 && d2 < d1) root = 2;
      let base: f64 = 85.0 * f64(root + 1); // 85 / 170 / 255
      let factor: f64 = 1.0 - 0.7 * (f64(n) / f64(maxIter));
      let v = base * factor;
      if (v < 0.0) v = 0.0;
      if (v > 255.0) v = 255.0;
      store<u8>(row + px, <u8>v);
    }
  }
}
