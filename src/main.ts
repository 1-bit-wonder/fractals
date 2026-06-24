// 1-bit fractal avatar generator — app controller.

import { quantize, type Quant } from "./render.js";
import { GEOMETRIC, type GeometricKind } from "./geometric.js";
import { mandelbrotJS, juliaJS, burningShipJS, tricornJS, newtonJS } from "./escape.js";
import { loadFractalWasm, renderWithBuffer, type FractalExports } from "./wasm.js";
import { encode1bitPng } from "./png1.js";
import { computeOrbit, EXPLAINERS, NEWTON_ROOTS, type OrbitKind } from "./learn.js";

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

type Mode = "generate" | "learn";

interface State {
  kind: Kind;
  size: number;
  quant: Quant;
  invert: boolean;
  detail: Record<Kind, number>;
  seed: number;
  views: Record<EscapeKind, View>;
  mode: Mode;
}

const state: State = {
  kind: "mandelbrot",
  size: 512,
  quant: "bayer",
  invert: false,
  mode: "generate",
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
const overlay = $<HTMLCanvasElement>("overlay");
const octx = overlay.getContext("2d")!;
const modeBar = $<HTMLDivElement>("mode-bar");
const learnPanel = $<HTMLElement>("learn-panel");
const learnTitle = $<HTMLHeadingElement>("learn-title");
const learnWhat = $<HTMLParagraphElement>("learn-what");
const learnRule = $<HTMLPreElement>("learn-rule");
const orbitBox = $<HTMLDivElement>("orbit-box");
const orbitReadout = $<HTMLParagraphElement>("orbit-readout");
const buildupBox = $<HTMLDivElement>("buildup-box");
const buildupStatus = $<HTMLSpanElement>("buildup-status");
const typeBar = $<HTMLDivElement>("type-bar");
const sizeBar = $<HTMLDivElement>("size-bar");
const ditherToggle = $<HTMLInputElement>("dither");
const invertToggle = $<HTMLInputElement>("invert");
const detailInput = $<HTMLInputElement>("detail");
const detailLabel = $<HTMLLabelElement>("detail-label");
const detailValue = $<HTMLSpanElement>("detail-value");
const engineTag = $<HTMLSpanElement>("engine-tag");
const hint = $<HTMLParagraphElement>("hint");
const shuffleBtn = $<HTMLButtonElement>("shuffle");

// "Surprise me" only changes patterns with a random/variable element: Julia
// cycles its constant; the chaos-game fractals reseed. The other 11 are fully
// deterministic, so there is nothing to shuffle.
const SHUFFLEABLE = new Set<Kind>(["julia", "sierpinski", "fern"]);
const canShuffle = (kind: Kind): boolean => SHUFFLEABLE.has(kind);

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
  if (state.mode === "learn") updateOverlay();
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
  if (state.mode === "learn") {
    stopBuildup();
    updateLearnPanel();
  }
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
  if (state.mode === "learn") {
    hint.textContent = isEscape
      ? "learn mode · move over the image to trace an orbit · scroll to zoom"
      : "learn mode · press build-up to watch it form";
  } else {
    hint.textContent = isEscape
      ? "drag to pan · scroll to zoom · double-click to reset"
      : "geometric fractal · adjust detail or shuffle the seed";
  }

  const shuffleable = canShuffle(state.kind);
  shuffleBtn.disabled = !shuffleable;
  shuffleBtn.title = shuffleable
    ? (state.kind === "julia" ? "cycle to a new Julia constant" : "reseed the random pattern")
    : `nothing random to shuffle for ${spec.label}`;
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
  if (!isEscape() || state.mode === "learn") return; // learn mode: hover traces orbits
  dragging = true;
  const v = state.views[state.kind as EscapeKind];
  dragStart = { x: ev.clientX, y: ev.clientY, cx: v.cx, cy: v.cy };
});

// Learn mode: moving over the canvas picks the point whose orbit we trace.
canvas.addEventListener("mousemove", (ev) => {
  if (state.mode !== "learn" || !isEscape()) return;
  const rect = canvas.getBoundingClientRect();
  lastFrac = {
    fx: (ev.clientX - rect.left) / rect.width,
    fy: (ev.clientY - rect.top) / rect.height,
  };
  updateOverlay();
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
shuffleBtn.addEventListener("click", () => {
  if (!canShuffle(state.kind)) return;
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

// --- Learn mode -----------------------------------------------------------

// Last hovered point, as a 0..1 fraction of the canvas (so it survives zoom/pan
// and resizes). Starts a little above centre so an orbit shows on entry.
let lastFrac = { fx: 0.5, fy: 0.42 };

/** Match the overlay's backing store to its displayed size (sharp on HiDPI). */
function sizeOverlay(): { w: number; h: number } {
  const rect = overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (overlay.width !== w * dpr || overlay.height !== h * dpr) {
    overlay.width = w * dpr;
    overlay.height = h * dpr;
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  return { w, h };
}

// White-haloed strokes/dots/text so the overlay reads over both black and white.
function strokeHalo(build: () => void, lw = 1.5): void {
  octx.lineJoin = "round";
  octx.lineCap = "round";
  octx.beginPath();
  build();
  octx.lineWidth = lw + 3;
  octx.strokeStyle = "rgba(255,255,255,0.95)";
  octx.stroke();
  octx.lineWidth = lw;
  octx.strokeStyle = "#000";
  octx.stroke();
}

function dotHalo(x: number, y: number, r: number): void {
  octx.beginPath();
  octx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  octx.fillStyle = "rgba(255,255,255,0.95)";
  octx.fill();
  octx.beginPath();
  octx.arc(x, y, r, 0, Math.PI * 2);
  octx.fillStyle = "#000";
  octx.fill();
}

function textHalo(t: string, x: number, y: number): void {
  octx.font = '11px "JetBrains Mono", monospace';
  octx.textBaseline = "middle";
  octx.lineWidth = 3;
  octx.strokeStyle = "rgba(255,255,255,0.95)";
  octx.strokeText(t, x, y);
  octx.fillStyle = "#000";
  octx.fillText(t, x, y);
}

function fmt(n: number): string {
  return (n < 0 ? "−" : "") + Math.abs(n).toFixed(3);
}

function complexStr(re: number, im: number): string {
  return `${fmt(re)} ${im < 0 ? "−" : "+"} ${Math.abs(im).toFixed(3)}i`;
}

/** Redraw the teaching overlay (axes + the current point's orbit). */
function updateOverlay(): void {
  const { w, h } = sizeOverlay();
  octx.clearRect(0, 0, w, h);
  if (state.mode !== "learn" || !isEscape()) return;

  const ek = state.kind as EscapeKind;
  const v = state.views[ek];
  const toX = (re: number) => ((re - v.cx) / v.scale + 0.5) * w;
  const toY = (im: number) => ((im - v.cy) / v.scale + 0.5) * h;

  // Axes (real = horizontal, imaginary = vertical), dashed and labelled.
  octx.save();
  octx.setLineDash([4, 4]);
  const ay = toY(0);
  if (ay >= 0 && ay <= h) {
    strokeHalo(() => { octx.moveTo(0, ay); octx.lineTo(w, ay); }, 1);
    textHalo("Re", w - 18, ay - 9);
  }
  const ax = toX(0);
  if (ax >= 0 && ax <= w) {
    strokeHalo(() => { octx.moveTo(ax, 0); octx.lineTo(ax, h); }, 1);
    textHalo("Im", ax + 7, 11);
  }
  octx.restore();

  // The picked point, then its orbit.
  const pRe = v.cx + (lastFrac.fx - 0.5) * v.scale;
  const pIm = v.cy + (lastFrac.fy - 0.5) * v.scale;
  const maxIter = Math.round(state.detail[ek]);
  const orbit = computeOrbit(ek as OrbitKind, pRe, pIm, v.jx, v.jy, maxIter);
  const pts = orbit.points;

  if (pts.length >= 2) {
    strokeHalo(() => {
      octx.moveTo(toX(pts[0][0]), toY(pts[0][1]));
      for (let i = 1; i < pts.length; i++) octx.lineTo(toX(pts[i][0]), toY(pts[i][1]));
    });
  }
  pts.forEach((p, i) => {
    const x = toX(p[0]), y = toY(p[1]);
    if (x < -40 || x > w + 40 || y < -40 || y > h + 40) return;
    dotHalo(x, y, i === 0 ? 3.5 : 2.2);
    if (i <= 4) textHalo(String(i), x + 6, y - 7);
  });

  // Ring + label on the input point (c for Mandelbrot-family, z₀ for Julia/Newton).
  const inX = lastFrac.fx * w, inY = lastFrac.fy * h;
  const inLabel = ek === "mandelbrot" || ek === "burningShip" || ek === "tricorn" ? "c" : "z₀";
  strokeHalo(() => { octx.moveTo(inX + 8, inY); octx.arc(inX, inY, 8, 0, Math.PI * 2); }, 1.5);
  textHalo(inLabel, inX + 11, inY + 11);

  updateReadout(orbit, ek, pRe, pIm, v.jx, v.jy);
}

function updateReadout(
  orbit: ReturnType<typeof computeOrbit>,
  ek: EscapeKind, pRe: number, pIm: number, jx: number, jy: number,
): void {
  const lines: string[] = [];
  if (ek === "julia") {
    lines.push(`z₀ = ${complexStr(pRe, pIm)}`);
    lines.push(`<span class="muted">c = ${complexStr(jx, jy)} (fixed)</span>`);
  } else if (ek === "newton") {
    lines.push(`z₀ = ${complexStr(pRe, pIm)}`);
  } else {
    lines.push(`c = ${complexStr(pRe, pIm)}`);
    lines.push(`<span class="muted">z₀ = 0</span>`);
  }

  // First couple of computed steps, to make the iteration concrete.
  const shown = orbit.points.slice(1, 3);
  shown.forEach((p, i) => lines.push(`z${i + 1} = ${complexStr(p[0], p[1])}`));

  if (ek === "newton") {
    lines.push(orbit.converged
      ? `<span class="verdict">→ converged to root ${NEWTON_ROOTS[orbit.root ?? 0]} in ${orbit.steps} steps</span>`
      : `<span class="verdict">→ still wandering after ${orbit.steps} steps</span>`);
  } else if (orbit.escaped) {
    lines.push(`<span class="verdict">→ escaped past radius 2 after ${orbit.steps} steps · OUTSIDE the set (shaded by speed)</span>`);
  } else {
    lines.push(`<span class="verdict">→ stayed bounded through all ${orbit.steps} steps · INSIDE the set (black)</span>`);
  }
  orbitReadout.innerHTML = lines.join("<br>");
}

/** Refresh the explanatory copy + which sub-box (orbit vs build-up) shows. */
function updateLearnPanel(): void {
  const e = EXPLAINERS[state.kind];
  learnTitle.textContent = e.title;
  learnWhat.textContent = e.what;
  learnRule.textContent = e.rule.join("\n");
  const esc = isEscape();
  orbitBox.hidden = !esc;
  buildupBox.hidden = esc;
  if (!esc) buildupStatus.textContent = "";
}

function applyMode(): void {
  const learn = state.mode === "learn";
  for (const btn of modeBar.querySelectorAll<HTMLButtonElement>("button")) {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  }
  learnPanel.hidden = !learn;
  overlay.style.display = learn ? "block" : "none";
  if (learn) {
    updateLearnPanel();
    render(); // render() refreshes the overlay when in learn mode
  } else {
    stopBuildup();
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }
  syncControls();
}

// --- Build-up animation (geometric fractals) ------------------------------

let buildupTimer: number | undefined;

function stopBuildup(): void {
  if (buildupTimer !== undefined) {
    clearTimeout(buildupTimer);
    buildupTimer = undefined;
  }
}

function playBuildup(): void {
  stopBuildup();
  const spec = SPECS[state.kind];
  const target = Math.round(state.detail[state.kind]);
  const min = spec.detailMin;
  // A handful of frames from min up to the current detail (~10 max).
  const span = Math.max(0, target - min);
  const stride = Math.max(spec.detailStep, Math.ceil(span / 10 / spec.detailStep) * spec.detailStep);
  const frames: number[] = [];
  for (let d = min; d < target; d += stride) frames.push(d);
  frames.push(target);

  let i = 0;
  const tick = (): void => {
    const d = frames[i];
    state.detail[state.kind] = d;
    detailInput.value = String(d);
    detailValue.textContent = String(d);
    const done = i === frames.length - 1;
    buildupStatus.textContent = `${spec.detailLabel}: ${d}${done ? "  ✓" : " …"}`;
    render();
    i++;
    buildupTimer = done ? undefined : window.setTimeout(tick, 430);
  };
  tick();
}

// --- Learn mode wiring ----------------------------------------------------

for (const btn of modeBar.querySelectorAll<HTMLButtonElement>("button")) {
  btn.addEventListener("click", () => {
    state.mode = btn.dataset.mode as Mode;
    applyMode();
  });
}

$<HTMLButtonElement>("play").addEventListener("click", playBuildup);

window.addEventListener("resize", () => {
  if (state.mode === "learn") updateOverlay();
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
