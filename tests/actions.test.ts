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
  makeLaneState,
  nibValue,
  regToBig,
  type Reg,
  type LaneState,
} from "../src/state/instrument.ts";
import { coreLanes, evaluate, routing } from "../src/state/routing.ts";

const hex64 = (reg: Reg): string =>
  regToBig(reg).toString(16).toUpperCase().padStart(16, "0");

const seed = (reg: Reg, value: bigint): void => bigToReg(value, reg);

/* ── actions ───────────────────────────────────────────────────────────── */

test("actions: unary ops match the DESIGN §11 vectors", () => {
  const lane = makeLaneState("1", 64, "xor");
  seed(lane.A, 0xfedcba9876543210n);

  applyUnary(lane.A, "rol", 4);
  assert.equal(hex64(lane.A), "EDCBA9876543210F");

  seed(lane.A, 0xfedcba9876543210n);
  applyUnary(lane.A, "not", 0);
  assert.equal(hex64(lane.A), "0123456789ABCDEF");

  seed(lane.A, 0xfedcba9876543210n);
  applyUnary(lane.A, "bswap", 0);
  assert.equal(hex64(lane.A), "1032547698BADCFE");
  applyUnary(lane.A, "bswap", 0);
  assert.equal(hex64(lane.A), "FEDCBA9876543210");
});

test("actions: presets load the core wavetables", () => {
  const lane = makeLaneState("1", 64, "xor");
  applyPreset(lane.A, "max");
  assert.equal(hex64(lane.A), "FFFFFFFFFFFFFFFF");
  applyPreset(lane.A, "zero");
  assert.equal(hex64(lane.A), "0000000000000000");
});

test("actions: bit and nibble writes keep target in step", () => {
  const lane = makeLaneState("1", 64, "xor");
  const j = toggleBit(lane.A, 0);
  assert.equal(j, 15);
  assert.equal(nibValue(lane.A, 15), 1);
  assert.equal(lane.A.target[15], 1);
  toggleBit(lane.A, 0);
  assert.equal(nibValue(lane.A, 15), 0);

  assert.equal(setNibble(lane.A, 3, 0x1f), 15);
  assert.equal(nibValue(lane.A, 3), 15);
  assert.equal(lane.A.target[3], 15);
});

test("actions: focus, visibility, binop and showB", () => {
  const lane = makeLaneState("1", 64, "xor");
  setFocus(lane, "b");
  assert.equal(lane.focus, "b");
  assert.equal(lane.edit, "b", "focusing an operand makes it the edit target");
  setFocus(lane, "z");
  assert.equal(lane.focus, "z");
  assert.equal(lane.edit, "b", "focusing Z leaves the edit target alone");

  setShowB(lane, true);
  assert.equal(lane.showB, true);
  setShowB(lane, false);
  assert.equal(lane.focus, "a", "unpairing B drops a Z focus");

  assert.equal(toggleFrameVisibility(lane, "a"), false);
  assert.equal(toggleFrameVisibility(lane, "a"), true);

  setBinop(lane, "add");
  assert.equal(lane.binop, "add");
});

test("actions: copyLane and unpair", () => {
  const src = makeLaneState("1", 64, "xor");
  const dst = makeLaneState("2", 64, "and");
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
  seed(S.lanes["1"].A, 0x5n);
  seed(S.lanes["1"].B, 0x3n);
  seed(S.lanes["2"].A, 0xfn);
  seed(S.lanes["2"].B, 0xcn);

  evaluate(true);
  assert.equal(regToBig(S.lanes["1"].Z), 0x6n);
  assert.equal(regToBig(S.lanes["2"].Z), 0x3n);
  assert.equal(S.lanes["1"].Z.target[15], 0x6);
  assert.equal(S.lanes["2"].Z.target[15], 0x3);
});

test("routing: a core route lands on the app tree and restores on unroute", () => {
  try {
    clearRoutes(routing, coreLanes());
    seed(S.lanes["1"].A, 0x5n);
    seed(S.lanes["1"].B, 0x3n);
    seed(S.lanes["3"].A, 0x7n);
    seed(S.lanes["3"].B, 0x9n);
    evaluate(true);
    const z3 = regToBig(S.lanes["3"].Z);
    assert.equal(z3, 0x1n, "lane 3 is AND");

    addRoute(routing, coreLanes(), { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
    evaluate(true);
    assert.equal(regToBig(S.lanes["1"].A), z3, "Z3 drives lane 1 A");
    assert.equal(regToBig(S.lanes["1"].Z), z3 ^ 0x3n, "Z1 re-derives from the driven A");

    clearRoutes(routing, coreLanes());
    evaluate(true);
    assert.equal(regToBig(S.lanes["1"].A), 0x5n, "unroute restores the parked base");
    assert.equal(regToBig(S.lanes["1"].Z), 0x6n, "Z1 follows the restored base");
  } finally {
    clearRoutes(routing, coreLanes());
  }
});
