/**
 * Routing engine — golden vectors from docs/analysis/routing.md §3.7.
 * Every value here was independently recomputed from the boot table formulas.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addRoute,
  clearRoutes,
  createRouting,
  driverOf,
  evaluateAll,
  isDriven,
  makeBootSlots,
  markDelays,
  popcountZ,
  remapParked,
  removeRoute,
  resizeSlots,
  toHex,
  truthCounts,
} from "../src/core/index.ts";
import type { DestinationPort, FrameKey, Slot, SlotKey, SlotMap } from "../src/core/types.ts";

const N = 64;

const boot = (): SlotMap => makeBootSlots(N);
const operand = (slot: Slot, frame: "a" | "b" | "z") => (frame === "a" ? slot.A : frame === "b" ? slot.B : slot.Z);
const hex = (slots: SlotMap, key: SlotKey, frame: FrameKey): string => toHex(operand(slots[key], frame).bits, N);
const snapshot = (slots: SlotMap): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of ["A", "B", "C"] as SlotKey[]) {
    for (const frame of ["a", "b", "z"] as FrameKey[]) out[`${key}.${frame}`] = hex(slots, key, frame);
  }
  return out;
};

test("boot values match the instrument (golden)", () => {
  const s = boot();
  assert.equal(hex(s, "A", "a"), "8ADEFEDA85210125");
  assert.equal(hex(s, "A", "b"), "FFFFFFFF00000000");
  assert.equal(hex(s, "A", "z"), "7521012585210125");
  assert.equal(hex(s, "B", "a"), "FEDA852101257ADE");
  assert.equal(hex(s, "B", "b"), "02468ACEECA86420");
  assert.equal(hex(s, "C", "a"), "0123456789ABCDEF");
  assert.equal(hex(s, "C", "b"), "8ADEFEDA85210125");
  assert.equal(hex(s, "C", "z"), "0002444281210125");
});

test("patch C.Z -> A.A: derived value, truth counts and popcount hold", () => {
  const s = boot();
  const routing = createRouting();
  const route = addRoute(routing, s, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });

  assert.equal(route.delay, false);
  assert.equal(routing.parked.size, 1);
  assert.equal(hex(s, "A", "a"), "8ADEFEDA85210125", "no write before evaluation");

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "A", "a"), "0002444281210125");
  assert.equal(hex(s, "A", "z"), "FFFDBBBD81210125");
  assert.deepEqual(truthCounts(s.A.A.bits, s.A.B.bits, N), [24, 27, 8, 5]);
  assert.equal(popcountZ(s.A.Z.bits), 35);
});

test("chain C.Z -> A.A -> B resolves in one evaluation", () => {
  const s = boot();
  const routing = createRouting();
  addRoute(routing, s, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });
  addRoute(routing, s, { slot: "A", frame: "z" }, { slot: "B", frame: "a" });

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "A", "a"), "0002444281210125");
  assert.equal(hex(s, "A", "z"), "FFFDBBBD81210125");
  assert.equal(hex(s, "B", "a"), "FFFDBBBD81210125");
  assert.equal(hex(s, "B", "z"), "FDBB31736D896505");
});

test("unplugging restores the pre-patch value byte-identically", () => {
  const s = boot();
  const before = snapshot(s);
  const routing = createRouting();
  const r1 = addRoute(routing, s, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });
  const r2 = addRoute(routing, s, { slot: "A", frame: "z" }, { slot: "B", frame: "a" });

  evaluateAll(routing, s, N);
  removeRoute(routing, s, r2.id);
  removeRoute(routing, s, r1.id);
  evaluateAll(routing, s, N);

  assert.deepEqual(snapshot(s), before);
  assert.equal(routing.parked.size, 0);
});

test("one cable per input: a second cable replaces the first, parking survives", () => {
  const s = boot();
  const bootA = hex(s, "A", "a");
  const routing = createRouting();

  addRoute(routing, s, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });
  addRoute(routing, s, { slot: "B", frame: "z" }, { slot: "A", frame: "a" });

  assert.equal(routing.routes.length, 1);
  assert.equal(driverOf(routing, "A", "a")?.from.slot, "B");
  assert.equal(isDriven(routing, "A", "a"), true);

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "A", "a"), hex(s, "B", "z"));

  removeRoute(routing, s, routing.routes[0].id);
  assert.equal(hex(s, "A", "a"), bootA, "parked base was captured on first attach");
});

test("invalid wiring is rejected explicitly", () => {
  const s = boot();
  const routing = createRouting();

  assert.throws(
    () => addRoute(routing, s, { slot: "A", frame: "z" }, { slot: "B", frame: "z" } as unknown as DestinationPort),
    /Z is derived/,
  );
  assert.throws(() => addRoute(routing, s, { slot: "A", frame: "a" }, { slot: "A", frame: "a" }), /identity/);
});

test("within-view feedback is a two-state oscillator with one evaluation of delay", () => {
  const s = boot();
  const a0 = hex(s, "A", "a");
  const z0 = hex(s, "A", "z");
  const routing = createRouting();

  const route = addRoute(routing, s, { slot: "A", frame: "z" }, { slot: "A", frame: "a" });
  assert.equal(route.delay, true, "self-view cable must be marked delayed");

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "A", "a"), z0);
  assert.equal(hex(s, "A", "z"), a0);

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "A", "a"), a0);
  assert.equal(hex(s, "A", "z"), z0);
});

test("cross-view cycles get exactly one delayed back edge and are deterministic", () => {
  const run = () => {
    const s = boot();
    const routing = createRouting();
    addRoute(routing, s, { slot: "A", frame: "z" }, { slot: "B", frame: "a" });
    addRoute(routing, s, { slot: "B", frame: "z" }, { slot: "A", frame: "a" });
    markDelays(routing);
    const delays = routing.routes.map((r) => r.delay);
    evaluateAll(routing, s, N);
    const first = snapshot(s);
    evaluateAll(routing, s, N);
    return { delays, first, second: snapshot(s) };
  };

  const a = run();
  const b = run();
  assert.deepEqual(a.delays, [false, true]);
  assert.deepEqual(a, b);
});

test("clearRoutes releases every driven input", () => {
  const s = boot();
  const before = snapshot(s);
  const routing = createRouting();
  addRoute(routing, s, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });
  addRoute(routing, s, { slot: "A", frame: "z" }, { slot: "B", frame: "b" });
  evaluateAll(routing, s, N);

  clearRoutes(routing, s);
  evaluateAll(routing, s, N);
  assert.deepEqual(snapshot(s), before);
  assert.equal(routing.routes.length, 0);
  assert.equal(routing.parked.size, 0);
});

test("resize remaps parked bases: unpatch equals resize without a cable", () => {
  const s = boot();
  const baseline = boot();
  const routing = createRouting();
  const route = addRoute(routing, s, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });

  resizeSlots(s, N, 256);
  remapParked(routing, N, 256);
  evaluateAll(routing, s, 256);
  resizeSlots(baseline, N, 256);

  // While patched, the driven value tracks the widened source.
  const expectedSource = toHex(baseline.C.Z.bits, 256);
  assert.equal(toHex(s.A.A.bits, 256), expectedSource);

  removeRoute(routing, s, route.id);
  assert.equal(toHex(s.A.A.bits, 256), toHex(baseline.A.A.bits, 256));
  assert.equal(
    toHex(s.A.A.bits, 256),
    "8ADEFEDA" + "0".repeat(48) + "85210125",
    "centre-pinned resize keeps the outer nibbles",
  );
  assert.equal(routing.parked.size, 0);
});

test("evaluation is focus-free and idempotent for acyclic patches", () => {
  const s = boot();
  const routing = createRouting();
  addRoute(routing, s, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });
  addRoute(routing, s, { slot: "A", frame: "z" }, { slot: "B", frame: "a" });

  evaluateAll(routing, s, N);
  const once = snapshot(s);
  evaluateAll(routing, s, N);
  const twice = snapshot(s);
  assert.deepEqual(once, twice);
});
