#!/usr/bin/env node
/**
 * Independent browser verification for the BitWave agent layer.
 *
 * Drives the built single-file artifact (`bitwave-v2.html`) over `file://` in a
 * fresh-profile headless Chrome/Edge over the DevTools Protocol, then asserts the
 * contract in docs/AGENT-INTERFACE.md. Zero dependencies.
 *
 * Expectations are derived from `src/core` (the tool registry, the envelope, the
 * document codec) — never from the page's own helpers — so this check would catch
 * a page that agrees with itself but not with the contract.
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
import { deserializeProject } from "../src/core/project.ts";
import { parseShareHash } from "../src/core/share.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

function flag(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

const artifactPath = resolve(flag("--artifact", join(ROOT, "bitwave-v2.html")));
const artifactUrl = pathToFileURL(artifactPath).href;

/** The bridge surface the contract promises (docs/AGENT-INTERFACE.md §7). */
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
  "stepDataset",
  "reset",
  "subscribe",
].sort();

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

class Protocol {
  constructor() {
    this.port = null;
    this.child = null;
    this.socket = null;
    this.profile = null;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
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
      this.events.push(message);
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

  async navigate(url, timeoutMs = 20000) {
    await this.send("Page.navigate", { url });
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
        // Let the first render settle (fonts + the install transaction).
        await this.evaluate("document.fonts.ready.then(() => true)");
        await sleep(100);
        return;
      }
      await sleep(100);
    }
    throw new Error(`page never became agent-ready: ${url}`);
  }

  /** Console errors, page exceptions and error-level log entries since start. */
  errorEvents() {
    const errors = [];
    for (const event of this.events) {
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

  try {
    await browser.start(chromePath);
    await browser.navigate(artifactUrl);
    await run("supplied artifact boots and mounts the bridge", async () => {
      assertEqual(await browser.evaluate("typeof window.bitwave"), "object");
      assertEqual(await browser.evaluate("document.body.dataset.agentReady"), "true");
    });

    await run("exactly one bitwave:ready and one bitwave:change on mount", async () => {
      const events = await browser.evaluate("window.__bitwaveVerify");
      assertEqual(events, { ready: 1, changes: 1 });
    });

    await run("bridge identity matches the contract", async () => {
      assertEqual(await browser.evaluate("window.bitwave.schemaVersion"), SCHEMA_VERSION);
      assertEqual(await browser.evaluate("window.bitwave.version"), TOOLSET_VERSION);
      assertEqual(await browser.evaluate("window.bitwave.ready"), true);
      assertEqual(await browser.evaluate("document.querySelector('#bitwave-state').dataset.schemaVersion"), String(SCHEMA_VERSION));
    });

    await run("bridge exposes exactly the contract surface", async () => {
      const keys = await browser.evaluate("Object.keys(window.bitwave).sort()");
      assertEqual(keys, BRIDGE_KEYS);
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
      assertEqual(pageManifest.relatedTools, []);
      assertEqual(pageManifest.tools.length, TOOLS.length);
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
      const before = await browser.evaluate("window.__bitwaveVerify.changes");
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
            responseStateWidth: result.state && result.state.width,
            stateUnchanged: JSON.stringify(after) === before,
            immediateWidth: after.width,
          };
        })()`);
        assertEqual(result.ok, false);
        assert(typeof result.code === "string" && result.code.startsWith("E_"), `expected a closed E_* code, got ${result.code}`);
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
      await browser.evaluate("window.bitwave.setState({ reset: true })");
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

    await run("a #bw= deeplink reload reproduces the state twice", async () => {
      await browser.navigate(artifactUrl);
      await browser.evaluate("window.bitwave.setState({ lane: 2, width: 16 })");
      const link = await browser.evaluate("window.bitwave.getDeeplink()");
      assert(link.startsWith(artifactUrl + "#bw="), `getDeeplink() is not the canonical app link: ${link}`);
      // Independent decode: the fragment must carry the very state we set.
      const doc = parseShareHash(new URL(link).hash);
      assert(doc !== null, "fragment did not decode");
      const engine = deserializeProject(doc);
      assertEqual(engine.N, 16);
      assertEqual(engine.view.lane, "2");

      await browser.navigate(link);
      const first = JSON.parse(await browser.evaluate("document.querySelector('#bitwave-state').textContent"));
      await browser.navigate(link);
      const second = JSON.parse(await browser.evaluate("document.querySelector('#bitwave-state').textContent"));
      assertEqual(first.width, 16);
      assertEqual(first.lane, 2);
      const strip = (state) => {
        const copy = JSON.parse(JSON.stringify(state));
        delete copy.deeplink;
        return copy;
      };
      assertEqual(strip(second), strip(first));
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
          tabSelected: tab ? tab.getAttribute("aria-selected") : null,
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
        assert(metrics.document <= metrics.inner, `documentElement overflows at ${width}px (${metrics.document} > ${metrics.inner})`);
        assert(metrics.body <= metrics.inner, `body overflows at ${width}px (${metrics.body} > ${metrics.inner})`);
      }
      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
    });

    await run("the page logged no console errors", async () => {
      const errors = browser.errorEvents();
      assert(
        errors.length === 0,
        `${errors.length} console error(s): ${errors.map((error) => `${error.kind}: ${error.text}`).join(" | ")}`,
      );
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
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
  } finally {
    await browser.close();
  }

  console.log("BitWave agent browser verification");
  console.log(`  artifact: ${artifactPath} (${existsSync(artifactPath) ? readFileSync(artifactPath).length : 0} bytes)`);
  console.log(`  browser:  ${chromePath}`);
  console.log(`  surface:  window.bitwave, #bitwave-state, ${TOOLS.length} tools, schema ${SCHEMA_VERSION}, toolset ${TOOLSET_VERSION}`);
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
  console.log("");
  console.log(`${results.length - (failed - (fatal ? 1 : 0))} passed, ${failed} failed`);
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
