/**
 * UI-state builder — the shape shared by `window.bitwave.getState()`,
 * `#bitwave-state` and the CLI `state` command.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildUiState } from "../src/core/agent-state.ts";
import { DEFAULT_LANE_COUNT, laneDefs } from "../src/core/lanedefs.ts";
import { exampleProjectDoc } from "../src/core/agent-defaults.ts";
import { deserializeProject } from "../src/core/project.ts";
import { computeZ } from "../src/core/derive.ts";
import { fromHex, toHex } from "../src/core/registers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const state = (doc = exampleProjectDoc()) =>
  buildUiState(doc, { deeplink: "file:///bitwave-v2.html#bw=abc" });

test("the shipped three-lane state is keyed by the stable lane keys", () => {
  const s = state();
  assert.deepEqual(Object.keys(s.lanes), ["1", "2", "3"]);
  /* Lane identity is the name index; the frame names derive from that key. */
  for (const def of laneDefs(DEFAULT_LANE_COUNT)) {
    const lane = s.lanes[def.key];
    assert.equal(lane.lane, def.index + 1, `lane number for key ${def.key}`);
    assert.deepEqual(Object.keys(lane.frames), [def.a, def.b, def.z]);
    assert.deepEqual(Object.keys(lane.visibility), [def.a, def.b, def.z]);
  }
  assert.deepEqual(s.view.splitPair, [1, 2]);
  assert.equal(s.lane, 1);
});

test("state has the contract keys and the focused defaults", () => {
  const s = state();
  assert.deepEqual(Object.keys(s), [
    "schemaVersion",
    "ready",
    "width",
    "lane",
    "frame",
    "view",
    "lanes",
    "lfo",
    "dataset",
    "editing",
    "recording",
    "deeplink",
    "bridge",
  ]);
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.ready, true);
  assert.equal(s.width, 8);
  assert.equal(s.lane, 1);
  assert.equal(s.frame, "A");
  assert.deepEqual(s.view, { mode: "2d", splitPair: [1, 2], activePane: 0 });
  assert.deepEqual(s.lfo, { on: false, mode: "rotcw", rate: 4 });
  assert.equal(s.dataset, null);
  assert.equal(s.editing.enabled, true);
  assert.deepEqual(s.recording, { on: false, rows: 0 });
  assert.equal(s.deeplink, "file:///bitwave-v2.html#bw=abc");
  assert.deepEqual(s.bridge, { schemaVersion: 1, version: "1.4.0" });
  assert.deepEqual(Object.keys(s.lanes), ["1", "2", "3"]);
});

test("lane frames and derived Z come from the shared core", () => {
  const s = state();
  const lane = s.lanes["1"];
  assert.equal(lane.lane, 1);
  assert.deepEqual(Object.keys(lane.frames), ["A", "B", "Z1"]);
  const doc = exampleProjectDoc();
  const z = computeZ(fromHex(doc.lanes["1"].a, doc.N), fromHex(doc.lanes["1"].b, doc.N), doc.N, doc.lanes["1"].binop);
  assert.equal(lane.frames["Z1"], toHex(z, doc.N));
  assert.deepEqual(lane.derived["Z1"], {
    hex: toHex(z, doc.N),
    popcount: lane.derived["Z1"].popcount,
    truthCounts: lane.derived["Z1"].truthCounts,
  });
  assert.equal(lane.derived["Z1"].truthCounts.reduce((a, b) => a + b, 0), doc.N);
  assert.deepEqual(lane.sources, { A: { kind: "none" }, B: { kind: "none" } });
  assert.deepEqual(lane.driven, { A: false, B: false });
});

test("focus, visibility, view and LFO settings are reflected", () => {
  const doc = exampleProjectDoc();
  doc.lanes["1"].focus = "b";
  doc.lanes["1"].frameVis = { a: false, b: true, z: true };
  doc.view.view3d = true;
  doc.view.split3d = true;
  doc.view.splitPair = ["1", "3"];
  doc.view.activePane = 1;
  doc.view.lfoMode = "slide";
  doc.view.lfoRate = 8;

  const s = buildUiState(doc, { lfoOn: true, copyArmed: true, deeplink: "x" });
  assert.equal(s.frame, "B");
  assert.deepEqual(s.view, { mode: "split", splitPair: [1, 3], activePane: 1 });
  assert.deepEqual(s.lanes["1"].visibility, { A: false, B: true, Z1: true });
  assert.deepEqual(s.lfo, { on: true, mode: "slide", rate: 8 });
  assert.equal(s.editing.copyArmed, true);
});

test("a derived focus is not editable", () => {
  const doc = exampleProjectDoc();
  doc.lanes["1"].focus = "z";
  const s = buildUiState(doc, {});
  assert.equal(s.frame, "Z1");
  assert.equal(s.editing.enabled, false);
});

test("a driven operand is reported and blocks local editing", () => {
  const doc = exampleProjectDoc();
  doc.routes = [{ from: "2.z", to: "1.a", mix: "set" }];
  doc.parked = { "1.a": doc.lanes["1"].a };
  const s = buildUiState(doc, {});
  assert.deepEqual(s.lanes["1"].sources["A"], { kind: "frame", source: "1:1", lane: 2, frame: "Z2" });
  assert.deepEqual(s.lanes["1"].driven, { A: true, B: false });
  assert.equal(s.editing.enabled, false);
});

test("dataset state carries columns, count, clamped index and row", () => {
  const doc = exampleProjectDoc();
  doc.dataset = { cols: ["x", "y"], rows: [["1", "2"], ["3", "4"]], index: 1 };
  const s = buildUiState(doc, {});
  assert.deepEqual(s.dataset, { columns: ["x", "y"], rows: 2, index: 1, row: ["3", "4"] });

  doc.dataset.index = 99;
  const clamped = buildUiState(doc, {});
  assert.equal(clamped.dataset?.index, 1);
});

test("expression sources and the record toggle are exposed", () => {
  const doc = exampleProjectDoc();
  doc.lanes["1"].expressions = { a: "round(2 * C)", b: "log.C" };
  const s = buildUiState(doc, {
    deeplink: "x",
    recording: { on: true, rows: 7 },
  });
  assert.deepEqual(s.lanes["1"].expressions, { A: "round(2 * C)", B: "log.C" });
  assert.deepEqual(s.lanes["2"].expressions, { C: null, D: null });
  assert.deepEqual(s.recording, { on: true, rows: 7 });
});

test("state serialization is deterministic and timestamp-free", () => {
  const first = JSON.stringify(state());
  const second = JSON.stringify(state());
  assert.equal(first, second);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(first));
});

test("a schema-4 document with a wider lane map reports those lanes by stable key", () => {
  const doc = exampleProjectDoc();
  delete doc.lanes["2"];
  doc.lanes["4"] = { ...doc.lanes["1"] };
  doc.view.lane = "4";
  doc.view.splitPair = ["1", "3"];

  const s = buildUiState(doc, {});
  assert.deepEqual(Object.keys(s.lanes), ["1", "3", "4"]);
  assert.deepEqual(Object.keys(s.lanes["4"].frames), ["G", "H", "Z4"]);
  assert.deepEqual(Object.keys(s.lanes["4"].visibility), ["G", "H", "Z4"]);
  assert.equal(s.lane, 4);
  assert.equal(s.frame, "G");
  assert.deepEqual(s.view.splitPair, [1, 3]);
});

test("the eight-lane fixture reports eight stable lane keys and names A-P/Z1-Z8", () => {
  const fixture = JSON.parse(readFileSync(path.join(ROOT, "examples", "eight-lanes.bitwave.json"), "utf8"));
  const engine = deserializeProject(fixture);
  const s = buildUiState(fixture, { deeplink: "file:///bitwave-v2.html#bw=x" });
  assert.deepEqual(Object.keys(s.lanes), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  const expectedNames = laneDefs(8).map((def) => ({ key: def.key, names: [def.a, def.b, def.z] }));
  for (const { key, names } of expectedNames) {
    assert.equal(s.lanes[key].lane, Number(key));
    assert.deepEqual(Object.keys(s.lanes[key].frames), names, `lane ${key} frame names`);
  }
  /* State reports the engine values, not a fixed three-lane table. */
  assert.deepEqual(Object.keys(engine.lanes).sort(), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.equal(s.lane, 8);
  assert.equal(s.frame, "O");
  assert.equal(s.lanes["1"].frames.Z1, "7521012585210125");
  assert.equal(s.lanes["8"].frames.O, "DEADBEEFCAFEBABE");
});
