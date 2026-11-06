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
  makeBootLanes,
  markDelays,
  popcountZ,
  remapParked,
  removeRoute,
  resizeLanes,
  toHex,
  truthCounts,
} from "../src/core/index.ts";
import type { DestinationPort, FrameKey, Lane, LaneKey, LaneMap } from "../src/core/types.ts";

const N = 64;

const boot = (): LaneMap => makeBootLanes(N);
const operand = (lane: Lane, frame: "a" | "b" | "z") => (frame === "a" ? lane.A : frame === "b" ? lane.B : lane.Z);
const hex = (lanes: LaneMap, key: LaneKey, frame: FrameKey): string => toHex(operand(lanes[key], frame).bits, N);
const snapshot = (lanes: LaneMap): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of ["1", "2", "3"] as LaneKey[]) {
    for (const frame of ["a", "b", "z"] as FrameKey[]) out[`${key}.${frame}`] = hex(lanes, key, frame);
  }
  return out;
};

test("boot values match the instrument (golden)", () => {
  const s = boot();
  assert.equal(hex(s, "1", "a"), "8ADEFEDA85210125");
  assert.equal(hex(s, "1", "b"), "FFFFFFFF00000000");
  assert.equal(hex(s, "1", "z"), "7521012585210125");
  assert.equal(hex(s, "2", "a"), "FEDA852101257ADE");
  assert.equal(hex(s, "2", "b"), "02468ACEECA86420");
  assert.equal(hex(s, "3", "a"), "0123456789ABCDEF");
  assert.equal(hex(s, "3", "b"), "8ADEFEDA85210125");
  assert.equal(hex(s, "3", "z"), "0002444281210125");
});

test("patch 3·Z -> 1·A: derived value, truth counts and popcount hold", () => {
  const s = boot();
  const routing = createRouting();
  const route = addRoute(routing, s, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });

  assert.equal(route.delay, false);
  assert.equal(routing.parked.size, 1);
  assert.equal(hex(s, "1", "a"), "8ADEFEDA85210125", "no write before evaluation");

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "1", "a"), "0002444281210125");
  assert.equal(hex(s, "1", "z"), "FFFDBBBD81210125");
  assert.deepEqual(truthCounts(s["1"].A.bits, s["1"].B.bits, N), [24, 27, 8, 5]);
  assert.equal(popcountZ(s["1"].Z.bits), 35);
});

test("chain 3·Z -> 1·A -> 2·A resolves in one evaluation", () => {
  const s = boot();
  const routing = createRouting();
  addRoute(routing, s, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  addRoute(routing, s, { lane: "1", frame: "z" }, { lane: "2", frame: "a" });

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "1", "a"), "0002444281210125");
  assert.equal(hex(s, "1", "z"), "FFFDBBBD81210125");
  assert.equal(hex(s, "2", "a"), "FFFDBBBD81210125");
  assert.equal(hex(s, "2", "z"), "FDBB31736D896505");
});

test("unplugging restores the pre-patch value byte-identically", () => {
  const s = boot();
  const before = snapshot(s);
  const routing = createRouting();
  const r1 = addRoute(routing, s, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  const r2 = addRoute(routing, s, { lane: "1", frame: "z" }, { lane: "2", frame: "a" });

  evaluateAll(routing, s, N);
  removeRoute(routing, s, r2.id);
  removeRoute(routing, s, r1.id);
  evaluateAll(routing, s, N);

  assert.deepEqual(snapshot(s), before);
  assert.equal(routing.parked.size, 0);
});

test("one route per input: a second route replaces the first, parking survives", () => {
  const s = boot();
  const bootA = hex(s, "1", "a");
  const routing = createRouting();

  addRoute(routing, s, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  addRoute(routing, s, { lane: "2", frame: "z" }, { lane: "1", frame: "a" });

  assert.equal(routing.routes.length, 1);
  assert.equal(driverOf(routing, "1", "a")?.from.lane, "2");
  assert.equal(isDriven(routing, "1", "a"), true);

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "1", "a"), hex(s, "2", "z"));

  removeRoute(routing, s, routing.routes[0].id);
  assert.equal(hex(s, "1", "a"), bootA, "parked base was captured on first attach");
});

test("invalid wiring is rejected explicitly", () => {
  const s = boot();
  const routing = createRouting();

  assert.throws(
    () => addRoute(routing, s, { lane: "1", frame: "z" }, { lane: "2", frame: "z" } as unknown as DestinationPort),
    /Z is derived/,
  );
  assert.throws(() => addRoute(routing, s, { lane: "1", frame: "a" }, { lane: "1", frame: "a" }), /identity/);
});

test("within-lane feedback is a two-state oscillator with one evaluation of delay", () => {
  const s = boot();
  const a0 = hex(s, "1", "a");
  const z0 = hex(s, "1", "z");
  const routing = createRouting();

  const route = addRoute(routing, s, { lane: "1", frame: "z" }, { lane: "1", frame: "a" });
  assert.equal(route.delay, true, "self-lane route must be marked delayed");

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "1", "a"), z0);
  assert.equal(hex(s, "1", "z"), a0);

  evaluateAll(routing, s, N);
  assert.equal(hex(s, "1", "a"), a0);
  assert.equal(hex(s, "1", "z"), z0);
});

test("cross-lane cycles get exactly one delayed back edge and are deterministic", () => {
  const run = () => {
    const s = boot();
    const routing = createRouting();
    addRoute(routing, s, { lane: "1", frame: "z" }, { lane: "2", frame: "a" });
    addRoute(routing, s, { lane: "2", frame: "z" }, { lane: "1", frame: "a" });
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
  addRoute(routing, s, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  addRoute(routing, s, { lane: "1", frame: "z" }, { lane: "2", frame: "b" });
  evaluateAll(routing, s, N);

  clearRoutes(routing, s);
  evaluateAll(routing, s, N);
  assert.deepEqual(snapshot(s), before);
  assert.equal(routing.routes.length, 0);
  assert.equal(routing.parked.size, 0);
});

test("resize remaps parked bases: unpatch equals resize without a route", () => {
  const s = boot();
  const baseline = boot();
  const routing = createRouting();
  const route = addRoute(routing, s, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });

  resizeLanes(s, N, 256);
  remapParked(routing, N, 256);
  evaluateAll(routing, s, 256);
  resizeLanes(baseline, N, 256);

  // While patched, the driven value tracks the widened source.
  const expectedSource = toHex(baseline["3"].Z.bits, 256);
  assert.equal(toHex(s["1"].A.bits, 256), expectedSource);

  removeRoute(routing, s, route.id);
  assert.equal(toHex(s["1"].A.bits, 256), toHex(baseline["1"].A.bits, 256));
  assert.equal(
    toHex(s["1"].A.bits, 256),
    "8ADEFEDA" + "0".repeat(48) + "85210125",
    "centre-pinned resize keeps the outer nibbles",
  );
  assert.equal(routing.parked.size, 0);
});

test("evaluation is focus-free and idempotent for acyclic patches", () => {
  const s = boot();
  const routing = createRouting();
  addRoute(routing, s, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  addRoute(routing, s, { lane: "1", frame: "z" }, { lane: "2", frame: "a" });

  evaluateAll(routing, s, N);
  const once = snapshot(s);
  evaluateAll(routing, s, N);
  const twice = snapshot(s);
  assert.deepEqual(once, twice);
});
