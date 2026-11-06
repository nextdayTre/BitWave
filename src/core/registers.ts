/**
 * Register and nibble arithmetic.
 *
 * Faithful port of the model in index.html: bits[0] is the LSB, display column
 * c maps to bit N-1-c (MSB on the left), and nibble j from the left covers
 * bits N-1-4j .. N-4-4j. `N` is always an explicit parameter here — the app
 * shares one width across all views, but the core never reads a global.
 */

import type { Register } from "./types.ts";

export const SIZES = [8, 16, 32, 64, 128, 256] as const;
export type RegisterSize = (typeof SIZES)[number];

export const DEFAULT_N = 64;

export const nibCount = (N: number): number => N >> 2;

export const makeRegister = (N: number): Register => {
  const n = nibCount(N);
  return {
    bits: new Uint8Array(N),
    anim: new Array<number>(n).fill(0),
    target: new Array<number>(n).fill(0),
  };
};

export function nibAt(bits: Uint8Array, N: number, j: number): number {
  const b = N - 1 - 4 * j;
  return (bits[b] << 3) | (bits[b - 1] << 2) | (bits[b - 2] << 1) | bits[b - 3];
}

export function setNibAt(bits: Uint8Array, N: number, j: number, v: number): void {
  const b = N - 1 - 4 * j;
  bits[b] = (v >> 3) & 1;
  bits[b - 1] = (v >> 2) & 1;
  bits[b - 2] = (v >> 1) & 1;
  bits[b - 3] = v & 1;
}

/** Place value of nibble j (0 = MSB): exponent of two its LSB is worth. */
export const nibWeightPow = (N: number, j: number): number => 4 * (nibCount(N) - 1 - j);

export function regToBig(bits: Uint8Array, N: number): bigint {
  let v = 0n;
  for (let i = N - 1; i >= 0; i--) v = (v << 1n) | BigInt(bits[i]);
  return v;
}

/** Writes the low N bits of `v` into `bits` (mod 2^N, two's-complement wrap). */
export function bigToReg(v: bigint, bits: Uint8Array, N: number): void {
  const mask = (1n << BigInt(N)) - 1n;
  v &= mask;
  for (let i = 0; i < N; i++) {
    bits[i] = Number(v & 1n);
    v >>= 1n;
  }
}

export function popcount(bits: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bits.length; i++) n += bits[i];
  return n;
}

export function bitsToNibbles(bits: Uint8Array, N: number): number[] {
  const n = nibCount(N);
  const out = new Array<number>(n);
  for (let j = 0; j < n; j++) out[j] = nibAt(bits, N, j);
  return out;
}

export function nibblesToBits(values: number[], N: number): Uint8Array {
  const bits = new Uint8Array(N);
  const n = nibCount(N);
  for (let j = 0; j < n; j++) setNibAt(bits, N, j, values[j] ?? 0);
  return bits;
}

const HEX = "0123456789ABCDEF";

export function toHex(bits: Uint8Array, N: number): string {
  const n = nibCount(N);
  let s = "";
  for (let j = 0; j < n; j++) s += HEX[nibAt(bits, N, j)];
  return s;
}

export function toDecimal(bits: Uint8Array, N: number): string {
  return regToBig(bits, N).toString();
}

/**
 * Right-aligns a hex string into an N-bit register, zero-padding on the left;
 * overflow truncates the high bits (DESIGN §10.16). Case-insensitive, an
 * optional 0x prefix is accepted. Throws on non-hex input so import paths can
 * report a real error instead of silently showing stale data.
 */
export function fromHex(text: string, N: number): Uint8Array {
  const clean = text.trim().replace(/^0[xX]/, "");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`not hexadecimal: ${JSON.stringify(text)}`);

  const bits = new Uint8Array(N);
  const digits = clean.length;
  // Walk from the LSB end: the last hex digit contributes bits 3..0.
  for (let k = 0; k < N; k++) {
    const digitIndex = digits - 1 - (k >> 2);
    if (digitIndex < 0) break;
    const v = parseInt(clean[digitIndex], 16);
    bits[k] = (v >> (k & 3)) & 1;
  }
  return bits;
}

/** Copies truth into the eased/target nibble views. */
export function syncTarget(reg: Register, N: number): void {
  const n = nibCount(N);
  if (reg.target.length !== n) {
    reg.target = new Array<number>(n).fill(0);
    reg.anim = new Array<number>(n).fill(0);
  }
  for (let j = 0; j < n; j++) reg.target[j] = nibAt(reg.bits, N, j);
}

export function syncAllTargets(slots: Record<string, { A: Register; B: Register; Z: Register }>, N: number): void {
  for (const slot of Object.values(slots)) {
    syncTarget(slot.A, N);
    syncTarget(slot.B, N);
    syncTarget(slot.Z, N);
  }
}

/**
 * Centre-pinned resize, faithful to `resizeRegister` in index.html: the
 * outermost nibbles on each side stay pinned and new nibbles appear at ∞.
 * `F0` at 8 bits becomes `F000` at 16, then `F000...0000` at 256.
 */
export function remapNibbles(oldValues: number[], oldN: number, newN: number): number[] {
  const oldNibs = nibCount(oldN);
  const newNibs = nibCount(newN);
  const keep = Math.min(oldNibs, newNibs) >> 1;
  const vals = new Array<number>(newNibs).fill(0);
  for (let k = 0; k < keep; k++) {
    vals[k] = oldValues[k];
    vals[newNibs - 1 - k] = oldValues[oldNibs - 1 - k];
  }
  return vals;
}
