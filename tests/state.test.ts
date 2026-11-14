import { test } from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/state/store.ts";
import {
  FRAME_NAMES,
  LANE_KEYS,
  S,
  SIZES,
  bigToReg,
  curLane,
  editKey,
  focusKey,
  frameName,
  makeLaneState,
  makeReg,
  nibAt,
  nibValue,
  recomputeZ,
  regOf,
  regToBig,
  setNibAt,
  setNibValue,
  syncTarget,
} from "../src/state/instrument.ts";
import { laneDefs } from "../src/core/lanedefs.ts";
import { LANE_KEYS as CORE_LANE_KEYS } from "../src/core/types.ts";

/* ── store ─────────────────────────────────────────────────────────────── */

test("store: patch notifies once with the settled state", () => {
  const store = createStore({ n: 0 });
  const seen: number[] = [];
  store.subscribe((state) => seen.push(state.n));

  store.patch((state) => { state.n = 1; });
  store.patch((state) => { state.n = 2; });

  assert.equal(store.get().n, 2);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(store.revision(), 2);
});

test("store: nested patches collapse to one notification", () => {
  const store = createStore({ n: 0 });
  const seen: number[] = [];
  store.subscribe((state) => seen.push(state.n));

  const result = store.patch((state) => {
    state.n = 1;
    store.patch((inner) => { inner.n = 2; });
    return "done";
  });

  assert.equal(result, "done");
  assert.deepEqual(seen, [2]);
  assert.equal(store.revision(), 1);
});

test("store: unsubscribe stops notifications", () => {
  const store = createStore({ n: 0 });
  const seen: number[] = [];
  const off = store.subscribe((state) => seen.push(state.n));

  store.patch((state) => { state.n = 1; });
  off();
  store.patch((state) => { state.n = 2; });

  assert.deepEqual(seen, [1]);
});

test("store: a throwing mutator still completes the transaction boundary", () => {
  const store = createStore({ n: 0 });
  const seen: number[] = [];
  store.subscribe((state) => seen.push(state.n));

  assert.throws(() => {
    store.patch((state) => {
      state.n = 1;
      throw new Error("boom");
    });
  }, /boom/);

  assert.deepEqual(seen, [1]);
  assert.equal(store.revision(), 1);
});

/* ── instrument ────────────────────────────────────────────────────────── */

test("instrument: frame names are global, derived from the stable lane key", () => {
  assert.deepEqual(FRAME_NAMES["1"], { a: "A", b: "B", z: "Z1" });
  assert.equal(frameName("1", "z"), "Z1");
  assert.equal(frameName("2", "a"), "C");
  assert.equal(frameName("2", "z"), "Z2");
  assert.equal(frameName("3", "b"), "F");
  assert.equal(frameName("3", "z"), "Z3");
});

test("instrument: state lanes are keyed by the lane key, not by slot letter", () => {
  assert.equal(S.N, 64);
  assert.deepEqual(SIZES, [8, 16, 32, 64, 128, 256]);
  assert.deepEqual(LANE_KEYS, ["1", "2", "3"]);
  assert.deepEqual(CORE_LANE_KEYS, laneDefs().map((def) => def.key));
  assert.equal(S.laneKey, "1");
  assert.deepEqual(Object.keys(S.lanes), ["1", "2", "3"]);
  assert.deepEqual(S.laneKeys, ["1", "2", "3"], "the ordered live lane list is derived from the map");
  /* D46: the frame-name table covers the whole eight-lane app cap so any live
     lane key has global names; the boot instrument still ships three. */
  assert.deepEqual(
    Object.keys(FRAME_NAMES),
    ["1", "2", "3", "4", "5", "6", "7", "8"],
  );
  assert.equal(FRAME_NAMES["8"].z, "Z8");
  for (const key of LANE_KEYS) {
    assert.equal(S.lanes[key].key, key, `lane ${key} carries its own key`);
  }

  const lane = makeLaneState("2", 64, "and");
  assert.equal(lane.key, "2");
  assert.equal(lane.binop, "and");
  assert.equal(lane.edit, "a");
  assert.equal(lane.focus, "a");
  assert.deepEqual(lane.frameVis, { a: true, b: true, z: true });
  assert.equal(lane.colA, -1);
});

test("instrument: selection helpers follow focus and edit", () => {
  const lane = makeLaneState("1", 64, "xor");
  assert.equal(editKey(lane), "a");
  assert.equal(regOf("z", lane), lane.Z);
  assert.equal(focusKey(lane), "a");

  lane.showB = true;
  lane.edit = "b";
  assert.equal(editKey(lane), "b");
  assert.equal(focusKey(lane), "a", "edit does not move focus");

  lane.focus = "b";
  assert.equal(focusKey(lane), "b");
  lane.focus = "z";
  assert.equal(focusKey(lane), "z");
});

test("instrument: nibble helpers delegate to the core register math", () => {
  const reg = makeReg(64);
  setNibValue(reg, 15, 0xa);
  assert.equal(nibValue(reg, 15), 0xa);
  assert.equal(nibAt(reg.bits, 15), 0xa);

  syncTarget(reg, true);
  assert.equal(reg.target[15], 0xa);
  assert.equal(reg.anim[15], 0xa);

  bigToReg(0xfedcba9876543210n, reg);
  assert.equal(regToBig(reg), 0xfedcba9876543210n);
});

test("instrument: recomputeZ delegates to the core derive", () => {
  const lane = makeLaneState("1", 64, "xor");
  setNibValue(lane.A, 15, 0x3);
  setNibValue(lane.B, 15, 0x5);
  recomputeZ(true, lane);

  assert.equal(regToBig(lane.Z), 0x6n);
  assert.equal(lane.Z.target[15], 0x6);
  assert.equal(lane.Z.anim[15], 0x6);

  lane.binop = "add";
  setNibValue(lane.A, 15, 0xf);
  setNibValue(lane.B, 15, 0x1);
  recomputeZ(true, lane);
  assert.equal(regToBig(lane.Z), 0x10n);
});

test("instrument: the live tree is shared with the app singleton", () => {
  assert.equal(curLane(), S.lanes[S.laneKey]);
  assert.equal(curLane().A, S.A);
  assert.equal(curLane().Z, S.Z);
});
