#!/usr/bin/env node
/**
 * Independent browser verification for the BitWave agent layer (toolset 1.2.0).
 *
 * Drives the built single-file artifact (`bitwave-v2.html`) over `file://` in a
 * fresh-profile headless Chrome/Edge over the DevTools Protocol, then asserts the
 * contract in docs/AGENT-INTERFACE.md — including the external-routing slice:
 * expression sources (`setExpression`), the transient Record take (`record`,
 * `getLog`) and the schema-4 project document behind `#bw=` links.
 *
 * Expectations are derived from `src/core` (the tool registry, the manifest, the
 * state builder, the project codec, the expression evaluator) — never from the
 * page's own helpers — so this check would catch a page that agrees with itself
 * but not with the contract.
 *
 * Usage:
 *   node agent/verify-browser.mjs
 *   node agent/verify-browser.mjs --artifact bitwave-v2.html --chrome "C:\path\to\chrome.exe"
 *
 * Env: BITWAVE_CHROME may point at the browser executable.
 * Exit codes: 0 all checks pass, 1 a check failed, 2 the environment is unusable
 * (missing artifact, no browser, protocol timeout).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SCHEMA_VERSION,
  TOOLSET_VERSION,
  TOOLS,
  callTool,
  getManifest,
  normalizeAgentPatch,
} from "../src/core/agent-tools.ts";
import { FRAME_NAMES, bootProjectDoc } from "../src/core/agent-defaults.ts";
import { buildUiState } from "../src/core/agent-state.ts";
import { evaluateExpression } from "../src/core/expression.ts";
import { PROJECT_SCHEMA, deserializeProject } from "../src/core/project.ts";
import { parseShareHash } from "../src/core/share.ts";
import { computeZ } from "../src/core/derive.ts";
import { bigToReg, fromHex, regToBig, toHex } from "../src/core/registers.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

function flag(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

const artifactPath = resolve(flag("--artifact", join(ROOT, "bitwave-v2.html")));
const artifactUrl = pathToFileURL(artifactPath).href;

/** The bridge surface the contract promises: v1 base + 1.1.0 additions + 1.2.0 schema-4 documents. */
const BRIDGE_KEYS = [
  "schemaVersion",
  "version",
  "ready",
  "getState",
  "getManifest",
  "tools",
  "call",
  "getDeeplink",
  "setState",
  "setLane",
  "setFrame",
  "setView",
  "setWidth",
  "setRegister",
  "setBinop",
  "setLfo",
  "setDataset",
  "setExpression",
  "setSource",
  "setRoute",
  "record",
  "getLog",
  "stepDataset",
  "reset",
  "subscribe",
].sort();

/** The nine global frame names, in lane order; derived from the shared core. */
const FRAME_LIST = ["1", "2", "3"].flatMap((lane) => Object.values(FRAME_NAMES[lane]));
const LANE_KEYS = ["1", "2", "3"];

const CHROME_CANDIDATES = [
  process.env.BITWAVE_CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/** Every global frame word of the boot document, as a name → BigInt map. */
function bootFrameWords() {
  const doc = bootProjectDoc();
  const width = doc.N;
  const frames = {};
  for (const laneKey of LANE_KEYS) {
    const lane = doc.lanes[laneKey];
    const names = FRAME_NAMES[laneKey];
    frames[names.a] = regToBig(fromHex(lane.a, width), width);
    frames[names.b] = regToBig(fromHex(lane.b, width), width);
    frames[names.z] = regToBig(
      computeZ(fromHex(lane.a, width), fromHex(lane.b, width), width, lane.binop),
      width,
    );
  }
  return frames;
}

/**
 * The register value an expression source must produce from the boot document
 * (the page under test starts from its boot state in the fresh session).
 */
function expectedExpressionHex(source) {
  const doc = bootProjectDoc();
  const width = doc.N;
  const value = evaluateExpression(source, { width, frames: bootFrameWords() });
  const bits = new Uint8Array(width);
  bigToReg(value, bits, width);
  return toHex(bits, width);
}

/** Expected frames after `setExpression("D", "C + 1")`: D from the expression, Z2 derived. */
function expectedPairExpression() {
  const doc = bootProjectDoc();
  const width = doc.N;
  const dHex = expectedExpressionHex("C + 1");
  const dBits = fromHex(dHex, width);
  const z2 = computeZ(fromHex(doc.lanes["2"].a, width), dBits, width, doc.lanes["2"].binop);
  return { d: dHex, z2: toHex(z2, width) };
}

/** State key sets derived from the shared builder, not from the page. */
function expectedStateShapes() {
  const expected = buildUiState(bootProjectDoc(), {
    deeplink: "expected://state",
    lfoOn: false,
    copyArmed: false,
    recording: { on: false, rows: 0 },
  });
  return {
    state: Object.keys(expected).sort(),
    lane: Object.keys(expected.lanes["1"]).sort(),
    laneKeys: LANE_KEYS,
    expected,
  };
}

/** Page state split into the deterministic body (no live URL) plus deeplink. */
function stateBody(state) {
  const copy = JSON.parse(JSON.stringify(state));
  delete copy.deeplink;
  return copy;
}

class Protocol {
  constructor() {
    this.port = null;
    this.child = null;
    this.socket = null;
    this.profile = null;
    this.nextId = 0;
    this.pending = new Map();
    this.rawEvents = [];
  }

  async start(chromePath) {
    this.profile = mkdtempSync(join(tmpdir(), "bitwave-verify-"));
    const portFile = join(this.profile, "DevToolsActivePort");
    this.child = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=1440,900",
        `--user-data-dir=${this.profile}`,
        "--remote-debugging-port=0",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    for (let i = 0; i < 200 && !this.port; i++) {
      try {
        this.port = readFileSync(portFile, "utf8").split(/\r?\n/)[0];
      } catch {
        await sleep(50);
      }
    }
    if (!this.port) throw new Error("DevToolsActivePort never appeared");
    const targets = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("no page target");
    this.socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      this.socket.onopen = done;
      this.socket.onerror = fail;
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) waiter.fail(new Error(JSON.stringify(message.error)));
        else waiter.done(message.result);
        return;
      }
      this.rawEvents.push(message);
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__bitwaveVerify = { ready: 0, changes: 0 };
        addEventListener("bitwave:ready", () => { window.__bitwaveVerify.ready += 1; });
        addEventListener("bitwave:change", () => { window.__bitwaveVerify.changes += 1; });
      `,
    });
  }

  send(method, params = {}) {
    return new Promise((done, fail) => {
      const id = ++this.nextId;
      this.pending.set(id, { done, fail });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`page exception: ${result.exceptionDetails.text ?? "unknown"}`);
    }
    return result.result.value;
  }

  /** A real navigation (no same-URL short-circuit) followed by readiness. */
  async navigate(url, timeoutMs = 20000) {
    if (url !== "about:blank") {
      await this.send("Page.navigate", { url });
    } else {
      await this.send("Page.navigate", { url });
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = await this.evaluate(`(() => {
        const body = document.body;
        const node = document.querySelector("#bitwave-state");
        return Boolean(
          body && body.dataset.agentReady === "true" &&
          node && node.textContent && node.textContent.length > 2 &&
          window.bitwave && window.bitwave.ready === true
        );
      })()`);
      if (ready) {
        await this.evaluate("document.fonts.ready.then(() => true)");
        await sleep(100);
        return;
      }
      await sleep(100);
    }
    throw new Error(`page never became agent-ready: ${url}`);
  }

  /** Force a real document load (used to prove a deeplink really reloads). */
  async reload(url) {
    await this.send("Page.navigate", { url: "about:blank" });
    await sleep(150);
    await this.navigate(url);
  }

  async eventCounters() {
    return this.evaluate(`window.__bitwaveVerify`);
  }

  /** Console errors, page exceptions and error-level log entries since start. */
  errorEvents() {
    const errors = [];
    for (const event of this.rawEvents) {
      if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") {
        errors.push({ kind: "console.error", text: event.params.args.map(describeRemote).join(" ") });
      } else if (event.method === "Runtime.exceptionThrown") {
        errors.push({
          kind: "exception",
          text: event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text,
        });
      } else if (event.method === "Log.entryAdded" && event.params.entry.level === "error") {
        errors.push({ kind: "log.error", text: event.params.entry.text });
      }
    }
    return errors;
  }

  async close() {
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    try {
      this.child?.kill();
    } catch {
      /* ignore */
    }
    await sleep(200);
    if (this.profile) {
      try {
        rmSync(this.profile, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* a still-exiting Chrome may hold the profile; the OS temp dir is the fallback */
      }
    }
  }
}

function describeRemote(arg) {
  if (arg.type === "string") return arg.value;
  return arg.description ?? arg.type;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (!deepEqual(actual, expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(artifactPath)) {
    console.error(`FAIL artifact not found: ${artifactPath} — run: npm run build`);
    return 2;
  }
  const chromePath = findChrome();
  if (!chromePath) {
    console.error("FAIL no Chrome/Edge found — set BITWAVE_CHROME");
    return 2;
  }

  const browser = new Protocol();
  const results = [];
  let fatal = null;
  const run = async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const freshUrl = `${artifactUrl}?fresh`;
  const state = () => browser.evaluate("document.querySelector('#bitwave-state').textContent").then(JSON.parse);
  const liveState = () => browser.evaluate("window.bitwave.getState()");
  const changeCount = async () => (await browser.eventCounters()).changes;

  try {
    await browser.start(chromePath);
    /* A fresh session makes the boot state deterministic (no autosave/URL carry-over). */
    await browser.navigate(freshUrl);

    await run("supplied artifact boots and mounts the bridge", async () => {
      assertEqual(await browser.evaluate("typeof window.bitwave"), "object");
      assertEqual(await browser.evaluate("document.body.dataset.agentReady"), "true");
    });

    await run("exactly one bitwave:ready and one bitwave:change on mount", async () => {
      assertEqual(await browser.eventCounters(), { ready: 1, changes: 1 });
    });

    await run("bridge identity matches the contract", async () => {
      assertEqual(await browser.evaluate("window.bitwave.schemaVersion"), SCHEMA_VERSION);
      assertEqual(await browser.evaluate("window.bitwave.version"), TOOLSET_VERSION);
      assertEqual(await browser.evaluate("window.bitwave.ready"), true);
      assertEqual(
        await browser.evaluate("document.querySelector('#bitwave-state').dataset.schemaVersion"),
        String(SCHEMA_VERSION),
      );
    });

    await run("bridge exposes exactly the contract surface (v1 + 1.1.0/1.2.0 additions)", async () => {
      assertEqual(await browser.evaluate("Object.keys(window.bitwave).sort()"), BRIDGE_KEYS);
      assertEqual(await browser.evaluate("typeof window.bitwave.setExpression"), "function");
      assertEqual(await browser.evaluate("typeof window.bitwave.setSource"), "function");
      assertEqual(await browser.evaluate("typeof window.bitwave.setRoute"), "function");
      assertEqual(await browser.evaluate("typeof window.bitwave.record"), "function");
      assertEqual(await browser.evaluate("typeof window.bitwave.getLog"), "function");
    });

    await run("#bitwave-state parses and === JSON.stringify(getState())", async () => {
      const text = await browser.evaluate("document.querySelector('#bitwave-state').textContent");
      const parsed = JSON.parse(text);
      const live = await browser.evaluate("JSON.stringify(window.bitwave.getState())");
      assert(text === live, "#bitwave-state text differs from JSON.stringify(getState())");
      assertEqual(parsed.schemaVersion, SCHEMA_VERSION);
      assertEqual(parsed.ready, true);
      assertEqual(parsed.bridge, { schemaVersion: SCHEMA_VERSION, version: TOOLSET_VERSION });
    });

    await run("state matches the core UI-state builder on the boot document", async () => {
      const pageState = await state();
      const { expected } = expectedStateShapes();
      assertEqual(stateBody(pageState), stateBody(expected));
      assertEqual(pageState.recording, { on: false, rows: 0 });
      for (const lane of LANE_KEYS) {
        assertEqual(pageState.lanes[lane].expressions, {
          [FRAME_NAMES[lane].a]: null,
          [FRAME_NAMES[lane].b]: null,
        });
      }
    });

    await run("state carries the 1.1.0 keys (recording, per-lane expressions)", async () => {
      const { state: expectedStateKeys, lane: expectedLaneKeys } = expectedStateShapes();
      assertEqual(Object.keys(await state()).sort(), expectedStateKeys);
      assert((await state()).recording && typeof (await state()).recording.on === "boolean", "recording.on missing");
      for (const lane of LANE_KEYS) {
        assertEqual(Object.keys((await state()).lanes[lane]).sort(), expectedLaneKeys, `lane ${lane} keys`);
      }
    });

    await run("legacy window.BitWave read-only surface is unchanged", async () => {
      const legacy = await browser.evaluate(`(() => {
        const surface = window.BitWave;
        if (!surface || typeof surface !== "object") return null;
        return {
          keys: Object.keys(surface).sort(),
          schema: surface.schema,
          state: typeof surface.state(),
          geometry: typeof surface.geometry === "function",
          hasSetters: ["setState", "setRegister", "setLane"].some((key) => typeof surface[key] === "function"),
        };
      })()`);
      assert(legacy !== null, "window.BitWave is missing");
      assertEqual(legacy.keys, ["artifact", "bindings", "frames", "geometry", "schema", "state"]);
      assertEqual(legacy.state, "object");
      assertEqual(legacy.geometry, true);
      assertEqual(legacy.hasSetters, false);
    });

    await run("getManifest() deep-equals the core manifest", async () => {
      const pageManifest = await browser.evaluate("window.bitwave.getManifest()");
      assertEqual(pageManifest, getManifest());
      assertEqual(pageManifest.version, TOOLSET_VERSION);
      assertEqual(pageManifest.relatedTools, []);
      assertEqual(pageManifest.tools.length, TOOLS.length);
      assert(pageManifest.errorCodes.includes("E_INVALID_EXPRESSION"), "manifest lacks E_INVALID_EXPRESSION");
    });

    await run("setState({lane:2}) is truthful synchronously", async () => {
      const result = await browser.evaluate(`(() => {
        const result = window.bitwave.setState({ lane: 2 });
        return {
          ok: result.ok,
          warnings: result.warnings,
          returnedLane: result.state.lane,
          immediateLane: window.bitwave.getState().lane,
        };
      })()`);
      assertEqual(result.ok, true);
      assertEqual(result.returnedLane, 2);
      assertEqual(result.immediateLane, 2);
      assert(Array.isArray(result.warnings) && result.warnings.length === 0, "warnings must be an empty array");
    });

    await run("a no-op setter emits no bitwave:change", async () => {
      const before = await changeCount();
      const result = await browser.evaluate(`(() => {
        const result = window.bitwave.setState({ lane: 2 });
        return { ok: result.ok, changes: window.__bitwaveVerify.changes };
      })()`);
      assertEqual(result.ok, true);
      assertEqual(result.changes, before);
    });

    await run("invalid setters return E_* without throwing and do not mutate state", async () => {
      const cases = [
        { patch: { width: 999 }, expected: normalizeAgentPatch({ width: 999 }).error.code },
        { patch: { bogusKey: true }, expected: normalizeAgentPatch({ bogusKey: true }).error.code },
        {
          patch: { register: { frame: "Z1", hex: "00" } },
          expected: normalizeAgentPatch({ register: { frame: "Z1", hex: "00" } }).error.code,
        },
        { patch: "not-an-object", expected: normalizeAgentPatch("not-an-object").error.code },
      ];
      for (const { patch, expected } of cases) {
        const result = await browser.evaluate(`(() => {
          const before = JSON.stringify(window.bitwave.getState());
          const result = window.bitwave.setState(${JSON.stringify(patch)});
          const after = window.bitwave.getState();
          return {
            ok: result.ok,
            code: result.error && result.error.code,
            responseError: result.error && typeof result.error.message === "string",
            stateUnchanged: JSON.stringify(after) === before,
            immediateWidth: after.width,
          };
        })()`);
        assertEqual(result.ok, false);
        assert(
          typeof result.code === "string" && result.code.startsWith("E_"),
          `expected a closed E_* code, got ${result.code}`,
        );
        assertEqual(result.code, expected);
        assert(result.responseError, "failure envelope has no error message");
        assert(result.stateUnchanged, `${JSON.stringify(patch)} mutated the state`);
        assertEqual(result.immediateWidth, 64);
      }
    });

    await run("setRegister writes an operand frame truthfully", async () => {
      const result = await browser.evaluate(`(() => {
        const result = window.bitwave.setRegister("A", "DEADBEEF");
        return { ok: result.ok, value: result.state.lanes["1"].frames.A };
      })()`);
      assertEqual(result.ok, true);
      assertEqual(result.value, "00000000DEADBEEF");
      await browser.evaluate("window.bitwave.reset()");
    });

    await run("call() envelopes equal the core registry (success + unknown + bad args)", async () => {
      const cases = [
        ["compare_operands", { a: "8ADEFEDA85210125", b: "FFFFFFFF00000000" }],
        ["evaluate_lane", { a: "8ADE", b: "FFFF", op: "xor", width: 16 }],
        ["parse_dataset", { text: "Hex 1,Hex 2\n00000001,00000002" }],
        ["no_such_tool", {}],
        ["evaluate_lane", { a: 123 }],
      ];
      for (const [name, args] of cases) {
        const page = await browser.evaluate(`window.bitwave.call(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
        assertEqual(page, callTool(name, args));
      }
    });

    /* ── external routing: expression sources (toolset 1.1.0) ───────────── */

    await run("setExpression computes D/Z2, records the source and emits one change", async () => {
      await browser.navigate(freshUrl);
      const before = await changeCount();
      const result = await browser.evaluate(`(() => {
        const result = window.bitwave.setExpression("D", "C + 1");
        const state = window.bitwave.getState();
        return {
          ok: result.ok,
          d: state.lanes["2"].frames.D,
          z2: state.lanes["2"].frames.Z2,
          expressions: state.lanes["2"].expressions,
          hiddenMatches: document.querySelector("#bitwave-state").textContent === JSON.stringify(state),
          changes: window.__bitwaveVerify.changes,
        };
      })()`);
      const expected = expectedPairExpression();
      assertEqual(result.ok, true);
      assertEqual(result.d, expected.d);
      assertEqual(result.z2, expected.z2);
      assertEqual(result.expressions, { C: null, D: "C + 1" });
      assertEqual(result.hiddenMatches, true);
      assertEqual(result.changes, before + 1);
    });

    await run("a no-op expression emits no bitwave:change", async () => {
      const before = await changeCount();
      const result = await browser.evaluate(`(() => {
        const result = window.bitwave.setExpression("D", "C + 1");
        return { ok: result.ok, changes: window.__bitwaveVerify.changes };
      })()`);
      assertEqual(result.ok, true);
      assertEqual(result.changes, before);
    });

    await run("invalid expression returns E_INVALID_EXPRESSION and mutates nothing", async () => {
      const expected = normalizeAgentPatch({ expression: { frame: "D", text: "C +" } });
      assertEqual(expected.ok, false);
      assertEqual(expected.error.code, "E_INVALID_EXPRESSION");
      const before = await changeCount();
      const result = await browser.evaluate(`(() => {
        const beforeState = JSON.stringify(window.bitwave.getState());
        const result = window.bitwave.setExpression("D", "C +");
        return {
          ok: result.ok,
          code: result.error && result.error.code,
          unchanged: JSON.stringify(window.bitwave.getState()) === beforeState,
          changes: window.__bitwaveVerify.changes,
        };
      })()`);
      assertEqual(result.ok, false);
      assertEqual(result.code, "E_INVALID_EXPRESSION");
      assertEqual(result.unchanged, true);
      assertEqual(result.changes, before);
    });

    await run("an expression source rejects derived and unknown frames", async () => {
      const before = await changeCount();
      const derived = await browser.evaluate(`(() => {
        const result = window.bitwave.setExpression("Z1", "1");
        return { ok: result.ok, code: result.error && result.error.code };
      })()`);
      const unknown = await browser.evaluate(`(() => {
        const result = window.bitwave.setExpression("Q", "1");
        return { ok: result.ok, code: result.error && result.error.code };
      })()`);
      assertEqual(derived.ok, false);
      assertEqual(derived.code, "E_BAD_ENUM");
      assertEqual(unknown.ok, false);
      assertEqual(unknown.code, "E_BAD_ENUM");
      assertEqual(await changeCount(), before);
    });

    await run("clearing an expression source keeps the frame and clears the source", async () => {
      const result = await browser.evaluate(`(() => {
        const result = window.bitwave.setExpression("D", "");
        const state = window.bitwave.getState();
        return { ok: result.ok, expressions: state.lanes["2"].expressions };
      })()`);
      assertEqual(result.ok, true);
      assertEqual(result.expressions, { C: null, D: null });
    });

    await run("setRoute/setSource bind and clear a frame route", async () => {
      await browser.navigate(freshUrl);
      const routed = await browser.evaluate(`(() => {
        const before = window.bitwave.getState();
        const result = window.bitwave.setRoute("D", "1.z");
        const after = window.bitwave.getState();
        return {
          ok: result.ok,
          source: after.lanes["2"].sources.D,
          equalsZ1: after.lanes["2"].frames.D === after.lanes["1"].frames.Z1,
          changed: JSON.stringify(after) !== JSON.stringify(before),
          expression: after.lanes["2"].expressions.D,
        };
      })()`);
      assertEqual(routed.ok, true);
      assertEqual(routed.changed, true);
      assertEqual(routed.equalsZ1, true);
      assertEqual(routed.source.kind, "frame");
      assertEqual(routed.source.source, "1:1");
      assertEqual(routed.source.lane, 1);
      assertEqual(routed.source.frame, "Z1");
      assertEqual(routed.expression, null);

      const self = await browser.evaluate(
        `window.bitwave.setRoute("D", "2.b")`,
      );
      assertEqual(self.ok, false);
      assertEqual(self.error.code, "E_BAD_ARGS");

      const cleared = await browser.evaluate(`(() => {
        const result = window.bitwave.setSource("D", { kind: "none" });
        return { ok: result.ok, source: window.bitwave.getState().lanes["2"].sources.D };
      })()`);
      assertEqual(cleared.ok, true);
      assertEqual(cleared.source.kind, "none");
    });

    /* ── external routing: the transient Record take ────────────────────── */

    await run("record(true) arms a fresh take; re-arming is a silent no-op", async () => {
      await browser.navigate(freshUrl);
      const dataset = await browser.evaluate(
        `window.bitwave.setDataset({ csv: "Hex 1,Hex 2\\n00000001,00000002\\n00000003,00000004" })`,
      );
      assertEqual(dataset.ok, true);
      const before = await changeCount();
      const armed = await browser.evaluate(`(() => {
        const result = window.bitwave.record(true);
        return { ok: result.ok, recording: result.state.recording, log: window.bitwave.getLog().rows.length, changes: window.__bitwaveVerify.changes };
      })()`);
      assertEqual(armed.ok, true);
      assertEqual(armed.recording, { on: true, rows: 0 });
      assertEqual(armed.log, 0);
      assertEqual(armed.changes, before + 1);
      const beforeAgain = await changeCount();
      const again = await browser.evaluate(`(() => {
        const result = window.bitwave.record(true);
        return { ok: result.ok, rows: result.state.recording.rows, changes: window.__bitwaveVerify.changes };
      })()`);
      assertEqual(again.ok, true);
      assertEqual(again.rows, 0);
      assertEqual(again.changes, beforeAgain);
    });

    await run("recorded updates append rows with all nine frames", async () => {
      const step = await browser.evaluate(`(() => {
        const result = window.bitwave.stepDataset(1);
        return { ok: result.ok, recording: result.state.recording };
      })()`);
      assertEqual(step.ok, true);
      assertEqual(step.recording, { on: true, rows: 1 });
      const registered = await browser.evaluate(`(() => {
        const result = window.bitwave.setRegister("A", "0123456789ABCDEF");
        return { ok: result.ok, recording: result.state.recording };
      })()`);
      assertEqual(registered.ok, true);
      assertEqual(registered.recording, { on: true, rows: 2 });

      const log = await browser.evaluate("window.bitwave.getLog()");
      assertEqual(log.ok, true);
      assertEqual(log.rows.length, 2);
      assertEqual(log.rows.map((row) => row.step), [1, 2]);
      for (const row of log.rows) {
        assertEqual(Object.keys(row.frames).sort(), [...FRAME_LIST].sort());
        for (const name of FRAME_LIST) {
          assert(/^[0-9A-F]+$/.test(row.frames[name]), `row frame ${name} is not uppercase hex: ${row.frames[name]}`);
        }
      }
      const pageState = await state();
      const stateFrames = {};
      for (const lane of LANE_KEYS) Object.assign(stateFrames, pageState.lanes[lane].frames);
      const last = log.rows[log.rows.length - 1];
      assertEqual(last.frames, stateFrames);
      assertEqual(pageState.recording, { on: true, rows: 2 });
    });

    await run("getLog limit/error semantics", async () => {
      const result = await browser.evaluate(`(() => {
        const full = window.bitwave.getLog();
        return {
          one: window.bitwave.getLog({ limit: 1 }).rows,
          zero: window.bitwave.getLog({ limit: 0 }).rows.length,
          many: window.bitwave.getLog({ limit: 99 }).rows.length,
          none: window.bitwave.getLog(),
          nullish: window.bitwave.getLog(null),
          string: window.bitwave.getLog("x"),
          fraction: window.bitwave.getLog({ limit: 1.5 }),
          negative: window.bitwave.getLog({ limit: -1 }),
          unknown: window.bitwave.getLog({ bogus: 1 }),
          lastFull: full.rows[full.rows.length - 1],
        };
      })()`);
      assertEqual(result.one.length, 1);
      assertEqual(result.one[0], result.lastFull);
      assertEqual(result.zero, 0);
      assertEqual(result.many, 2);
      assertEqual(result.none.ok, true);
      assertEqual(result.nullish.ok, true);
      assertEqual(result.string.error.code, "E_BAD_ARGS");
      assertEqual(result.fraction.error.code, "E_BAD_ARGS");
      assertEqual(result.negative.error.code, "E_OUT_OF_RANGE");
      assertEqual(result.unknown.error.code, "E_BAD_ARGS");
    });

    await run("a no-op setter does not grow the recorded take", async () => {
      const before = await changeCount();
      const result = await browser.evaluate(`(() => {
        const lane = window.bitwave.getState().lane;
        const result = window.bitwave.setState({ lane });
        return { ok: result.ok, recording: result.state.recording, changes: window.__bitwaveVerify.changes };
      })()`);
      assertEqual(result.ok, true);
      assertEqual(result.recording.rows, 2);
      assertEqual(result.changes, before);
    });

    await run("record(false) freezes the take and the record UI reflects it", async () => {
      const result = await browser.evaluate(`(() => {
        const result = window.bitwave.record(false);
        const button = document.getElementById("recordBtn");
        const count = document.getElementById("recordCount");
        return {
          ok: result.ok,
          recording: result.state.recording,
          pressed: button && button.getAttribute("aria-pressed"),
          count: count && count.textContent.trim(),
          exportDisabled: document.getElementById("exportLogBtn")?.disabled,
        };
      })()`);
      assertEqual(result.ok, true);
      assertEqual(result.recording, { on: false, rows: 2 });
      assertEqual(result.pressed, "false");
      assertEqual(result.count, "2 rows");
      assertEqual(result.exportDisabled, false);
      const stepped = await browser.evaluate(`(() => {
        const result = window.bitwave.stepDataset(1);
        return { ok: result.ok, recording: result.state.recording, log: window.bitwave.getLog().rows.length };
      })()`);
      assertEqual(stepped.ok, true);
      assertEqual(stepped.recording, { on: false, rows: 2 });
      assertEqual(stepped.log, 2);
      const before = await changeCount();
      const again = await browser.evaluate(`window.bitwave.record(false)`);
      assertEqual(again.ok, true);
      assertEqual(await changeCount(), before);
    });

    await run("re-arming record starts a fresh take", async () => {
      const result = await browser.evaluate(`(() => {
        const result = window.bitwave.record(true);
        return { ok: result.ok, recording: result.state.recording, log: window.bitwave.getLog().rows.length };
      })()`);
      assertEqual(result.ok, true);
      assertEqual(result.recording, { on: true, rows: 0 });
      assertEqual(result.log, 0);
      await browser.evaluate("window.bitwave.record(false)");
    });

    /* ── deeplink: schema 4, expression sources, real reload ────────────── */

    await run("a #bw= deeplink carries schema-4 expression sources and reloads twice", async () => {
      await browser.navigate(artifactUrl);
      await browser.evaluate("window.bitwave.reset()");
      await browser.evaluate("window.bitwave.setState({ lane: 2, width: 16 })");
      const expression = await browser.evaluate(
        `window.bitwave.setExpression("D", "C + 1")`,
      );
      assertEqual(expression.ok, true);
      const beforeState = stateBody(await liveState());
      const link = await browser.evaluate("window.bitwave.getDeeplink()");
      assert(link.startsWith(artifactUrl + "#bw="), `getDeeplink() is not the canonical app link: ${link}`);

      /* Independent decode: the fragment must be a schema-4 doc with the expression. */
      const doc = parseShareHash(new URL(link).hash);
      assert(doc !== null, "fragment did not decode");
      assertEqual(doc.schema, PROJECT_SCHEMA);
      assertEqual(doc.lanes["2"].expressions, { b: "C + 1" });
      const engine = deserializeProject(doc);
      assertEqual(engine.N, 16);
      assertEqual(engine.view.lane, "2");
      assertEqual(engine.extras.expressions["2"].b, "C + 1");
      /* Recording is a transient session artifact: never in the document. */
      assertEqual(doc.recording, undefined);

      /* Real reloads with autosave cleared: only the link can supply the state. */
      await browser.evaluate("localStorage.clear()");
      await browser.reload(link);
      const first = stateBody(await liveState());
      await browser.evaluate("localStorage.clear()");
      await browser.reload(link);
      const second = stateBody(await liveState());
      assertEqual(first, beforeState);
      assertEqual(second, first);
    });

    await run("the help panel agent tab opens and reports an active bridge", async () => {
      await browser.navigate(artifactUrl);
      await browser.evaluate(`(() => {
        document.getElementById("helpBtn").click();
        document.querySelector('[data-agent-tab="agent"]').click();
        return true;
      })()`);
      await sleep(200);
      const panel = await browser.evaluate(`(() => {
        const tab = document.querySelector('[data-agent-tab="agent"]');
        const status = document.querySelector('[data-agent-status]');
        const body = document.querySelector('[data-agent-panel="agent"]');
        return {
          statusAttribute: status ? status.getAttribute("data-agent-status") : null,
          statusText: status ? status.textContent.trim() : null,
          panelVisible: body ? !body.hidden : false,
          overflow: document.documentElement.scrollWidth <= window.innerWidth,
        };
      })()`);
      assertEqual(panel.statusAttribute, "bridge-active");
      assertEqual(panel.statusText, "bridge active");
      assertEqual(panel.panelVisible, true);
      assert(panel.overflow, "agent tab introduced horizontal overflow");
      await browser.evaluate("document.getElementById('helpClose').click()");
    });

    await run("no horizontal overflow at 360/720/1440", async () => {
      for (const width of [360, 720, 1440]) {
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(150);
        const metrics = await browser.evaluate(`({
          inner: window.innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        })`);
        assert(
          metrics.document <= metrics.inner,
          `documentElement overflows at ${width}px (${metrics.document} > ${metrics.inner})`,
        );
        assert(metrics.body <= metrics.inner, `body overflows at ${width}px (${metrics.body} > ${metrics.inner})`);
      }
      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
    });

    await run("subscribe fires once immediately, then only on genuine changes", async () => {
      const report = await browser.evaluate(`(() => {
        window.bitwave.setLane(1);            // normalise the focus lane with no subscriber attached
        const seen = [];
        const off = window.bitwave.subscribe((state) => seen.push(state.lane));
        const immediate = seen.length;
        window.bitwave.setLane(1);
        window.bitwave.setLane(1);
        const afterNoop = seen.length;
        window.bitwave.setLane(3);
        const afterChange = seen.length;
        off();
        off();
        window.bitwave.setLane(2);
        return { immediate, afterNoop, afterChange, afterUnsubscribe: seen.length };
      })()`);
      assertEqual(report.immediate, 1);
      assertEqual(report.afterNoop, 1);
      assertEqual(report.afterChange, 2);
      assertEqual(report.afterUnsubscribe, 2);
    });

    await run("the page logged no console errors", async () => {
      const errors = browser.errorEvents();
      assert(
        errors.length === 0,
        `${errors.length} console error(s): ${errors.map((error) => `${error.kind}: ${error.text}`).join(" | ")}`,
      );
    });
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
  } finally {
    await browser.close();
  }

  console.log("BitWave agent browser verification (toolset 1.2.0 / schema 4)");
  console.log(`  artifact: ${artifactPath} (${existsSync(artifactPath) ? readFileSync(artifactPath).length : 0} bytes)`);
  console.log(`  browser:  ${chromePath}`);
  console.log(
    `  surface:  window.bitwave, #bitwave-state, ${TOOLS.length} tools, schema ${SCHEMA_VERSION}, toolset ${TOOLSET_VERSION}, project schema ${PROJECT_SCHEMA}`,
  );
  console.log("");
  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS  ${result.name}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${result.name}`);
      console.log(`      ${result.detail}`);
    }
  }
  if (fatal) {
    failed += 1;
    console.log(`FAIL  browser session`);
    console.log(`      ${fatal}`);
  }
  const total = results.length + (fatal ? 1 : 0);
  console.log("");
  console.log(`${total - failed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`FAIL unhandled: ${error instanceof Error ? error.stack : error}`);
    process.exitCode = 1;
  });
