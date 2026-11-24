/**
 * Free Frames (D52) — core graph, 7-register chains, schema 5 persistence,
 * compact share tag 5 + tag 4 backward compatibility, app state/bindings/record,
 * and agent state/patch validation.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  APP_FREE_FRAME_CAP,
  freeFrameIndex,
  freeFrameKey,
  freeFrameKeyFromName,
  freeFrameName,
  freeFrameNames,
  frameRefFromName,
} from "../src/core/lanedefs.ts";
import { makeBootLanes, makeFreeFrame, resizeFreeFrames } from "../src/core/lanes.ts";
import { fromHex, toHex } from "../src/core/registers.ts";
import {
  addRoute,
  createRouting,
  evaluateAll,
  freePortKey,
  isFreeDriven,
  remapParked,
  removeRoute,
} from "../src/core/routing.ts";
import {
  PROJECT_SCHEMA,
  deserializeProject,
  parseProject,
  serializeProject,
  stringifyProject,
} from "../src/core/project.ts";
import { buildShareLink, canonicalShareDocument } from "../src/core/agent-share.ts";
import { COMPACT_SHARE_TAG, decodeShare, encodeCompactShare, parseShareHash } from "../src/core/share.ts";
import { buildUiState } from "../src/core/agent-state.ts";
import { normalizeAgentPatch } from "../src/core/agent-tools.ts";
import type { FreeFrameMap, ProjectViewState } from "../src/core/index.ts";

import { S, liveFreeFrameKeys } from "../src/state/instrument.ts";
import {
  addFreeFrame,
  deleteFreeFrame,
  duplicateFreeFrame,
  selectFreeFrame,
  selectLane,
  setFreeFrameMeta,
  setHexWord,
} from "../src/state/actions.ts";
import {
  availableSources,
  bindFrame,
  bindFreeExpression,
  bindFreeFrame,
  bindFreeNone,
  describeFreeInput,
  isFocusDriven,
} from "../src/state/bindings.ts";
import { evaluate } from "../src/state/routing.ts";
import {
  clearRecording,
  readLog,
  recordCsv,
  recordSnapshot,
  startRecording,
  stopRecording,
} from "../src/state/record.ts";
import { applyProject, captureProject } from "../src/state/project-bridge.ts";

const pristine = captureProject();
after(() => {
  applyProject(pristine);
});

const VIEW: ProjectViewState = {
  lane: "1",
  view3d: false,
  split3d: false,
  splitPair: ["1", "2"],
  activePane: 0,
};

test("free-frame naming F1..F16 never collides with lane operand F or derived Z1", () => {
  assert.equal(APP_FREE_FRAME_CAP, 16);
  assert.equal(freeFrameKey(0), "1");
  assert.equal(freeFrameName("7"), "F7");
  assert.equal(freeFrameNames(3).join(","), "F1,F2,F3");
  assert.equal(freeFrameKeyFromName("F1"), "1");
  assert.equal(freeFrameKeyFromName("f16"), "16");
  assert.equal(freeFrameKeyFromName("F"), null, "single-letter F is Lane 3 operand B");
  assert.equal(freeFrameKeyFromName("F0"), null);
  assert.equal(freeFrameKeyFromName("F17"), null);
  assert.equal(freeFrameKeyFromName("Z1"), null);
  assert.equal(freeFrameIndex("16"), 15);
  assert.equal(freeFrameIndex("17"), -1);
  assert.deepEqual(frameRefFromName("F", 8), { lane: "3", frame: "b", name: "F" });
});

test("core routing: 7-register linear chain F1 -> F2 -> ... -> F7 resolves in one pass", () => {
  const N = 16;
  const lanes = makeBootLanes(N);
  const freeFrames: FreeFrameMap = {};
  for (let i = 1; i <= 7; i += 1) {
    const k = String(i);
    freeFrames[k] = makeFreeFrame(k, N, {
      label: `stage_${i}`,
      sourceNote: `numpy.stage(${i})`,
    });
    freeFrames[k].reg.bits = fromHex(i.toString(16).padStart(4, "0"), N);
  }
  freeFrames["1"].reg.bits = fromHex("BEEF", N);

  const routing = createRouting();
  // Wire in reverse insertion order to prove topoOrderNodes resolves regardless of order.
  for (let i = 6; i >= 1; i -= 1) {
    addRoute(routing, lanes, { free: String(i) }, { free: String(i + 1) }, "set", freeFrames);
  }

  evaluateAll(routing, lanes, N, undefined, freeFrames);
  for (let i = 1; i <= 7; i += 1) {
    assert.equal(toHex(freeFrames[String(i)].reg.bits, N), "BEEF", `F${i} settled in one tick`);
  }

  // Unplugging F2 restores its parked pre-patch base ("0002") byte-identically.
  assert.equal(isFreeDriven(routing, "2"), true);
  assert.equal(removeRoute(routing, lanes, `${freePortKey("1")}>${freePortKey("2")}`, freeFrames), true);
  assert.equal(isFreeDriven(routing, "2"), false);
  assert.equal(toHex(freeFrames["2"].reg.bits, N), "0002");
});

test("core routing: cross-routing lane Z1 -> F1 -> Lane 2 B and feedback cycle delay", () => {
  const N = 16;
  const lanes = makeBootLanes(N);
  lanes["1"].A.bits = fromHex("F00F", N);
  lanes["1"].B.bits = fromHex("0FF0", N);
  lanes["1"].binop = "xor";
  const freeFrames: FreeFrameMap = {
    "1": makeFreeFrame("1", N, { label: "tap" }),
  };
  freeFrames["1"].reg.bits = fromHex("1234", N);

  const routing = createRouting();
  addRoute(routing, lanes, { lane: "1", frame: "z" }, { free: "1" }, "set", freeFrames);
  addRoute(routing, lanes, { free: "1" }, { lane: "2", frame: "b" }, "set", freeFrames);

  evaluateAll(routing, lanes, N, undefined, freeFrames);
  assert.equal(toHex(freeFrames["1"].reg.bits, N), "FFFF");
  assert.equal(toHex(lanes["2"].B.bits, N), "FFFF");

  // Closing a cycle back into Lane 1 A marks the back edge as delayed (z^-1).
  const back = addRoute(routing, lanes, { free: "1" }, { lane: "1", frame: "a" }, "set", freeFrames);
  assert.equal(back.delay, true);

  // Resize remaps free frames and parked bases cleanly.
  resizeFreeFrames(freeFrames, 16, 32);
  remapParked(routing, 16, 32);
  assert.equal(freeFrames["1"].reg.bits.length, 32);
});

test("schema 5 & compact tag 5: free frames with NumPy labels/notes round-trip and tag 4 still decodes", () => {
  const N = 16;
  const lanes = makeBootLanes(N);
  const freeFrames: FreeFrameMap = {
    "1": makeFreeFrame("1", N, { label: "raw", sourceNote: "numpy.array(samples)" }),
    "2": makeFreeFrame("2", N, { label: "rfft_mag", sourceNote: "numpy.abs(numpy.fft.rfft(x))" }),
  };
  freeFrames["1"].reg.bits = fromHex("CAFE", N);
  freeFrames["2"].reg.bits = fromHex("BABE", N);

  const routing = createRouting();
  addRoute(routing, lanes, { free: "1" }, { free: "2" }, "set", freeFrames);
  evaluateAll(routing, lanes, N, undefined, freeFrames);

  const doc = serializeProject(
    lanes,
    routing,
    N,
    { ...VIEW, activeFree: "2" },
    null,
    "2026-11-22T00:00:00.000Z",
    {
      freeFrames,
      freeVis: { "1": true, "2": false },
      freeExpressions: { "1": "", "2": "" },
    },
  );
  assert.equal(doc.schema, PROJECT_SCHEMA);
  assert.equal(doc.schema, 5);
  assert.equal(doc.view.activeFree, "2");
  assert.equal(doc.frames?.["1"].label, "raw");
  assert.equal(doc.frames?.["2"].sourceNote, "numpy.abs(numpy.fft.rfft(x))");
  assert.equal(doc.frames?.["2"].visible, false);
  assert.deepEqual(doc.routes, [{ from: "F1", to: "F2", mix: "set" }]);
  assert.equal(doc.parked["F2"], "BABE");

  // JSON round-trip
  const reloaded = parseProject(stringifyProject(doc));
  assert.equal(reloaded.view.activeFree, "2");
  assert.equal(reloaded.freeFrames["1"].label, "raw");
  assert.equal(reloaded.freeFrames["2"].sourceNote, "numpy.abs(numpy.fft.rfft(x))");
  assert.equal(reloaded.extras.freeVis["2"], false);
  assert.equal(toHex(reloaded.freeFrames["2"].reg.bits, N), "CAFE");

  // Compact tag-5 share round-trip
  const link = buildShareLink(doc);
  assert.equal(link.withinBudget, true);
  const rawCompact = decodeShare(link.fragment.slice("#bw=".length)) as unknown[];
  assert.equal(rawCompact[0], COMPACT_SHARE_TAG);
  const expanded = parseShareHash(link.fragment);
  assert.deepEqual(expanded, canonicalShareDocument(doc));

  // Backward compatibility: compact tag-4 link still decodes cleanly!
  const laneOnly = serializeProject(lanes, createRouting(), N, VIEW, null, "2026-11-22T00:00:00.000Z");
  const tag5Arr = decodeShare(encodeCompactShare(laneOnly)) as unknown[];
  const tag4Arr = [4, ...tag5Arr.slice(1)];
  const tag4Hash = "#bw=" + Buffer.from(JSON.stringify(tag4Arr), "utf8").toString("base64url");
  const fromTag4 = deserializeProject(parseShareHash(tag4Hash));
  assert.equal(fromTag4.N, N);
  assert.deepEqual(Object.keys(fromTag4.freeFrames), []);
});

test("app state: 7-stage expression chain, Record log, bindings, UI state and patch validation", () => {
  applyProject(pristine);
  const keys: string[] = [];
  for (let i = 1; i <= 7; i += 1) {
    const k = addFreeFrame({
      hex: i === 1 ? "0000000000000001" : "0000000000000000",
      label: `step${i}`,
      sourceNote: `numpy.step(${i})`,
    });
    assert.ok(k);
    keys.push(k);
  }
  assert.deepEqual(liveFreeFrameKeys(), ["1", "2", "3", "4", "5", "6", "7"]);

  // Chain expressions F2 = F1 << 4, F3 = F2 << 4, ..., F7 = F6 << 4
  for (let i = 2; i <= 7; i += 1) {
    bindFreeExpression(S.freeFrames[String(i)], `F${i - 1} << 4`);
  }
  evaluate(true);
  assert.equal(toHex(S.freeFrames["7"].reg.bits, S.N), "0000000001000000");

  // Feed F7 into Lane 1 operand B via route!
  assert.ok(availableSources(S.lanes["1"], "b").some((s) => s.name === "F7"));
  bindFrame(S.lanes["1"], "b", { free: "7" });
  evaluate(true);
  assert.equal(toHex(S.lanes["1"].B.bits, S.N), "0000000001000000");

  // Focusing F7 marks it driven and reports activeFree = "F7" in buildUiState
  selectFreeFrame("7");
  assert.equal(isFocusDriven(), true);
  assert.equal(describeFreeInput(S.freeFrames["7"]).state, "expr");

  const captured = captureProject("2026-11-22T00:00:00.000Z");
  const uiState = buildUiState(captured);
  assert.equal(uiState.activeFree, "F7");
  assert.equal(uiState.frame, "F7");
  assert.equal(uiState.editing.enabled, false);
  assert.equal(uiState.freeFrames["F7"].label, "step7");
  assert.equal(uiState.freeFrames["F7"].sourceNote, "numpy.step(7)");
  assert.equal(uiState.freeFrames["F7"].hex, "0000000001000000");
  assert.equal(uiState.lanes["1"].sources["B"].frame, "F7");

  // Record captures both lane frames and free frames F1..F7
  startRecording();
  recordSnapshot();
  const row = readLog()[0];
  assert.equal(row.frames["F1"], "0000000000000001");
  assert.equal(row.frames["F7"], "0000000001000000");
  assert.match(recordCsv(), /,F1,F2,F3,F4,F5,F6,F7\n/);
  stopRecording();
  clearRecording();

  // Duplicate, metadata update, delete & parked-base cleanup
  const dupKey = duplicateFreeFrame("1");
  assert.equal(dupKey, "8");
  setFreeFrameMeta(S.freeFrames["8"], { label: "copy", sourceNote: "scipy.signal" });
  assert.equal(S.freeFrames["8"].label, "copy");
  assert.equal(S.freeFrames["8"].sourceNote, "scipy.signal");

  // Unbind F2, route F1 -> F2, delete F1 -> F2's parked base restores cleanly
  bindFreeNone(S.freeFrames["2"]);
  setHexWord(S.freeFrames["2"].reg, "ABCD");
  bindFreeFrame(S.freeFrames["2"], { free: "1" });
  evaluate(true);
  assert.equal(toHex(S.freeFrames["2"].reg.bits, S.N), "0000000000000001");
  assert.equal(deleteFreeFrame("1").ok, true);
  assert.equal(toHex(S.freeFrames["2"].reg.bits, S.N), "000000000000ABCD");

  // Patch validator accepts F1..F16 for frame, register, expression, source & routes
  const validPatch = normalizeAgentPatch({
    frame: "f7",
    register: { frame: "F2", hex: "DEAD" },
    expression: { frame: "F3", text: "F2 ^ 0xFF" },
    source: { frame: "B", kind: "frame", from: "f7" },
  });
  assert.equal(validPatch.ok, true);
  if (validPatch.ok) {
    assert.equal(validPatch.patch.frame, "F7");
    assert.equal(validPatch.patch.register?.frame, "F2");
    assert.equal(validPatch.patch.expression?.frame, "F3");
    assert.equal(validPatch.patch.source?.kind, "frame");
    if (validPatch.patch.source?.kind === "frame") {
      assert.equal(validPatch.patch.source.from, "F7");
    }
  }
  assert.equal(
    normalizeAgentPatch({ source: { frame: "F1", kind: "frame", from: "F1" } }).ok,
    false,
    "self-route on free frame refused",
  );

  selectLane("1");
  assert.equal(S.activeFree, null);
});

test("D53: a deleted dependency freezes downstream stages and reports why", () => {
  applyProject(pristine);
  try {
    addFreeFrame({ hex: "0000000000000001" }); // F1
    addFreeFrame({ hex: "0000000000000000" }); // F2
    addFreeFrame({ hex: "0000000000000000" }); // F3
    bindFreeExpression(S.freeFrames["2"], "F1 << 4");
    bindFreeExpression(S.freeFrames["3"], "F2 << 4");
    evaluate(true);

    assert.equal(S.expressionErrors["F2"] ?? null, null);
    assert.equal(S.expressionErrors["F3"] ?? null, null);
    assert.equal(toHex(S.freeFrames["3"].reg.bits, S.N), "0000000000000100");

    /* Deleting the middle stage leaves F3's expression dangling. It must not
       silently pass as a settled value. */
    assert.equal(deleteFreeFrame("2").ok, true);
    evaluate(true);
    assert.match(S.expressionErrors["F3"], /F2/);
    assert.equal(toHex(S.freeFrames["3"].reg.bits, S.N), "0000000000000100", "last settled bits kept");

    /* Stepping the survivor proves the frozen stage no longer tracks it. */
    setHexWord(S.freeFrames["1"].reg, "0000000000000002");
    evaluate(true);
    assert.equal(toHex(S.freeFrames["3"].reg.bits, S.N), "0000000000000100");

    const captured = captureProject("2026-11-23T00:00:00.000Z");
    const uiState = buildUiState(captured, { expressionErrors: S.expressionErrors });
    assert.match(uiState.freeFrames["F3"].expressionError, /F2/);
    assert.equal(uiState.freeFrames["F1"].expressionError, null);

    /* The deleted key is reused, and the chain resumes on the next pass. */
    addFreeFrame({ hex: "0000000000000003" });
    evaluate(true);
    assert.equal(S.expressionErrors["F3"] ?? null, null);
    assert.equal(toHex(S.freeFrames["3"].reg.bits, S.N), "0000000000000030");
  } finally {
    applyProject(pristine);
  }
});
