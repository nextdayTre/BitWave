/**
 * Agent tool registry — known vectors, envelope/error contract, determinism,
 * canonical deeplinks and bridge patch validation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  ERROR_CODES,
  SCHEMA_VERSION,
  TOOLS,
  callTool,
  buildDeeplink,
  getManifest,
  normalizeAgentPatch,
} from "../src/core/agent-tools.ts";
import { exampleProjectDoc, frameRefFromName } from "../src/core/agent-defaults.ts";
import { buildShareLink } from "../src/core/agent-share.ts";
import { deserializeProject } from "../src/core/project.ts";
import { parseShareHash } from "../src/core/share.ts";
import { fromHex, toHex } from "../src/core/registers.ts";
import { computeZ } from "../src/core/derive.ts";

const A = "8ADEFEDA85210125";
const B = "FFFFFFFF00000000";
const N = 64;

const okData = (result: unknown): Record<string, unknown> => {
  const envelope = result as { ok: boolean; data: Record<string, unknown> };
  assert.equal(envelope.ok, true);
  return envelope.data;
};

test("registry has the six documented pure tools in canonical order", () => {
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    ["manifest", "analyze_register", "evaluate_lane", "compare_operands", "parse_dataset", "build_deeplink"],
  );
  for (const tool of TOOLS) {
    assert.equal(tool.scope, "pure");
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.examples.length >= 1);
  }
});

test("manifest is JSON-safe, versioned and strips run functions", () => {
  const manifest = getManifest();
  assert.equal(manifest.id, "bitwave");
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
  assert.equal(manifest.version, "1.3.0");
  assert.equal(manifest.tools.length, 6);
  assert.deepEqual(manifest.errorCodes, [...ERROR_CODES]);
  assert.ok(!("run" in manifest.tools[0]));
  assert.deepEqual(manifest.relatedTools, []);
  assert.equal(JSON.parse(JSON.stringify(manifest)).id, "bitwave");
});

test("success envelope has the fixed key order", () => {
  assert.deepEqual(Object.keys(callTool("analyze_register", { hex: A })), [
    "ok",
    "schemaVersion",
    "tool",
    "data",
    "deeplink",
    "warnings",
  ]);
});

test("failure envelope has the fixed key order", () => {
  const envelope = callTool("analyze_register", { hex: "not-hex" });
  assert.deepEqual(Object.keys(envelope), ["ok", "schemaVersion", "tool", "error", "warnings"]);
  assert.equal(envelope.ok, false);
  if (!envelope.ok) {
    assert.deepEqual(Object.keys(envelope.error), ["code", "message"]);
  }
});

test("analyze_register normalizes and reports the DESIGN vector", () => {
  const data = okData(callTool("analyze_register", { hex: A, width: 64 }));
  assert.equal(data.width, 64);
  assert.equal(data.hex, A);
  assert.equal(data.decimal, BigInt("0x" + A).toString());
  assert.deepEqual(data.nibbles, [8, 10, 13, 14, 15, 14, 13, 10, 8, 5, 2, 1, 0, 1, 2, 5]);
  assert.equal(data.popcount, 30);
  assert.equal(data.bitLength, 64);
});

test("analyze_register truncates overflow and validates input", () => {
  const data = okData(callTool("analyze_register", { hex: "1234", width: 8 }));
  assert.equal(data.hex, "34");
  assert.equal(data.nibbles.length, 2);
  assert.equal(callTool("analyze_register", { hex: "" }).ok, false);
  assert.equal(callTool("analyze_register", { hex: "ZZ" }).ok, false);
  assert.equal(callTool("analyze_register", { hex: A, width: 24 }).ok, false);
  assert.equal(callTool("analyze_register", { hex: A, nope: 1 }).ok, false);
  assert.equal(callTool("analyze_register", ["x"]).ok, false);
});

test("evaluate_lane matches the golden XOR/AND/OR vectors", () => {
  const xor = okData(callTool("evaluate_lane", { a: A, b: B, op: "xor" }));
  assert.equal(xor.op, "xor");
  assert.deepEqual(xor.z, { hex: "7521012585210125", popcount: 20 });
  assert.deepEqual(xor.truthCounts, [23, 11, 9, 21]);
  assert.equal(xor.carry, null);
  assert.equal(xor.borrow, null);

  const and = okData(callTool("evaluate_lane", { a: A, b: B, op: "and" }));
  assert.deepEqual(and.z, { hex: "8ADEFEDA00000000", popcount: 21 });

  const or = okData(callTool("evaluate_lane", { a: A, b: B, op: "or" }));
  assert.deepEqual(or.z, { hex: "FFFFFFFF85210125", popcount: 41 });
});

test("evaluate_lane reports ADD carry and SUB borrow, and defaults B to zero", () => {
  const add = okData(callTool("evaluate_lane", { a: "FF", b: "01", op: "add", width: 8 }));
  assert.equal(add.z.hex, "00");
  assert.equal(add.carry, true);
  assert.equal(add.borrow, null);

  const sub = okData(callTool("evaluate_lane", { a: "00", b: "01", op: "sub", width: 8 }));
  assert.equal(sub.z.hex, "FF");
  assert.equal(sub.carry, null);
  assert.equal(sub.borrow, true);

  const defaultB = okData(callTool("evaluate_lane", { a: "FF", width: 8 }));
  assert.equal(defaultB.b.hex, "00");
  assert.equal(defaultB.z.hex, "FF");
});

test("compare_operands covers every operator in canonical order", () => {
  const data = okData(callTool("compare_operands", { a: A, b: B, width: N }));
  const results = data.results as Array<{ op: string; z: string; popcount: number }>;
  assert.deepEqual(results.map((r) => r.op), ["and", "or", "xor", "add", "sub"]);
  assert.deepEqual(data.truthCounts, [23, 11, 9, 21]);

  for (const result of results) {
    const single = okData(callTool("evaluate_lane", { a: A, b: B, op: result.op, width: N }));
    assert.equal(result.z, (single.z as { hex: string }).hex, `op ${result.op}`);
    assert.equal(result.popcount, (single.z as { popcount: number }).popcount, `op ${result.op}`);
  }
});

test("parse_dataset applies the import typing rules", () => {
  const text = "Hex 1,Hex 2\n00000001,00000002\n00000003,00000004";
  const data = okData(callTool("parse_dataset", { text, maxRows: 2 }));
  assert.deepEqual(data.columns, [
    { name: "Hex 1", mode: "hex", widthBits: 32 },
    { name: "Hex 2", mode: "hex", widthBits: 32 },
  ]);
  assert.equal(data.totalRows, 2);
  assert.equal(data.truncated, false);
  assert.deepEqual(data.rows, [
    ["00000001", "00000002"],
    ["00000003", "00000004"],
  ]);

  const truncated = okData(callTool("parse_dataset", { text, maxRows: 1 }));
  assert.equal(truncated.truncated, true);
  assert.equal((truncated.rows as string[][]).length, 1);

  const binary = okData(callTool("parse_dataset", { text: "flags\n1010\n1100" }));
  assert.deepEqual(binary.columns, [{ name: "flags", mode: "bin", widthBits: 4 }]);
  assert.equal(binary.totalRows, 2);

  assert.equal(callTool("parse_dataset", { text: "" }).ok, false);
  assert.equal(callTool("parse_dataset", { text: "a,b\n1,2", maxRows: 0 }).ok, false);
  assert.equal(callTool("parse_dataset", { text: "x".repeat(262145) }).ok, false);
});

test("build_deeplink returns a canonical, deterministic, round-tripping link", () => {
  const doc = exampleProjectDoc();
  const first = okData(callTool("build_deeplink", { project: doc }));
  const second = okData(callTool("build_deeplink", { project: doc }));

  assert.equal(first.fragment, second.fragment);
  assert.match(String(first.fragment), /^#bw=/);
  assert.equal(first.payloadChars, String(first.fragment).length - 4);
  assert.equal(first.withinBudget, true);
  assert.equal(first.datasetDropped, false);
  assert.equal(first.expressionsDropped, false);
  assert.equal(first.url, null);

  // The canonical payload is the compact JSON array with the leading tag (D45).
  const raw = JSON.parse(
    Buffer.from(String(first.fragment).slice("#bw=".length), "base64url").toString("utf8"),
  );
  assert.ok(Array.isArray(raw));
  assert.equal(raw[0], 4);
  assert.equal(raw[1], 8);

  const decoded = parseShareHash(String(first.fragment));
  assert.ok(decoded && typeof decoded === "object");
  assert.ok(!("savedAt" in (decoded as Record<string, unknown>)), "canonical links omit savedAt");
  const loaded = deserializeProject(decoded);
  assert.equal(loaded.N, 8);

  const withBase = okData(callTool("build_deeplink", { project: doc, base: "http://localhost:8000/" }));
  assert.equal(withBase.url, `http://localhost:8000/${first.fragment}`);
});

test("build_deeplink rejects invalid projects and bad bases", () => {
  const invalid = callTool("build_deeplink", { project: { schema: 2, app: "other" } });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "E_INVALID_PROJECT");

  const base = callTool("build_deeplink", { project: exampleProjectDoc(), base: "http://x/#y" });
  assert.equal(base.ok, false);
  if (!base.ok) assert.equal(base.error.code, "E_BAD_ARGS");

  assert.equal(callTool("build_deeplink", {}).ok, false);
});

test("build_deeplink accepts schema 2/3/4 documents and upgrades them to schema 4", () => {
  const current = exampleProjectDoc();
  const links = new Map<number, string>();
  for (const schema of [2, 3, 4]) {
    const data = okData(callTool("build_deeplink", { project: { ...current, schema } }));
    const decoded = parseShareHash(String(data.fragment)) as Record<string, unknown>;
    assert.equal(decoded.schema, 4, `schema ${schema} upgrades to the canonical schema`);
    assert.ok(!("savedAt" in decoded), "canonical links omit savedAt");
    deserializeProject(decoded); // proves the canonical payload is a valid project
    links.set(schema, String(data.fragment));
  }
  /* The same state expressed at an older schema gives the same canonical link. */
  assert.equal(links.get(2), links.get(4));
  assert.equal(links.get(3), links.get(4));

  /* Schema 1 loads through the same core path (the CLI also accepts it). */
  assert.equal(callTool("build_deeplink", { project: { ...current, schema: 1 } }).ok, true);
});

test("build_deeplink and the canonical share helper agree", () => {
  const doc = exampleProjectDoc();
  const direct = buildShareLink(doc);
  const envelope = okData(callTool("build_deeplink", { project: doc }));
  assert.equal(envelope.fragment, direct.fragment);
  assert.equal(envelope.payloadChars, direct.payloadChars);
});

test("buildDeeplink throws an AgentToolError-shaped object on bad input", () => {
  assert.throws(() => buildDeeplink({}), (error: unknown) => {
    return (error as { code?: string }).code === "E_BAD_ARGS";
  });
});

test("callTool never throws for unknown tools or malformed argument shapes", () => {
  const unknown = callTool("does_not_exist", {});
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.code, "E_UNKNOWN_TOOL");
  assert.equal(callTool(null, {}).ok, false);
  assert.equal(callTool("manifest", "nope").ok, false);
});

test("results are byte-deterministic", () => {
  const a = JSON.stringify(callTool("compare_operands", { a: A, b: B }));
  const b = JSON.stringify(callTool("compare_operands", { a: A, b: B }));
  assert.equal(a, b);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(a), "no timestamps in tool output");
});

test("normalizeAgentPatch accepts a combined valid patch", () => {
  const result = normalizeAgentPatch({
    lane: 2,
    frame: "Z1",
    view: "split",
    width: 16,
    register: { frame: "A", hex: "dead" },
    binop: "add",
    lfo: { on: true, mode: "slide", rate: 8 },
    dataset: { csv: "a\n01", index: 2 },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.patch.lane, 2);
  assert.equal(result.patch.frame, "Z1");
  assert.equal(result.patch.view, "split");
  assert.equal(result.patch.width, 16);
  assert.deepEqual(result.patch.register, { frame: "A", hex: "dead" });
  assert.equal(result.patch.binop, "add");
  assert.deepEqual(result.patch.lfo, { on: true, mode: "slide", rate: 8 });
  assert.deepEqual(result.patch.dataset, { csv: "a\n01", index: 2 });
  assert.equal(result.patch.reset, undefined);
});

test("normalizeAgentPatch rejects invalid patches with a code", () => {
  const code = (patch: unknown): string | undefined => {
    const result = normalizeAgentPatch(patch);
    return result.ok ? undefined : result.error.code;
  };
  assert.equal(code({}), "E_BAD_ARGS");
  assert.equal(code({ nope: 1 }), "E_BAD_ARGS");
  assert.equal(code({ lane: 4 }), "E_BAD_ENUM");
  assert.equal(code({ frame: "Q" }), "E_BAD_ENUM");
  assert.equal(code({ width: 24 }), "E_BAD_ENUM");
  assert.equal(code({ view: "4d" }), "E_BAD_ENUM");
  assert.equal(code({ binop: "nand" }), "E_BAD_ENUM");
  assert.equal(code({ register: { frame: "Z1", hex: "aa" } }), "E_BAD_ENUM");
  assert.equal(code({ register: { frame: "A", hex: "zz" } }), "E_INVALID_HEX");
  assert.equal(code({ register: { frame: "A", hex: "" } }), "E_EMPTY_INPUT");
  assert.equal(code({ lfo: { rate: 3 } }), "E_BAD_ENUM");
  assert.equal(code({ lfo: { on: "yes" } }), "E_BAD_ARGS");
  assert.equal(code({ dataset: { index: -1 } }), "E_OUT_OF_RANGE");
  assert.equal(code({ reset: false }), "E_BAD_ARGS");
});

test("normalizeAgentPatch accepts expression and record controls", () => {
  const expression = normalizeAgentPatch({ expression: { frame: "b", text: "round(2 * C)" } });
  assert.equal(expression.ok, true);
  if (expression.ok) {
    assert.deepEqual(expression.patch.expression, { frame: "B", text: "round(2 * C)" });
  }

  const cleared = normalizeAgentPatch({ expression: { frame: "A", text: "  " }, record: false });
  assert.equal(cleared.ok, true);
  if (cleared.ok) {
    assert.deepEqual(cleared.patch.expression, { frame: "A", text: "" });
    assert.equal(cleared.patch.record, false);
  }

  const invalid = normalizeAgentPatch({ expression: { frame: "A", text: "1 +" } });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "E_INVALID_EXPRESSION");

  assert.equal(normalizeAgentPatch({ expression: { frame: "Z1", text: "C" } }).ok, false);
  assert.equal(normalizeAgentPatch({ record: 1 }).ok, false);
});

test("normalizeAgentPatch accepts source and route controls", () => {
  const route = normalizeAgentPatch({ source: { frame: "D", kind: "frame", from: "1.z" } });
  assert.equal(route.ok, true);
  if (route.ok) assert.deepEqual(route.patch.source, { frame: "D", kind: "frame", from: "1.z" });

  const data = normalizeAgentPatch({ source: { frame: "a", kind: "data", column: 2 } });
  assert.equal(data.ok, true);
  if (data.ok) assert.deepEqual(data.patch.source, { frame: "A", kind: "data", column: 2 });

  const none = normalizeAgentPatch({ source: { frame: "F", kind: "none" } });
  assert.equal(none.ok, true);

  assert.equal(normalizeAgentPatch({ source: { frame: "D", kind: "frame", from: "2.b" } }).ok, false);
  assert.equal(normalizeAgentPatch({ source: { frame: "Z1", kind: "none" } }).ok, false);
  assert.equal(normalizeAgentPatch({ source: { frame: "D", kind: "frame", from: "bad" } }).ok, false);
  assert.equal(normalizeAgentPatch({ source: { frame: "D", kind: "data", column: -1 } }).ok, false);
});

test("frame references resolve the global names", () => {
  assert.deepEqual(frameRefFromName("Z2"), { lane: "2", frame: "z", slotKey: "B", name: "Z2" });
  assert.deepEqual(frameRefFromName("d"), { lane: "2", frame: "b", slotKey: "B", name: "D" });
  assert.equal(frameRefFromName("Q"), null);
});

test("evaluate_lane uses the same engine as the UI core", () => {
  const z = computeZ(fromHex(A, N), fromHex(B, N), N, "xor");
  const data = okData(callTool("evaluate_lane", { a: A, b: B, op: "xor" }));
  assert.equal(data.z && (data.z as { hex: string }).hex, toHex(z, N));
});
