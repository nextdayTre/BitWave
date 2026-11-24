/**
 * App <-> project document round trip (F5).
 *
 * Exercises the bridge that maps the live instrument tree to `.bitwave` and
 * back: lanes, routes/parked bases, focus/frameVis, LFO settings, dataset
 * cursor, unknown-field preservation and the app-level rejections.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { S, SIZES, liveLaneKeys } from "../src/state/instrument.ts";
import { DEMO } from "../src/state/dataset.ts";
import { coreLanes, evaluate, routing } from "../src/state/routing.ts";
import { addRoute } from "../src/core/routing.ts";
import { addLane, deleteLane, setHexWord } from "../src/state/actions.ts";
import {
  clearRecording,
  recordCount,
  recordCsv,
  recordSnapshot,
  readLog,
  startRecording,
  stopRecording,
} from "../src/state/record.ts";
import { toHex } from "../src/core/registers.ts";
import { makeBootLanes } from "../src/core/lanes.ts";
import {
  applyProject,
  captureProject,
  rememberUnknownFields,
} from "../src/state/project-bridge.ts";

/* These tests replace the live singletons; restore the pristine tree so later
   test files (same process, `--test-isolation=none`) see the defaults. */
const pristine = captureProject();
after(() => {
  applyProject(pristine);
  rememberUnknownFields({});
});

const doc = () => ({
  schema: 2,
  app: "bitwave",
  savedAt: "2026-11-06T00:00:00.000Z",
  N: 16,
  view: {
    lane: "2",
    view3d: true,
    split3d: true,
    splitPair: ["1", "3"],
    activePane: 1,
    lfoMode: "slide",
    lfoRate: 8,
  },
  lanes: {
    "1": {
      a: "DEAD", b: "BEEF", showB: true, binop: "and", edit: "b", seededB: true,
      lfoB: "opp", colA: 0, colB: 2, focus: "b", frameVis: { a: false, b: true, z: true },
    },
    "2": {
      a: "0123", b: "4567", showB: false, binop: "xor", edit: "a", seededB: false,
      lfoB: "0", colA: -1, colB: -1, focus: "a", frameVis: { a: true, b: true, z: true },
    },
    "3": {
      a: "89AB", b: "CDEF", showB: true, binop: "add", edit: "a", seededB: true,
      lfoB: "q", colA: 1, colB: -1, focus: "z", frameVis: { a: true, b: false, z: true },
    },
  },
  routes: [{ from: "1.z", to: "3.a", mix: "set" }],
  parked: { "3.a": "89AB" },
  dataset: { cols: ["x", "y"], rows: [["1", "2"], ["3", "4"]], index: 1 },
  futureField: { keep: true },
});

test("applyProject maps a v2 document onto the live instrument tree", () => {
  const result = applyProject(doc());
  assert.equal(result.ok, true, result.message);
  assert.equal(S.N, 16);
  assert.equal(S.laneKey, "2");                    // view.lane "2"
  assert.equal(S.view3d, true);
  assert.equal(S.split3d, true);
  assert.deepEqual(S.splitPair, ["1", "3"]);
  assert.equal(S.activePane, 1);
  assert.equal(S.lfo.mode, "slide");
  assert.equal(S.lfo.rate, 8);
  assert.equal(S.lfo.on, false);

  const lane1 = S.lanes["1"];
  assert.equal(lane1.showB, true);
  assert.equal(lane1.binop, "and");
  assert.equal(lane1.edit, "b");
  assert.equal(lane1.focus, "b");
  assert.equal(lane1.frameVis.a, false);
  assert.equal(lane1.colA, 0);
  assert.equal(lane1.colB, 2);
  assert.equal(lane1.seededB, true);

  assert.equal(routing.routes.length, 1);
  assert.equal(routing.routes[0].from.lane, "1");
  assert.equal(routing.parked.get("3:a")?.length, 16); // one byte per bit at N=16

  assert.deepEqual(DEMO.cols, ["x", "y"]);
  assert.equal(DEMO.rows.length, 2);
  assert.equal(DEMO.i, 1);
});

test("captureProject round-trips the mapped state", () => {
  applyProject(doc());
  const before = {
    N: S.N,
    laneKey: S.laneKey,
    view3d: S.view3d,
    splitPair: S.splitPair.slice(),
    lane1: { ...S.lanes["1"], A: null, B: null, Z: null, frameVis: { ...S.lanes["1"].frameVis } },
    routes: routing.routes.length,
    parked: routing.parked.size,
    dataset: { cols: DEMO.cols.slice(), rows: DEMO.rows.map((r) => r.slice()), i: DEMO.i },
  };
  const captured = captureProject("2026-11-06T01:00:00.000Z");
  assert.equal(captured.schema, 5);
  assert.equal(captured.N, 16);
  assert.equal(captured.view.lane, "2");
  assert.equal(captured.lanes["1"].focus, "b");
  assert.equal(captured.lanes["1"].frameVis.a, false);
  assert.equal(captured.lanes["3"].focus, "z");
  assert.equal(captured.view.lfoMode, "slide");
  assert.equal(captured.view.lfoRate, 8);
  assert.equal(captured.dataset?.index, 1);

  /* Re-loading the capture reproduces the same state. */
  const result = applyProject(captured);
  assert.equal(result.ok, true, result.message);
  assert.equal(S.N, before.N);
  assert.equal(S.laneKey, before.laneKey);
  assert.equal(S.view3d, before.view3d);
  assert.deepEqual(S.splitPair, before.splitPair);
  assert.equal(S.lanes["1"].frameVis.a, false);
  assert.deepEqual(DEMO.cols, before.dataset.cols);
  assert.equal(DEMO.i, before.dataset.i);
});

test("unknown top-level fields survive load + capture", () => {
  rememberUnknownFields(doc());
  const captured = captureProject() as Record<string, unknown>;
  assert.deepEqual(captured.futureField, { keep: true });
  /* A document without the unknown field clears the remembered extras. */
  const plain = { ...doc() };
  delete (plain as Record<string, unknown>).futureField;
  rememberUnknownFields(plain);
  const again = captureProject() as Record<string, unknown>;
  assert.equal("futureField" in again, false);
});

test("unsupported app-level documents are refused with a code", () => {
  const newer = applyProject({ ...doc(), schema: 99 });
  assert.equal(newer.ok, false);
  assert.equal(newer.code, "newer-schema");

  const width = applyProject({ ...doc(), N: 24 });
  assert.equal(width.ok, false);
  assert.equal(width.code, "malformed");
  assert.ok(width.message?.includes("unsupported register width"), width.message);

  const notBitwave = applyProject({ ...doc(), app: "other" });
  assert.equal(notBitwave.ok, false);
  assert.equal(notBitwave.code, "unsupported-app");
});

test("a document without a dataset clears the board", () => {
  applyProject(doc());
  assert.equal(DEMO.rows.length, 2);
  const bare = { ...doc() } as Record<string, unknown>;
  delete bare.dataset;
  const result = applyProject(bare);
  assert.equal(result.ok, true);
  assert.equal(result.dataset, false);
  assert.equal(DEMO.rows.length, 0);
  assert.equal(DEMO.i, 0);
});

test("expressions evaluate through the clocked pass and the Record log", () => {
  assert.equal(applyProject(doc()).ok, true);
  const lane2 = S.lanes["2"];
  setHexWord(lane2.A, "0005");
  lane2.expressions.b = "C + 1";
  evaluate();
  assert.equal(toHex(lane2.B.bits, S.N), "0006", "D = C + 1");
  assert.equal(toHex(lane2.Z.bits, S.N), "0003", "Z2 = C xor D");

  startRecording();
  recordSnapshot();
  assert.equal(recordCount(), 1);
  const row = readLog()[0];
  assert.equal(row.frames["C"], "0005");
  assert.equal(row.frames["D"], "0006");
  assert.equal(row.frames["Z2"], "0003");

  // The expression sees the previous recorded row, one update late.
  lane2.expressions.b = "log.C + 1";
  setHexWord(lane2.A, "0007");
  evaluate();
  assert.equal(toHex(lane2.B.bits, S.N), "0006", "D = previous C + 1");
  assert.equal(toHex(lane2.Z.bits, S.N), "0001");

  // An invalid expression leaves the last valid bits intact.
  lane2.expressions.b = "1 +";
  evaluate();
  assert.equal(toHex(lane2.B.bits, S.N), "0006");

  stopRecording();
  clearRecording();
  assert.equal(recordCount(), 0);
});

test("every supported width is representable", () => {
  for (const n of SIZES) {
    const hex = "A".repeat(n / 4);
    const candidate = {
      ...doc(),
      N: n,
      lanes: {
        "1": { ...doc().lanes["1"], a: hex, b: hex },
        "2": { ...doc().lanes["2"], a: hex, b: hex },
        "3": { ...doc().lanes["3"], a: hex, b: hex },
      },
      routes: [],
      parked: {},
      dataset: undefined,
    };
    const result = applyProject(candidate);
    assert.equal(result.ok, true, `${n} bits: ${result.message}`);
    assert.equal(S.N, n);
  }
});

/* ---------------------------------------------------------------------------
 * Schema 4 (D44) + the dynamic-lane live tree (D46): the document is a lane map
 * keyed by stable lane key, and the live instrument now holds exactly the
 * document's lanes (one to eight, gaps allowed).
 * ------------------------------------------------------------------------- */

/** A schema-4 lane record at width `N`; `index` is the 1-based lane number. */
function wideLane(index: number, N = 8): Record<string, unknown> {
  const hex = (value: number) => value.toString(16).toUpperCase().padStart(N / 4, "0");
  return {
    a: hex(index * 2),
    b: hex(index * 2 + 1),
    showB: true,
    binop: "xor",
    edit: "a",
    seededB: true,
    lfoB: "0",
    colA: -1,
    colB: -1,
    focus: "a",
    frameVis: { a: true, b: true, z: true },
  };
}

function wideDoc({
  keys = [1, 2, 3, 4, 5, 6, 7, 8],
  N = 8,
  viewLane = "8",
  splitPair = ["8", "7"] as [string, string],
  routes = [] as Array<{ from: string; to: string; mix: "set" }>,
  parked = {} as Record<string, string>,
  lane8Expressions,
}: {
  keys?: number[];
  N?: number;
  viewLane?: string;
  splitPair?: [string, string];
  routes?: Array<{ from: string; to: string; mix: "set" }>;
  parked?: Record<string, string>;
  lane8Expressions?: { a?: string; b?: string };
} = {}) {
  const lanes: Record<string, Record<string, unknown>> = {};
  for (const index of keys) lanes[String(index)] = wideLane(index, N);
  if (lane8Expressions && lanes["8"]) lanes["8"].expressions = { ...lane8Expressions };
  return {
    schema: 4,
    app: "bitwave" as const,
    savedAt: "2026-11-06T00:00:00.000Z",
    N,
    view: { lane: viewLane, view3d: false, split3d: false, splitPair, activePane: 0 as const },
    lanes,
    routes,
    parked,
  };
}

test("an eight-lane schema-4 document widens the live tree and round-trips", () => {
  const N = 8;
  const result = applyProject(
    wideDoc({
      N,
      viewLane: "8",
      splitPair: ["8", "7"],
      routes: [{ from: "7.z", to: "1.a", mix: "set" }],
      parked: { "1.a": wideLane(1, N).a },
    }),
  );
  assert.equal(result.ok, true, result.message);

  assert.deepEqual(Object.keys(S.lanes), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.deepEqual(liveLaneKeys(), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.equal(S.laneKey, "8", "the document's focused lane loads");
  assert.deepEqual(S.splitPair, ["8", "7"]);
  assert.equal(toHex(S.lanes["8"].A.bits, N), "10");
  assert.equal(toHex(S.lanes["8"].Z.bits, N), "01", "Z is derived for lane 8");

  /* A cross-lane route from lane 7 drives lane 1; its parked base is preserved. */
  assert.equal(routing.routes.length, 1);
  assert.equal(toHex(S.lanes["1"].A.bits, N), toHex(S.lanes["7"].Z.bits, N));
  assert.equal(routing.parked.size, 1);

  /* Capture writes every live lane, in ascending key order, and round-trips. */
  const captured = captureProject("2026-11-06T01:00:00.000Z");
  assert.equal(captured.schema, 5);
  assert.deepEqual(Object.keys(captured.lanes), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.equal(captured.view.lane, "8");
  assert.equal(captured.routes.length, 1);
  assert.equal(applyProject(captured).ok, true);
  assert.deepEqual(Object.keys(S.lanes), ["1", "2", "3", "4", "5", "6", "7", "8"]);
});

test("a gapped schema-4 document keeps exactly its live lanes, without renumbering", () => {
  const result = applyProject(wideDoc({ keys: [1, 3, 4], viewLane: "4", splitPair: ["4", "1"] }));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(Object.keys(S.lanes), ["1", "3", "4"]);
  assert.equal(S.laneKey, "4");
  assert.equal(frameNameForTest("3", "z"), "Z3", "names derive from the stable key, not position");
  assert.equal(toHex(S.lanes["4"].A.bits, 8), "08");

  /* The freed middle key is reused; existing lanes are never renumbered. */
  assert.equal(addLane(), "2");
  assert.deepEqual(Object.keys(S.lanes), ["1", "2", "3", "4"]);
  assert.equal(toHex(S.lanes["3"].A.bits, 8), "06", "lane 3 kept its own value");

  const captured = captureProject("2026-11-06T01:00:00.000Z");
  assert.deepEqual(Object.keys(captured.lanes), ["1", "2", "3", "4"]);
  assert.equal(applyProject(captured).ok, true);
});

test("routing and expression environments follow all eight live lanes", () => {
  const N = 8;
  const doc8 = wideDoc({
    N,
    lane8Expressions: { a: "Z7 + 1" },
    routes: [],
  });
  assert.equal(applyProject(doc8).ok, true);

  /* The expression on lane 8 A sees lane 7's derived frame (Z7). */
  evaluate();
  const expectedZ7 = BigInt(0x0e ^ 0x0f); // lane 7 is 0E xor 0F
  assert.equal(toHex(S.lanes["8"].A.bits, N), (expectedZ7 + 1n).toString(16).padStart(2, "0").toUpperCase());

  /* A route from lane 8 to lane 2 is applied and delays are recomputed. */
  addRoute(routing, coreLanes(), { lane: "8", frame: "z" }, { lane: "2", frame: "b" });
  evaluate(true);
  assert.equal(toHex(S.lanes["2"].B.bits, N), toHex(S.lanes["8"].Z.bits, N));
  assert.equal(routing.routes.length, 1);
});

test("Record rows carry 3L frames (three per live lane), not a fixed nine", () => {
  assert.equal(applyProject(wideDoc()).ok, true);
  evaluate(true);
  startRecording();
  recordSnapshot();
  const row = readLog()[0];
  assert.equal(Object.keys(row.frames).length, 24, "eight lanes × three frames");
  for (const name of ["A", "B", "Z1", "O", "P", "Z8"]) {
    assert.equal(typeof row.frames[name], "string", `recorded frame ${name}`);
  }
  const header = recordCsv().split("\n")[0].split(",");
  assert.equal(header.length, 25, "step + 3L frame columns");
  assert.deepEqual(header.slice(-3), ["O", "P", "Z8"]);
  stopRecording();
  clearRecording();

  /* A three-lane live set records exactly nine frame columns. */
  assert.equal(applyProject(pristineThreeLaneDoc()).ok, true);
  startRecording();
  recordSnapshot();
  const narrow = readLog()[0];
  assert.equal(Object.keys(narrow.frames).length, 9);
  assert.equal(recordCsv().split("\n")[0].split(",").length, 10);
  stopRecording();
  clearRecording();
});

test("legacy schema-1/2/3 documents still load and capture as schema 4", () => {
  for (const schema of [1, 2, 3]) {
    const result = applyProject({ ...doc(), schema });
    assert.equal(result.ok, true, `schema ${schema}: ${result.message}`);
    assert.equal(S.N, 16);
    assert.equal(S.laneKey, "2");
    assert.deepEqual(liveLaneKeys(), ["1", "2", "3"], "the closed three-lane object is still the live set");
  }
  assert.equal(captureProject().schema, 5);
});

function frameNameForTest(lane: string, frame: "a" | "b" | "z"): string {
  const names: Record<string, { a: string; b: string; z: string }> = {
    "1": { a: "A", b: "B", z: "Z1" },
    "2": { a: "C", b: "D", z: "Z2" },
    "3": { a: "E", b: "F", z: "Z3" },
    "4": { a: "G", b: "H", z: "Z4" },
    "8": { a: "O", b: "P", z: "Z8" },
  };
  return names[lane][frame];
}

/** The captured boot document (three lanes) — the D46 "narrow" baseline. */
function pristineThreeLaneDoc() {
  return pristine;
}