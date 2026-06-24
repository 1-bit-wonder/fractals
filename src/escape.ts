// Pure-TypeScript fallback for the escape-time fractals.
//
// Mirrors assembly/index.ts so the app still works if the WASM module fails to
// load. The WASM path is preferred (it's noticeably faster at 1024px), but the
// numeric results are identical.

function shade(n: number, zx: number, zy: number, maxIter: number): number {
  if (n >= maxIter) return 0;
  const logZn = Math.log(zx * zx + zy * zy) * 0.5;
  let sn = n + 1 - Math.log2(logZn);
  if (sn < 0) sn = 0;
  let v = 255 * Math.sqrt(sn / maxIter);
  if (v > 255) v = 255;
  return v | 0;
}

export function mandelbrotJS(
  buf: Uint8Array, size: number,
  cx: number, cy: number, scale: number, maxIter: number,
): void {
  const inv = 1 / size;
  for (let py = 0; py < size; py++) {
    const im0 = cy + ((py + 0.5) * inv - 0.5) * scale;
    const row = py * size;
    for (let px = 0; px < size; px++) {
      const re0 = cx + ((px + 0.5) * inv - 0.5) * scale;
      let zx = 0, zy = 0, n = 0;
      while (n < maxIter) {
        const zx2 = zx * zx, zy2 = zy * zy;
        if (zx2 + zy2 > 4) break;
        zy = 2 * zx * zy + im0;
        zx = zx2 - zy2 + re0;
        n++;
      }
      buf[row + px] = shade(n, zx, zy, maxIter);
    }
  }
}

export function juliaJS(
  buf: Uint8Array, size: number,
  cx: number, cy: number, scale: number,
  jx: number, jy: number, maxIter: number,
): void {
  const inv = 1 / size;
  for (let py = 0; py < size; py++) {
    const zy0 = cy + ((py + 0.5) * inv - 0.5) * scale;
    const row = py * size;
    for (let px = 0; px < size; px++) {
      const zx0 = cx + ((px + 0.5) * inv - 0.5) * scale;
      let zx = zx0, zy = zy0, n = 0;
      while (n < maxIter) {
        const zx2 = zx * zx, zy2 = zy * zy;
        if (zx2 + zy2 > 4) break;
        zy = 2 * zx * zy + jy;
        zx = zx2 - zy2 + jx;
        n++;
      }
      buf[row + px] = shade(n, zx, zy, maxIter);
    }
  }
}

export function burningShipJS(
  buf: Uint8Array, size: number,
  cx: number, cy: number, scale: number, maxIter: number,
): void {
  const inv = 1 / size;
  for (let py = 0; py < size; py++) {
    const im0 = cy + ((py + 0.5) * inv - 0.5) * scale;
    const row = py * size;
    for (let px = 0; px < size; px++) {
      const re0 = cx + ((px + 0.5) * inv - 0.5) * scale;
      let zx = 0, zy = 0, n = 0;
      while (n < maxIter) {
        const zx2 = zx * zx, zy2 = zy * zy;
        if (zx2 + zy2 > 4) break;
        zy = Math.abs(2 * zx * zy) + im0;
        zx = zx2 - zy2 + re0;
        n++;
      }
      buf[row + px] = shade(n, zx, zy, maxIter);
    }
  }
}

export function tricornJS(
  buf: Uint8Array, size: number,
  cx: number, cy: number, scale: number, maxIter: number,
): void {
  const inv = 1 / size;
  for (let py = 0; py < size; py++) {
    const im0 = cy + ((py + 0.5) * inv - 0.5) * scale;
    const row = py * size;
    for (let px = 0; px < size; px++) {
      const re0 = cx + ((px + 0.5) * inv - 0.5) * scale;
      let zx = 0, zy = 0, n = 0;
      while (n < maxIter) {
        const zx2 = zx * zx, zy2 = zy * zy;
        if (zx2 + zy2 > 4) break;
        zy = -2 * zx * zy + im0;
        zx = zx2 - zy2 + re0;
        n++;
      }
      buf[row + px] = shade(n, zx, zy, maxIter);
    }
  }
}

const R3 = 0.86602540378443864; // sqrt(3)/2

export function newtonJS(
  buf: Uint8Array, size: number,
  cx: number, cy: number, scale: number, maxIter: number,
): void {
  const inv = 1 / size;
  for (let py = 0; py < size; py++) {
    const zy0 = cy + ((py + 0.5) * inv - 0.5) * scale;
    const row = py * size;
    for (let px = 0; px < size; px++) {
      const zx0 = cx + ((px + 0.5) * inv - 0.5) * scale;
      let a = zx0, b = zy0, n = 0;
      while (n < maxIter) {
        const a2 = a * a, b2 = b * b;
        const fx = a * a2 - 3 * a * b2 - 1;
        const fy = 3 * a2 * b - b * b2;
        const fpx = 3 * (a2 - b2);
        const fpy = 6 * a * b;
        const den = fpx * fpx + fpy * fpy;
        if (den < 1e-18) break;
        const dx = (fx * fpx + fy * fpy) / den;
        const dy = (fy * fpx - fx * fpy) / den;
        a -= dx;
        b -= dy;
        n++;
        if (dx * dx + dy * dy < 1e-12) break;
      }
      const d0 = (a - 1) * (a - 1) + b * b;
      const d1 = (a + 0.5) * (a + 0.5) + (b - R3) * (b - R3);
      const d2 = (a + 0.5) * (a + 0.5) + (b + R3) * (b + R3);
      let root = 0;
      if (d1 < d0 && d1 <= d2) root = 1;
      else if (d2 < d0 && d2 < d1) root = 2;
      const v = 85 * (root + 1) * (1 - 0.7 * (n / maxIter));
      buf[row + px] = Math.max(0, Math.min(255, v)) | 0;
    }
  }
}
