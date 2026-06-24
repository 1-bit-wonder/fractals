// Loader + typed wrapper for the AssemblyScript escape-time kernels.
//
// The WASM module owns a scratch buffer in its own linear memory; we render
// into it, then copy the bytes back out into a fresh Uint8Array (so the result
// survives any later memory growth) and free the scratch.

export interface FractalExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(ptr: number): void;
  mandelbrot(ptr: number, size: number, cx: number, cy: number, scale: number, maxIter: number): void;
  julia(ptr: number, size: number, cx: number, cy: number, scale: number, jx: number, jy: number, maxIter: number): void;
  burningShip(ptr: number, size: number, cx: number, cy: number, scale: number, maxIter: number): void;
  tricorn(ptr: number, size: number, cx: number, cy: number, scale: number, maxIter: number): void;
  newton(ptr: number, size: number, cx: number, cy: number, scale: number, maxIter: number): void;
}

const importObject: WebAssembly.Imports = {
  env: {
    abort(_msg: number, _file: number, line: number, column: number) {
      throw new Error(`wasm abort at ${line}:${column}`);
    },
    trace() {},
    seed() { return 0; },
  },
};

export async function loadFractalWasm(
  url = "./build/fractals.wasm",
): Promise<FractalExports | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, importObject);
    return instance.exports as unknown as FractalExports;
  } catch (err) {
    console.warn("[fractals] WASM unavailable, falling back to JS:", err);
    return null;
  }
}

/** Run a kernel that writes `size*size` brightness bytes, returning a copy. */
export function renderWithBuffer(
  wasm: FractalExports,
  size: number,
  run: (ptr: number) => void,
): Uint8Array {
  const len = size * size;
  const ptr = wasm.alloc(len);
  try {
    run(ptr);
    // Copy out *after* rendering, using a fresh view in case alloc grew memory.
    return new Uint8Array(wasm.memory.buffer, ptr, len).slice();
  } finally {
    wasm.free(ptr);
  }
}
