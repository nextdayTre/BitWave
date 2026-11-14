import { test, after } from "node:test";
import assert from "node:assert/strict";

import { addRoute, clearRoutes } from "../src/core/routing.ts";
import {
  addLane,
  applyPreset,
  applyUnary,
  copyLane,
  deleteLane,
  duplicateLane,
  setBinop,
  setFocus,
  setNibble,
  setShowB,
  toggleBit,
  toggleFrameVisibility,
  unpair,
} from "../src/state/actions.ts";
import {
  APP_LANE_CAP,
  S,
  bigToReg,
  liveLaneKeys,
  makeLaneState,
  nibValue,
  regToBig,
  type Reg,
  type LaneState,
} from "../src/state/instrument.ts";
import { coreLanes, evaluate, routing } from "../src/state/routing.ts";
import { applyProject, captureProject } from "../src/state/project-bridge.ts";

/* Lane-management tests grow/shrink the live singleton; restore the boot tree
   so later files (`--test-isolation=none`) see the default three lanes. */
const pristine = captureProject();
after(() => applyProject(pristine));
const resetBoot = () => applyProject(pristine);

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

/* ── lane management (D46) ─────────────────────────────────────────────── */

test("lane management: add allocates the lowest free key and never renumbers", () => {
  resetBoot();
  assert.equal(addLane(), "4");
  const added = S.lanes["4"];
  assert.equal(added.key, "4", "the new lane carries its stable key");
  assert.equal(added.binop, "xor", "blank lane starts XOR");
  assert.equal(added.showB, false);
  assert.equal(added.edit, "a");
  assert.equal(added.focus, "a");
  assert.deepEqual(added.frameVis, { a: true, b: true, z: true });
  assert.deepEqual(added.expressions, { a: "", b: "" });
  assert.equal(added.colA, -1);
  assert.equal(added.colB, -1);
  assert.equal(regToBig(added.A), 0n, "zero register A");
  assert.equal(regToBig(added.B), 0n, "zero register B");
  assert.deepEqual(liveLaneKeys(), ["1", "2", "3", "4"]);

  for (const expected of ["5", "6", "7", "8"]) assert.equal(addLane(), expected);
  assert.equal(liveLaneKeys().length, APP_LANE_CAP);
  assert.equal(addLane(), null, "add is refused at the eight-lane cap");

  /* Deleting a middle lane frees its key; the freed key is reusable and no
     surviving lane is renumbered. */
  const removed = deleteLane("3");
  assert.equal(removed.ok, true);
  assert.deepEqual(liveLaneKeys(), ["1", "2", "4", "5", "6", "7", "8"]);
  assert.equal(S.lanes["4"].key, "4");
  assert.equal(addLane(), "3");
  assert.deepEqual(liveLaneKeys(), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  resetBoot();
});

test("lane management: duplicate copies model state but not routes or parked bases", () => {
  resetBoot();
  clearRoutes(routing, coreLanes());
  const src = S.lanes["1"];
  seed(src.A, 0xdeadn);
  seed(src.B, 0xbeefn);
  setShowB(src, true);
  src.binop = "add";
  src.seededB = true;
  src.lfoB = "opp";
  src.fold = "b-far";
  src.frameVis.b = false;
  src.expressions.a = "Z2 + 1";
  src.colA = 2;
  setFocus(src, "b");
  const z1 = regToBig(src.Z);

  addRoute(routing, coreLanes(), { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  const routesBefore = routing.routes.length;
  const parkedBefore = [...routing.parked.keys()];

  assert.equal(duplicateLane("1"), "4");
  const copy = S.lanes["4"];
  assert.equal(copy.key, "4");
  assert.equal(regToBig(copy.A), 0xdeadn);
  assert.equal(regToBig(copy.B), 0xbeefn);
  assert.equal(copy.showB, true);
  assert.equal(copy.binop, "add");
  assert.equal(copy.seededB, true);
  assert.equal(copy.lfoB, "opp");
  assert.equal(copy.fold, "b-far");
  assert.equal(copy.frameVis.b, false);
  assert.equal(copy.expressions.a, "Z2 + 1");
  assert.equal(copy.colA, 2);
  assert.equal(copy.focus, "b");

  assert.equal(routing.routes.length, routesBefore, "duplicate adds no route edges");
  assert.equal(
    routing.routes.some((route) => route.from.lane === "4" || route.to.lane === "4"),
    false,
    "no route touches the duplicate",
  );
  assert.deepEqual([...routing.parked.keys()], parkedBefore, "parked bases are untouched");

  /* The copy derives its own Z (Z4 = G add H) once its copied expression is
     cleared — a duplicate keeps the source's expression sources too. */
  assert.equal(copy.expressions.a, "Z2 + 1", "duplicate copies expression sources");
  copy.expressions.a = "";
  evaluate(true);
  assert.equal(regToBig(copy.A), 0xdeadn, "the copy's own A is untouched by source routes");
  assert.notEqual(regToBig(copy.Z), z1);
  assert.equal(regToBig(copy.Z), (0xdeadn + 0xbeefn) & 0xffffffffffffffffn);

  /* Unknown source and cap are refusals. */
  assert.equal(duplicateLane("9"), null);
  while (liveLaneKeys().length < APP_LANE_CAP) addLane();
  assert.equal(duplicateLane("1"), null, "duplicate is refused at the cap");
  resetBoot();
});

test("lane management: delete clears routes, restores parked bases and repairs split", () => {
  resetBoot();
  clearRoutes(routing, coreLanes());
  const bootA1 = regToBig(S.lanes["1"].A);
  const bootB2 = regToBig(S.lanes["2"].B);

  addRoute(routing, coreLanes(), { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  addRoute(routing, coreLanes(), { lane: "1", frame: "z" }, { lane: "2", frame: "b" });
  evaluate(true);
  assert.equal(routing.parked.size, 2);

  assert.equal(deleteLane("3").ok, true);
  assert.equal(S.lanes["3"], undefined);
  assert.deepEqual(liveLaneKeys(), ["1", "2"]);
  evaluate(true);
  assert.equal(
    regToBig(S.lanes["1"].A),
    bootA1,
    "a route leaving the deleted lane unplugs its destination and restores the parked base",
  );
  assert.equal(routing.routes.length, 1, "only the surviving route remains");
  assert.deepEqual([...routing.parked.keys()], ["2:b"]);

  /* Delete a split-pane lane: split exits because fewer than two lanes remain. */
  S.view3d = true;
  S.split3d = true;
  S.splitPair = ["1", "2"];
  S.activePane = 0;
  S.laneKey = "1";
  assert.equal(deleteLane("1").ok, true);
  evaluate(true);
  assert.equal(regToBig(S.lanes["2"].B), bootB2, "lane 1's outgoing route restored lane 2 B");
  assert.equal(routing.routes.length, 0);
  assert.equal(routing.parked.size, 0);
  assert.deepEqual(liveLaneKeys(), ["2"]);
  assert.equal(S.laneKey, "2", "focus falls to the lowest remaining lane");
  assert.equal(S.split3d, false, "split cannot survive below two lanes");
  assert.deepEqual(S.splitPair, ["2", "2"]);

  /* The last lane can never be deleted. */
  assert.deepEqual(deleteLane("2"), { ok: false, reason: "last" });
  assert.equal(S.lanes["2"] !== undefined, true);
  assert.deepEqual(deleteLane("5"), { ok: false, reason: "unknown" });

  /* Split stays exactly two panes and a deleted pane lane is repaired. */
  resetBoot();
  S.view3d = true;
  S.split3d = true;
  S.splitPair = ["1", "2"];
  S.activePane = 0;
  S.laneKey = "1";
  assert.equal(deleteLane("1").ok, true);
  assert.deepEqual(liveLaneKeys(), ["2", "3"]);
  assert.equal(S.split3d, true, "split survives with two lanes");
  assert.notEqual(S.splitPair[0], S.splitPair[1], "split panes never collapse onto one lane");
  for (const key of S.splitPair) assert.ok(liveLaneKeys().includes(key));
  resetBoot();
});
