/**
 * Derived registers and the algebra readouts.
 *
 * Z is always A <op> B for a view. Bitwise ops work bit for bit; ADD/SUB carry
 * and borrow across the whole word through BigInt, which is precisely why
 * neither equals XOR. Nothing here is editable — Z is a function (DESIGN §10.8).
 */

import type { BinOp, Register } from "./types.ts";
import { bigToReg, regToBig } from "./registers.ts";

export const OPSYM: Record<BinOp, string> = {
  and: "\u2227", // ∧
  or: "\u2228",  // ∨
  xor: "\u2295", // ⊕
  add: "+",
  sub: "\u2212", // −
};

export const isArith = (op: BinOp): boolean => op === "add" || op === "sub";

/** Truth value of one bit pair (only meaningful for bitwise ops). */
export const binFn = (op: BinOp, a: number, b: number): number =>
  op === "and" ? a & b : op === "or" ? a | b : a ^ b;

/** Pure Z: returns a new N-bit array. ADD/SUB wrap mod 2^N. */
export function computeZ(aBits: Uint8Array, bBits: Uint8Array, N: number, op: BinOp): Uint8Array {
  const out = new Uint8Array(N);
  if (op === "add" || op === "sub") {
    const a = regToBig(aBits, N);
    const b = regToBig(bBits, N);
    bigToReg(op === "add" ? a + b : a - b, out, N);
    return out;
  }
  for (let i = 0; i < N; i++) {
    const x = aBits[i];
    const y = bBits[i];
    out[i] = op === "and" ? x & y : op === "or" ? x | y : x ^ y;
  }
  return out;
}

/** In-place variant used by the evaluation pipeline (keeps register identity). */
export function computeZInto(z: Register, aBits: Uint8Array, bBits: Uint8Array, N: number, op: BinOp): void {
  z.bits = computeZ(aBits, bBits, N, op);
}

/**
 * How many bit positions hold each input pair, in (00, 01, 10, 11) order.
 * The four counts always sum to N (DESIGN §6).
 */
export function truthCounts(aBits: Uint8Array, bBits: Uint8Array, N: number): [number, number, number, number] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) counts[(aBits[i] << 1) | bBits[i]]++;
  return counts;
}

export function popcountZ(zBits: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < zBits.length; i++) n += zBits[i];
  return n;
}

/** Carry out for ADD, borrow out for SUB. */
export function carryOrBorrow(aBits: Uint8Array, bBits: Uint8Array, N: number, op: BinOp): boolean {
  const a = regToBig(aBits, N);
  const b = regToBig(bBits, N);
  return op === "add" ? a + b >= 1n << BigInt(N) : a < b;
}
