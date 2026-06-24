// Learn mode: the math made visible.
//
// Two pure, dependency-free pieces feed the teaching overlay in main.ts:
//   - `computeOrbit` replays the escape-time iteration for a single point so the
//     UI can draw the path z0 -> z1 -> z2 ... (mirrors the kernels in escape.ts).
//   - `EXPLAINERS` is the plain-language copy shown for every pattern.

export type OrbitKind = "mandelbrot" | "julia" | "burningShip" | "tricorn" | "newton";

export interface Orbit {
  /** The visited values z0, z1, z2, … in the complex plane (capped for drawing). */
  points: Array<[number, number]>;
  /** Escape-time: did |z| ever exceed the escape radius (2)? */
  escaped: boolean;
  /** Iterations actually performed before escape / convergence / maxIter. */
  steps: number;
  /** Whether we stopped because the orbit stayed inside (escape-time). */
  bounded: boolean;
  /** Newton only: did the step size collapse onto a root? */
  converged?: boolean;
  /** Newton only: which of the three roots (0, 1, 2) the orbit fell into. */
  root?: number;
}

const ESCAPE_R2 = 4; // |z|^2 > 4  ==  |z| > 2
const MAX_DRAW = 96; // cap stored points so bounded orbits stay drawable
const R3 = 0.86602540378443864; // sqrt(3)/2, the imaginary part of the Newton roots

/**
 * Replay a single point's orbit under the given kind's rule.
 *
 * For Mandelbrot/Burning Ship/Tricorn the pixel is the constant `c` and z starts
 * at 0; for Julia the pixel is the start `z0` and `(jx, jy)` is the constant `c`;
 * Newton runs its root-finding step instead of an escape test.
 */
export function computeOrbit(
  kind: OrbitKind,
  pRe: number, pIm: number, // the picked point, in complex-plane coordinates
  jx: number, jy: number,   // Julia constant (ignored by the others)
  maxIter: number,
): Orbit {
  if (kind === "newton") return newtonOrbit(pRe, pIm, maxIter);

  let zx: number, zy: number, cx: number, cy: number;
  if (kind === "julia") {
    zx = pRe; zy = pIm; cx = jx; cy = jy;
  } else {
    zx = 0; zy = 0; cx = pRe; cy = pIm;
  }

  const points: Array<[number, number]> = [[zx, zy]];
  let n = 0;
  let escaped = false;
  while (n < maxIter) {
    const zx2 = zx * zx, zy2 = zy * zy;
    if (zx2 + zy2 > ESCAPE_R2) { escaped = true; break; }
    let nzx: number, nzy: number;
    if (kind === "burningShip") {
      nzy = Math.abs(2 * zx * zy) + cy;
      nzx = zx2 - zy2 + cx;
    } else if (kind === "tricorn") {
      nzy = -2 * zx * zy + cy;
      nzx = zx2 - zy2 + cx;
    } else {
      nzy = 2 * zx * zy + cy;
      nzx = zx2 - zy2 + cx;
    }
    zx = nzx; zy = nzy; n++;
    if (points.length <= MAX_DRAW) points.push([zx, zy]);
  }
  return { points, escaped, steps: n, bounded: !escaped };
}

/** Newton's method for z^3 - 1 = 0 (mirrors newtonJS in escape.ts). */
function newtonOrbit(a0: number, b0: number, maxIter: number): Orbit {
  let a = a0, b = b0, n = 0;
  const points: Array<[number, number]> = [[a, b]];
  let converged = false;
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
    a -= dx; b -= dy; n++;
    if (points.length <= MAX_DRAW) points.push([a, b]);
    if (dx * dx + dy * dy < 1e-12) { converged = true; break; }
  }
  const d0 = (a - 1) * (a - 1) + b * b;
  const d1 = (a + 0.5) * (a + 0.5) + (b - R3) * (b - R3);
  const d2 = (a + 0.5) * (a + 0.5) + (b + R3) * (b + R3);
  let root = 0;
  if (d1 < d0 && d1 <= d2) root = 1;
  else if (d2 < d0 && d2 < d1) root = 2;
  return { points, escaped: false, steps: n, bounded: true, converged, root };
}

/** Human-readable labels for the three Newton roots, indexed by `Orbit.root`. */
export const NEWTON_ROOTS = ["1", "−0.5 + 0.866i", "−0.5 − 0.866i"];

export interface Explainer {
  title: string;
  /** One or two plain sentences: what the rule is doing, no jargon. */
  what: string;
  /** A few short monospace lines: the rule itself, as a recipe. */
  rule: string[];
}

export const EXPLAINERS: Record<string, Explainer> = {
  mandelbrot: {
    title: "Mandelbrot — z → z² + c",
    what:
      "Every pixel is a complex number c. Start at z = 0 and apply z → z² + c " +
      "over and over. If z stays small forever, c belongs to the set and is " +
      "painted black. If z races off past radius 2, c is outside — and how many " +
      "steps it lasted sets the shade.",
    rule: ["z₀ = 0", "zₙ₊₁ = zₙ² + c", "escape when |z| > 2"],
  },
  julia: {
    title: "Julia — z → z² + c (c fixed)",
    what:
      "Exactly Mandelbrot's rule, flipped: here c is one fixed constant for the " +
      "whole image, and the pixel is the starting value z₀. Nudging c (try " +
      "“Surprise me”) reshapes the entire pattern.",
    rule: ["z₀ = the pixel", "zₙ₊₁ = zₙ² + c", "c is fixed", "escape when |z| > 2"],
  },
  burningShip: {
    title: "Burning Ship — fold, then square",
    what:
      "Mandelbrot's rule with one twist: take the absolute value of z's real and " +
      "imaginary parts before squaring. That fold is what creates the sharp, " +
      "ship-like flames.",
    rule: ["z₀ = 0", "zₙ₊₁ = (|x| + i|y|)² + c", "escape when |z| > 2"],
  },
  tricorn: {
    title: "Tricorn — conjugate, then square",
    what:
      "Like Mandelbrot, but flip the sign of z's imaginary part (conjugate it) " +
      "each step before squaring. That mirror gives the tricorn its three-fold " +
      "symmetry.",
    rule: ["z₀ = 0", "zₙ₊₁ = conj(zₙ)² + c", "escape when |z| > 2"],
  },
  newton: {
    title: "Newton — solving z³ = 1",
    what:
      "Newton's method hunts for a solution of z³ − 1 = 0, stepping toward the " +
      "answer from each starting pixel. There are three solutions; the shade " +
      "shows which one this pixel falls into and how fast it gets there.",
    rule: ["zₙ₊₁ = zₙ − f(z) / f′(z)", "f(z) = z³ − 1", "3 roots → 3 regions"],
  },
  sierpinski: {
    title: "Sierpiński triangle — the chaos game",
    what:
      "Pick 3 corners. Drop a dot, then repeatedly jump halfway toward a randomly " +
      "chosen corner, marking each landing spot. Out of pure randomness a perfect " +
      "triangle-of-triangles appears.",
    rule: ["repeat:", "  pick a random corner", "  move halfway to it", "  plot the point"],
  },
  fern: {
    title: "Barnsley fern — an IFS",
    what:
      "Four simple “shrink, rotate, shift” transforms, chosen at random with fixed " +
      "odds, are applied to a moving point. The dots pile up into a fern — leaves " +
      "made of smaller leaves.",
    rule: ["repeat:", "  pick a transform (weighted)", "  apply it to the point", "  plot the point"],
  },
  carpet: {
    title: "Sierpiński carpet",
    what:
      "Cut a square into a 3×3 grid and remove the centre cell. Do the same to " +
      "each of the 8 survivors, and again, forever. Each level multiplies the holes.",
    rule: ["split into 3×3", "drop the middle cell", "recurse on the other 8"],
  },
  koch: {
    title: "Koch snowflake",
    what:
      "Take each straight segment, split it into thirds, and push a triangular " +
      "bump out of the middle third. Repeat on every new segment — the edge gets " +
      "endlessly crinklier while barely growing.",
    rule: ["each segment:", "  split into 3", "  bump the middle out", "repeat"],
  },
  dragon: {
    title: "Dragon curve",
    what:
      "Fold a paper strip in half again and again, then unfold so every crease is " +
      "a right angle. That run of left/right turns traces the dragon.",
    rule: ["take the path", "add a copy of it", "rotated 90°", "repeat"],
  },
  hilbert: {
    title: "Hilbert curve",
    what:
      "A single line that bends to visit every cell of a grid without ever " +
      "crossing itself. Each level replaces one U-shape with four smaller, rotated " +
      "U-shapes, joined up.",
    rule: ["one U → four U’s", "rotate + connect", "fills the square"],
  },
  levy: {
    title: "Lévy C curve",
    what:
      "Replace each segment with two segments meeting at a right angle — the two " +
      "short sides of a right triangle. Repeat, and a curling C grows.",
    rule: ["each segment:", "  → two sides", "  of a right triangle", "repeat"],
  },
  vicsek: {
    title: "Vicsek fractal",
    what:
      "From a 3×3 grid keep only the centre and the four edge cells — a plus sign. " +
      "Do the same inside each surviving square. A cross made of crosses.",
    rule: ["split into 3×3", "keep centre + 4 sides", "recurse"],
  },
  pythagoras: {
    title: "Pythagoras tree",
    what:
      "Stand a square up, rest a right triangle on top, and grow a new (smaller) " +
      "square on each of the triangle's two other sides. Every square sprouts two " +
      "children.",
    rule: ["square → triangle on top", "→ two child squares", "branch, branch, branch"],
  },
};
