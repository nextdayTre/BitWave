/**
 * Dynamic-lanes slice 1 (D43): lane/frame naming primitives and their
 * composition with the expression environment.
 *
 * Expected names are written out literally so this file pins the grammar
 * independently of the helper under test. The expression cases prove the
 * evaluator resolves names from the environment rather than a fixed 3-lane
 * whitelist, while the agent-defaults cases prove the agent surface is the
 * shipped 1–8 range with the legacy lanes-1–3 slot map beside it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APP_LANE_CAP,
  DEFAULT_LANE_COUNT,
  NAME_CEILING,
  derivedNames,
  frameNamesFor,
  frameRefFromName,
  laneDef,
  laneDefs,
  laneIndex,
  laneKey,
  laneKeyFromNumber,
  operandNames,
} from "../src/core/lanedefs.ts";
import {
  FRAME_NAMES,
  LANE_OF_SLOT,
  SLOT_OF_LANE,
  frameName,
  frameRefFromName as agentFrameRefFromName,
  laneKeyFromNumber as agentLaneKeyFromNumber,
} from "../src/core/agent-defaults.ts";
import { ExpressionError, evaluateExpression } from "../src/core/expression.ts";

/** A complete frame environment for `count` lanes (every name maps to a word). */
function frameEnv(
  count: number,
  values: Record<string, bigint> = {},
): { width: number; frames: Record<string, bigint> } {
  const frames: Record<string, bigint> = {};
  for (const name of [...operandNames(count), ...derivedNames(count)]) frames[name] = 0n;
  return { width: 8, frames: { ...frames, ...values } };
}

function expressionCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ExpressionError) return error.code;
    throw error;
  }
  return undefined;
}

test("name constants: shipped default 3, app cap 8, grammar ceiling 13", () => {
  assert.equal(DEFAULT_LANE_COUNT, 3);
  assert.equal(APP_LANE_CAP, 8);
  assert.equal(NAME_CEILING, 13);
});

test("default three-lane table is exactly A/B/Z1, C/D/Z2, E/F/Z3", () => {
  assert.deepEqual(
    laneDefs().map(({ key, index, a, b, z }) => ({ key, index, a, b, z })),
    [
      { key: "1", index: 0, a: "A", b: "B", z: "Z1" },
      { key: "2", index: 1, a: "C", b: "D", z: "Z2" },
      { key: "3", index: 2, a: "E", b: "F", z: "Z3" },
    ],
  );
  assert.deepEqual(frameNamesFor(), {
    "1": { a: "A", b: "B", z: "Z1" },
    "2": { a: "C", b: "D", z: "Z2" },
    "3": { a: "E", b: "F", z: "Z3" },
  });
  assert.deepEqual(operandNames(), ["A", "B", "C", "D", "E", "F"]);
  assert.deepEqual(derivedNames(), ["Z1", "Z2", "Z3"]);
  assert.deepEqual(laneDefs(1), [laneDef(0)]);
  assert.deepEqual(laneDefs(DEFAULT_LANE_COUNT), laneDefs());
});

test("eight lanes: operands A..P and derived Z1..Z8", () => {
  const operands = operandNames(APP_LANE_CAP);
  assert.equal(operands.length, 16);
  assert.deepEqual(operands, "ABCDEFGHIJKLMNOP".split(""));
  assert.deepEqual(derivedNames(APP_LANE_CAP), ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "Z7", "Z8"]);
  assert.deepEqual(laneDef(7), { key: "8", index: 7, a: "O", b: "P", z: "Z8" });
  assert.deepEqual(Object.keys(frameNamesFor(APP_LANE_CAP)), ["1", "2", "3", "4", "5", "6", "7", "8"]);
});

test("thirteen lanes is the grammar ceiling: index 12 is Y/Z, Z13", () => {
  assert.deepEqual(laneDef(12), { key: "13", index: 12, a: "Y", b: "Z", z: "Z13" });
  assert.deepEqual(operandNames(NAME_CEILING).slice(-2), ["Y", "Z"]);
  assert.equal(derivedNames(NAME_CEILING).at(-1), "Z13");
  assert.equal(laneDefs(NAME_CEILING).length, 13);
});

test("names derive from the index, so gapped lane maps keep their identities", () => {
  assert.deepEqual(laneDef(3), { key: "4", index: 3, a: "G", b: "H", z: "Z4" });
  // A lane map may be 1, 3, 4: every name still comes from its own index.
  const gapped = ["1", "3", "4"].map((key) => laneDef(laneIndex(key)));
  assert.deepEqual(
    gapped.map(({ key, a, b, z }) => ({ key, a, b, z })),
    [
      { key: "1", a: "A", b: "B", z: "Z1" },
      { key: "3", a: "E", b: "F", z: "Z3" },
      { key: "4", a: "G", b: "H", z: "Z4" },
    ],
  );
  assert.deepEqual(laneDef(laneIndex("7")), { key: "7", index: 6, a: "M", b: "N", z: "Z7" });
});

test("lane counts outside 1..13 are rejected with a clear RangeError", () => {
  assert.throws(() => laneDefs(0), /lane count must be an integer in \[1, 13\]; got 0/);
  assert.throws(() => laneDefs(14), /lane count must be an integer in \[1, 13\]; got 14/);
  for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => laneDefs(count), RangeError, `count ${String(count)}`);
  }
  assert.throws(() => laneDef(-1), RangeError);
  assert.throws(() => laneDef(NAME_CEILING), RangeError);
  assert.throws(() => laneKey(NAME_CEILING), RangeError);
});

test("lane keys round-trip; invalid keys/numbers are rejected", () => {
  for (let index = 0; index < NAME_CEILING; index += 1) {
    assert.equal(laneKey(index), String(index + 1));
    assert.equal(laneIndex(laneKey(index)), index);
  }
  for (const bad of ["0", "14", "", "01", "1.0", "x", " 1", 2, 0, null, undefined]) {
    assert.equal(laneIndex(bad), -1, `laneIndex(${String(bad)})`);
  }
  assert.equal(laneKeyFromNumber(1), "1");
  assert.equal(laneKeyFromNumber(13), "13");
  for (const bad of [0, 14, -3, 1.5, "1", null, undefined]) {
    assert.equal(laneKeyFromNumber(bad), null, `laneKeyFromNumber(${String(bad)})`);
  }
});

test("frame refs resolve case-insensitively and reject unknown names", () => {
  assert.deepEqual(frameRefFromName("Z1"), { lane: "1", frame: "z", name: "Z1" });
  assert.deepEqual(frameRefFromName("a"), { lane: "1", frame: "a", name: "A" });
  assert.deepEqual(frameRefFromName("d"), { lane: "2", frame: "b", name: "D" });
  assert.deepEqual(frameRefFromName("z13", NAME_CEILING), { lane: "13", frame: "z", name: "Z13" });
  assert.deepEqual(frameRefFromName("P", APP_LANE_CAP), { lane: "8", frame: "b", name: "P" });
  // The default ceiling is the shipped three lanes.
  assert.equal(frameRefFromName("G"), null);
  assert.equal(frameRefFromName("Z8"), null);
  assert.equal(frameRefFromName("Q"), null);
  assert.equal(frameRefFromName(""), null);
  assert.equal(frameRefFromName(" A "), null);
  assert.equal(frameRefFromName(1), null);
  assert.equal(frameRefFromName(null), null);
});

test("expression names follow the environment: 8 lanes accept A + Z8", () => {
  assert.equal(evaluateExpression("A + Z8", frameEnv(APP_LANE_CAP, { A: 1n, Z8: 2n })), 3n);
  assert.equal(evaluateExpression("O ^ P", frameEnv(APP_LANE_CAP, { O: 0x0fn, P: 0xf0n })), 0xffn);
  assert.equal(evaluateExpression("N + Z1", frameEnv(APP_LANE_CAP, { Z1: 1n })), 9n);
  assert.equal(evaluateExpression("log.P + 1", { ...frameEnv(APP_LANE_CAP), log: { P: 4n } }), 5n);
});

test("a three-lane environment rejects Z8 with E_EXPR_UNKNOWN_NAME", () => {
  assert.equal(expressionCode(() => evaluateExpression("Z8", frameEnv(DEFAULT_LANE_COUNT))), "E_EXPR_UNKNOWN_NAME");
  assert.equal(
    expressionCode(() => evaluateExpression("A + Z8", frameEnv(DEFAULT_LANE_COUNT, { A: 1n }))),
    "E_EXPR_UNKNOWN_NAME",
  );
  assert.throws(
    () => evaluateExpression("Z8", frameEnv(DEFAULT_LANE_COUNT)),
    (error: unknown) => {
      assert.ok(error instanceof ExpressionError);
      assert.equal(error.code, "E_EXPR_UNKNOWN_NAME");
      // The hint lists the three-lane environment's real names, not the 8-lane ones.
      assert.equal(error.hint?.includes("Z3"), true);
      assert.equal(error.hint?.includes("Z8"), false);
      return true;
    },
  );
});

test("name resolution is environment-driven, not a fixed whitelist", () => {
  assert.equal(evaluateExpression("G + 1", { width: 8, frames: { G: 5n } }), 6n);
  const empty = { width: 8, frames: {} };
  assert.equal(expressionCode(() => evaluateExpression("A", empty)), "E_EXPR_UNKNOWN_NAME");
  assert.equal(expressionCode(() => evaluateExpression("Z1", { width: 8, frames: { A: 1n } })), "E_EXPR_UNKNOWN_NAME");
  assert.equal(expressionCode(() => evaluateExpression("N", empty)), undefined);
});

test("agent-defaults keeps the historic three-lane slot map and widens to the 1-8 cap", () => {
  /* The frame-name vocabulary covers the whole shipped app cap (D46). */
  assert.deepEqual(Object.keys(FRAME_NAMES), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.deepEqual(FRAME_NAMES["1"], { a: "A", b: "B", z: "Z1" });
  assert.deepEqual(FRAME_NAMES["8"], { a: "O", b: "P", z: "Z8" });
  /* The legacy schema-1 slot letters exist for lanes 1–3 only. */
  assert.deepEqual(SLOT_OF_LANE, { "1": "A", "2": "B", "3": "C" });
  assert.deepEqual(LANE_OF_SLOT, { A: "1", B: "2", C: "3" });
  assert.equal(frameName("3", "z"), "Z3");
  assert.equal(frameName("8", "z"), "Z8");
  /* Old A–F/Z1–Z3 refs keep their slotKey; lanes 4–8 have no slot letter. */
  assert.deepEqual(agentFrameRefFromName("Z2"), { lane: "2", frame: "z", slotKey: "B", name: "Z2" });
  assert.deepEqual(agentFrameRefFromName("d"), { lane: "2", frame: "b", slotKey: "B", name: "D" });
  assert.deepEqual(agentFrameRefFromName("G"), { lane: "4", frame: "a", name: "G" });
  assert.deepEqual(agentFrameRefFromName("Z8"), { lane: "8", frame: "z", name: "Z8" });
  assert.deepEqual(agentFrameRefFromName("p"), { lane: "8", frame: "b", name: "P" });
  assert.equal(agentFrameRefFromName("Q"), null);
  assert.equal(agentFrameRefFromName("Z9"), null);
  assert.equal(agentLaneKeyFromNumber(1), "1");
  assert.equal(agentLaneKeyFromNumber(8), "8");
  assert.equal(agentLaneKeyFromNumber(9), null);
  assert.equal(agentLaneKeyFromNumber(0), null);
  assert.equal(agentLaneKeyFromNumber(4.5), null);
});
