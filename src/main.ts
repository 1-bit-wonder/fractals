// 1-bit fractal avatar generator — app controller.

import { quantize, type Quant } from "./render.js";
import { GEOMETRIC, type GeometricKind } from "./geometric.js";
import { mandelbrotJS, juliaJS, burningShipJS, tricornJS, newtonJS } from "./escape.js";
import { loadFractalWasm, renderWithBuffer, type FractalExports } from "./wasm.js";
import { encode1bitPng } from "./png1.js";

type EscapeKind = "mandelbrot" | "julia" | "burningShip" | "tricorn" | "newton";
type Kind = EscapeKind | GeometricKind;

interface View {
  cx: number;
  cy: number;
  scale: number;
  jx: number;
  jy: number;
}

interface Spec {
  label: string;
  engine: "escape" | "geometric";
  detailLabel: string;
  detailMin: number;
  detailMax: number;
  detailStep: number;
  detailDefault: number;
  view?: View; // escape-time only
}

const SPECS: Record<Kind, Spec> = {
  mandelbrot: {
    label: "Mandelbrot", engine: "escape", detailLabel: "Iterations",
    detailMin: 40, detailMax: 600, detailStep: 10, detailDefault: 150,
    view: { cx: -0.5, cy: 0, scale: 3.0, jx: 0, jy: 0 },
  },
  julia: {
    label: "Julia", engine: "escape", detailLabel: "Iterations",
    detailMin: 40, detailMax: 600, detailStep: 10, detailDefault: 150,
    view: { cx: 0, cy: 0, scale: 3.0, jx: -0.4, jy: 0.6 },
  },
  burningShip: {
    label: "Burning Ship", engine: "escape", detailLabel: "Iterations",
    detailMin: 40, detailMax: 600, detailStep: 10, detailDefault: 150,
    view: { cx: -0.45, cy: -0.5, scale: 3.2, jx: 0, jy: 0 },
  },
  tricorn: {
    label: "Tricorn", engine: "escape", detailLabel: "Iterations",
    detailMin: 40, detailMax: 600, detailStep: 10, detailDefault: 150,
    view: { cx: -0.25, cy: 0, scale: 3.2, jx: 0, jy: 0 },
  },
  newton: {
    label: "Newton", engine: "escape", detailLabel: "Iterations",
    detailMin: 10, detailMax: 120, detailStep: 2, detailDefault: 40,
    view: { cx: 0, cy: 0, scale: 3.0, jx: 0, jy: 0 },
  },
  sierpinski: {
    label: "Sierpiński", engine: "geometric", detailLabel: "Density",
    detailMin: 1, detailMax: 20, detailStep: 1, detailDefault: 8,
  },
  carpet: {
    label: "Carpet", engine: "geometric", detailLabel: "Levels",
    detailMin: 1, detailMax: 7, detailStep: 1, detailDefault: 5,
  },
  koch: {
    label: "Koch", engine: "geometric", detailLabel: "Iterations",
    detailMin: 0, detailMax: 6, detailStep: 1, detailDefault: 4,
  },
  dragon: {
    label: "Dragon", engine: "geometric", detailLabel: "Iterations",
    detailMin: 2, detailMax: 16, detailStep: 1, detailDefault: 12,
  },
  fern: {
    label: "Fern", engine: "geometric", detailLabel: "Density",
    detailMin: 1, detailMax: 20, detailStep: 1, detailDefault: 8,
  },
  hilbert: {
    label: "Hilbert", engine: "geometric", detailLabel: "Order",
    detailMin: 1, detailMax: 7, detailStep: 1, detailDefault: 6,
  },
  levy: {
    label: "Lévy C", engine: "geometric", detailLabel: "Iterations",
    detailMin: 0, detailMax: 15, detailStep: 1, detailDefault: 12,
  },
  vicsek: {
    label: "Vicsek", engine: "geometric", detailLabel: "Levels",
    detailMin: 1, detailMax: 6, detailStep: 1, detailDefault: 4,
  },
  pythagoras: {
    label: "Pythagoras", engine: "geometric", detailLabel: "Depth",
    detailMin: 1, detailMax: 12, detailStep: 1, detailDefault: 9,
  },
};

const KIND_ORDER: Kind[] = [
  "mandelbrot", "julia", "burningShip", "tricorn", "newton",
  "sierpinski", "carpet", "koch", "dragon", "fern",
  "hilbert", "levy", "vicsek", "pythagoras",
];

// Interesting Julia constants to cycle through on "Surprise me".
const JULIA_PRESETS: Array<[number, number]> = [
  [-0.4, 0.6], [0.285, 0.01], [-0.70176, -0.3842], [-0.8, 0.156],
  [-0.7269, 0.1889], [0.355, 0.355], [-0.74543, 0.11301], [0.37, 0.1],
];

interface State {
  kind: Kind;
  size: number;
  quant: Quant;
  invert: boolean;
  detail: Record<Kind, number>;
  seed: number;
  views: Record<EscapeKind, View>;
}

const state: State = {
  kind: "mandelbrot",
  size: 512,
  quant: "bayer",
  invert: false,
  detail: Object.fromEntries(
    KIND_ORDER.map((k) => [k, SPECS[k].detailDefault]),
  ) as Record<Kind, number>,
  seed: 1337,
  views: {
    mandelbrot: { ...SPECS.mandelbrot.view! },
    julia: { ...SPECS.julia.view! },
    burningShip: { ...SPECS.burningShip.view! },
    tricorn: { ...SPECS.tricorn.view! },
    newton: { ...SPECS.newton.view! },
  },
};

let wasm: FractalExports | null = null;

// --- DOM ------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;
const typeBar = $<HTMLDivElement>("type-bar");
const sizeBar = $<HTMLDivElement>("size-bar");
const ditherToggle = $<HTMLInputElement>("dither");
const invertToggle = $<HTMLInputElement>("invert");
const detailInput = $<HTMLInputElement>("detail");
const detailLabel = $<HTMLLabelElement>("detail-label");
const detailValue = $<HTMLSpanElement>("detail-value");
const engineTag = $<HTMLSpanElement>("engine-tag");
const hint = $<HTMLParagraphElement>("hint");

// --- Rendering ------------------------------------------------------------

function computeBrightness(): Uint8Array {
  const { kind, size } = state;
  const spec = SPECS[kind];
  const detail = Math.round(state.detail[kind]);

  if (spec.engine === "geometric") {
    return GEOMETRIC[kind as GeometricKind](size, detail, state.seed);
  }

  const ek = kind as EscapeKind;
  const v = state.views[ek];
  if (wasm) {
    return renderWithBuffer(wasm, size, (ptr) => {
      switch (ek) {
        case "mandelbrot": wasm!.mandelbrot(ptr, size, v.cx, v.cy, v.scale, detail); break;
        case "julia": wasm!.julia(ptr, size, v.cx, v.cy, v.scale, v.jx, v.jy, detail); break;
        case "burningShip": wasm!.burningShip(ptr, size, v.cx, v.cy, v.scale, detail); break;
        case "tricorn": wasm!.tricorn(ptr, size, v.cx, v.cy, v.scale, detail); break;
        case "newton": wasm!.newton(ptr, size, v.cx, v.cy, v.scale, detail); break;
      }
    });
  }
  const buf = new Uint8Array(size * size);
  switch (ek) {
    case "mandelbrot": mandelbrotJS(buf, size, v.cx, v.cy, v.scale, detail); break;
    case "julia": juliaJS(buf, size, v.cx, v.cy, v.scale, v.jx, v.jy, detail); break;
    case "burningShip": burningShipJS(buf, size, v.cx, v.cy, v.scale, detail); break;
    case "tricorn": tricornJS(buf, size, v.cx, v.cy, v.scale, detail); break;
    case "newton": newtonJS(buf, size, v.cx, v.cy, v.scale, detail); break;
  }
  return buf;
}

let frameQueued = false;
function scheduleRender(): void {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    render();
  });
}

function render(): void {
  const { size } = state;
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const bright = computeBrightness();
  const img = quantize(bright, size, state.quant, state.invert);
  ctx.putImageData(img, 0, 0);
}

// --- UI construction ------------------------------------------------------

function buildTypeBar(): void {
  for (const kind of KIND_ORDER) {
    const btn = document.createElement("button");
    btn.textContent = SPECS[kind].label;
    btn.className = "chip";
    btn.dataset.kind = kind;
    btn.addEventListener("click", () => selectKind(kind));
    typeBar.appendChild(btn);
  }
}

function buildSizeBar(): void {
  for (const size of [128, 256, 512, 1024]) {
    const btn = document.createElement("button");
    btn.textContent = String(size);
    btn.className = "chip";
    btn.dataset.size = String(size);
    btn.addEventListener("click", () => {
      state.size = size;
      syncControls();
      scheduleRender();
    });
    sizeBar.appendChild(btn);
  }
}

function selectKind(kind: Kind): void {
  state.kind = kind;
  syncControls();
  scheduleRender();
}

function syncControls(): void {
  const spec = SPECS[state.kind];
  for (const btn of typeBar.querySelectorAll<HTMLButtonElement>("button")) {
    btn.classList.toggle("active", btn.dataset.kind === state.kind);
  }
  for (const btn of sizeBar.querySelectorAll<HTMLButtonElement>("button")) {
    btn.classList.toggle("active", btn.dataset.size === String(state.size));
  }
  detailInput.min = String(spec.detailMin);
  detailInput.max = String(spec.detailMax);
  detailInput.step = String(spec.detailStep);
  detailInput.value = String(state.detail[state.kind]);
  detailLabel.firstChild!.textContent = spec.detailLabel + " ";
  detailValue.textContent = String(Math.round(state.detail[state.kind]));
  ditherToggle.checked = state.quant === "bayer";
  invertToggle.checked = state.invert;

  const isEscape = spec.engine === "escape";
  engineTag.textContent = isEscape
    ? (wasm ? "engine: WASM" : "engine: JS")
    : "engine: TS";
  engineTag.classList.toggle("wasm", isEscape && !!wasm);
  hint.textContent = isEscape
    ? "drag to pan · scroll to zoom · double-click to reset"
    : "geometric fractal · adjust detail or shuffle the seed";
}

// --- Escape-time interaction ----------------------------------------------

function canvasToComplex(ev: MouseEvent | WheelEvent): { re: number; im: number } {
  const rect = canvas.getBoundingClientRect();
  const fx = (ev.clientX - rect.left) / rect.width; // 0..1
  const fy = (ev.clientY - rect.top) / rect.height;
  const v = state.views[state.kind as EscapeKind];
  return {
    re: v.cx + (fx - 0.5) * v.scale,
    im: v.cy + (fy - 0.5) * v.scale,
  };
}

let dragging = false;
let dragStart = { x: 0, y: 0, cx: 0, cy: 0 };

function isEscape(): boolean {
  return SPECS[state.kind].engine === "escape";
}

canvas.addEventListener("mousedown", (ev) => {
  if (!isEscape()) return;
  dragging = true;
  const v = state.views[state.kind as EscapeKind];
  dragStart = { x: ev.clientX, y: ev.clientY, cx: v.cx, cy: v.cy };
});

window.addEventListener("mouseup", () => { dragging = false; });

window.addEventListener("mousemove", (ev) => {
  if (!dragging || !isEscape()) return;
  const rect = canvas.getBoundingClientRect();
  const v = state.views[state.kind as EscapeKind];
  const dx = (ev.clientX - dragStart.x) / rect.width;
  const dy = (ev.clientY - dragStart.y) / rect.height;
  v.cx = dragStart.cx - dx * v.scale;
  v.cy = dragStart.cy - dy * v.scale;
  scheduleRender();
});

canvas.addEventListener("wheel", (ev) => {
  if (!isEscape()) return;
  ev.preventDefault();
  const v = state.views[state.kind as EscapeKind];
  const target = canvasToComplex(ev);
  const factor = ev.deltaY < 0 ? 0.8 : 1.25;
  // Zoom toward the cursor: keep the point under the cursor fixed.
  v.cx = target.re + (v.cx - target.re) * factor;
  v.cy = target.im + (v.cy - target.im) * factor;
  v.scale *= factor;
  scheduleRender();
}, { passive: false });

canvas.addEventListener("dblclick", () => {
  if (!isEscape()) return;
  const ek = state.kind as EscapeKind;
  state.views[ek] = { ...SPECS[ek].view! };
  scheduleRender();
});

// --- Controls -------------------------------------------------------------

detailInput.addEventListener("input", () => {
  state.detail[state.kind] = Number(detailInput.value);
  detailValue.textContent = String(Math.round(state.detail[state.kind]));
  scheduleRender();
});

ditherToggle.addEventListener("change", () => {
  state.quant = ditherToggle.checked ? "bayer" : "threshold";
  scheduleRender();
});

invertToggle.addEventListener("change", () => {
  state.invert = invertToggle.checked;
  scheduleRender();
});

let juliaIdx = 0;
$<HTMLButtonElement>("shuffle").addEventListener("click", () => {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  if (state.kind === "julia") {
    juliaIdx = (juliaIdx + 1) % JULIA_PRESETS.length;
    const [jx, jy] = JULIA_PRESETS[juliaIdx];
    state.views.julia.jx = jx;
    state.views.julia.jy = jy;
  }
  scheduleRender();
});

function saveBlob(blob: Blob, suffix: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.kind}-${state.size}${suffix}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

$<HTMLButtonElement>("download").addEventListener("click", () => {
  canvas.toBlob((blob) => {
    if (blob) saveBlob(blob, "");
  }, "image/png");
});

$<HTMLButtonElement>("download-1bpp").addEventListener("click", async () => {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const blob = await encode1bitPng(img);
  saveBlob(blob, "-1bpp");
});

// --- Boot -----------------------------------------------------------------

async function main(): Promise<void> {
  buildTypeBar();
  buildSizeBar();
  wasm = await loadFractalWasm();
  syncControls();
  render();
}

main();
