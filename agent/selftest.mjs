#!/usr/bin/env node
/**
 * BitWave agent transport selftest — end-to-end, browser-free.
 *
 * Spawns `agent/cli.mjs` and `agent/mcp-server.mjs` as child processes and
 * recomputes the expected values here, independently of the shared core:
 * nibbles/popcount from the hex text, XOR/AND/OR/ADD/SUB with BigInt maths and
 * truth counts from a per-bit loop. The only core imports are the codec and
 * schema checks explicitly named by the contract (`parseShareHash`,
 * `deserializeProject`), used to prove a built deeplink is a valid project.
 *
 * Prints one PASS/FAIL line per check and a final count. Exit code is non-zero
 * on any failure so CI and `node agent/cli.mjs selftest` can gate on it.
 *
 * Usage: node agent/selftest.mjs
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseShareHash } from "../src/core/share.ts";
import { deserializeProject } from "../src/core/project.ts";

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(AGENT_DIR, "..");
const CLI = path.join(AGENT_DIR, "cli.mjs");
const MCP = path.join(AGENT_DIR, "mcp-server.mjs");
const GENERATOR = path.join(AGENT_DIR, "gen-agent-artifacts.mjs");
const PROJECT_FIXTURE = path.join(REPO_ROOT, "examples", "demo.bitwave.json");

// ---------------------------------------------------------------------------
// Independent vectors (DESIGN §11; also asserted in tests/design-invariants).
// ---------------------------------------------------------------------------

const A = "8ADEFEDA85210125";
const B = "FFFFFFFF00000000";
const XOR_Z = "7521012585210125";
const AND_Z = "8ADEFEDA00000000";
const OR_Z = "FFFFFFFF85210125";
const TRUTH_COUNTS = [23, 11, 9, 21];
const MASK64 = (1n << 64n) - 1n;
const HEX_DIGIT_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function popcountHex(hex) {
  let total = 0;
  for (const character of hex) total += HEX_DIGIT_POPCOUNT[parseInt(character, 16)];
  return total;
}

function nibblesOf(hex) {
  return Array.from(hex, (character) => parseInt(character, 16));
}

function bigintOf(hex) {
  return BigInt("0x" + hex);
}

function hexOf(value, width) {
  return value.toString(16).toUpperCase().padStart(width / 4, "0");
}

function truthCountsOf(aHex, bHex, width) {
  const a = bigintOf(aHex);
  const b = bigintOf(bHex);
  const counts = [0, 0, 0, 0];
  for (let bit = 0; bit < width; bit++) {
    const aBit = Number((a >> BigInt(bit)) & 1n);
    const bBit = Number((b >> BigInt(bit)) & 1n);
    counts[aBit === 0 ? (bBit === 0 ? 0 : 1) : bBit === 0 ? 2 : 3] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const results = [];

function check(name, run) {
  try {
    run();
    results.push({ name, ok: true });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    results.push({ name, ok: false });
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`FAIL ${name}: ${message}\n`);
  }
}

function runNode(script, args = [], options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

function cliStdout(args, expectedStatus = 0) {
  const result = runNode(CLI, args);
  assert.equal(result.error, undefined, `spawn failed: ${result.error ? result.error.message : ""}`);
  assert.equal(
    result.status,
    expectedStatus,
    `node agent/cli.mjs ${args.join(" ")} exited ${result.status}: ${result.stderr.trim()}`,
  );
  return result;
}

/** Parse --json stdout as exactly one JSON value (extra diagnostics fail the check). */
function cliJson(args, expectedStatus = 0) {
  const result = cliStdout(args, expectedStatus);
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new assert.AssertionError({
      message: `stdout is not one JSON value: ${JSON.stringify(result.stdout.slice(0, 200))}`,
    });
  }
  return value;
}

function cliEnvelope(args) {
  const envelope = cliJson(args);
  assert.deepEqual(Object.keys(envelope), ["ok", "schemaVersion", "tool", "data", "deeplink", "warnings"]);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.schemaVersion, 1);
  assert.deepEqual(envelope.warnings, []);
  return envelope;
}

function assertFailureEnvelope(envelope, code) {
  assert.deepEqual(Object.keys(envelope), ["ok", "schemaVersion", "tool", "error", "warnings"]);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, code);
}

// ---------------------------------------------------------------------------
// MCP stdio scenario (one deterministic transcript, reused by the checks)
// ---------------------------------------------------------------------------

const MCP_INPUT = [
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "bitwave-selftest", version: "1.5.0" },
    },
  }),
  JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
  JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
  JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "evaluate_lane", arguments: { a: A, b: B, op: "xor" } },
  }),
  JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "analyze_register", arguments: { hex: "ZZ" } },
  }),
  JSON.stringify({ jsonrpc: "2.0", id: 6, method: "unknown/method" }),
  "not json",
].join("\n") + "\n";

let mcpRunCache;
function mcpRun() {
  if (mcpRunCache === undefined) mcpRunCache = runNode(MCP, [], { input: MCP_INPUT });
  return mcpRunCache;
}

function mcpResponses() {
  const result = mcpRun();
  assert.equal(result.error, undefined, `MCP spawn failed: ${result.error ? result.error.message : ""}`);
  assert.equal(result.status, 0, `MCP exited ${result.status}: ${result.stderr.trim()}`);
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new assert.AssertionError({
          message: `MCP stdout line ${index + 1} is not JSON: ${JSON.stringify(line.slice(0, 200))}`,
        });
      }
    });
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function runChecks() {
  results.length = 0;
  mcpRunCache = undefined;

  check("CLI help exits 0 with usage text", () => {
    const result = cliStdout(["help"]);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /analyze_register/);
    assert.match(result.stdout, /Exit codes: 0 ok, 2 usage, 3 tool error/);
  });

  check("manifest --json is one deterministic envelope", () => {
    const first = cliStdout(["manifest", "--json"]);
    const second = cliStdout(["manifest", "--json"]);
    assert.equal(first.stdout, second.stdout);
    const envelope = cliEnvelope(["manifest", "--json"]);
    assert.deepEqual(Object.keys(envelope.data), [
      "id",
      "title",
      "version",
      "schemaVersion",
      "description",
      "urls",
      "deeplink",
      "ui",
      "tools",
      "errorCodes",
      "invariants",
      "relatedTools",
    ]);
    assert.equal(envelope.data.id, "bitwave");
    assert.equal(envelope.data.version, "1.5.0");
    assert.equal(envelope.data.schemaVersion, 1);
    assert.deepEqual(
      envelope.data.tools.map((tool) => tool.name),
      ["manifest", "analyze_register", "evaluate_lane", "compare_operands", "parse_dataset", "build_deeplink"],
    );
    assert.ok(!("run" in envelope.data.tools[0]), "manifest must strip run functions");
  });

  check("manifest documents the stage-bar lane dropdown and the 1-8 range", () => {
    const manifest = cliEnvelope(["manifest", "--json"]).data;
    assert.equal(manifest.ui.laneSelect, "#stageBar .lane-select");
    assert.equal(manifest.ui.laneSelector, "[data-agent-lane]");
    assert.equal(manifest.ui.frameSelector, "[data-agent-frame]");
    assert.match(String(manifest.description), /1–8/);
    assert.match(String(manifest.description), /live lanes|default instrument/);
  });

  check("agent/manifest.json matches the manifest envelope", () => {
    const envelope = cliEnvelope(["manifest", "--json"]);
    const file = readFileSync(path.join(REPO_ROOT, "agent", "manifest.json"), "utf8");
    assert.equal(file, JSON.stringify(envelope.data, null, 2) + "\n");
  });

  check("analyze_register matches independent nibble/popcount math", () => {
    const data = cliEnvelope(["analyze_register", "--hex", A, "--json"]).data;
    assert.equal(data.width, 64);
    assert.equal(data.hex, A);
    assert.deepEqual(data.nibbles, nibblesOf(A));
    assert.equal(data.popcount, popcountHex(A));
    assert.equal(data.popcount, 30);
    assert.equal(data.bitLength, 64);
    assert.equal(data.decimal, bigintOf(A).toString());
  });

  check("analyze_register truncates high bits at 8 bits", () => {
    const data = cliEnvelope(["analyze_register", "--hex", "1234", "--width", "8", "--json"]).data;
    assert.equal(data.width, 8);
    assert.equal(data.hex, "34");
    assert.deepEqual(data.nibbles, [3, 4]);
  });

  check("evaluate_lane xor matches independent BigInt and truth maths", () => {
    const data = cliEnvelope(["evaluate_lane", "--a", A, "--b", B, "--op", "xor", "--json"]).data;
    assert.equal(data.op, "xor");
    assert.equal(data.a.hex, A);
    assert.equal(data.b.hex, B);
    assert.equal(data.z.hex, hexOf(bigintOf(A) ^ bigintOf(B), 64));
    assert.equal(data.z.hex, XOR_Z);
    assert.equal(data.z.popcount, popcountHex(XOR_Z));
    assert.equal(data.z.popcount, 20);
    assert.deepEqual(data.truthCounts, truthCountsOf(A, B, 64));
    assert.deepEqual(data.truthCounts, TRUTH_COUNTS);
    assert.equal(data.truthCounts.reduce((sum, n) => sum + n, 0), 64);
    assert.equal(data.carry, null);
    assert.equal(data.borrow, null);
  });

  check("evaluate_lane and/or match the DESIGN goldens", () => {
    const and = cliEnvelope(["evaluate_lane", "--a", A, "--b", B, "--op", "and", "--json"]).data;
    const or = cliEnvelope(["evaluate_lane", "--a", A, "--b", B, "--op", "or", "--json"]).data;
    assert.equal(and.z.hex, AND_Z);
    assert.equal(and.z.popcount, 21);
    assert.equal(or.z.hex, OR_Z);
    assert.equal(or.z.popcount, 41);
    assert.equal(and.z.hex, hexOf(bigintOf(A) & bigintOf(B), 64));
    assert.equal(or.z.hex, hexOf(bigintOf(A) | bigintOf(B), 64));
  });

  check("evaluate_lane add carries and sub borrows at 8 bits", () => {
    const add = cliEnvelope(["evaluate_lane", "--a", "FF", "--b", "01", "--op", "add", "--width", "8", "--json"]).data;
    assert.equal(add.z.hex, "00");
    assert.equal(add.carry, true);
    assert.equal(add.borrow, null);
    const sub = cliEnvelope(["evaluate_lane", "--a", "00", "--b", "01", "--op", "sub", "--width", "8", "--json"]).data;
    assert.equal(sub.z.hex, "FF");
    assert.equal(sub.carry, null);
    assert.equal(sub.borrow, true);
  });

  check("compare_operands covers all five operators in canonical order", () => {
    const data = cliEnvelope(["compare_operands", "--a", A, "--b", B, "--json"]).data;
    const a = bigintOf(A);
    const b = bigintOf(B);
    const expected = {
      and: a & b,
      or: a | b,
      xor: a ^ b,
      add: (a + b) & MASK64,
      sub: (a - b) & MASK64,
    };
    assert.deepEqual(data.results.map((result) => result.op), ["and", "or", "xor", "add", "sub"]);
    for (const result of data.results) {
      assert.equal(result.z, hexOf(expected[result.op], 64), `op ${result.op}`);
      assert.equal(result.popcount, popcountHex(result.z), `op ${result.op} popcount`);
    }
    const add = data.results.find((result) => result.op === "add");
    const sub = data.results.find((result) => result.op === "sub");
    assert.equal(add.carry, a + b > MASK64);
    assert.equal(sub.borrow, a < b);
    assert.deepEqual(data.truthCounts, truthCountsOf(A, B, 64));
  });

  check("parse_dataset types columns and reports rows", () => {
    const data = cliEnvelope([
      "parse_dataset",
      "--text",
      "Hex 1,Hex 2\n00000001,00000002\n00000003,00000004\n00000005,00000006",
      "--max-rows",
      "2",
      "--json",
    ]).data;
    assert.deepEqual(data.columns, [
      { name: "Hex 1", mode: "hex", widthBits: 32 },
      { name: "Hex 2", mode: "hex", widthBits: 32 },
    ]);
    assert.equal(data.totalRows, 3);
    assert.equal(data.truncated, true);
    assert.deepEqual(data.rows, [
      ["00000001", "00000002"],
      ["00000003", "00000004"],
    ]);
  });

  check("parse_dataset detects a binary column", () => {
    const data = cliEnvelope(["parse_dataset", "--text", "flags\n1010\n1100", "--json"]).data;
    assert.deepEqual(data.columns, [{ name: "flags", mode: "bin", widthBits: 4 }]);
    assert.equal(data.totalRows, 2);
    assert.equal(data.truncated, false);
  });

  check("deeplink round-trips a project fixture through parseShareHash", () => {
    const fixture = JSON.parse(readFileSync(PROJECT_FIXTURE, "utf8"));
    const first = cliEnvelope(["deeplink", "--project", "examples/demo.bitwave.json", "--base", "http://localhost:8000/", "--json"]);
    const second = cliEnvelope(["deeplink", "--project", "examples/demo.bitwave.json", "--base", "http://localhost:8000/", "--json"]);
    assert.equal(first.data.fragment, second.data.fragment, "deeplink is deterministic");
    const data = first.data;
    assert.ok(String(data.fragment).startsWith("#bw="));
    assert.equal(data.payloadChars, String(data.fragment).length - 4);
    assert.equal(data.withinBudget, true);
    assert.equal(data.datasetDropped, false);
    assert.equal(data.url, "http://localhost:8000/" + data.fragment);

    const decoded = parseShareHash(String(data.fragment));
    assert.ok(decoded && typeof decoded === "object");
    assert.deepEqual(Object.keys(decoded), [
      "schema",
      "app",
      "N",
      "view",
      "lanes",
      "routes",
      "parked",
      "dataset",
    ]);
    assert.ok(!("savedAt" in decoded), "canonical links omit savedAt");
    assert.equal(decoded.app, "bitwave");
    assert.equal(decoded.N, fixture.N);
    assert.deepEqual(decoded.routes, fixture.routes);
    assert.deepEqual(decoded.parked, fixture.parked);
    assert.deepEqual(decoded.dataset, fixture.dataset);

    const loaded = deserializeProject(decoded); // proves the payload is a valid project
    assert.equal(loaded.N, fixture.N);
    assert.equal(loaded.routing.routes.length, fixture.routes.length);
  });

  check("deeplink without --project uses the boot document", () => {
    const data = cliEnvelope(["deeplink", "--json"]).data;
    assert.ok(String(data.fragment).startsWith("#bw="));
    assert.equal(data.withinBudget, true);
    assert.equal(data.url, null);
    const decoded = parseShareHash(String(data.fragment));
    assert.ok(decoded && typeof decoded === "object");
    assert.equal(decoded.N, 64);
    assert.equal(decoded.view.lane, "1");
    assert.equal(decoded.lanes["1"].binop, "xor");
    deserializeProject(decoded);
  });

  check("deeplink round-trips the eight-lane fixture within budget", () => {
    const data = cliEnvelope(["deeplink", "--project", "examples/eight-lanes.bitwave.json", "--json"]).data;
    assert.ok(String(data.fragment).startsWith("#bw="));
    assert.equal(data.withinBudget, true);
    assert.ok(data.payloadChars < 2000, `payload ${data.payloadChars} exceeds the budget`);
    const decoded = parseShareHash(String(data.fragment));
    assert.ok(decoded && typeof decoded === "object");
    assert.equal(decoded.schema, 4);
    assert.deepEqual(Object.keys(decoded.lanes), ["1", "2", "3", "4", "5", "6", "7", "8"]);
    const loaded = deserializeProject(decoded);
    assert.equal(loaded.N, 64);
    assert.deepEqual(Object.keys(loaded.lanes), ["1", "2", "3", "4", "5", "6", "7", "8"]);
    assert.equal(loaded.view.lane, "8");
    assert.equal(loaded.lanes["8"].A.bits.length, 64);
  });

  check("state --json is a headless, deterministic UI state", () => {
    const first = cliStdout(["state", "--json"]);
    const second = cliStdout(["state", "--json"]);
    assert.equal(first.stdout, second.stdout);
    const state = JSON.parse(first.stdout);
    assert.deepEqual(Object.keys(state), [
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
    assert.equal(state.width, 64);
    assert.equal(state.lane, 1);
    assert.equal(state.frame, "A");
    assert.equal(state.dataset, null);
    assert.ok(String(state.deeplink).startsWith("bitwave-v2.html#bw="));
    assert.deepEqual(Object.keys(state.lanes), ["1", "2", "3"]);
    assert.deepEqual(state.bridge, { schemaVersion: 1, version: "1.5.0" });
  });

  check("state --project reports the eight-lane document by stable key", () => {
    const state = JSON.parse(
      cliStdout(["state", "--project", "examples/eight-lanes.bitwave.json", "--json"]).stdout,
    );
    assert.deepEqual(Object.keys(state.lanes), ["1", "2", "3", "4", "5", "6", "7", "8"]);
    assert.equal(state.lane, 8);
    assert.equal(state.frame, "O");
    assert.deepEqual(Object.keys(state.lanes["1"].frames), ["A", "B", "Z1"]);
    assert.deepEqual(Object.keys(state.lanes["4"].frames), ["G", "H", "Z4"]);
    assert.deepEqual(Object.keys(state.lanes["8"].frames), ["O", "P", "Z8"]);
    assert.equal(state.lanes["1"].frames.Z1, "7521012585210125");
    assert.equal(state.lanes["8"].frames.O, "DEADBEEFCAFEBABE");
    assert.equal(state.lanes["8"].frames.P, "0123456789ABCDEF");
    assert.deepEqual(state.view.splitPair, [7, 8]);
    assert.deepEqual(state.bridge, { schemaVersion: 1, version: "1.5.0" });
  });

  check("state --project reports the dataset cursor", () => {
    const fixture = JSON.parse(readFileSync(PROJECT_FIXTURE, "utf8"));
    const state = JSON.parse(cliStdout(["state", "--project", "examples/demo.bitwave.json", "--json"]).stdout);
    assert.equal(state.width, fixture.N);
    assert.equal(state.dataset.rows, fixture.dataset.rows.length);
    assert.equal(state.dataset.index, fixture.dataset.index);
    assert.deepEqual(state.dataset.row, fixture.dataset.rows[fixture.dataset.index]);
    const stepped = JSON.parse(
      cliStdout(["state", "--project", "examples/demo.bitwave.json", "--index", "2", "--json"]).stdout,
    );
    assert.equal(stepped.dataset.index, 2);
    assert.deepEqual(stepped.dataset.row, fixture.dataset.rows[2]);
  });

  check("tool errors exit 3 with a failure envelope", () => {
    const envelope = cliJson(["analyze_register", "--hex", "ZZ", "--json"], 3);
    assertFailureEnvelope(envelope, "E_INVALID_HEX");
    assert.equal(envelope.tool, "analyze_register");
    const empty = cliJson(["parse_dataset", "--text", "   ", "--json"], 3);
    assertFailureEnvelope(empty, "E_EMPTY_INPUT");
  });

  check("usage errors exit 2 and leave stdout clean", () => {
    const missing = cliStdout(["analyze_register", "--json"], 2);
    assert.equal(missing.stdout, "");
    const unknownCommand = cliStdout(["frobnicate"], 2);
    assert.equal(unknownCommand.stdout, "");
    const unknownFlag = cliStdout(["manifest", "--bogus"], 2);
    assert.equal(unknownFlag.stdout, "");
  });

  check("generated artifacts are current", () => {
    const result = runNode(GENERATOR, ["--check"]);
    assert.equal(result.status, 0, `generator --check failed:\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /artifacts up to date/);
  });

  check("artifacts --check forwards the generator exit code", () => {
    const viaCli = runNode(CLI, ["artifacts", "--check"]);
    const viaGenerator = runNode(GENERATOR, ["--check"]);
    assert.equal(viaCli.status, viaGenerator.status);
    assert.equal(viaCli.status, 0);
  });

  check("MCP initialize/ping/tools-list handshake", () => {
    const responses = mcpResponses();
    assert.equal(responses.length, 7, "one response per request; initialized is silent");
    const initialize = responses.find((response) => response.id === 1);
    assert.ok(initialize);
    assert.equal(initialize.jsonrpc, "2.0");
    assert.equal(initialize.result.protocolVersion, "2025-06-18");
    assert.deepEqual(initialize.result.capabilities, { tools: {} });
    assert.deepEqual(initialize.result.serverInfo, { name: "bitwave", version: "1.5.0" });
    const ping = responses.find((response) => response.id === 2);
    assert.deepEqual(ping.result, {});
    const list = responses.find((response) => response.id === 3);
    assert.deepEqual(
      list.result.tools.map((tool) => tool.name),
      ["manifest", "analyze_register", "evaluate_lane", "compare_operands", "parse_dataset", "build_deeplink"],
    );
    for (const tool of list.result.tools) {
      assert.equal(typeof tool.description, "string");
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(!("run" in tool));
    }
  });

  check("MCP tools/call returns envelope text and isError", () => {
    const responses = mcpResponses();
    const success = responses.find((response) => response.id === 4);
    assert.equal(success.result.isError, false);
    assert.equal(success.result.content.length, 1);
    assert.equal(success.result.content[0].type, "text");
    const envelope = JSON.parse(success.result.content[0].text);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.tool, "evaluate_lane");
    assert.equal(envelope.data.z.hex, XOR_Z);

    const failure = responses.find((response) => response.id === 5);
    assert.equal(failure.result.isError, true);
    const failedEnvelope = JSON.parse(failure.result.content[0].text);
    assertFailureEnvelope(failedEnvelope, "E_INVALID_HEX");
  });

  check("MCP reports unknown methods and parse errors", () => {
    const responses = mcpResponses();
    const unknown = responses.find((response) => response.id === 6);
    assert.equal(unknown.error.code, -32601);
    const parseError = responses.find((response) => response.id === null);
    assert.ok(parseError, "a malformed line gets a parse-error response");
    assert.equal(parseError.error.code, -32700);
    assert.equal(parseError.jsonrpc, "2.0");
  });

  check("MCP exits cleanly on EOF", () => {
    const result = runNode(MCP, [], { input: "" });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

} // end runChecks

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runSelftest() {
  runChecks();
  const failed = results.filter((result) => !result.ok).length;
  process.stdout.write(`\nselftest: ${results.length - failed} passed, ${failed} failed (${results.length} checks)\n`);
  return failed === 0 ? 0 : 1;
}

/** True when this module is the process entry point (not imported by a test). */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(moduleUrl);
  const resolved = path.resolve(entry);
  return process.platform === "win32"
    ? self.toLowerCase() === resolved.toLowerCase()
    : self === resolved;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runSelftest();
}
