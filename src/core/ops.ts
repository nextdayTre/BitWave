/**
 * Unary operations and wavetable presets.
 *
 * Every function returns a NEW bit array and never mutates its input, so the
 * app can snapshot before applying an op (and a future undo stack is trivial).
 * Faithful port of the ops in index.html, with N explicit.
 */

import { nibAt, setNibAt, nibCount } from "./registers.ts";

export const clampNib = (v: number): number => Math.max(0, Math.min(15, Math.round(v)));

/** ROL — phase shift. Bit b moves to b+k, wrapping. */
export function rotateLeft(bits: Uint8Array, N: number, k: number): Uint8Array {
  const shift = ((k % N) + N) % N;
  const out = new Uint8Array(N);
  for (let b = 0; b < N; b++) out[(b + shift) % N] = bits[b];
  return out;
}

export function rotateRight(bits: Uint8Array, N: number, k: number): Uint8Array {
  const shift = ((k % N) + N) % N;
  const out = new Uint8Array(N);
  for (let b = 0; b < N; b++) out[(b - shift + N) % N] = bits[b];
  return out;
}

/** SHL — bits past the MSB are discarded, not folded. */
export function shiftLeft(bits: Uint8Array, N: number, k: number): Uint8Array {
  const out = new Uint8Array(N);
  for (let b = 0; b + k < N; b++) out[b + k] = bits[b];
  return out;
}

export function shiftRight(bits: Uint8Array, N: number, k: number): Uint8Array {
  const out = new Uint8Array(N);
  for (let b = N - 1; b - k >= 0; b--) out[b - k] = bits[b];
  return out;
}

/** NOT — polarity inversion, the vertical flip. */
export function invert(bits: Uint8Array, N: number): Uint8Array {
  const out = new Uint8Array(N);
  for (let b = 0; b < N; b++) out[b] = bits[b] ^ 1;
  return out;
}

/** XOR against a rising nibble ramp — the wavefolder. */
export function fold(bits: Uint8Array, N: number): Uint8Array {
  const out = bits.slice();
  const n = nibCount(N);
  for (let j = 0; j < n; j++) setNibAt(out, N, j, nibAt(out, N, j) ^ (j & 15));
  return out;
}

/**
 * BSWAP — reverse byte (nibble-pair) order; bit order inside a byte is kept.
 * A no-op at 8 bits: one byte has no byte order.
 */
export function byteSwap(bits: Uint8Array, N: number): Uint8Array {
  const n = nibCount(N);
  const bytes = n >> 1;
  if (bytes < 2) return bits.slice();

  const cur = new Array<number>(n);
  for (let j = 0; j < n; j++) cur[j] = nibAt(bits, N, j);
  const out = new Uint8Array(N);
  for (let j = 0; j < n; j++) {
    const byteIdx = j >> 1;
    const inByte = j & 1;
    const dest = (bytes - 1 - byteIdx) * 2 + inByte;
    setNibAt(out, N, dest, cur[j]);
  }
  return out;
}

export type TableName = "zero" | "max" | "sine" | "cosine" | "triangle" | "sawDown" | "sawUp" | "square";

type TableFn = (n: number, j: number) => number;

/** Wavetable presets, identical to the formulas in index.html. */
export const TABLES: Record<TableName, TableFn> = {
  zero: () => 0,
  max: () => 15,
  sine: (n, j) => clampNib(7.5 + 7.5 * Math.sin((2 * Math.PI * j) / n)),
  cosine: (n, j) => clampNib(7.5 + 7.5 * Math.cos((2 * Math.PI * j) / n)),
  triangle: (n, j) => {
    const t = n === 1 ? 0 : j / (n - 1);
    return clampNib(15 * (1 - Math.abs(2 * t - 1)));
  },
  sawDown: (n, j) => clampNib(15 * (1 - j / Math.max(1, n - 1))),
  sawUp: (n, j) => clampNib(15 * (j / Math.max(1, n - 1))),
  square: (n, j) => (j < n / 2 ? 15 : 0),
};

export function tableValues(name: TableName, N: number): number[] {
  const n = nibCount(N);
  const fn = TABLES[name];
  const out = new Array<number>(n);
  for (let j = 0; j < n; j++) out[j] = fn(n, j);
  return out;
}
