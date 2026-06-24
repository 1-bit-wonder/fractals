# 1-bit fractals

[![Deploy to GitHub Pages](https://github.com/1-bit-wonder/fractals/actions/workflows/deploy.yml/badge.svg)](https://github.com/1-bit-wonder/fractals/actions/workflows/deploy.yml)

A 1-bit (pure black & white) fractal generator that produces 1:1 square
avatars of common fractal patterns.

- **UI**: plain HTML + CSS, 1-bit aesthetic.
- **Logic**: TypeScript.
- **Hot loops**: the escape-time fractals (Mandelbrot, Julia, Burning Ship)
  run as a WebAssembly module compiled from **AssemblyScript**
  (`assembly/index.ts`), with an identical pure-TypeScript fallback
  (`src/escape.ts`) if WASM fails to load.

## Patterns

| Pattern         | Engine             |
| --------------- | ------------------ |
| Mandelbrot      | WASM (escape-time) |
| Julia           | WASM (escape-time) |
| Burning Ship    | WASM (escape-time) |
| Tricorn         | WASM (escape-time) |
| Newton (z³−1)   | WASM (escape-time) |
| Sierpiński      | TS (chaos game)    |
| Carpet          | TS (deterministic) |
| Koch snowflake  | TS (line subdiv.)  |
| Dragon curve    | TS (L-system)      |
| Barnsley fern   | TS (IFS)           |
| Hilbert curve   | TS (space-filling) |
| Lévy C curve    | TS (line subdiv.)  |
| Vicsek          | TS (deterministic) |
| Pythagoras tree | TS (recursive)     |

## How the 1-bit pipeline works

Every generator emits an 8-bit *brightness* buffer (one byte per pixel).
A single `quantize` step (`src/render.ts`) collapses that to one bit of ink
using either a hard threshold or an 8×8 Bayer ordered dither, then writes
black/white pixels to a square `<canvas>`.

The 8-bit intermediate exists because the escape-time fractals are inherently
continuous (the smooth-iteration field), and keeping it around lets the dither
mode / invert / threshold toggle re-quantize instantly without recomputing the
fractal. The geometric fractals are binary at the source and just write 0/255.

## Develop

Requires Node 22 (pinned via `mise.toml`).

```sh
mise install        # node 22
npm install         # assemblyscript + typescript
npm run dev         # build WASM + TS, then serve at http://localhost:8080
```

Other tasks:

```sh
npm run build       # build:wasm + build:ts
npm run build:wasm  # AssemblyScript -> build/fractals.wasm
npm run watch       # tsc --watch
npm run serve       # static server only (uses existing build)
```

## Controls

- **Pattern / Size** — pick a fractal and the square avatar resolution.
- **Detail** — iterations (escape-time), recursion levels (carpet/koch/dragon),
  or point density (sierpiński/fern).
- **Bayer dither / Invert** — instant 1-bit re-quantize toggles.
- Escape-time fractals: **drag** to pan, **scroll** to zoom, **double-click** to
  reset.
- **Surprise me** — cycles Julia constants / reseeds the chaos-game fractals.
- **PNG** — saves the avatar as a standard (8-bit RGBA) PNG.
- **1-bit PNG** — saves a genuine 1-bit-per-pixel grayscale PNG (~8× smaller),
  hand-encoded in `src/png1.ts` (canvas can't export sub-8-bit depth).
