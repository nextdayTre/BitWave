/**
 * UI-state builder — the shape shared by `window.bitwave.getState()`,
 * `#bitwave-state` and the CLI `state` command.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUiState } from "../src/core/agent-state.ts";
import { exampleProjectDoc } from "../src/core/agent-defaults.ts";
import { computeZ } from "../src/core/derive.ts";
import { fromHex, toHex } from "../src/core/registers.ts";

const state = (doc = exampleProjectDoc()) =>
  buildUiState(doc, { deeplink: "file:///bitwave-v2.html#bw=abc" });

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
  assert.equal(s.deeplink, "file:///bitwave-v2.html#bw=abc");
  assert.deepEqual(s.bridge, { schemaVersion: 1, version: "1.0.0" });
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

test("state serialization is deterministic and timestamp-free", () => {
  const first = JSON.stringify(state());
  const second = JSON.stringify(state());
  assert.equal(first, second);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(first));
});
