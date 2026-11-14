/**
 * Agent transports — the CLI, the MCP stdio server and the generated artifacts.
 *
 * The registry itself is covered by tests/agent-tools.test.ts; this file asserts
 * the contract around it: the envelope channel, exit-code semantics, manifest
 * byte equality, deterministic generation and the JSON-RPC surface.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UsageError, parseArgs, runCli } from "../agent/cli.mjs";
import { PROTOCOL_VERSION, handleLine, handleMessage } from "../agent/mcp-server.mjs";
import { buildArtifacts } from "../agent/gen-agent-artifacts.mjs";
import { buildShareLink } from "../src/core/agent-share.ts";
import { getManifest } from "../src/core/agent-tools.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "agent", "cli.mjs");
const GENERATOR = path.join(ROOT, "agent", "gen-agent-artifacts.mjs");

const A = "8ADEFEDA85210125";
const B = "FFFFFFFF00000000";
const XOR_Z = "7521012585210125";
const ENVELOPE_KEYS = ["ok", "schemaVersion", "tool", "data", "deeplink", "warnings"];

function capture(argv) {
  const stdout = [];
  const stderr = [];
  const code = runCli(argv, {
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

function spawnNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
}

function parseEnvelope(stdout) {
  const envelope = JSON.parse(stdout);
  assert.deepEqual(Object.keys(envelope), ENVELOPE_KEYS);
  return envelope;
}

test("parseArgs accepts --flag value and --flag=value", () => {
  assert.deepEqual(parseArgs(["analyze_register", "--hex", A, "--width=64", "--json"]), {
    command: "analyze_register",
    extra: [],
    flags: { hex: A, width: "64", json: true },
  });
  assert.deepEqual(parseArgs(["--a", A, "--b=" + B, "compare_operands"]), {
    command: "compare_operands",
    extra: [],
    flags: { a: A, b: B },
  });
  assert.deepEqual(parseArgs([]), { command: "help", extra: [], flags: {} });
});

test("parseArgs rejects unknown flags and missing values", () => {
  assert.throws(() => parseArgs(["--bogus"]), UsageError);
  assert.throws(() => parseArgs(["--hex"]), UsageError);
  assert.throws(() => parseArgs(["--hex", "--json"]), UsageError);
  assert.throws(() => parseArgs(["--json=1"]), UsageError);
});

test("manifest --json prints exactly one envelope on stdout", () => {
  const result = capture(["manifest", "--json"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const envelope = parseEnvelope(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.tool, "manifest");
  assert.equal(envelope.data.id, "bitwave");
  assert.equal(envelope.data.version, "1.3.0");
  assert.equal(envelope.deeplink, null);
  assert.deepEqual(envelope.warnings, []);
});

test("envelope output is byte-deterministic", () => {
  const first = capture(["compare_operands", "--a", A, "--b", B, "--json"]);
  const second = capture(["compare_operands", "--a", A, "--b", B, "--json"]);
  assert.equal(first.code, 0);
  assert.equal(first.stdout, second.stdout);
  const envelope = parseEnvelope(first.stdout);
  assert.equal(envelope.data.results[2].op, "xor");
  assert.equal(envelope.data.results[2].z, XOR_Z);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(first.stdout), "tool output carries no timestamp");
});

test("tool errors exit 3 with a failure envelope on stdout", () => {
  const result = capture(["analyze_register", "--hex", "ZZ", "--json"]);
  assert.equal(result.code, 3);
  const envelope = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(envelope), ["ok", "schemaVersion", "tool", "error", "warnings"]);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "E_INVALID_HEX");
  assert.equal(envelope.tool, "analyze_register");

  const human = capture(["analyze_register", "--hex", "ZZ"]);
  assert.equal(human.code, 3);
  assert.equal(human.stdout, "");
  assert.match(human.stderr, /E_INVALID_HEX/);
});

test("usage errors exit 2 and keep stdout clean", () => {
  const missing = capture(["analyze_register", "--json"]);
  assert.equal(missing.code, 2);
  assert.equal(missing.stdout, "");

  const unknownCommand = capture(["frobnicate"]);
  assert.equal(unknownCommand.code, 2);
  assert.equal(unknownCommand.stdout, "");

  const unknownFlag = capture(["manifest", "--bogus"]);
  assert.equal(unknownFlag.code, 2);
  assert.equal(unknownFlag.stdout, "");
});

test("a spawned CLI call matches the in-process runner", () => {
  const args = ["compare_operands", "--a", A, "--b", B, "--json"];
  const inProcess = capture(args);
  const spawned = spawnNode(CLI, args);
  assert.equal(spawned.error, undefined);
  assert.equal(spawned.status, 0);
  assert.equal(spawned.stdout, inProcess.stdout);
  assert.equal(parseEnvelope(spawned.stdout).data.op, undefined);
});

test("state is headless, envelope-free and deterministic", () => {
  const first = capture(["state", "--json"]);
  const second = capture(["state", "--json"]);
  assert.equal(first.code, 0);
  assert.equal(first.stdout, second.stdout);
  const state = JSON.parse(first.stdout);
  assert.ok(!("ok" in state), "state is not an envelope");
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.width, 64);
  assert.equal(state.lane, 1);
  assert.equal(state.frame, "A");
  assert.ok(String(state.deeplink).startsWith("bitwave-v2.html#bw="));
  assert.deepEqual(Object.keys(state.lanes), ["1", "2", "3"]);

  const based = JSON.parse(capture(["state", "--base", "http://localhost:8000/", "--json"]).stdout);
  assert.ok(String(based.deeplink).startsWith("http://localhost:8000/#bw="));
});

test("the CLI deeplink equals the app's canonical builder for the same state", () => {
  const fixture = JSON.parse(readFileSync(path.join(ROOT, "examples", "demo.bitwave.json"), "utf8"));
  const direct = buildShareLink(fixture);
  const spawned = spawnNode(CLI, [
    "deeplink",
    "--project",
    "examples/demo.bitwave.json",
    "--base",
    "http://localhost:8000/",
    "--json",
  ]);
  assert.equal(spawned.status, 0, spawned.stderr);
  const envelope = parseEnvelope(spawned.stdout);
  assert.equal(envelope.data.fragment, direct.fragment, "CLI and the address bar share one canonical link");
  assert.equal(envelope.data.payloadChars, direct.payloadChars);
  assert.equal(envelope.deeplink, "http://localhost:8000/" + direct.fragment);
  // The canonical payload is the compact array (D45).
  const raw = JSON.parse(
    Buffer.from(direct.fragment.slice("#bw=".length), "base64url").toString("utf8"),
  );
  assert.ok(Array.isArray(raw));
  assert.equal(raw[0], 4);
});

test("agent/manifest.json is byte-identical to getManifest()", () => {
  const file = readFileSync(path.join(ROOT, "agent", "manifest.json"), "utf8");
  assert.equal(file, JSON.stringify(getManifest(), null, 2) + "\n");
});

test("the generated artifact set matches the contract", () => {
  const files = buildArtifacts();
  assert.deepEqual([...files.keys()], [
    "agent/manifest.json",
    "agent/examples/manifest.json",
    "agent/examples/analyze_register.json",
    "agent/examples/evaluate_lane.json",
    "agent/examples/compare_operands.json",
    "agent/examples/parse_dataset.json",
    "agent/examples/build_deeplink.json",
    "agent/examples/README.md",
  ]);
  for (const [relative, content] of files) {
    assert.ok(content.endsWith("\n"), `${relative} ends with a newline`);
    if (!relative.endsWith(".json")) continue;
    const parsed = JSON.parse(content);
    if (relative === "agent/manifest.json") {
      assert.equal(parsed.id, "bitwave");
    } else {
      assert.equal(parsed.ok, true);
      assert.equal(parsed.tool, path.basename(relative, ".json"));
      assert.equal(parsed.schemaVersion, 1);
    }
  }
  // Recomputing must produce identical bytes (no timestamps or ordering drift).
  assert.deepEqual([...buildArtifacts().entries()], [...files.entries()]);
});

test("artifacts --check is current and idempotent", () => {
  const first = spawnNode(GENERATOR, ["--check"]);
  const second = spawnNode(GENERATOR, ["--check"]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(second.status, 0);
  assert.equal(first.stdout, second.stdout);

  const viaCli = spawnNode(CLI, ["artifacts", "--check"]);
  assert.equal(viaCli.status, 0, viaCli.stdout + viaCli.stderr);
});

test("MCP initialize / ping / tools-list", () => {
  const initialize = handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.ok(initialize);
  assert.equal(initialize.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(PROTOCOL_VERSION, "2025-06-18");
  assert.deepEqual(initialize.result.capabilities, { tools: {} });
  assert.deepEqual(initialize.result.serverInfo, { name: "bitwave", version: "1.3.0" });

  assert.equal(handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.deepEqual(handleMessage({ jsonrpc: "2.0", id: 2, method: "ping" }).result, {});

  const list = handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.deepEqual(
    list.result.tools.map((tool) => tool.name),
    ["manifest", "analyze_register", "evaluate_lane", "compare_operands", "parse_dataset", "build_deeplink"],
  );
  assert.deepEqual(Object.keys(list.result.tools[0]), ["name", "description", "inputSchema"]);
});

test("MCP tools/call returns the same envelope as the CLI", () => {
  const success = handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "evaluate_lane", arguments: { a: A, b: B, op: "xor" } },
  });
  assert.equal(success.result.isError, false);
  assert.equal(success.result.content.length, 1);
  assert.equal(success.result.content[0].type, "text");
  const envelope = JSON.parse(success.result.content[0].text);
  assert.deepEqual(envelope, parseEnvelope(capture(["evaluate_lane", "--a", A, "--b", B, "--op", "xor", "--json"]).stdout));

  const failure = handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "analyze_register", arguments: { hex: "ZZ" } },
  });
  assert.equal(failure.result.isError, true);
  const failedEnvelope = JSON.parse(failure.result.content[0].text);
  assert.equal(failedEnvelope.ok, false);
  assert.equal(failedEnvelope.error.code, "E_INVALID_HEX");
});

test("MCP uses the documented JSON-RPC error codes", () => {
  const parseError = handleLine("not json");
  assert.deepEqual(parseError, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  assert.equal(handleLine(""), null);

  const unknown = handleMessage({ jsonrpc: "2.0", id: 9, method: "does/not/exist" });
  assert.equal(unknown.error.code, -32601);

  const invalid = handleMessage({ jsonrpc: "2.0", id: 10, method: 42 });
  assert.equal(invalid.error.code, -32600);
  assert.equal(handleMessage({ jsonrpc: "2.0", method: "does/not/exist" }), null);
});
