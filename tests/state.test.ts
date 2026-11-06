import { test } from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/state/store.ts";
import {
  FRAME_NAMES,
  S,
  SIZES,
  SLOT_KEYS,
  bigToReg,
  curSlot,
  editKey,
  focusKey,
  frameName,
  laneLabel,
  makeReg,
  makeSlot,
  nibAt,
  nibValue,
  recomputeZ,
  regOf,
  regToBig,
  setNibAt,
  setNibValue,
  syncTarget,
} from "../src/state/instrument.ts";

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

test("instrument: frame names are global", () => {
  assert.deepEqual(FRAME_NAMES.A, { a: "A", b: "B", z: "Z1" });
  assert.equal(frameName("A", "z"), "Z1");
  assert.equal(frameName("B", "a"), "C");
  assert.equal(frameName("B", "z"), "Z2");
  assert.equal(frameName("C", "b"), "F");
  assert.equal(frameName("C", "z"), "Z3");
  assert.equal(laneLabel("A"), "1");
  assert.equal(laneLabel("C"), "3");
});

test("instrument: boot tree shape and per-lane frame state", () => {
  assert.equal(S.N, 64);
  assert.deepEqual(SLOT_KEYS, ["A", "B", "C"]);
  assert.deepEqual(SIZES, [8, 16, 32, 64, 128, 256]);
  assert.equal(S.slot, "A");
  assert.deepEqual(Object.keys(S.slots), ["A", "B", "C"]);

  const slot = makeSlot("B", 64, "and");
  assert.equal(slot.key, "B");
  assert.equal(slot.binop, "and");
  assert.equal(slot.edit, "a");
  assert.equal(slot.focus, "a");
  assert.deepEqual(slot.frameVis, { a: true, b: true, z: true });
  assert.equal(slot.colA, -1);
});

test("instrument: selection helpers follow focus and edit", () => {
  const slot = makeSlot("A", 64, "xor");
  assert.equal(editKey(slot), "a");
  assert.equal(regOf("z", slot), slot.Z);
  assert.equal(focusKey(slot), "a");

  slot.showB = true;
  slot.edit = "b";
  assert.equal(editKey(slot), "b");
  assert.equal(focusKey(slot), "a", "edit does not move focus");

  slot.focus = "b";
  assert.equal(focusKey(slot), "b");
  slot.focus = "z";
  assert.equal(focusKey(slot), "z");
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
  const slot = makeSlot("A", 64, "xor");
  setNibValue(slot.A, 15, 0x3);
  setNibValue(slot.B, 15, 0x5);
  recomputeZ(true, slot);

  assert.equal(regToBig(slot.Z), 0x6n);
  assert.equal(slot.Z.target[15], 0x6);
  assert.equal(slot.Z.anim[15], 0x6);

  slot.binop = "add";
  setNibValue(slot.A, 15, 0xf);
  setNibValue(slot.B, 15, 0x1);
  recomputeZ(true, slot);
  assert.equal(regToBig(slot.Z), 0x10n);
});

test("instrument: the live tree is shared with the app singleton", () => {
  assert.equal(curSlot(), S.slots[S.slot]);
  assert.equal(curSlot().A, S.A);
  assert.equal(curSlot().Z, S.Z);
});
