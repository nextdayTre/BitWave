#!/usr/bin/env node
/**
 * BitWave hosted/PWA check — proves the installable distribution actually works.
 *
 * Zero-dependency: a Node http server serves `dist/hosted/`, and a headless
 * Chromium is driven over the DevTools Protocol (Node's built-in WebSocket).
 *
 * What it proves (PLAN F6 / DESIGN §11):
 *   - the hosted page carries a valid manifest and every declared icon exists;
 *   - a service worker registers, activates and controls the page;
 *   - the app shell is in the cache under a hash-derived cache name;
 *   - with the network emulated offline, a reload still boots the instrument
 *     (state surface + golden register value) with no console errors;
 *   - the committed single-file `bitwave-v2.html` stayed untouched and free of
 *     manifest/service-worker references (the artifact promise).
 *
 * Run: npm run check:pwa   (after `npm run build:pwa`)
 * Chromium is auto-detected, or set BITWAVE_CHROME=/path/to/chrome.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOSTED = resolve(ROOT, "dist/hosted");
const ARTIFACT = resolve(ROOT, "bitwave-v2.html");
const GOLDEN = "8ADEFEDA85210125";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
};

const headed = process.argv.includes("--headed");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ───────────────────────────────────────────────── chromium detection ── */

function findChromium() {
  if (process.env.BITWAVE_CHROME && existsSync(process.env.BITWAVE_CHROME)) {
    return process.env.BITWAVE_CHROME;
  }
  const home = homedir();
  const programFiles = process.env.PROGRAMFILES || "C:/Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA;

  const caches = [
    localAppData && join(localAppData, "ms-playwright"),
    home && join(home, "AppData/Local/ms-playwright"),
    home && join(home, ".cache/ms-playwright"),
    home && join(home, "Library/Caches/ms-playwright"),
  ].filter(Boolean);
  const layouts = [
    "chrome-win64/chrome.exe",
    "chrome-win/chrome.exe",
    "chrome-linux/chrome",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    for (const version of readdirSync(cache).filter((name) => name.startsWith("chromium-")).sort().reverse()) {
      for (const layout of layouts) {
        const candidate = join(cache, version, layout);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  const fixed = [
    join(programFiles, "Google/Chrome/Application/chrome.exe"),
    join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
    localAppData && join(localAppData, "Google/Chrome/Application/chrome.exe"),
    join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
    join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const candidate of fixed) if (existsSync(candidate)) return candidate;
  return null;
}

async function launchChromium(executable) {
  const profile = mkdtempSync(join(tmpdir(), "bitwave-pwa-"));
  const port = 9900 + Math.floor(Math.random() * 400);
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1280,900",
    "about:blank",
  ];
  if (!headed) args.unshift("--headless=new");

  const proc = spawn(executable, args, { stdio: "ignore", windowsHide: true });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`${endpoint}/json/list`)).json();
      const page = list.find((target) => target.type === "page");
      if (page) return { proc, profile, page };
    } catch {
      /* not listening yet */
    }
    if (proc.exitCode !== null) throw new Error(`Chromium exited early (code ${proc.exitCode})`);
    await sleep(100);
  }
  proc.kill();
  throw new Error("Chromium did not expose a DevTools target within 15 s");
}

/* ─────────────────────────────────────────────────────────── CDP ── */

class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((done, fail) => {
      socket.onopen = done;
      socket.onerror = () => fail(new Error("CDP WebSocket failed to open"));
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject: fail } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) fail(new Error(`${message.error.message} (${message.error.code})`));
        else done(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      }
    };
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  send(method, params = {}) {
    return new Promise((done, fail) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve: done, reject: fail });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

/* ─────────────────────────────────────────────────────── fixture server ── */

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const file = normalize(join(HOSTED, pathname));
    if (!file.startsWith(HOSTED) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(readFileSync(file));
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      done({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

/* ─────────────────────────────────────────────────────────── harness ── */

const consoleErrors = [];
const results = [];
let cdp;
let browser;
let server;

async function evaluate(expression, awaitPromise = true) {
  const reply = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (reply.exceptionDetails) {
    const detail = reply.exceptionDetails.exception?.description || reply.exceptionDetails.text;
    throw new Error(`page exception: ${String(detail).split("\n")[0]}`);
  }
  return reply.result?.value;
}

async function waitFor(expression, label, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await evaluate(expression); } catch (error) { last = error.message; }
    if (last) return last;
    await sleep(60);
  }
  throw new Error(`timed out waiting for ${label} (last: ${String(last)})`);
}

async function runCheck(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || "" });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

async function main() {
  for (const file of ["index.html", "manifest.webmanifest", "sw.js", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"]) {
    assert(existsSync(join(HOSTED, file)), `missing dist/hosted/${file} — run \`npm run build:pwa\` first`);
  }

  const executable = findChromium();
  assert(executable, "no Chromium found; set BITWAVE_CHROME or install Chrome/Edge");
  const fixture = await startServer();
  server = fixture.server;
  const { origin } = fixture;
  browser = await launchChromium(executable);
  cdp = await Cdp.connect(browser.page.webSocketDebuggerUrl);

  console.log(`BitWave PWA check — ${origin}`);
  console.log(`  chromium: ${executable}`);
  console.log(`  root:     ${HOSTED}`);
  console.log("");

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  cdp.on("Runtime.exceptionThrown", (params) => {
    const text = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "unknown";
    consoleErrors.push(`exception: ${String(text).split("\n").slice(0, 2).join(" | ")}`);
  });
  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") consoleErrors.push(params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  await cdp.send("Page.navigate", { url: origin + "/" });
  await waitFor(`document.readyState === 'complete'`, "document ready");
  await waitFor(`document.getElementById('hex') && document.getElementById('hex').textContent.trim().length >= 2`, "instrument boot");
  await sleep(400);

  await runCheck("hosted · the page boots the instrument over http", async () => {
    const boot = JSON.parse(await evaluate(`JSON.stringify({
      hex: document.getElementById('hex').textContent.trim(),
      surface: typeof window.BitWave,
      manifest: !!document.querySelector('link[rel="manifest"]'),
      title: document.title
    })`));
    assert(boot.hex === GOLDEN, `boot register: ${boot.hex}`);
    assert(boot.surface === "object", "window.BitWave state surface is missing");
    assert(boot.manifest === true, "hosted page has no manifest link");
    assert(/BitWave/i.test(boot.title), `title: ${boot.title}`);
    return `boot ${boot.hex} · BitWave surface · manifest link present`;
  });

  await runCheck("manifest · valid, installable metadata and all icons exist", async () => {
    const manifest = JSON.parse(await evaluate(`fetch(document.querySelector('link[rel="manifest"]').href)
      .then((r) => r.json()).then((m) => JSON.stringify(m))`));
    assert(manifest.name && manifest.short_name, "manifest name/short_name missing");
    assert(manifest.display === "standalone", `display: ${manifest.display}`);
    assert(manifest.start_url === "./" && manifest.scope === "./", `start/scope: ${manifest.start_url}/${manifest.scope}`);
    assert(Array.isArray(manifest.icons) && manifest.icons.length >= 3, "manifest needs at least three icons");
    const sizes = manifest.icons.map((icon) => icon.sizes);
    assert(sizes.includes("192x192") && sizes.includes("512x512"), `icon sizes: ${sizes.join(",")}`);
    assert(manifest.icons.some((icon) => icon.purpose === "maskable"), "no maskable icon");
    for (const icon of manifest.icons) {
      const ok = await evaluate(`fetch(${JSON.stringify(icon.src)}).then((r) => r.ok)`);
      assert(ok === true, `icon does not load: ${icon.src}`);
    }
    return `${manifest.icons.length} icons · standalone · start ${manifest.start_url} · maskable ✓`;
  });

  await runCheck("service worker · registers, activates and controls the page", async () => {
    const worker = JSON.parse(await evaluate(`navigator.serviceWorker.ready.then((registration) => JSON.stringify({
      scope: registration.scope,
      state: registration.active && registration.active.state
    }))`));
    assert(worker.state === "activated", `worker state: ${JSON.stringify(worker)}`);
    assert(worker.scope.endsWith("/"), `scope: ${worker.scope}`);
    const controlled = await waitFor(`!!navigator.serviceWorker.controller`, "service-worker controller", 8000);
    assert(controlled === true, "page is not controlled by the service worker");
    return `activated · scope ${worker.scope} · controller present`;
  });

  await runCheck("cache · app shell stored under a hash-versioned cache", async () => {
    const cache = JSON.parse(await evaluate(`(async () => {
      const keys = await caches.keys();
      const name = keys.find((key) => /^bitwave-[0-9a-f]{10}$/.test(key));
      if (!name) return JSON.stringify({ name: null, keys });
      const cache = await caches.open(name);
      const assets = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-512.png"];
      const present = {};
      for (const asset of assets) present[asset] = !!(await cache.match(asset));
      return JSON.stringify({ name, keys, present });
    })()`));
    assert(cache.name, `no hash-versioned cache; keys: ${(cache.keys || []).join(",")}`);
    assert(Object.values(cache.present).every(Boolean), `missing cached assets: ${JSON.stringify(cache.present)}`);
    return `${cache.name} · index + manifest + icon cached`;
  });

  await runCheck("offline · a reload with the server down still boots from the cache", async () => {
    /* Stronger than network emulation: stop the origin server. If the app still
       boots, the service worker cache is doing the work. */
    assert(server, "fixture server already stopped");
    await new Promise((done) => server.close(done));
    server = null;

    try {
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitFor(`document.readyState === 'complete'`, "offline document ready", 10000);
      await waitFor(`document.getElementById('hex') && document.getElementById('hex').textContent.trim().length >= 2`, "offline instrument boot", 10000);
      const offline = JSON.parse(await evaluate(`JSON.stringify({
        hex: document.getElementById('hex').textContent.trim(),
        controlled: !!navigator.serviceWorker.controller
      })`));
      assert(offline.hex === GOLDEN, `offline register: ${offline.hex}`);
      assert(offline.controlled === true, "offline page lost its service worker controller");
      assert(consoleErrors.length === 0, `console errors while offline: ${consoleErrors.slice(0, 3).join(" | ")}`);
      return `server stopped · reload boots ${offline.hex} · controlled · 0 console errors`;
    } finally {
      /* nothing to restore: the remaining checks read files from disk */
    }
  });

  await runCheck("artifact · the committed single file stayed clean", async () => {
    const artifact = readFileSync(ARTIFACT, "utf8");
    assert(!/rel="manifest"/.test(artifact), "bitwave-v2.html gained a manifest link");
    assert(!/serviceWorker/.test(artifact), "bitwave-v2.html gained service-worker registration");
    assert(!/icons\/icon/.test(artifact), "bitwave-v2.html references external icons");
    assert(/id="wave"/.test(artifact) && /BitWave/.test(artifact), "artifact does not contain the instrument");
    return "single-file artifact has no manifest/icons/SW references";
  });

  await runCheck("hosted build · only the PWA shell is external", async () => {
    const html = readFileSync(join(HOSTED, "index.html"), "utf8");
    const refs = new Set();
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) refs.add(match[1]);
    const unexpected = [...refs].filter((ref) =>
      !/^\.\/(manifest\.webmanifest|icons\/favicon-32\.png|icons\/icon-192\.png)$/.test(ref));
    assert(unexpected.length === 0, `unexpected external refs: ${unexpected.join(", ")}`);
    assert(/"serviceWorker"/.test(html) && /register\("\.\/sw\.js"\)/.test(html), "hosted page does not register the worker");
    return "manifest + 3 icon/registration refs only";
  });

  /* ── report ── */
  console.log("");
  const width = Math.max(...results.map((result) => result.name.length));
  for (const result of results) {
    console.log(`${result.ok ? "✔" : "✘"} ${result.name.padEnd(width)}  ${result.detail}`);
  }
  const passed = results.filter((result) => result.ok).length;
  console.log("");
  console.log(`${passed} passed, ${results.length - passed} failed — dist/hosted (headless Chromium)`);
  if (passed !== results.length) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`\n✘ PWA check could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (browser?.proc) try { browser.proc.kill(); } catch { /* already gone */ }
  if (browser?.profile) try { rmSync(browser.profile, { recursive: true, force: true }); } catch { /* best effort */ }
  if (server) await new Promise((done) => server.close(done));
}

