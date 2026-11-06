/**
 * Monotone cubic Hermite (Fritsch–Butland interior weights, zero end tangents).
 *
 * The curve cannot overshoot the [0,15] nibble range (DESIGN §2 stance #2), and
 * with two control points it degenerates to smoothstep — the reference shapes.
 * Pure maths; the caller maps nibble values to y pixels.
 */

export interface Spline {
  xs: number[];
  ys: number[];
  m: number[];
  h: number[];
  n: number;
}

export function buildSpline(xs: number[], ys: number[]): Spline {
  const n = xs.length;
  const h = new Array<number>(n - 1);
  const d = new Array<number>(n - 1);
  const m = new Array<number>(n);
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = h[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / h[i];
  }
  m[0] = 0;
  m[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0; // local extremum → level off
    } else {
      const w1 = 2 * h[i] + h[i - 1]; // Fritsch–Butland weighting
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return { xs, ys, m, h, n };
}

export function evalSpline(sp: Spline, x: number): number {
  const { xs, ys, m, h, n } = sp;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];

  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;

  const t = (x - xs[i]) / h[i];
  const t2 = t * t;
  const t3 = t2 * t;

  return (2 * t3 - 3 * t2 + 1) * ys[i]
    + (t3 - 2 * t2 + t) * h[i] * m[i]
    + (-2 * t3 + 3 * t2) * ys[i + 1]
    + (t3 - t2) * h[i] * m[i + 1];
}
