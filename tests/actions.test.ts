import { test } from "node:test";
import assert from "node:assert/strict";

import { addRoute, clearRoutes } from "../src/core/routing.ts";
import {
  applyPreset,
  applyUnary,
  copyLane,
  setBinop,
  setFocus,
  setNibble,
  setShowB,
  toggleBit,
  toggleFrameVisibility,
  unpair,
} from "../src/state/actions.ts";
import {
  S,
  bigToReg,
  makeSlot,
  nibValue,
  regToBig,
  type Reg,
  type Slot,
} from "../src/state/instrument.ts";
import { coreLanes, evaluate, routing } from "../src/state/routing.ts";

const hex64 = (reg: Reg): string =>
  regToBig(reg).toString(16).toUpperCase().padStart(16, "0");

const seed = (reg: Reg, value: bigint): void => bigToReg(value, reg);

/* ── actions ───────────────────────────────────────────────────────────── */

test("actions: unary ops match the DESIGN §11 vectors", () => {
  const slot = makeSlot("A", 64, "xor");
  seed(slot.A, 0xfedcba9876543210n);

  applyUnary(slot.A, "rol", 4);
  assert.equal(hex64(slot.A), "EDCBA9876543210F");

  seed(slot.A, 0xfedcba9876543210n);
  applyUnary(slot.A, "not", 0);
  assert.equal(hex64(slot.A), "0123456789ABCDEF");

  seed(slot.A, 0xfedcba9876543210n);
  applyUnary(slot.A, "bswap", 0);
  assert.equal(hex64(slot.A), "1032547698BADCFE");
  applyUnary(slot.A, "bswap", 0);
  assert.equal(hex64(slot.A), "FEDCBA9876543210");
});

test("actions: presets load the core wavetables", () => {
  const slot = makeSlot("A", 64, "xor");
  applyPreset(slot.A, "max");
  assert.equal(hex64(slot.A), "FFFFFFFFFFFFFFFF");
  applyPreset(slot.A, "zero");
  assert.equal(hex64(slot.A), "0000000000000000");
});

test("actions: bit and nibble writes keep target in step", () => {
  const slot = makeSlot("A", 64, "xor");
  const j = toggleBit(slot.A, 0);
  assert.equal(j, 15);
  assert.equal(nibValue(slot.A, 15), 1);
  assert.equal(slot.A.target[15], 1);
  toggleBit(slot.A, 0);
  assert.equal(nibValue(slot.A, 15), 0);

  assert.equal(setNibble(slot.A, 3, 0x1f), 15);
  assert.equal(nibValue(slot.A, 3), 15);
  assert.equal(slot.A.target[3], 15);
});

test("actions: focus, visibility, binop and showB", () => {
  const slot = makeSlot("A", 64, "xor");
  setFocus(slot, "b");
  assert.equal(slot.focus, "b");
  assert.equal(slot.edit, "b", "focusing an operand makes it the edit target");
  setFocus(slot, "z");
  assert.equal(slot.focus, "z");
  assert.equal(slot.edit, "b", "focusing Z leaves the edit target alone");

  setShowB(slot, true);
  assert.equal(slot.showB, true);
  setShowB(slot, false);
  assert.equal(slot.focus, "a", "unpairing B drops a Z focus");

  assert.equal(toggleFrameVisibility(slot, "a"), false);
  assert.equal(toggleFrameVisibility(slot, "a"), true);

  setBinop(slot, "add");
  assert.equal(slot.binop, "add");
});

test("actions: copyLane and unpair", () => {
  const src = makeSlot("A", 64, "xor");
  const dst = makeSlot("B", 64, "and");
  seed(src.A, 0xdeadbeefn);
  seed(src.B, 0x1234n);
  src.showB = true;
  src.focus = "z";
  src.frameVis.b = false;
  src.lfoB = "q";
  src.colA = 3;

  copyLane(src, dst);
  assert.equal(regToBig(dst.A), 0xdeadbeefn);
  assert.equal(regToBig(dst.B), 0x1234n);
  assert.equal(dst.showB, true);
  assert.equal(dst.focus, "z");
  assert.equal(dst.frameVis.b, false);
  assert.equal(dst.lfoB, "q");
  assert.equal(dst.colA, 3);

  unpair(dst);
  assert.equal(dst.showB, false);
  assert.equal(dst.edit, "a");
  assert.equal(dst.focus, "a");
});

/* ── routing adapter (core evaluateAll on the app tree) ────────────────── */

test("routing: evaluate derives Z for every lane and syncs targets", () => {
  clearRoutes(routing, coreLanes());
  seed(S.slots.A.A, 0x5n);
  seed(S.slots.A.B, 0x3n);
  seed(S.slots.B.A, 0xfn);
  seed(S.slots.B.B, 0xcn);

  evaluate(true);
  assert.equal(regToBig(S.slots.A.Z), 0x6n);
  assert.equal(regToBig(S.slots.B.Z), 0x3n);
  assert.equal(S.slots.A.Z.target[15], 0x6);
  assert.equal(S.slots.B.Z.target[15], 0x3);
});

test("routing: a core route lands on the app tree and restores on unroute", () => {
  try {
    clearRoutes(routing, coreLanes());
    seed(S.slots.A.A, 0x5n);
    seed(S.slots.A.B, 0x3n);
    seed(S.slots.C.A, 0x7n);
    seed(S.slots.C.B, 0x9n);
    evaluate(true);
    const z3 = regToBig(S.slots.C.Z);
    assert.equal(z3, 0x1n, "lane 3 is AND");

    addRoute(routing, coreLanes(), { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
    evaluate(true);
    assert.equal(regToBig(S.slots.A.A), z3, "Z3 drives lane 1 A");
    assert.equal(regToBig(S.slots.A.Z), z3 ^ 0x3n, "Z1 re-derives from the driven A");

    clearRoutes(routing, coreLanes());
    evaluate(true);
    assert.equal(regToBig(S.slots.A.A), 0x5n, "unroute restores the parked base");
    assert.equal(regToBig(S.slots.A.Z), 0x6n, "Z1 follows the restored base");
  } finally {
    clearRoutes(routing, coreLanes());
  }
});
