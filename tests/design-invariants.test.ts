/**
 * Golden vectors from DESIGN.md §11 plus property checks.
 * These are the regression net for every later refactor of the instrument.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSpline,
  computeZ,
  evalSpline,
  fromHex,
  invert,
  byteSwap,
  nibAt,
  nibWeightPow,
  nibblesToBits,
  popcountZ,
  remapNibbles,
  rotateLeft,
  rotateRight,
  setNibAt,
  tableValues,
  toHex,
  truthCounts,
} from "../src/core/index.ts";

const N = 64;
const hex = (bits: Uint8Array): string => toHex(bits, N);

test("bit addressing: LSB is bits[0], nibble 0 is the MSB nibble", () => {
  const bits = new Uint8Array(N);
  bits[0] = 1;
  assert.equal(hex(bits), "0000000000000001");
  setNibAt(bits, N, 0, 0xf);
  assert.equal(hex(bits), "F000000000000001");
  assert.equal(nibAt(bits, N, 0), 0xf);
  assert.equal(nibAt(bits, N, 15), 1);
});

test("ROL 4 on FEDCBA9876543210 -> EDCBA9876543210F", () => {
  assert.equal(hex(rotateLeft(fromHex("FEDCBA9876543210", N), N, 4)), "EDCBA9876543210F");
});

test("NOT on FEDCBA9876543210 -> 0123456789ABCDEF (DESIGN §11 errata: doc lists 123456789ABCDEF0)", () => {
  // Bitwise complement of FEDCBA9876543210 is 0123456789ABCDEF. DESIGN.md §11
  // currently lists 123456789ABCDEF0, which is inconsistent with NOT's state
  // semantics (§6, §8) and with index.html's own `invert`. Do not "fix" the
  // engine to match the typo — the vector in DESIGN.md should be corrected.
  assert.equal(hex(invert(fromHex("FEDCBA9876543210", N), N)), "0123456789ABCDEF");
});

test("BSWAP on FEDCBA9876543210 -> 1032547698BADCFE; twice is identity; no-op at 8 bits", () => {
  const once = byteSwap(fromHex("FEDCBA9876543210", N), N);
  assert.equal(hex(once), "1032547698BADCFE");
  assert.equal(hex(byteSwap(once, N)), "FEDCBA9876543210");
  assert.equal(toHex(byteSwap(fromHex("AB", 8), 8), 8), "AB");
});

test("rotate by N is identity; rotate right undoes rotate left", () => {
  const src = fromHex("8ADEFEDA85210125", N);
  assert.equal(hex(rotateLeft(src, N, N)), "8ADEFEDA85210125");
  assert.equal(hex(rotateRight(rotateLeft(src, N, 13), N, 13)), "8ADEFEDA85210125");
});

test("A·B XOR/AND/OR golden vectors and truth counts", () => {
  const a = fromHex("8ADEFEDA85210125", N);
  const b = fromHex("FFFFFFFF00000000", N);

  assert.equal(hex(computeZ(a, b, N, "xor")), "7521012585210125");
  assert.equal(hex(computeZ(a, b, N, "and")), "8ADEFEDA00000000");
  assert.equal(hex(computeZ(a, b, N, "or")), "FFFFFFFF85210125");

  const counts = truthCounts(a, b, N);
  assert.deepEqual(counts, [23, 11, 9, 21]);
  assert.equal(counts.reduce((s, c) => s + c, 0), N);

  assert.equal(popcountZ(computeZ(a, b, N, "xor")), 20);
  assert.equal(popcountZ(computeZ(a, b, N, "and")), 21);
});

test("ADD and SUB wrap mod 2^N (two's-complement semantics)", () => {
  assert.equal(toHex(computeZ(fromHex("FF", 8), fromHex("01", 8), 8, "add"), 8), "00");
  assert.equal(toHex(computeZ(fromHex("00", 8), fromHex("01", 8), 8, "sub"), 8), "FF");
  assert.equal(
    toHex(computeZ(fromHex("FEDCBA9876543210", N), fromHex("0F", N), N, "add"), N),
    "FEDCBA987654321F",
  );
});

test("fromHex right-aligns and truncates overflow (DESIGN §10.16)", () => {
  assert.equal(hex(fromHex("DEAD", N)), "000000000000DEAD");
  assert.equal(hex(fromHex("0xDEAD", N)), "000000000000DEAD");
  assert.equal(hex(fromHex("1FFFFFFFFFFFFFFFF", N)), "FFFFFFFFFFFFFFFF");
  assert.throws(() => fromHex("not hex", N), /not hexadecimal/);
});

test("positional weight is a constant of the position (DESIGN §6)", () => {
  assert.equal(nibWeightPow(64, 0), 60);
  assert.equal(nibWeightPow(64, 15), 0);
  assert.equal(nibWeightPow(256, 0), 252);
  assert.equal(nibWeightPow(8, 0), 4);
});

test("centre-pinned resize: F0 at 8 bits becomes F000 at 16", () => {
  assert.deepEqual(remapNibbles([0xf, 0], 8, 16), [0xf, 0, 0, 0]);
  assert.equal(toHex(nibblesToBits(remapNibbles([0xf, 0], 8, 16), 16), 16), "F000");
  assert.deepEqual(remapNibbles([0xf, 0], 8, 32), [0xf, 0, 0, 0, 0, 0, 0, 0]);
});

test("spline stays inside the nibble range, pins its ends, and degenerates to smoothstep", () => {
  const n = 64;
  const values = tableValues("sine", n * 4);
  const xs = values.map((_, j) => j);
  const sp = buildSpline(xs, values);

  assert.equal(evalSpline(sp, xs[0]), values[0]);
  assert.equal(evalSpline(sp, xs[n - 1]), values[n - 1]);
  let lo = Infinity;
  let hi = -Infinity;
  const EPS = 1e-9; // IEEE-754 noise only; the cubic itself cannot overshoot
  for (let s = 0; s <= 1000; s++) {
    const y = evalSpline(sp, xs[0] + ((xs[n - 1] - xs[0]) * s) / 1000);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
    assert.ok(y >= -EPS && y <= 15 + EPS, `overshoot at sample ${s}: ${y}`);
  }
  assert.ok(lo >= -EPS && hi <= 15 + EPS);

  // Two control points: zero end tangents -> smoothstep; midpoint is the mean.
  const two = buildSpline([0, 1], [0, 15]);
  assert.equal(evalSpline(two, 0.5), 7.5);
  assert.equal(evalSpline(two, 0), 0);
  assert.equal(evalSpline(two, 1), 15);
});
