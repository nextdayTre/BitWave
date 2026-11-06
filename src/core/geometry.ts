/**
 * Plot and column geometry — the contract that keeps the curve over its bits.
 *
 * Ported from `draw()`/`nearestNibble()`/`valueFromY()` in index.html. These
 * functions are pure: the renderer passes the measured viewport and gets back
 * the rectangle and the exact control-point x positions. The DOM strip uses
 * the same `gap`/`width` values as flex `gap`, which is why the control point
 * at x(j) sits over its nibble centre (DESIGN §5, §10.4).
 */

export interface PlotRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  pw: number;
  ph: number;
}

export interface ColumnGeometry {
  n: number;
  /** px gap between nibble columns (also mirrored to the strip's flex gap). */
  gap: number;
  /** nibble content width in px. */
  width: number;
  /** control-point x per nibble, i.e. the nibble centre. */
  xs: number[];
}

export const H_PAD_DESKTOP = 40;
export const H_PAD_NARROW = 16;
export const TOP_INSET = 34;
export const BOTTOM_INSET = 26;
export const COMPACT_BELOW = 46;

export function plotRect(viewW: number, viewH: number): PlotRect {
  const padX = viewW < 680 ? H_PAD_NARROW : H_PAD_DESKTOP;
  const x0 = padX;
  const x1 = Math.max(x0 + 10, viewW - padX);
  const y0 = TOP_INSET;
  const y1 = Math.max(y0 + 10, viewH - BOTTOM_INSET);
  return { x0, x1, y0, y1, pw: x1 - x0, ph: y1 - y0 };
}

/** gap = clamp((pw/n) * 0.16, 1.5, 12); w = (pw - (n-1)*gap)/n; x(j) = x0 + j(w+gap) + w/2. */
export function columnGeometry(rect: PlotRect, n: number): ColumnGeometry {
  const gap = Math.max(1.5, Math.min(12, (rect.pw / n) * 0.16));
  const width = (rect.pw - (n - 1) * gap) / n;
  const xs = new Array<number>(n);
  for (let j = 0; j < n; j++) xs[j] = rect.x0 + j * (width + gap) + width / 2;
  return { n, gap, width, xs };
}

/** Below ~46px per nibble the four bit glyphs stop being legible (DESIGN §9). */
export const isCompact = (rect: PlotRect, n: number): boolean => rect.pw / n < COMPACT_BELOW;

export function nearestNibble(rect: PlotRect, geo: ColumnGeometry, px: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let j = 0; j < geo.n; j++) {
    const d = Math.abs(geo.xs[j] - px);
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

/** y(v) = y1 - (v/15)*ph — unsigned linear, 0000 at the bottom. */
export const yOf = (rect: PlotRect, v: number): number => rect.y1 - (v / 15) * rect.ph;

/** Inverse mapping, rounded and clamped to a nibble value. */
export function valueFromY(rect: PlotRect, py: number): number {
  const v = ((rect.y1 - py) / rect.ph) * 15;
  return Math.max(0, Math.min(15, Math.round(v)));
}

/** ∞ = ((x0+x1)/2, y(7.5)) — the register's growth anchor (DESIGN §6). */
export const infinityPoint = (rect: PlotRect): { x: number; y: number } => ({
  x: (rect.x0 + rect.x1) / 2,
  y: yOf(rect, 7.5),
});
