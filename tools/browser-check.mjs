#!/usr/bin/env node
/**
 * BitWave browser check — zero-dependency headless-Chromium verification.
 *
 * WHY THIS EXISTS
 *   DESIGN.md §11 says the visual contract is measurable, so measure it. PLAN.md
 *   F0 recorded browser-level checks as blocked in the original sandbox; they
 *   are not blocked now. This script drives the shipped single-file artifact
 *   over `file://` through the Chrome DevTools Protocol using only Node's
 *   built-in WebSocket + fetch — no Playwright, no npm dependency.
 *
 * WHAT IT PROVES
 *   - the artifact boots with zero console errors / uncaught exceptions;
 *   - the golden boot value, decimal agreement and 64-bit readout;
 *   - no horizontal overflow and no clipped controls at 360 / 420 / 720 / 1440;
 *   - canvas width == viewport, `--pad` and compact mode follow DESIGN §5/§9;
 *   - the bit strip's gap / nibble width / x(j) follow the §5 formula;
 *   - the frame navigator opens, lists three frames and its eyes toggle;
 *   - 3-D shows A/B/Z, Z = A xor B and truth counts 23/11/9/21;
 *   - D47: the top-bar VIEW/3D control replaces the bottom VIEW row (360/720/1440),
 *     each pane head's hinge is per-lane/independent in split, each pane head's
 *     `copy to…` menu names and excludes its own source lane, and the always-present
 *     truth disclosure toggles in place without moving the hex readouts;
 *   - CSV import types a hex payload, binds lane 1 A and the §11 op vectors
 *     (ROL 4, NOT, BSWAP) hold on the live artifact;
 *   - optionally, deterministic state screenshots (same state → same bytes).
 *
 * RUN
 *   npm run check:browser
 *   node tools/browser-check.mjs --artifact bitwave-v2.html --shots .shots
 *   node tools/browser-check.mjs --headed          # watch it drive
 *
 * CHROMIUM
 *   Auto-detected from Playwright's browser cache, common Chrome/Edge install
 *   paths, or `BITWAVE_CHROME=/path/to/chrome`. Close other headless instances
 *   only if a launch hangs; each run uses a fresh temporary profile.
 *
 * EXIT
 *   0 all checks pass · 1 a check failed or no Chromium was found.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const USAGE = `BitWave browser check — zero-dependency headless Chromium.

  node tools/browser-check.mjs [options]

Options:
  --artifact <file>   HTML artifact to verify (default: bitwave-v2.html)
  --compare <file>    also pixel-compare the artifact against a reference file
  --shots <dir>       also write deterministic state screenshots to <dir>
  --headed            run a visible Chromium window (debugging)
  --help, -h          show this help

Chromium is auto-detected, or set BITWAVE_CHROME to an executable path.`;

/* ─────────────────────────────────────────────────────────── arguments ── */

function parseArgs(argv) {
  const opts = { artifact: 'bitwave-v2.html', compare: null, shots: null, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--artifact') opts.artifact = argv[++i];
    else if (arg === '--compare') opts.compare = argv[++i];
    else if (arg === '--shots') opts.shots = argv[++i];
    else if (arg === '--headed') opts.headed = true;
    else if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0); }
    else throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
  }
  if (!opts.artifact || !existsSync(resolve(ROOT, opts.artifact))) {
    throw new Error(`artifact not found: ${opts.artifact}`);
  }
  if (opts.compare && !existsSync(resolve(ROOT, opts.compare))) {
    throw new Error(`comparison artifact not found: ${opts.compare}`);
  }
  return opts;
}

/* ────────────────────────────────────────────────────────── chromium ── */

function findChromium() {
  const fromEnv = process.env.BITWAVE_CHROME;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || 'C:/Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)';

  const caches = [
    localAppData && join(localAppData, 'ms-playwright'),
    home && join(home, 'AppData/Local/ms-playwright'),
    home && join(home, '.cache/ms-playwright'),
    home && join(home, 'Library/Caches/ms-playwright'),
  ].filter(Boolean);

  const layouts = [
    'chrome-win64/chrome.exe',
    'chrome-win/chrome.exe',
    'chrome-linux/chrome',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
  ];

  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    const versions = readdirSync(cache)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const version of versions) {
      for (const layout of layouts) {
        const candidate = join(cache, version, layout);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  const fixed = [
    join(programFiles, 'Google/Chrome/Application/chrome.exe'),
    join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
    localAppData && join(localAppData, 'Google/Chrome/Application/chrome.exe'),
    join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
    join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const candidate of fixed) if (existsSync(candidate)) return candidate;
  return null;
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function launchChromium(executable, headed) {
  const profile = mkdtempSync(join(tmpdir(), 'bitwave-check-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    /* Glyph rasterization stability: LCD subpixel antialiasing can change by a
       few edge pixels between two runs of the SAME artifact (observed on the
       3d-focus-z1 parity state). Grayscale AA makes --compare deterministic. */
    '--disable-lcd-text',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
    'about:blank',
  ];
  if (!headed) args.unshift('--headless=new');

  const proc = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`${endpoint}/json/list`)).json();
      const page = list.find((target) => target.type === 'page');
      if (page) return { proc, profile, endpoint, page };
    } catch {
      /* not listening yet */
    }
    if (proc.exitCode !== null) throw new Error(`Chromium exited early (code ${proc.exitCode})`);
    await sleep(100);
  }
  proc.kill();
  throw new Error('Chromium did not expose a DevTools target within 15 s');
}

/* ─────────────────────────────────────────────────────────────── CDP ── */

class Cdp {
  static async connect(url) {
    if (typeof WebSocket !== 'function') {
      throw new Error('this Node build has no global WebSocket (need Node >= 22.4)');
    }
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.onopen = resolveOpen;
      socket.onerror = () => rejectOpen(new Error('CDP WebSocket failed to open'));
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
        const { resolve: resolveCall, reject: rejectCall } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) rejectCall(new Error(`${message.error.message} (${message.error.code})`));
        else resolveCall(message.result);
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
    return new Promise((resolveCall, rejectCall) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

/* ────────────────────────────────────────────────────────── harness ── */

const opts = parseArgs(process.argv.slice(2));
const artifactUrl = pathToFileURL(resolve(ROOT, opts.artifact)).href;
const consoleErrors = [];
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closeTo(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ±${tolerance}, measured ${actual}`
  );
}

function popcount(hex) {
  let count = 0;
  for (const digit of hex) count += (parseInt(digit, 16).toString(2).match(/1/g) || []).length;
  return count;
}

let cdp;
let artifactName;

async function evaluate(expression) {
  const reply = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (reply.exceptionDetails) {
    const detail = reply.exceptionDetails.exception?.description || reply.exceptionDetails.text;
    throw new Error(`page exception: ${detail}`);
  }
  return reply.result?.value;
}

async function waitFor(expression, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(expression);
    } catch (error) {
      last = error.message;
    }
    if (last) return last;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label} (last: ${String(last).slice(0, 160)})`);
}

let loadCounter = 0;

function withQuery(url, parts) {
  const query = parts.filter(Boolean).join("&");
  if (!query) return url;
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}${query}${hash}`;
}

async function loadPage(url, { width = 1440, height = 900, settle = 300, query = "" } = {}) {
  /* A unique query makes every load a real document load even when only the
     fragment differs (the share link lives in the fragment). */
  const target = withQuery(url, [query, `chk=${++loadCounter}`]);
  consoleErrors.length = 0;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: target });
  await waitFor(`document.readyState === 'complete'`, 'document ready');
  await waitFor(
    `['hex', 'sizeOut', 'wave', 'nibs'].every((id) => document.getElementById(id))`,
    'instrument elements'
  );
  await waitFor(
    `document.getElementById('hex').textContent.trim().length >= 2`,
    'boot readout'
  );
  await sleep(settle);
}

async function loadApp(options = {}) {
  return loadPage(artifactUrl, options);
}

async function click(selector) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('missing element: ' + ${JSON.stringify(selector)});
    el.click();
    return true;
  })()`);
}

/* D42: the frames view replaced the pop-out navigator panel. */
async function openFramesView() {
  if (await evaluate(`document.getElementById('framesView').hidden`)) {
    await click('#framesBtn');
  }
  await waitFor(`!document.getElementById('framesView').hidden`, 'frames view');
  await sleep(120);
}

/* `--compare` also drives the reference artifact, which may predate the D43
   lane-key rename (cards still carry A/B/C in `data-lane`). Prefer the lane
   key and fall back to the legacy slot letter for three-lane references. */
const LEGACY_SLOT = { "1": "A", "2": "B", "3": "C" };
async function pickFrameCard(lane, frame) {
  const modern = `#framesGrid [data-lane="${lane}"][data-frame="${frame}"] .frame-card`;
  const hasModern = await evaluate(`Boolean(document.querySelector(${JSON.stringify(modern)}))`);
  const legacyLane = LEGACY_SLOT[lane];
  const selector =
    hasModern || !legacyLane
      ? modern
      : `#framesGrid [data-lane="${legacyLane}"][data-frame="${frame}"] .frame-card`;
  await click(selector);
  await sleep(180);
}

/* Synthetic keydown on the focused element — exercises the strip's own
   key handler without browser traversal (which Tab needs, see pressNative). */
async function keydown(key) {
  return JSON.parse(await evaluate(`JSON.stringify((() => {
    const el = document.activeElement || document.body;
    const event = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      activeJ: document.activeElement?.closest?.('.nib')?.dataset?.j ?? null,
      activeTag: document.activeElement ? document.activeElement.tagName : null
    };
  })())`));
}

/* Native key event — required for Tab focus traversal. */
async function pressNative(key, code, keyCode) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(80);
}

/* Native Enter on a focused button: activation needs keyDown with text, not
   rawKeyDown (used by the D41 readout-lens keyboard path). */
async function pressActivate() {
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r', unmodifiedText: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await sleep(80);
}

/* Native Alt+digit — the D46 lane shortcut needs the modifier to survive. */
async function pressAltDigit(digit) {
  const key = {
    key: String(digit),
    code: `Digit${digit}`,
    windowsVirtualKeyCode: 48 + digit,
    nativeVirtualKeyCode: 48 + digit,
    modifiers: 1, // Alt
  };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await sleep(120);
}

/** Read the visible pane lane select's live options. */
async function laneSelectOptions() {
  return JSON.parse(await evaluate(`JSON.stringify((() => {
    const select = document.querySelector('#stageBar .pane-head:not([hidden]) .lane-select');
    return select ? [...select.options].map((option) => ({ value: option.value, label: option.textContent.trim() })) : null;
  })())`));
}

async function readInstrument() {
  return JSON.parse(await evaluate(`JSON.stringify({
    hex: document.getElementById('hex').textContent.trim(),
    dec: document.getElementById('dec').textContent.trim(),
    size: document.getElementById('sizeOut').textContent.trim(),
    truth: [...document.querySelectorAll('#truth .ct')].map((el) => el.textContent.trim()),
    hexA: document.getElementById('hexA').textContent.trim(),
    hexB: document.getElementById('hexB').textContent.trim(),
    hexZ: document.getElementById('hexZ').textContent.trim()
  })`));
}

async function readLayout() {
  return JSON.parse(await evaluate(`JSON.stringify((() => {
    const strip = document.querySelector('.strip');
    const nibs = [...document.querySelectorAll('.nib')];
    const rects = nibs.map((nib) => {
      const r = nib.getBoundingClientRect();
      return { left: r.left, width: r.width, center: r.left + r.width / 2 };
    });
    const gapFromRect = rects.length > 1 ? rects[1].left - (rects[0].left + rects[0].width) : NaN;
    const controls = [...document.querySelectorAll('button, select, input')];
    const clipped = controls.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5);
    }).map((el) => (el.id || el.textContent || el.tagName).trim().slice(0, 18));
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      overflow: document.body.scrollWidth - document.body.clientWidth,
      canvasWidth: document.getElementById('wave').width,
      canvasClientWidth: document.getElementById('wave').clientWidth,
      pad: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pad')),
      compact: strip.classList.contains('compact'),
      nibbles: nibs.length,
      nibbleWidth: rects[0] ? rects[0].width : NaN,
      nibbleGap: gapFromRect,
      firstLeft: rects[0] ? rects[0].left : NaN,
      lastRight: rects.length ? rects[rects.length - 1].left + rects[rects.length - 1].width : NaN,
      widths: rects.map((r) => r.width),
      clipped: clipped.slice(0, 6)
    };
  })())`));
}

function checkStripGeometry(layout, width, height) {
  const plotWidth = layout.viewportWidth - 2 * layout.pad;
  const expectedGap = Math.min(12, Math.max(1.5, (plotWidth / layout.nibbles) * 0.16));
  const expectedWidth = (plotWidth - (layout.nibbles - 1) * expectedGap) / layout.nibbles;
  const expectedCompact = plotWidth / layout.nibbles < 46;

  assert(layout.nibbles === 16, `expected 16 nibbles, found ${layout.nibbles}`);
  closeTo(layout.firstLeft, layout.pad, 0.6, 'strip left edge');
  closeTo(layout.lastRight, layout.viewportWidth - layout.pad, 0.6, 'strip right edge');
  closeTo(layout.nibbleGap, expectedGap, 0.6, 'nibble gap');
  closeTo(layout.nibbleWidth, expectedWidth, 0.6, 'nibble width');
  for (const nibbleWidth of layout.widths) {
    closeTo(nibbleWidth, layout.nibbleWidth, 0.6, 'nibble width consistency');
  }
  assert(
    layout.compact === expectedCompact,
    `compact mode: expected ${expectedCompact}, got ${layout.compact}`
  );

  const detail = `gap ${layout.nibbleGap.toFixed(2)} / ${expectedGap.toFixed(2)} px · ` +
    `nibble ${layout.nibbleWidth.toFixed(2)} / ${expectedWidth.toFixed(2)} px · ` +
    `pad ${layout.pad} px · ${layout.compact ? 'compact' : 'full'} strip`;
  return detail;
}

async function capture() {
  const reply = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  return Buffer.from(reply.data, 'base64');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

async function runCheck(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

/* ───────────────────────────────────────────────────────────── main ── */

const executable = findChromium();
if (!executable) {
  console.error(
    '✘ no Chromium found.\n' +
    '  Set BITWAVE_CHROME=/path/to/chrome, or install Chrome/Edge, or run\n' +
    '  `npx playwright install chromium` once and let the Playwright cache be detected.'
  );
  process.exit(1);
}

let browser;
try {
  browser = await launchChromium(executable, opts.headed);
  cdp = await Cdp.connect(browser.page.webSocketDebuggerUrl);
  artifactName = basename(resolve(ROOT, opts.artifact));

  console.log(`BitWave browser check — ${artifactName}`);
  console.log(`  chromium: ${executable}`);
  console.log(`  url:      ${artifactUrl}`);
  console.log('');

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  /* Autosave (F5) persists state between loads on the same origin. Clear it at
     the start of every document unless the URL carries `keep`, so each check
     starts from the boot instrument and the persistence checks can opt in. */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { if (!location.search.includes("keep")) localStorage.clear(); } catch (e) {}`,
  });

  cdp.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails;
    const text = details?.exception?.description || details?.text || 'unknown exception';
    consoleErrors.push(`exception: ${String(text).split('\n').slice(0, 3).join(' | ')}`);
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return;
    const text = params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
    consoleErrors.push(`console.error: ${String(text).split('\n')[0]}`);
  });
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') consoleErrors.push(`log: ${params.entry.text}`);
  });

  /* 1. boot ------------------------------------------------------------- */
  await runCheck('boot · artifact loads with no console errors (2 s idle)', async () => {
    await loadApp({ settle: 2000 });
    assert(
      consoleErrors.length === 0,
      `console errors: ${consoleErrors.slice(0, 3).join(' | ')}`
    );
    return '0 errors, 0 exceptions';
  });

  await runCheck('boot · golden A value and decimal agree', async () => {
    await loadApp();
    const readout = await readInstrument();
    assert(/^[0-9A-F]{16}$/.test(readout.hex), `hex readout is not 64-bit hex: ${readout.hex}`);
    assert(readout.hex === '8ADEFEDA85210125', `boot A changed: ${readout.hex}`);
    assert(
      BigInt(`0x${readout.hex}`).toString() === readout.dec,
      `decimal ${readout.dec} does not match hex ${readout.hex}`
    );
    return `A = ${readout.hex} · dec agrees`;
  });

  await runCheck('boot · size readout is 64 bits · 16 nibbles', async () => {
    const readout = await readInstrument();
    assert(
      readout.size === '64 bits · 16 nibbles',
      `size readout: ${JSON.stringify(readout.size)}`
    );
    return readout.size;
  });

  /* 2. responsive + strip geometry ------------------------------------- */
  const layouts = [
    { width: 1440, height: 900, pad: 40 },
    { width: 720, height: 900, pad: 16 },
    { width: 420, height: 800, pad: 16 },
    { width: 360, height: 780, pad: 16 },
  ];

  for (const layout of layouts) {
    await runCheck(`layout · ${layout.width}×${layout.height} · no overflow, §5 strip`, async () => {
      await loadApp({ width: layout.width, height: layout.height });
      const measured = await readLayout();
      assert(
        measured.overflow === 0,
        `horizontal overflow: body.scrollWidth − clientWidth = ${measured.overflow}`
      );
      assert(
        measured.canvasWidth === measured.viewportWidth,
        `canvas.width ${measured.canvasWidth} ≠ viewport ${measured.viewportWidth}`
      );
      assert(
        measured.canvasClientWidth === measured.viewportWidth,
        `canvas.clientWidth ${measured.canvasClientWidth} ≠ viewport ${measured.viewportWidth}`
      );
      closeTo(measured.pad, layout.pad, 0.01, '--pad');
      assert(
        measured.clipped.length === 0,
        `controls outside the viewport: ${measured.clipped.join(', ')}`
      );
      return checkStripGeometry(measured, layout.width, layout.height);
    });
  }

  /* 2b. zoom / reflow — DESIGN §5: page scrolls, stage keeps its floor --- */
  const zooms = [
    { label: '200 %', width: 720, height: 450 },
    { label: '400 %', width: 360, height: 225 },
  ];

  for (const zoom of zooms) {
    await runCheck(`reflow · ${zoom.label} (${zoom.width}×${zoom.height}) · scrolls, stage floor, no clipped controls`, async () => {
      await loadApp({ width: zoom.width, height: zoom.height });
      const measured = JSON.parse(await evaluate(`JSON.stringify((() => {
        const scroller = document.scrollingElement;
        const stage = document.querySelector('.stage');
        const controls = [...document.querySelectorAll('button, select, input')]
          .filter((el) => el.offsetParent !== null && !el.hidden);
        const clipped = controls.filter((el) => {
          const r = el.getBoundingClientRect();
          const top = r.top + window.scrollY;
          return r.width > 0 && (top < -0.5 || top + r.height > scroller.scrollHeight + 0.5);
        }).map((el) => (el.id || el.textContent || el.tagName).trim().slice(0, 18));
        return {
          scrollHeight: scroller.scrollHeight,
          innerHeight: window.innerHeight,
          scrollable: scroller.scrollHeight > window.innerHeight + 1,
          stageHeight: stage.getBoundingClientRect().height,
          bodyOverflowY: getComputedStyle(document.body).overflowY,
          horizontal: document.body.scrollWidth - document.body.clientWidth,
          canvasClientWidth: document.getElementById('wave').clientWidth,
          clipped,
        };
      })())`));
      assert(
        measured.bodyOverflowY === 'visible',
        `body overflow-y is ${measured.bodyOverflowY} — controls clip with no scrollbar`
      );
      assert(
        measured.scrollable,
        `page does not scroll: scrollHeight ${measured.scrollHeight} ≤ viewport ${measured.innerHeight}`
      );
      assert(
        measured.stageHeight >= 220,
        `stage floor broken: ${measured.stageHeight.toFixed(1)}px < 220px`
      );
      assert(measured.horizontal === 0, `horizontal overflow: ${measured.horizontal}`);
      assert(
        measured.canvasClientWidth === zoom.width,
        `canvas width ${measured.canvasClientWidth} ≠ viewport ${zoom.width}`
      );
      assert(
        measured.clipped.length === 0,
        `unreachable controls: ${measured.clipped.join(', ')}`
      );
      return `scroll ${measured.scrollHeight}px > ${measured.innerHeight}px · stage ${measured.stageHeight.toFixed(0)}px`;
    });
  }

  /* 3. frames view (D42) ------------------------------------------------- */
  await runCheck('frames · the frames view shows every frame as an equal card', async () => {
    await loadApp();
    await click('#framesBtn');
    await waitFor(`!document.getElementById('framesView').hidden`, 'frames view');
    const summary = JSON.parse(await evaluate(`JSON.stringify({
      columns: [...document.querySelectorAll('#framesGrid .lane-col:not(.is-add)')].map(
        (col) => [...col.querySelectorAll('.frame-glyph')].map((glyph) => glyph.textContent.trim())
      ),
      lanes: document.querySelectorAll('#framesGrid .lane-btn').length,
      eyes: document.querySelectorAll('#framesGrid .eye-btn').length,
      add: document.querySelectorAll('#framesGrid .lane-col.is-add').length,
      lanesBtn: !document.getElementById('lanesBtn').hidden,
      panesHidden: [...document.querySelectorAll('.pane-head')].every((pane) => pane.hidden),
      canvasHidden: getComputedStyle(document.getElementById('wave')).visibility === 'hidden',
      active: document.querySelectorAll('#framesGrid .frame-card[aria-pressed="true"]').length
    })`));
    assert(
      JSON.stringify(summary.columns) === JSON.stringify([['A', 'B', 'Z1'], ['C', 'D', 'Z2'], ['E', 'F', 'Z3']]),
      `frame columns: ${JSON.stringify(summary.columns)}`
    );
    assert(summary.lanes === 3, `lane heads: ${summary.lanes}`);
    assert(summary.eyes === 9, `eye buttons: ${summary.eyes}`);
    assert(summary.add === 1, `add tiles: ${summary.add}`);
    assert(summary.lanesBtn === true, 'the Lanes button is not shown');
    assert(summary.panesHidden === true, 'stage-bar panes are still visible');
    assert(summary.canvasHidden === true, 'the canvas is not hidden behind the frames view');
    assert(summary.active === 1, `active cards: ${summary.active}`);

    /* `Lanes` and Esc both leave the view without choosing a frame. */
    await click('#lanesBtn');
    await sleep(150);
    assert(
      (await evaluate(`document.getElementById('framesView').hidden`)) === true,
      'Lanes did not return to the lanes view'
    );
    await openFramesView();
    await evaluate(
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`
    );
    await sleep(150);
    assert(
      (await evaluate(`document.getElementById('framesView').hidden`)) === true,
      'Esc did not return to the lanes view'
    );

    /* D46: the `+` tile is the live add-lane control. Clicking it creates a
       blank lane at the lowest free key and focuses it. */
    await openFramesView();
    const beforeAdd = JSON.parse(await evaluate(`JSON.stringify({
      columns: document.querySelectorAll('#framesGrid .lane-col:not(.is-add)').length,
      dup: document.querySelectorAll('#framesGrid [data-act="dup"]').length,
      del: document.querySelectorAll('#framesGrid [data-act="del"]').length,
      addDisabled: document.querySelector('#framesGrid .frame-add').getAttribute('aria-disabled'),
      hint: document.querySelector('#framesGrid .frame-add-hint').textContent.trim()
    })`));
    assert(beforeAdd.columns === 3, `initial lane columns: ${beforeAdd.columns}`);
    assert(beforeAdd.dup === 3 && beforeAdd.del === 3, `per-lane dup/del controls: ${beforeAdd.dup}/${beforeAdd.del}`);
    assert(beforeAdd.addDisabled === 'false', 'the add tile is aria-disabled below the cap');
    assert(beforeAdd.hint === 'add lane', `add hint: ${JSON.stringify(beforeAdd.hint)}`);
    await click('#framesGrid .frame-add');
    await sleep(250);
    const afterAdd = JSON.parse(await evaluate(`JSON.stringify({
      columns: document.querySelectorAll('#framesGrid .lane-col:not(.is-add)').length,
      names: [...document.querySelectorAll('#framesGrid [data-lane="4"] .frame-glyph')].map((g) => g.textContent.trim()),
      lane: window.BitWave.state().lane,
      note: document.getElementById('framesNote').textContent.trim(),
      focusedLane: document.activeElement?.closest?.('.lane-col')?.dataset.lane ?? null
    })`));
    assert(afterAdd.columns === 4, `add did not create a lane: ${afterAdd.columns} columns`);
    assert(JSON.stringify(afterAdd.names) === JSON.stringify(['G', 'H', 'Z4']), `lane 4 names: ${JSON.stringify(afterAdd.names)}`);
    assert(afterAdd.lane === 4, `add did not focus the new lane: ${afterAdd.lane}`);
    assert(/\b4\b/.test(afterAdd.note), `add note: ${JSON.stringify(afterAdd.note)}`);

    /* Narrow viewport: the grid scrolls inside the frames view, the page does not. */
    await loadPage(artifactUrl, { width: 360, height: 780 });
    await openFramesView();
    const narrow = JSON.parse(await evaluate(`JSON.stringify({
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      gridOverflow: document.getElementById('framesScroll').scrollWidth - document.getElementById('framesScroll').clientWidth,
      rightDisabled: document.getElementById('framesRight').disabled
    })`));
    assert(narrow.bodyOverflow === 0, `frames view overflows the page at 360: ${narrow.bodyOverflow}`);
    assert(narrow.gridOverflow > 0, 'the card grid should scroll horizontally at 360');
    assert(narrow.rightDisabled === false, 'the right scroll arrow is disabled while the grid overflows');
    await click('#framesRight');
    await sleep(450);
    const scrolled = await evaluate(`document.getElementById('framesScroll').scrollLeft`);
    assert(scrolled > 0, `the scroll arrow did not move the grid: ${scrolled}`);

    return '9 equal cards · live + adds lane 4 G/H/Z4 · Lanes/Esc return · 360 scrolls';
  });

  await runCheck('frames · add grows to the eight-lane cap then disables', async () => {
    await loadApp();
    await openFramesView();
    for (let i = 0; i < 5; i += 1) await click('#framesGrid .frame-add');
    await sleep(300);
    const full = JSON.parse(await evaluate(`JSON.stringify({
      columns: document.querySelectorAll('#framesGrid .lane-col:not(.is-add)').length,
      heads: [...document.querySelectorAll('#framesGrid .lane-btn')].map((b) => b.textContent.trim()),
      lastNames: [...document.querySelectorAll('#framesGrid [data-lane="8"] .frame-glyph')].map((g) => g.textContent.trim()),
      addDisabled: document.querySelector('#framesGrid .frame-add').getAttribute('aria-disabled'),
      addLabel: document.querySelector('#framesGrid .frame-add').getAttribute('aria-label'),
      lanes: Object.keys(window.bitwave.getState().lanes).sort((a, b) => Number(a) - Number(b))
    })`));
    assert(full.columns === 8, `adding grew to ${full.columns} columns, expected 8`);
    assert(full.heads.length === 8 && full.heads[7] === 'LANE 8', `lane heads: ${JSON.stringify(full.heads)}`);
    assert(
      JSON.stringify(full.lastNames) === JSON.stringify(['O', 'P', 'Z8']),
      `lane 8 names: ${JSON.stringify(full.lastNames)}`,
    );
    assert(full.addDisabled === 'true', 'the add tile is not aria-disabled at the eight-lane cap');
    assert(/maximum/.test(full.addLabel), `cap label: ${JSON.stringify(full.addLabel)}`);
    assert(JSON.stringify(full.lanes) === JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8']), `lanes: ${JSON.stringify(full.lanes)}`);

    /* Clicking the disabled tile reports the cap instead of inventing lanes. */
    await click('#framesGrid .frame-add');
    await sleep(150);
    const note = await evaluate(`document.getElementById('framesNote').textContent`);
    assert(/maximum/.test(note), `cap note: ${JSON.stringify(note)}`);
    assert(
      (await evaluate(`document.querySelectorAll('#framesGrid .lane-col:not(.is-add)').length`)) === 8,
      'the cap click created a ninth lane',
    );
    return '3→8 lanes via + · 8 O/P/Z8 · add disabled at the cap with a reason';
  });

  await runCheck('frames · duplicate copies lane state but not routes', async () => {
    await loadApp();
    /* Route lane 3 Z3 into lane 1 A (the first source row). */
    await click('#sourcesBtn');
    await waitFor(`!document.getElementById('sourcesPanel').hidden`, 'source table');
    await evaluate(`(() => {
      const select = document.querySelector('#sourcesRows tr select');
      select.value = 'frame:3:z';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(250);
    await click('#sourcesClose');
    await evaluate(`window.bitwave.setRegister('B', 'DEAD00000000BEEF')`);
    await sleep(150);
    await openFramesView();
    const before = JSON.parse(await evaluate(`JSON.stringify({
      a: window.bitwave.getState().lanes["1"].frames.A,
      b: window.bitwave.getState().lanes["1"].frames.B,
      z3: window.bitwave.getState().lanes["3"].frames.Z3
    })`));
    await click('#framesGrid [data-lane="1"] [data-act="dup"]');
    await sleep(300);
    const after = JSON.parse(await evaluate(`JSON.stringify({
      columns: document.querySelectorAll('#framesGrid .lane-col:not(.is-add)').length,
      lane: window.bitwave.getState().lane,
      copy: window.bitwave.getState().lanes["4"],
      lane1Driven: window.bitwave.getState().lanes["1"].driven,
      note: document.getElementById('framesNote').textContent.trim()
    })`));
    assert(after.columns === 4, `duplicate created ${after.columns} columns`);
    assert(after.lane === 4, `duplicate focused lane ${after.lane}`);
    assert(after.copy.frames.G === before.a, `duplicate G: ${after.copy.frames.G} vs ${before.a}`);
    assert(after.copy.frames.H === before.b, `duplicate H: ${after.copy.frames.H} vs ${before.b}`);
    assert(after.copy.frames.Z4 && after.copy.frames.Z4.length > 0, 'duplicate has no derived Z4');
    assert(after.copy.driven.G === false && after.copy.driven.H === false, 'duplicate inherited driven inputs');
    assert(after.copy.sources.G.kind === 'none' && after.copy.sources.H.kind === 'none', 'duplicate inherited routes');
    assert(after.lane1Driven.A === true, 'the source lane lost its route');
    assert(before.a === before.z3, `route did not drive lane 1 A: ${before.a} vs ${before.z3}`);
    assert(/duplicated lane 1 as lane 4/.test(after.note), `duplicate note: ${JSON.stringify(after.note)}`);
    return 'copy keeps values/operator/expressions · driven source stays read-only · no route edges copied';
  });

  await runCheck('frames · delete warns with a reference count, confirms, and clears routes', async () => {
    await loadApp();
    /* Route lane 1 Z1 into lane 2 A: deleting lane 1 leaves a surviving
       destination whose parked pre-patch base must be restored. */
    const bootLane2A = await evaluate(`window.BitWave.state().lanes["2"].frames.C`);
    await click('#sourcesBtn');
    await waitFor(`!document.getElementById('sourcesPanel').hidden`, 'source table');
    await evaluate(`(() => {
      const select = document.querySelectorAll('#sourcesRows tr.src-binding')[2].querySelector('select');
      select.value = 'frame:1:z';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(250);
    await click('#sourcesClose');
    await openFramesView();

    /* First click shows an inline confirmation; Esc cancels and stays in-view. */
    await click('#framesGrid [data-lane="1"] [data-act="del"]');
    await sleep(200);
    let confirm = JSON.parse(await evaluate(`JSON.stringify({
      text: document.querySelector('#framesGrid [data-lane="1"] .lane-confirm-text')?.textContent ?? null,
      focused: document.activeElement?.dataset?.act ?? null
    })`));
    assert(confirm.text && /delete lane 1/.test(confirm.text), `confirm text: ${JSON.stringify(confirm.text)}`);
    assert(/1 route/.test(confirm.text), `confirm did not count the route: ${JSON.stringify(confirm.text)}`);
    assert(confirm.focused === 'confirm', `focus did not move to the confirming button: ${confirm.focused}`);
    await keydown('Escape');
    await sleep(200);
    const cancelled = JSON.parse(await evaluate(`JSON.stringify({
      view: document.getElementById('framesView').hidden,
      confirm: Boolean(document.querySelector('#framesGrid .lane-confirm-text')),
      lane1: Boolean(window.bitwave.getState().lanes["1"]),
      note: document.getElementById('framesNote').textContent.trim()
    })`));
    assert(cancelled.view === false, 'Esc cancelled the whole frames view instead of the delete');
    assert(cancelled.confirm === false, 'the inline confirmation did not close');
    assert(cancelled.lane1 === true, 'Esc still deleted lane 1');
    assert(/cancelled/.test(cancelled.note), `cancel note: ${JSON.stringify(cancelled.note)}`);

    /* Second delete: confirm deletes, clears the route and restores the parked base. */
    await click('#framesGrid [data-lane="1"] [data-act="del"]');
    await sleep(180);
    await click('#framesGrid [data-lane="1"] [data-act="confirm"]');
    await sleep(350);
    const deleted = JSON.parse(await evaluate(`JSON.stringify({
      lanes: Object.keys(window.bitwave.getState().lanes).sort((a, b) => Number(a) - Number(b)),
      focused: window.bitwave.getState().lane,
      note: document.getElementById('framesNote').textContent.trim(),
      lane2A: window.BitWave.state().lanes["2"].frames.C,
      lane2Driven: window.bitwave.getState().lanes["2"].driven
    })`));
    assert(JSON.stringify(deleted.lanes) === JSON.stringify(['2', '3']), `lanes after delete: ${JSON.stringify(deleted.lanes)}`);
    assert(deleted.focused === 2, `focus after deleting the focused lane: ${deleted.focused}`);
    assert(/deleted lane 1/.test(deleted.note), `delete note: ${JSON.stringify(deleted.note)}`);
    assert(deleted.lane2Driven.C === false, 'the route into lane 2 survived the delete');
    assert(deleted.lane2A === bootLane2A, `parked base not restored: ${deleted.lane2A} vs ${bootLane2A}`);
    return 'warns with route count · Esc cancels · confirm deletes, clears route, restores parked base';
  });

  await runCheck('frames · eye toggle flips aria-pressed and dims the card', async () => {
    await loadApp();
    await openFramesView();
    await click('#framesGrid [data-lane="1"][data-frame="a"] .eye-btn');
    await sleep(150);
    const hidden = JSON.parse(await evaluate(`JSON.stringify({
      pressed: document.querySelector('#framesGrid [data-lane="1"][data-frame="a"] .eye-btn').getAttribute('aria-pressed'),
      hidden: document.querySelector('#framesGrid [data-lane="1"][data-frame="a"]').classList.contains('is-hidden'),
      label: document.querySelector('#framesGrid [data-lane="1"][data-frame="a"] .eye-btn').getAttribute('aria-label')
    })`));
    assert(hidden.pressed === 'false', `aria-pressed: ${hidden.pressed}`);
    assert(hidden.hidden === true, 'card did not gain .is-hidden');
    assert(/^Show frame A\b/.test(hidden.label), `eye label did not change: ${hidden.label}`);
    return 'A hidden · aria-pressed=false · label now "Show frame A"';
  });

  /* D46: the stage bar selects a lane through a native per-pane dropdown. */
  const selectLaneInPane = async (key, paneIdx = 0) => {
    await evaluate(`(() => {
      const panes = [...document.querySelectorAll('#stageBar .pane-head')].filter((pane) => !pane.hidden);
      const select = panes[${paneIdx}] && panes[${paneIdx}].querySelector('.lane-select');
      if (!select) throw new Error('missing lane select for pane ${paneIdx}');
      select.value = ${JSON.stringify(key)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`);
    await sleep(140);
  };
  const clickLane = (key) => selectLaneInPane(key, 0);

  /* 3b. global frame names: A/B C/D E/F + Z1/Z2/Z3 ---------------------- */
  await runCheck('naming · lanes map to A/B, C/D, E/F and Z1/Z2/Z3', async () => {
    await loadApp();
    const labels = {};
    labels['1'] = await evaluate(`document.getElementById('strip').dataset.edit`);
    await clickLane('2');
    labels['2'] = await evaluate(`document.getElementById('strip').dataset.edit`);
    await clickLane('3');
    labels['3'] = await evaluate(`document.getElementById('strip').dataset.edit`);
    assert(
      JSON.stringify(labels) === JSON.stringify({ 1: 'A', 2: 'C', 3: 'E' }),
      `strip labels per lane: ${JSON.stringify(labels)}`
    );

    await clickLane('1');
    await openFramesView();
    const columns = JSON.parse(await evaluate(`JSON.stringify(
      [...document.querySelectorAll('#framesGrid .lane-col:not(.is-add)')].map(
        (col) => [...col.querySelectorAll('.frame-glyph')].map((glyph) => glyph.textContent.trim())
      )
    )`));
    assert(
      JSON.stringify(columns) === JSON.stringify([['A', 'B', 'Z1'], ['C', 'D', 'Z2'], ['E', 'F', 'Z3']]),
      `frame columns: ${JSON.stringify(columns)}`
    );
    return 'lane 1 A/B/Z1 · lane 2 C/D/Z2 · lane 3 E/F/Z3 in strip and frame columns';
  });

  await runCheck('visibility · eye toggles are per lane', async () => {
    await loadApp();
    await openFramesView();
    await click('#framesGrid [data-lane="1"][data-frame="a"] .eye-btn');
    await sleep(150);
    const lane1Hidden = await evaluate(
      `document.querySelector('#framesGrid [data-lane="1"][data-frame="a"] .eye-btn').getAttribute('aria-pressed')`
    );
    const lane2Visible = await evaluate(
      `document.querySelector('#framesGrid [data-lane="2"][data-frame="a"] .eye-btn').getAttribute('aria-pressed')`
    );
    assert(lane1Hidden === 'false', `lane 1 A after hide: ${lane1Hidden}`);
    assert(lane2Visible === 'true', `lane 2 C should be unaffected: ${lane2Visible}`);

    /* The 2-D canvas legend entries use the same visibility path. This guards
       the D42 regression where the legend click called a removed setter.
       `?fresh` boots A focused; choosing the B card enables A·B mode, which is
       the only 2-D state that draws the legend. */
    await loadApp({ query: 'fresh' });
    await openFramesView();
    await pickFrameCard('1', 'b');
    await waitFor(`typeof window.bitwave === 'object'`, 'agent bridge');
    const before = JSON.parse(await evaluate(`JSON.stringify(window.bitwave.getState().lanes["1"].visibility)`));
    const geo = JSON.parse(await evaluate(`JSON.stringify(window.BitWave.geometry())`));
    const box = JSON.parse(await evaluate(`JSON.stringify((() => {
      const r = document.getElementById('wave').getBoundingClientRect();
      return { left: r.left, top: r.top };
    })())`));
    const legendX = box.left + geo.plot.x1 - 12;
    const legendY = box.top + geo.plot.y0 + 8;
    const clickLegend = async () => {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: legendX, y: legendY, button: 'left', clickCount: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: legendX, y: legendY, button: 'left', clickCount: 1,
      });
      await sleep(250);
    };
    await clickLegend();
    const after = JSON.parse(await evaluate(`JSON.stringify(window.bitwave.getState().lanes["1"].visibility)`));
    const changed = Object.keys(before).filter((frame) => before[frame] !== after[frame]);
    assert(
      changed.length === 1 && after[changed[0]] === false,
      `legend click did not hide one frame: ${JSON.stringify({ before, after })}`
    );
    await clickLegend();
    const restored = JSON.parse(await evaluate(`JSON.stringify(window.bitwave.getState().lanes["1"].visibility)`));
    assert(
      JSON.stringify(restored) === JSON.stringify(before),
      `second legend click did not restore visibility: ${JSON.stringify(restored)}`
    );
    return 'hiding A leaves C visible (per-lane) · 2-D legend click toggles and restores';
  });

  /* 3c. focus: a card is navigation, the lens on the readouts stays a lens */
  await runCheck('focus · a card focuses the frame and returns to the lanes view', async () => {
    await loadApp();
    await click('#depthBtn');
    assert(
      (await evaluate(`document.getElementById('depthBtn').getAttribute('aria-pressed')`)) === 'true',
      '3-D did not turn on'
    );
    const entered = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      readonly: document.getElementById('strip').classList.contains('is-readonly')
    })`));
    assert(entered.strip === 'A', `3-D stole focus on entry: strip shows ${entered.strip}`);
    assert(entered.readonly === false, '3-D should leave A editable');

    await openFramesView();
    await pickFrameCard('1', 'a');
    let state = JSON.parse(await evaluate(`JSON.stringify({
      view3d: document.getElementById('depthBtn').getAttribute('aria-pressed'),
      viewHidden: document.getElementById('framesView').hidden,
      strip: document.getElementById('strip').dataset.edit,
      readonly: document.getElementById('strip').classList.contains('is-readonly'),
      stage: document.getElementById('stageBar').textContent
    })`));
    assert(state.view3d === 'true', 'choosing a card left the 3-D view');
    assert(state.viewHidden === true, 'choosing a card did not return to the lanes view');
    assert(state.strip === 'A', `strip after choosing A: ${state.strip}`);
    assert(state.readonly === false, 'A should be editable');
    assert(/→ Z1/.test(state.stage), `stage bar: ${JSON.stringify(state.stage)}`);

    const before = JSON.parse(await evaluate(`JSON.stringify({
      a: document.getElementById('hexA').textContent,
      z: document.getElementById('hexZ').textContent
    })`));
    await openFramesView();
    await pickFrameCard('1', 'z');
    state = JSON.parse(await evaluate(`JSON.stringify({
      view3d: document.getElementById('depthBtn').getAttribute('aria-pressed'),
      viewHidden: document.getElementById('framesView').hidden,
      strip: document.getElementById('strip').dataset.edit,
      readonly: document.getElementById('strip').classList.contains('is-readonly'),
      nibReadonly: [...document.querySelectorAll('#nibs .nib')].every((n) => n.getAttribute('aria-readonly') === 'true'),
      bits: document.querySelectorAll('#nibs .bit').length,
      hint: document.getElementById('hint').textContent
    })`));
    assert(state.view3d === 'true', 'choosing Z1 left the 3-D view');
    assert(state.viewHidden === true, 'choosing Z1 did not return to the lanes view');
    assert(state.strip === 'Z1', `strip after choosing Z1: ${state.strip}`);
    assert(state.readonly === true && state.nibReadonly === true, 'Z strip is not read-only');
    assert(state.bits === 64, `strip should show all 64 bits of Z1, found ${state.bits}`);
    assert(/read-only/.test(state.hint), `hint did not explain read-only: ${JSON.stringify(state.hint)}`);

    await click('#nibs .bit');
    const after = JSON.parse(await evaluate(`JSON.stringify({
      a: document.getElementById('hexA').textContent,
      z: document.getElementById('hexZ').textContent
    })`));
    assert(
      after.a === before.a && after.z === before.z,
      `a bit click edited through a derived frame: ${JSON.stringify(before)} → ${JSON.stringify(after)}`
    );

    await openFramesView();
    await pickFrameCard('1', 'b');
    const b = JSON.parse(await evaluate(`JSON.stringify({
      viewHidden: document.getElementById('framesView').hidden,
      strip: document.getElementById('strip').dataset.edit,
      readonly: document.getElementById('strip').classList.contains('is-readonly')
    })`));
    assert(b.viewHidden === true, 'choosing B did not return to the lanes view');
    assert(b.strip === 'B' && b.readonly === false, `choosing B: ${JSON.stringify(b)}`);
    return 'card A → lanes · card Z1 → read-only strip · card B editable · 3-D kept';
  });

  await runCheck('focus · names follow the lane in the stage bar and readouts', async () => {
    await loadApp();
    /* 3-D brings the second operand live, so the A/B/Z readout row exists. */
    await click('#depthBtn');
    await sleep(200);
    await clickLane('2');
    await sleep(120);
    const lane2 = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      stage: document.getElementById('stageBar').textContent,
      a: document.getElementById('hexA').previousElementSibling.textContent,
      b: document.getElementById('hexB').previousElementSibling.textContent,
      z: document.getElementById('hexZ').previousElementSibling.textContent,
      truth: document.querySelector('#truthToggle .truth-title').textContent
    })`));
    assert(lane2.strip === 'C', `lane 2 strip: ${lane2.strip}`);
    assert(/LANE 2 · C.*D.*→ Z2/.test(lane2.stage), `lane 2 stage: ${JSON.stringify(lane2.stage)}`);
    assert(lane2.a === 'C' && lane2.b === 'D' && lane2.z === 'Z2', `lane 2 readout labels: ${JSON.stringify(lane2)}`);
    assert(/C.*D.*→ Z2/.test(lane2.truth), `lane 2 truth header: ${JSON.stringify(lane2.truth)}`);

    await clickLane('3');
    const lane3 = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      stage: document.getElementById('stageBar').textContent
    })`));
    assert(lane3.strip === 'E', `lane 3 strip: ${lane3.strip}`);
    assert(/LANE 3 · E.*F.*→ Z3/.test(lane3.stage), `lane 3 stage: ${JSON.stringify(lane3.stage)}`);

    /* D41: the A/B/Z1 readout labels are the frame lens (focus only). */
    await loadApp();
    await click('#depthBtn');
    await waitFor(
      `document.getElementById('depthBtn').getAttribute('aria-pressed') === 'true'`,
      '3-D for the readout lens'
    );
    const beforeLens = JSON.parse(await evaluate(`JSON.stringify({
      a: document.getElementById('hexA').textContent.trim(),
      b: document.getElementById('hexB').textContent.trim(),
      z: document.getElementById('hexZ').textContent.trim(),
      view3d: document.getElementById('depthBtn').getAttribute('aria-pressed')
    })`));
    const buttons = JSON.parse(await evaluate(`JSON.stringify({
      labels: ['lblA', 'lblB', 'lblZ'].map((id) => document.getElementById(id).textContent.trim()),
      pressed: ['lblA', 'lblB', 'lblZ'].map((id) => document.getElementById(id).getAttribute('aria-pressed')),
      names: ['lblA', 'lblB', 'lblZ'].map((id) => document.getElementById(id).getAttribute('aria-label')),
      sizes: ['lblA', 'lblB', 'lblZ'].map((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      })
    })`));
    assert(buttons.labels.join(',') === 'A,B,Z1', `readout labels: ${JSON.stringify(buttons.labels)}`);
    assert(buttons.pressed.join(',') === 'true,false,false', `boot pressed state: ${buttons.pressed}`);
    assert(
      buttons.names[0] === 'focus A' && buttons.names[2] === 'focus Z1 (read-only)',
      `readout names: ${JSON.stringify(buttons.names)}`
    );
    assert(
      buttons.sizes.every(([w, h]) => w >= 24 && h >= 24),
      `readout targets under 24px: ${JSON.stringify(buttons.sizes)}`
    );

    await click('#lblB');
    await sleep(150);
    let lens = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      pressed: ['lblA', 'lblB', 'lblZ'].map((id) => document.getElementById(id).getAttribute('aria-pressed')),
      editTarget: document.getElementById('editTarget').textContent.trim(),
      entryDisabled: document.getElementById('hexEntry').disabled,
      entryValue: document.getElementById('hexEntry').value.toUpperCase(),
      hexB: document.getElementById('hexB').textContent.trim(),
      view3d: document.getElementById('depthBtn').getAttribute('aria-pressed')
    })`));
    assert(lens.strip === 'B', `B lens strip: ${lens.strip}`);
    assert(lens.pressed.join(',') === 'false,true,false', `B lens pressed: ${lens.pressed}`);
    assert(lens.editTarget === 'edit · B', `B lens edit target: ${lens.editTarget}`);
    assert(lens.entryDisabled === false, 'the word entry is disabled for B');
    assert(lens.entryValue === lens.hexB, `word entry is not B's value: ${lens.entryValue} vs ${lens.hexB}`);
    assert(lens.view3d === 'true', 'the readout lens left the 3-D view');

    await click('#lblZ');
    await sleep(150);
    lens = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      readonly: document.getElementById('strip').classList.contains('is-readonly'),
      pressed: ['lblA', 'lblB', 'lblZ'].map((id) => document.getElementById(id).getAttribute('aria-pressed')),
      editTarget: document.getElementById('editTarget').textContent.trim(),
      entryDisabled: document.getElementById('hexEntry').disabled
    })`));
    assert(lens.strip === 'Z1' && lens.readonly === true, `Z1 lens: ${JSON.stringify(lens)}`);
    assert(lens.pressed.join(',') === 'false,false,true', `Z1 lens pressed: ${lens.pressed}`);
    assert(lens.editTarget === 'Z1 · read-only', `Z1 lens edit target: ${lens.editTarget}`);
    assert(lens.entryDisabled === true, 'the word entry is enabled on a derived frame');

    /* Keyboard path: focus a label, Enter chooses that frame (no new shortcut). */
    await evaluate(`document.getElementById('lblA').focus()`);
    await pressActivate();
    await sleep(150);
    const keyboard = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      pressed: document.getElementById('lblA').getAttribute('aria-pressed')
    })`));
    assert(keyboard.strip === 'A' && keyboard.pressed === 'true', `keyboard lens: ${JSON.stringify(keyboard)}`);

    const afterLens = JSON.parse(await evaluate(`JSON.stringify({
      a: document.getElementById('hexA').textContent.trim(),
      b: document.getElementById('hexB').textContent.trim(),
      z: document.getElementById('hexZ').textContent.trim(),
      view3d: document.getElementById('depthBtn').getAttribute('aria-pressed')
    })`));
    assert(
      JSON.stringify(beforeLens) === JSON.stringify(afterLens),
      `the readout lens changed values or the view: ${JSON.stringify(beforeLens)} → ${JSON.stringify(afterLens)}`
    );
    return 'lane 2 C/D/Z2 · lane 3 E/F/Z3 in strip, stage bar, readouts and truth · A/B/Z1 readout lens retargets strip + word entry, Z1 read-only, 24px targets, keyboard path';
  });

  await runCheck('edit · bit click and wheel update the register through actions', async () => {
    await loadApp();
    const before = await evaluate(`document.getElementById('hex').textContent.trim()`);
    assert(before === '8ADEFEDA85210125', `boot A: ${before}`);

    await evaluate(`document.querySelector('#nibs .bit').click()`);
    const clicked = await evaluate(`document.getElementById('hex').textContent.trim()`);
    assert(clicked === '0ADEFEDA85210125', `after MSB toggle: ${clicked}`);

    await evaluate(
      `document.querySelector('#nibs .nib[data-j="0"] .hex')
        .dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }))`
    );
    const wheeled = await evaluate(`document.getElementById('hex').textContent.trim()`);
    assert(wheeled === '1ADEFEDA85210125', `after wheel: ${wheeled}`);

    const dec = await evaluate(`document.getElementById('dec').textContent.trim()`);
    assert(BigInt(`0x${wheeled}`).toString() === dec, 'decimal readout drifted');
    return 'MSB toggle 8A→0A · wheel 0A→1A · decimal agrees';
  });

  /* 4. 3-D field -------------------------------------------------------- */
  await runCheck('meta · trend badge slot keeps the readout width stable', async () => {
    await loadApp();
    const measure = async () =>
      JSON.parse(await evaluate(`JSON.stringify({
        badge: document.getElementById('trend').getBoundingClientRect().width,
        badgeScroll: document.getElementById('trend').scrollWidth,
        hexLeft: document.getElementById('hex').getBoundingClientRect().left,
        hexWidth: document.getElementById('hex').getBoundingClientRect().width
      })`));
    const words = ['level', 'step-up', 'step-down'];
    const seen = [];
    for (const word of words) {
      await evaluate(`document.getElementById('trend').textContent = ${JSON.stringify(word)}`);
      seen.push(await measure());
    }
    assert(seen.every((s) => s.badge === seen[0].badge), `badge widths: ${seen.map((s) => s.badge).join(', ')}`);
    assert(seen.every((s) => s.badgeScroll <= s.badge), `badge text overflows: ${seen.map((s) => `${s.badgeScroll}/${s.badge}`).join(', ')}`);
    assert(seen.every((s) => s.hexLeft === seen[0].hexLeft && s.hexWidth === seen[0].hexWidth), '2-D hex readout moved');

    await click('#depthBtn');
    const measure3d = async () =>
      JSON.parse(await evaluate(`JSON.stringify({
        badge: document.getElementById('trend').getBoundingClientRect().width,
        aLeft: document.getElementById('hexA').getBoundingClientRect().left,
        aWidth: document.getElementById('hexA').getBoundingClientRect().width,
        zLeft: document.getElementById('hexZ').getBoundingClientRect().left
      })`));
    const seen3d = [];
    for (const word of words) {
      await evaluate(`document.getElementById('trend').textContent = ${JSON.stringify(word)}`);
      seen3d.push(await measure3d());
    }
    assert(seen3d.every((s) => s.badge === seen3d[0].badge), '3-D badge width changed');
    assert(seen3d.every((s) => s.aLeft === seen3d[0].aLeft && s.aWidth === seen3d[0].aWidth && s.zLeft === seen3d[0].zLeft), '3-D readout moved');
    await evaluate(`document.getElementById('trend').textContent = 'level'`);
    await click('#depthBtn');
    return `badge ${seen[0].badge}px · 2-D and 3-D readouts fixed`;
  });

  await runCheck('3d · depth field shows A/B/Z with Z = A xor B', async () => {
    await loadApp();
    await click('#depthBtn');
    await waitFor(`document.getElementById('truth').offsetParent !== null`, '3-D truth table');
    const readout = await readInstrument();
    const a = BigInt(`0x${readout.hexA}`);
    const b = BigInt(`0x${readout.hexB}`);
    const z = BigInt(`0x${readout.hexZ}`);
    assert((a ^ b) === z, `Z ${readout.hexZ} ≠ A xor B ${(a ^ b).toString(16).toUpperCase()}`);
    return `A ${readout.hexA} xor B ${readout.hexB} = Z ${readout.hexZ}`;
  });

  await runCheck('3d · truth counts are 23 / 11 / 9 / 21 and popcount(Z) = 20', async () => {
    const readout = await readInstrument();
    assert(
      JSON.stringify(readout.truth) === JSON.stringify(['23', '11', '9', '21']),
      `truth counts: ${JSON.stringify(readout.truth)}`
    );
    assert(popcount(readout.hexZ) === 20, `popcount(Z) = ${popcount(readout.hexZ)}`);
    return 'counts 23/11/9/21 · popcount(Z) = 20';
  });

  await runCheck('3d · hinge is per pane: independent folds, maths unchanged', async () => {
    await loadApp();
    /* D47: the hinge lives in each pane head and is hidden in 2-D. */
    const in2d = JSON.parse(await evaluate(`JSON.stringify({
      folds: [...document.querySelectorAll('#stageBar .pane-fold')].filter((b) => !b.hidden).length
    })`));
    assert(in2d.folds === 0, `the hinge should be hidden in 2-D: ${in2d.folds} visible`);

    await click('#depthBtn');
    await waitFor(
      `[...document.querySelectorAll('#stageBar .pane-fold')].some((b) => !b.hidden)`,
      '3-D hinge'
    );
    const before = await readInstrument();
    const offLabel = await evaluate(`document.querySelector('#stageBar .pane-fold:not([hidden])').textContent`);
    const offHidden = await evaluate(`document.querySelector('#stageBar .pane-fold:not([hidden])').hidden`);
    await click('#stageBar .pane-fold:not([hidden])');
    const onLabel = await evaluate(`document.querySelector('#stageBar .pane-fold:not([hidden])').textContent`);
    const after = await readInstrument();
    assert(!offHidden, 'fold control should be visible in 3-D');
    assert(offLabel === 'A far' && onLabel === 'B far', `fold labels: ${offLabel} → ${onLabel}`);
    assert(before.hexA === after.hexA && before.hexB === after.hexB, 'hinge changed operand values');
    assert(before.hexZ === after.hexZ, 'hinge changed Z');
    await click('#stageBar .pane-fold:not([hidden])');

    /* In split 3-D each pane folds its own lane: toggling pane 0 must not move
       pane 1's label. */
    await click('#stageBar .op.mini');
    await sleep(250);
    const split = JSON.parse(await evaluate(`JSON.stringify({
      folds: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .pane-fold')].map((b) => b.textContent.trim()),
      lanes: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .lane-select')].map((s) => s.value)
    })`));
    assert(split.folds.length === 2, `split hinges: ${JSON.stringify(split.folds)}`);
    assert(split.folds.every((label) => label === 'A far'), `split starting folds: ${JSON.stringify(split.folds)}`);
    await click('#stageBar .pane-head[data-pane="0"] .pane-fold');
    await sleep(150);
    const folded = JSON.parse(await evaluate(`JSON.stringify({
      folds: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .pane-fold')].map((b) => b.textContent.trim()),
      lanes: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .lane-select')].map((s) => s.value)
    })`));
    assert(
      JSON.stringify(folded.folds) === JSON.stringify(['B far', 'A far']),
      `pane 0 fold leaked into pane 1 (or vice versa): ${JSON.stringify(folded.folds)}`,
    );
    const splitValues = await evaluate(`JSON.stringify([
      document.getElementById('hexA').textContent,
      document.getElementById('hexB').textContent,
      document.getElementById('hexZ').textContent
    ])`);
    assert(
      JSON.parse(splitValues).join(',') === [before.hexA, before.hexB, before.hexZ].join(','),
      `split hinge changed the maths: ${splitValues}`,
    );
    return 'A far ⇄ B far · per-pane in split (no leak) · A/B/Z unchanged';
  });

  /* 5. CSV import + §11 op vectors ------------------------------------- */
  const csvPayload = 'FEDCBA9876543210';
  const importCsvText = async (text) => {
    await evaluate(`(() => {
      const csv = ${JSON.stringify(text)};
      const transfer = new DataTransfer();
      transfer.items.add(new File([csv], 'check.csv', { type: 'text/csv' }));
      const input = document.getElementById('csvFile');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(
      `!document.getElementById('stepSeg').hidden`,
      'CSV load'
    );
    await sleep(250);
  };
  const importCsv = async () => {
    await importCsvText(`id,payload\n1,${csvPayload}\n`);
    await waitFor(
      `document.getElementById('hex').textContent.trim() === '${csvPayload}'`,
      'CSV value in register A'
    );
  };

  await runCheck('csv · import types and binds the widest column to lane 1 A', async () => {
    await loadApp();
    await importCsv();
    await click('#sourcesBtn');
    await waitFor(`!document.getElementById('sourcesPanel').hidden`, 'source table');
    const state = JSON.parse(await evaluate(`JSON.stringify({
      size: document.getElementById('sizeOut').textContent.trim(),
      rows: document.querySelectorAll('#sourcesRows tr.src-binding').length,
      groupHeads: document.querySelectorAll('#sourcesRows tr.src-group-head').length,
      dest: document.querySelector('#sourcesRows tr.src-binding .src-dest').textContent.trim(),
      chip: document.querySelector('#sourcesRows tr.src-binding .src-state').textContent.trim(),
      hex: document.getElementById('hex').textContent.trim()
    })`));
    assert(state.rows === 6, `source rows: ${state.rows}`);
    assert(state.groupHeads === 3, `source lane groups: ${state.groupHeads}`);
    assert(state.dest.includes('A') && state.dest.includes('payload'), `row label: ${state.dest}`);
    assert(state.chip === 'data', `row state: ${state.chip}`);
    assert(state.hex === csvPayload, `A after import: ${state.hex}`);
    assert(state.size === '64 bits · 16 nibbles', `size after import: ${state.size}`);
    await click('#sourcesClose');
    return `A · payload → data · A = ${state.hex} · 64 bits`;
  });

  /* 5b. keyboard editing — the strip is the semantic editor (DESIGN §6) -- */
  await runCheck('keyboard · nibbles are spinbuttons with one roving tab stop', async () => {
    await loadApp();
    const a11y = JSON.parse(await evaluate(`JSON.stringify((() => {
      const nibs = [...document.querySelectorAll('#nibs .nib')];
      return {
        count: nibs.length,
        roles: [...new Set(nibs.map((n) => n.getAttribute('role')))],
        tabStops: nibs.filter((n) => n.getAttribute('tabindex') === '0').length,
        inRovingSet: nibs.filter((n) => n.getAttribute('tabindex') !== null).length,
        valuenow: nibs[0].getAttribute('aria-valuenow'),
        valuetext: nibs[0].getAttribute('aria-valuetext'),
        label: nibs[0].getAttribute('aria-label'),
        stripRole: document.getElementById('strip').getAttribute('role'),
        stripLabel: document.getElementById('strip').getAttribute('aria-label'),
      };
    })())`));
    assert(a11y.count === 16, `nibbles: ${a11y.count}`);
    assert(
      JSON.stringify(a11y.roles) === JSON.stringify(['spinbutton']),
      `nibble roles: ${JSON.stringify(a11y.roles)}`
    );
    assert(a11y.tabStops === 1, `roving tab stops: ${a11y.tabStops} (expected 1)`);
    assert(a11y.inRovingSet === 16, `roving set: ${a11y.inRovingSet}/16 nibbles`);
    assert(a11y.valuenow === '8', `nibble 0 aria-valuenow: ${a11y.valuenow}`);
    assert(
      /nibble 1 of 16, hex 8, bits 60–63, weight 2\^60/.test(a11y.valuetext),
      `aria-valuetext: ${a11y.valuetext}`
    );
    assert(/nibble 1 of 16/.test(a11y.label), `aria-label: ${a11y.label}`);
    assert(a11y.stripRole === 'group' && /A register/.test(a11y.stripLabel), `strip: ${a11y.stripRole} / ${a11y.stripLabel}`);
    return '16 spinbuttons · 1 tab stop · valuetext names bits + weight';
  });

  await runCheck('keyboard · ↑/↓, ←/→, Home/End and 0–F edit the focused nibble', async () => {
    await loadApp();
    await evaluate(`document.querySelector('#nibs .nib[data-j="0"]').focus()`);

    let r = await keydown('ArrowDown');
    let hex = await evaluate(`document.getElementById('hex').textContent.trim()`);
    assert(hex === '7ADEFEDA85210125', `↓ on nibble 0: ${hex}`);
    assert(r.activeJ === '0', `↓ moved focus to ${r.activeJ}`);
    const now = await evaluate(`document.querySelector('#nibs .nib[data-j="0"]').getAttribute('aria-valuenow')`);
    assert(now === '7', `aria-valuenow after ↓: ${now}`);

    r = await keydown('ArrowRight');
    assert(r.activeJ === '1' && r.prevented, `→ should move nibble focus: ${JSON.stringify(r)}`);

    r = await keydown('f');
    hex = await evaluate(`document.getElementById('hex').textContent.trim()`);
    assert(hex === '7FDEFEDA85210125', `0–F on nibble 1: ${hex}`);
    assert(r.activeJ === '1', `typing moved focus to ${r.activeJ}`);

    r = await keydown('End');
    assert(r.activeJ === '15', `End focus: ${r.activeJ}`);
    r = await keydown('0');
    hex = await evaluate(`document.getElementById('hex').textContent.trim()`);
    assert(hex === '7FDEFEDA85210120', `0–F on last nibble: ${hex}`);

    r = await keydown('Home');
    assert(r.activeJ === '0', `Home focus: ${r.activeJ}`);

    const dec = await evaluate(`document.getElementById('dec').textContent.trim()`);
    assert(BigInt(`0x${hex}`).toString() === dec, 'decimal readout drifted after keyboard edit');
    return 'nibbles set by keys · focus stays · readouts agree';
  });

  await runCheck('keyboard · Tab enters the strip and Enter-focus survives a render', async () => {
    await loadApp();
    /* DOM order: header → help → stage bar (lane set, frames, split, copy) → strip.
       D47: the per-pane copy opener is the last stage-bar control before the strip
       (the hinge is hidden in 2-D), so Tab from it must land on the first nibble. */
    await evaluate(`document.querySelector('#stageBar .pane-copy').focus()`);
    await pressNative('Tab', 'Tab', 9);
    const entered = await evaluate(`document.activeElement?.closest?.('.nib')?.dataset?.j ?? null`);
    assert(entered === '0', `Tab from the stage bar did not enter the strip (active nibble: ${entered})`);

    /* A commit re-renders the strip's innerHTML; the focused nibble must survive. */
    await evaluate(`document.querySelector('#nibs .nib[data-j="3"]').focus()`);
    await click('[data-preset="square"]');
    await evaluate(`new Promise((resolve) => setTimeout(resolve, 80))`);
    const survived = JSON.parse(await evaluate(`JSON.stringify({
      activeJ: document.activeElement?.closest?.('.nib')?.dataset?.j ?? null,
      hex: document.getElementById('hex').textContent.trim()
    })`));
    assert(survived.activeJ === '3', `focus lost on re-render: ${survived.activeJ}`);
    assert(survived.hex !== '8ADEFEDA85210125', 'preset did not apply');
    return 'Tab → strip · focus survives commit re-render';
  });

  await runCheck('keyboard · arrows in the strip do not also step the CSV', async () => {
    await loadApp();
    const fixture = readFileSync(resolve(ROOT, 'examples/testcsv.csv'), 'utf8');
    await importCsvText(fixture);
    const before = await evaluate(`document.getElementById('exCount').textContent.trim()`);
    await evaluate(`document.querySelector('#nibs .nib[data-j="0"]').focus()`);
    const r = await keydown('ArrowRight');
    const after = await evaluate(`document.getElementById('exCount').textContent.trim()`);
    assert(r.activeJ === '1', `strip arrow focus: ${r.activeJ}`);
    assert(after === before, `CSV stepper fired from the strip: ${before} → ${after}`);

    /* Away from the strip the stepper still works (no regression). */
    await evaluate(`document.activeElement.blur()`);
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`);
    await sleep(120);
    const stepped = await evaluate(`document.getElementById('exCount').textContent.trim()`);
    assert(stepped !== after, `CSV stepper did not work outside the strip: ${stepped}`);
    return `strip owns ←/→ · stepper still steps (${after} → ${stepped})`;
  });

  await runCheck('keyboard · a bit click focuses its nibble; derived strips have no tab stop', async () => {
    await loadApp();
    await evaluate(`document.querySelector('#nibs .nib[data-j="2"] .bit').click()`);
    const focused = await evaluate(`document.activeElement?.closest?.('.nib')?.dataset?.j ?? null`);
    assert(focused === '2', `bit click left focus on ${focused}`);

    await openFramesView();
    await pickFrameCard('1', 'z');
    const z = JSON.parse(await evaluate(`JSON.stringify({
      readonly: [...document.querySelectorAll('#nibs .nib')].every((n) => n.getAttribute('aria-readonly') === 'true'),
      tabStops: document.querySelectorAll('#nibs .nib[tabindex]').length,
      roles: document.querySelectorAll('#nibs .nib[role="spinbutton"]').length
    })`));
    assert(z.readonly === true, 'derived strip is not aria-readonly');
    assert(z.tabStops === 0, `derived strip has ${z.tabStops} tab stops`);
    assert(z.roles === 16, `derived strip exposes ${z.roles}/16 spinbuttons`);
    return 'bit click → nibble focus · Z1 strip read-only, no tab stops';
  });

  /* 5c. semantics — landmarks, names, live region, radiogroup ------------- */
  await runCheck('a11y · one main landmark, named groups, canvas text alternative', async () => {
    await loadApp();
    const a = JSON.parse(await evaluate(`JSON.stringify((() => {
      const main = document.querySelectorAll('main');
      const groups = [...document.querySelectorAll('.controls .group')];
      return {
        mains: main.length,
        inside: main[0] ? [...main[0].children].map((el) => el.className.split(' ')[0]) : [],
        groups: groups.length,
        named: groups.filter((g) => g.getAttribute('role') === 'group' && g.getAttribute('aria-label')).length,
        groupLabels: groups.map((g) => g.getAttribute('aria-label')),
        canvasRole: document.getElementById('wave').getAttribute('role'),
        canvasAlt: document.getElementById('wave').getAttribute('aria-label'),
        liveRole: document.getElementById('liveStatus').getAttribute('role'),
        liveLive: document.getElementById('liveStatus').getAttribute('aria-live'),
        liveAtomic: document.getElementById('liveStatus').getAttribute('aria-atomic'),
        stripRole: document.getElementById('strip').getAttribute('role'),
        stripLabel: document.getElementById('strip').getAttribute('aria-label'),
      };
    })())`));
    assert(a.mains === 1, `main landmarks: ${a.mains}`);
    assert(
      JSON.stringify(a.inside) === JSON.stringify(['stage', 'strip', 'meta', 'controls', 'help-panel']),
      `main children: ${JSON.stringify(a.inside)}`
    );
    assert(a.groups === 5 && a.named === a.groups, `named groups: ${a.named}/${a.groups}`);
    assert(
      JSON.stringify(a.groupLabels) === JSON.stringify(['source', 'register edit', 'operate', 'derive', 'motion']),
      `group order: ${JSON.stringify(a.groupLabels)}`,
    );
    assert(a.canvasRole === 'img', `canvas role: ${a.canvasRole}`);
    assert(/2-D waveform · lane 1 · A 8ADEFEDA85210125 · editing A/.test(a.canvasAlt), `canvas alt: ${a.canvasAlt}`);
    assert(a.liveRole === 'status' && a.liveLive === 'polite' && a.liveAtomic === 'true', 'live region attributes');
    assert(a.stripRole === 'group' && /A register/.test(a.stripLabel), `strip group: ${a.stripRole}/${a.stripLabel}`);
    return 'main landmark · 5 named groups (view moved to the top bar, D47) · canvas alt · polite live region';
  });

  await runCheck('a11y · live status announces committed changes only', async () => {
    await loadApp();
    await click('[data-preset="square"]');
    await sleep(260);
    const announced = await evaluate(`document.getElementById('liveStatus').textContent.trim()`);
    assert(
      /^lane 1 · A = [0-9A-F]{16} · Z1 popcount \d+$/.test(announced),
      `live status: ${JSON.stringify(announced)}`
    );

    /* The canvas alternative updates with the same commit. */
    const alt = await evaluate(`document.getElementById('wave').getAttribute('aria-label')`);
    assert(/A 0F0F0F0F0F0F0F0F|A [0-9A-F]{16}/.test(alt) && !/A 8ADEFEDA85210125/.test(alt), `canvas alt after commit: ${alt}`);

    /* Starting the LFO must not flood the region: its ticks stay quiet. */
    await click('#lfoBtn');
    await sleep(500);
    const during = await evaluate(`document.getElementById('liveStatus').textContent.trim()`);
    await click('#lfoBtn');
    await sleep(300);
    assert(/^lane 1 · A = [0-9A-F]{16}/.test(during), `LFO tick spoke: ${JSON.stringify(during)}`);
    return `announced "${announced}" · quiet during LFO`;
  });

  await runCheck('a11y · lane selection is a native dropdown with live options', async () => {
    await loadApp();
    const before = JSON.parse(await evaluate(`JSON.stringify((() => {
      const select = document.querySelector('#stageBar .pane-head:not([hidden]) .lane-select');
      return {
        tag: select ? select.tagName : null,
        options: select ? [...select.options].map((option) => ({ value: option.value, label: option.textContent.trim() })) : [],
        selected: select ? select.value : null,
        radioGroups: document.querySelectorAll('#stageBar [role="radiogroup"]').length,
        agentLanes: [...document.querySelectorAll('#stageBar [data-agent-lane]')].map((el) => el.dataset.agentLane),
      };
    })())`));
    assert(before.tag === 'SELECT', `lane control is not a native select: ${before.tag}`);
    assert(
      JSON.stringify(before.options) === JSON.stringify([
        { value: '1', label: 'Lane 1' },
        { value: '2', label: 'Lane 2' },
        { value: '3', label: 'Lane 3' },
      ]),
      `lane option labels: ${JSON.stringify(before.options)}`,
    );
    assert(before.selected === '1', `selected lane: ${before.selected}`);
    assert(before.radioGroups === 0, 'the old lane radiogroup is still in the stage bar');
    assert(JSON.stringify(before.agentLanes) === JSON.stringify(['1']), `data-agent-lane: ${JSON.stringify(before.agentLanes)}`);

    /* Select by change (the native keyboard path is arrows/Home/End). */
    await selectLaneInPane('2', 0);
    let after = JSON.parse(await evaluate(`JSON.stringify({
      lane: window.BitWave.state().lane,
      selected: document.querySelector('#stageBar .pane-head:not([hidden]) .lane-select').value,
      strip: document.getElementById('strip').dataset.edit
    })`));
    assert(after.lane === 2 && after.selected === '2', `select did not pick lane 2: ${JSON.stringify(after)}`);
    assert(after.strip === 'C', `strip did not follow the second lane: ${after.strip}`);

    /* Alt+3 selects a live lane by its stable key. */
    await pressAltDigit(3);
    after = JSON.parse(await evaluate(`JSON.stringify({
      lane: window.BitWave.state().lane,
      selected: document.querySelector('#stageBar .pane-head:not([hidden]) .lane-select').value
    })`));
    assert(after.lane === 3 && after.selected === '3', `Alt+3 did not select lane 3: ${JSON.stringify(after)}`);

    /* Split has two selects; the second is named for its pane. */
    await click('#depthBtn');
    await sleep(200);
    await click('#stageBar .op.mini');
    await sleep(250);
    const split = JSON.parse(await evaluate(`JSON.stringify({
      selects: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .lane-select')].map((select) => ({
        label: select.getAttribute('aria-label'),
        value: select.value
      }))
    })`));
    assert(split.selects.length === 2, `split selects: ${JSON.stringify(split.selects)}`);
    assert(split.selects[0].label === 'Lane', `first pane label: ${split.selects[0].label}`);
    assert(split.selects[1].label === 'Lane (second pane)', `second pane label: ${split.selects[1].label}`);
    await selectLaneInPane('1', 1);
    const panes = JSON.parse(await evaluate(`JSON.stringify(window.BitWave.state().view.splitPair)`));
    assert(panes[1] === 1, `second pane did not select lane 1: ${JSON.stringify(panes)}`);
    return 'native select per pane · Lane 1…N labels · change selects · Alt+3 · split second-pane label';
  });

  await runCheck('a11y · all interactive targets are at least 24px', async () => {
    await loadApp();
    await click('#depthBtn');   // stage-bar mini controls only exist in 3-D
    await sleep(200);
    const stageSizes = JSON.parse(await evaluate(`JSON.stringify((() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
      const minis = [...document.querySelectorAll('.op.mini, .pane-fold, .pane-copy, .seg.mini .op')]
        .filter((el) => el.offsetParent !== null);
      const laneSelect = document.querySelector('#stageBar .lane-select');
      const truth = rect(document.getElementById('truthToggle'));
      return {
        miniCount: minis.length,
        minW: minis.length ? Math.min(...minis.map((el) => rect(el).w)) : 0,
        minH: minis.length ? Math.min(...minis.map((el) => rect(el).h)) : 0,
        selectW: rect(laneSelect).w,
        selectH: rect(laneSelect).h,
        truthW: truth.w,
        truthH: truth.h,
        rangeH: rect(document.getElementById('size')).h,
      };
    })())`));
    assert(stageSizes.miniCount > 0, 'no stage-bar mini controls found');
    assert(stageSizes.minW >= 24 && stageSizes.minH >= 24, `mini controls ${stageSizes.minW.toFixed(1)}×${stageSizes.minH.toFixed(1)} < 24`);
    assert(stageSizes.selectW >= 24 && stageSizes.selectH >= 24, `lane select ${stageSizes.selectW.toFixed(1)}×${stageSizes.selectH.toFixed(1)} < 24`);
    assert(stageSizes.truthW > 24 && stageSizes.truthH >= 24, `truth toggle target ${stageSizes.truthW.toFixed(1)}×${stageSizes.truthH.toFixed(1)} < 24`);
    assert(stageSizes.rangeH >= 24, `width slider target height ${stageSizes.rangeH}`);

    /* The frames view's lane-head controls are only laid out while it is open. */
    await openFramesView();
    const laneHead = JSON.parse(await evaluate(`JSON.stringify((() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
      const actions = [...document.querySelectorAll('#framesGrid .lane-act')];
      return {
        count: actions.length,
        minW: actions.length ? Math.min(...actions.map((el) => rect(el).w)) : 0,
        minH: actions.length ? Math.min(...actions.map((el) => rect(el).h)) : 0,
      };
    })())`));
    assert(laneHead.count >= 6, `lane-head controls: ${laneHead.count}`);
    assert(laneHead.minW >= 24 && laneHead.minH >= 24, `lane head controls ${laneHead.minW.toFixed(1)}×${laneHead.minH.toFixed(1)} < 24`);
    return `minis ≥ ${stageSizes.minW.toFixed(0)}×${stageSizes.minH.toFixed(0)}px · lane select ${stageSizes.selectW.toFixed(0)}×${stageSizes.selectH.toFixed(0)}px · lane acts ≥ ${laneHead.minW.toFixed(0)}×${laneHead.minH.toFixed(0)}px`;
  });

  await runCheck('a11y · prefers-reduced-motion removes transitions and keeps the LFO usable', async () => {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    try {
      await loadApp();
      const reduced = JSON.parse(await evaluate(`JSON.stringify({
        matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        hint: getComputedStyle(document.getElementById('hint')).transitionDuration,
        bit: getComputedStyle(document.querySelector('#nibs .bit')).transitionDuration,
        lfoPressed: document.getElementById('lfoBtn').getAttribute('aria-pressed')
      })`));
      assert(reduced.matches === true, 'media emulation did not apply');
      assert(reduced.hint === '0s' && reduced.bit === '0s', `transitions not removed: hint ${reduced.hint}, bit ${reduced.bit}`);
      assert(reduced.lfoPressed === 'false', 'LFO should start off');
      await click('#lfoBtn');
      await sleep(200);
      const on = await evaluate(`document.getElementById('lfoBtn').getAttribute('aria-pressed')`);
      assert(on === 'true', 'LFO cannot be started under reduced motion');
      await click('#lfoBtn');
      return 'transitions 0s · LFO off by default, startable (rate capped 4/s)';
    } finally {
      await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  /* 5e. F4 IA — module order, stage bar, copy menu, hex entry, map ------- */
  await runCheck('ia · stage bar is always visible and owns lane + frames + split', async () => {
    await loadApp();
    let bar = JSON.parse(await evaluate(`JSON.stringify({
      visible: document.getElementById('stageBar').offsetParent !== null,
      hasFrames: document.getElementById('stageBar').contains(document.getElementById('framesBtn')),
      laneSelects: document.querySelectorAll('#stageBar .pane-head:not([hidden]) .lane-select').length,
      laneOptions: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .lane-select option')].length,
      splitDisabled: document.querySelector('#stageBar .op.mini').getAttribute('aria-disabled'),
      expr: document.querySelector('#stageBar .stage-expr').textContent,
      controlsHasLane: document.querySelectorAll('.controls [data-lane]').length,
      controlsHasSplit: document.querySelectorAll('.controls .op.mini').length,
      foldsVisible: [...document.querySelectorAll('#stageBar .pane-fold')].filter((b) => !b.hidden).length,
      copiesVisible: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .pane-copy')].length
    })`));
    assert(bar.visible, 'stage bar is hidden in 2-D');
    assert(bar.hasFrames, 'frames opener is not in the stage bar');
    assert(bar.laneSelects === 1, `stage-bar lane selects: ${bar.laneSelects}`);
    assert(bar.laneOptions === 3, `stage-bar lane options: ${bar.laneOptions}`);
    assert(bar.splitDisabled === 'true', `split should be aria-disabled in 2-D: ${bar.splitDisabled}`);
    assert(/LANE 1 · A ⊕ B → Z1/.test(bar.expr), `stage expression: ${JSON.stringify(bar.expr)}`);
    assert(bar.controlsHasLane === 0, 'lane set is duplicated in the controls row');
    assert(bar.controlsHasSplit === 0, 'split is duplicated in the controls row');
    assert(bar.foldsVisible === 0, `the D47 hinge should be hidden in 2-D: ${bar.foldsVisible} visible`);
    assert(bar.copiesVisible === 1, `the per-pane copy opener should be in place in 2-D: ${bar.copiesVisible}`);

    await click('#depthBtn');
    await sleep(200);
    bar = JSON.parse(await evaluate(`JSON.stringify({
      splitDisabled: document.querySelector('#stageBar .op.mini').getAttribute('aria-disabled'),
      expr: document.querySelector('#stageBar .stage-expr').textContent,
      foldsVisible: [...document.querySelectorAll('#stageBar .pane-fold')].filter((b) => !b.hidden).length,
      foldLabel: document.querySelector('#stageBar .pane-fold:not([hidden])').textContent.trim()
    })`));
    assert(bar.splitDisabled === 'false', 'split should be enabled in 3-D');
    assert(bar.foldsVisible === 1 && bar.foldLabel === 'A far', `3-D hinge: ${JSON.stringify(bar)}`);

    await click('#stageBar .op.mini');
    await sleep(250);
    const split = JSON.parse(await evaluate(`JSON.stringify({
      panes: [...document.querySelectorAll('#stageBar .pane-head')].filter((p) => !p.hidden).length,
      expr: document.querySelector('#stageBar .pane-head[data-pane="1"] .stage-expr').textContent,
      folds: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .pane-fold')].length,
      copies: [...document.querySelectorAll('#stageBar .pane-head:not([hidden]) .pane-copy')].length
    })`));
    assert(split.panes === 2, `split panes: ${split.panes}`);
    assert(/C ⊕ D → Z2/.test(split.expr), `split second-pane expression: ${JSON.stringify(split.expr)}`);
    assert(split.folds === 2 && split.copies === 2, `split per-pane controls: ${JSON.stringify(split)}`);

    await click('#stageBar .pane-head[data-pane="1"] .op.mini');
    await sleep(250);
    const unsplit = await evaluate(`[...document.querySelectorAll('#stageBar .pane-head')].filter((p) => !p.hidden).length`);
    assert(unsplit === 1, `returning from split left ${unsplit} panes visible`);
    return 'stage bar visible in 2-D and 3-D · lane+frames+split+fold+copy single home · split panes';
  });

  await runCheck('ia · top-bar VIEW control replaces the bottom VIEW row', async () => {
    await loadApp();
    const bar = JSON.parse(await evaluate(`JSON.stringify((() => {
      const header = document.querySelector('header');
      const btn = document.getElementById('depthBtn');
      const view = document.querySelector('.header-view');
      const help = document.getElementById('helpBtn');
      return {
        inHeader: header.contains(btn),
        label: view ? view.querySelector('.view-label').textContent.trim() : null,
        groupLabel: view ? view.getAttribute('aria-label') : null,
        leftOfHelp: view ? view.getBoundingClientRect().left < help.getBoundingClientRect().left : false,
        text: btn.textContent.trim(),
        pressed: btn.getAttribute('aria-pressed'),
        inControls: document.querySelectorAll('.controls #depthBtn').length,
        viewGroups: document.querySelectorAll('.controls .group[aria-label="view"]').length
      };
    })())`));
    assert(bar.inHeader && bar.inControls === 0, 'the view control is not in the top bar');
    assert(bar.label === 'view' && bar.groupLabel === 'view', `VIEW label/group: ${JSON.stringify(bar)}`);
    assert(bar.leftOfHelp, 'the VIEW control is not immediately left of the help button');
    assert(bar.text === '3D' && bar.pressed === 'false', `depth button state: ${JSON.stringify(bar)}`);
    assert(bar.viewGroups === 0, 'the bottom VIEW group still exists in the controls row');

    await click('#depthBtn');
    await sleep(200);
    assert(
      (await evaluate(`document.getElementById('depthBtn').getAttribute('aria-pressed')`)) === 'true',
      'the top-bar 3D toggle did not turn 3-D on',
    );
    await evaluate(`document.getElementById('depthBtn').focus()`);
    await pressActivate();
    await sleep(200);
    assert(
      (await evaluate(`document.getElementById('depthBtn').getAttribute('aria-pressed')`)) === 'false',
      'the top-bar 3D toggle did not turn 3-D off from the keyboard',
    );

    /* The header must hold the re-homed control at every shipped breakpoint. */
    for (const [width, height] of [[360, 780], [720, 900], [1440, 900]]) {
      await loadApp({ width, height });
      const fit = JSON.parse(await evaluate(`JSON.stringify((() => {
        const h = document.querySelector('header');
        const view = document.querySelector('.header-view');
        return {
          pageOverflow: document.body.scrollWidth - document.body.clientWidth,
          headerOverflow: h.scrollWidth - h.clientWidth,
          viewVisible: view.offsetParent !== null,
          depthLeft: document.getElementById('depthBtn').getBoundingClientRect().left,
          helpLeft: document.getElementById('helpBtn').getBoundingClientRect().left
        };
      })())`));
      assert(fit.pageOverflow === 0, `header caused horizontal overflow at ${width}: ${fit.pageOverflow}`);
      assert(fit.headerOverflow <= 0, `header content overflows at ${width}: ${fit.headerOverflow}`);
      assert(fit.viewVisible, `the VIEW control is not laid out at ${width}`);
      assert(fit.helpLeft > fit.depthLeft, `VIEW is not left of ? at ${width}`);
    }
    return 'VIEW + 3D in the header left of ? · click and Enter toggle · no overflow at 360/720/1440';
  });

  await runCheck('ia · reserved space: modules and disabled placeholders stay put', async () => {
    await loadApp();
    const boot = JSON.parse(await evaluate(`JSON.stringify({
      groups: [...document.querySelectorAll('.controls .group')].map((g) => g.getAttribute('aria-label')),
      binops: [...document.querySelectorAll('#binopSet [data-binop]')].map((b) => ({
        visible: b.offsetParent !== null,
        disabled: b.getAttribute('aria-disabled'),
        checked: b.getAttribute('aria-checked')
      })),
      bState: document.getElementById('bState').textContent,
      stepDisabled: document.getElementById('stepSeg').getAttribute('aria-disabled'),
      stepVisible: document.getElementById('stepSeg').offsetParent !== null,
      exCount: document.getElementById('exCount').textContent.trim(),
      logVisible: document.getElementById('obsSeg').offsetParent !== null,
      hexDisabled: document.getElementById('hexEntry').disabled,
      hexFits: (() => {
        const el = document.getElementById('hexEntry');
        return el.scrollWidth <= el.clientWidth + 1;
      })()
    })`));
    assert(
      JSON.stringify(boot.groups) === JSON.stringify(['source', 'register edit', 'operate', 'derive', 'motion']),
      `module order: ${JSON.stringify(boot.groups)}`
    );
    assert(boot.binops.every((b) => b.visible), 'binops were removed from the DOM without B');
    assert(boot.binops.every((b) => b.disabled === 'true'), 'binops are not aria-disabled without B');
    assert(boot.binops.filter((b) => b.checked === 'true').length === 1, 'exactly one binop checked');
    assert(boot.bState === 'B off', `B state chip: ${boot.bState}`);
    assert(boot.stepVisible && boot.stepDisabled === 'true', 'CSV stepper should be reserved-space disabled');
    assert(boot.exCount === '— / —', `exCount before a load: ${boot.exCount}`);
    assert(boot.logVisible, 'log/export should be visible before a load');
    assert(boot.hexDisabled === false, 'hex entry should be editable on operand A');
    assert(boot.hexFits, 'the 16-digit hex word is clipped in the entry field');

    await importCsv();
    const loaded = JSON.parse(await evaluate(`JSON.stringify({
      stepDisabled: document.getElementById('stepSeg').getAttribute('aria-disabled'),
      exCount: document.getElementById('exCount').textContent.trim()
    })`));
    assert(loaded.stepDisabled === 'false', 'stepper still disabled after import');
    assert(loaded.exCount === '1 / 1', `exCount after import: ${loaded.exCount}`);

    await click('#depthBtn');
    await sleep(200);
    const bOn = JSON.parse(await evaluate(`JSON.stringify({
      disabled: document.querySelector('#binopSet [data-binop]').getAttribute('aria-disabled'),
      checkedTab: [...document.querySelectorAll('#binopSet [data-binop]')]
        .find((b) => b.getAttribute('aria-checked') === 'true')?.getAttribute('tabindex'),
      bState: document.getElementById('bState').textContent
    })`));
    assert(bOn.disabled === 'false', 'binops should enable with B');
    assert(bOn.checkedTab === '0', `checked binop tabindex: ${bOn.checkedTab}`);
    assert(bOn.bState === 'B on', `B state chip: ${bOn.bState}`);
    return 'five modules in order · disabled placeholders stay in place';
  });

  await runCheck('ia · per-pane copy to… menu: source lane, dynamic anchor, Esc', async () => {
    await loadApp();
    /* D47: the copy opener lives in the pane head, in place in 2-D, and names its
       own source lane (the pane's lane, not necessarily the focused one). */
    const boot = JSON.parse(await evaluate(`JSON.stringify((() => {
      const opener = document.querySelector('#stageBar .pane-head:not([hidden]) .pane-copy');
      return {
        text: opener.textContent.trim(),
        expanded: opener.getAttribute('aria-expanded'),
        disabled: opener.getAttribute('aria-disabled'),
        haspopup: opener.getAttribute('aria-haspopup'),
        viewGroups: document.querySelectorAll('.controls .group[aria-label="view"]').length,
        viewRowBtn: Boolean(document.querySelector('.controls #depthBtn')),
      };
    })())`));
    assert(boot.text === 'copy to…', `copy opener text: ${JSON.stringify(boot.text)}`);
    assert(boot.haspopup === 'menu' && boot.expanded === 'false', `copy opener state: ${JSON.stringify(boot)}`);
    assert(boot.disabled === 'false', 'copy should be enabled with three lanes');
    assert(boot.viewGroups === 0 && boot.viewRowBtn === false, 'the bottom VIEW row/group is still present');

    await click('#stageBar .pane-head:not([hidden]) .pane-copy');
    let menu = JSON.parse(await evaluate(`JSON.stringify({
      open: !document.querySelector('.copy-menu').hidden,
      role: document.querySelector('.copy-menu').getAttribute('role'),
      label: document.querySelector('.copy-menu').getAttribute('aria-label'),
      items: [...document.querySelectorAll('.copy-menu [role="menuitem"]')].map((b) => b.textContent.trim()),
      expanded: document.querySelector('#stageBar .pane-head:not([hidden]) .pane-copy').getAttribute('aria-expanded'),
      focused: document.activeElement.getAttribute('role')
    })`));
    assert(menu.open && menu.role === 'menu', 'copy menu did not open as a menu');
    assert(menu.label === 'copy lane 1 to', `menu name does not name the source lane: ${JSON.stringify(menu.label)}`);
    assert(
      JSON.stringify(menu.items) === JSON.stringify(['lane 2', 'lane 3']),
      `menu items exclude the source lane: ${JSON.stringify(menu.items)}`,
    );
    assert(menu.expanded === 'true', 'copy opener aria-expanded is not true');
    assert(menu.focused === 'menuitem', `focus did not move into the menu: ${menu.focused}`);
    assert((await evaluate(`window.BitWave.state().editing.copyArmed`)) === true, 'copyArmed not reported while open');

    await keydown('Escape');
    menu = JSON.parse(await evaluate(`JSON.stringify({
      open: !document.querySelector('.copy-menu').hidden,
      focusedClass: document.activeElement.className,
      armed: window.BitWave.state().editing.copyArmed
    })`));
    assert(
      menu.open === false && /pane-copy/.test(menu.focusedClass) && menu.armed === false,
      `Esc did not close cleanly and return focus: ${JSON.stringify(menu)}`,
    );

    await click('#stageBar .pane-head:not([hidden]) .pane-copy');
    await sleep(100);
    const before = JSON.parse(await evaluate(`JSON.stringify({
      a: window.BitWave.state().lanes['1'].frames.A,
      b: window.BitWave.state().lanes['1'].frames.B
    })`));
    await click('.copy-menu [data-lane="2"]');
    await sleep(300);
    const copied = JSON.parse(await evaluate(`JSON.stringify({
      c: window.BitWave.state().lanes['2'].frames.C,
      d: window.BitWave.state().lanes['2'].frames.D,
      open: !document.querySelector('.copy-menu').hidden,
      live: document.getElementById('liveStatus').textContent.trim()
    })`));
    assert(copied.c === before.a && copied.d === before.b, `lane 2 was not copied: ${JSON.stringify(copied)}`);
    assert(copied.open === false, 'menu stayed open after copy');
    assert(/copied lane 1 → lane 2/.test(copied.live), `live status did not report the copy: ${copied.live}`);

    /* Split: the second pane's opener is the source lane for its own menu. */
    await click('#depthBtn');
    await waitFor(`document.getElementById('depthBtn').getAttribute('aria-pressed') === 'true'`, '3-D');
    await click('#stageBar .op.mini');
    await sleep(250);
    await click('#stageBar .pane-head[data-pane="1"] .pane-copy');
    const splitMenu = JSON.parse(await evaluate(`JSON.stringify({
      label: document.querySelector('.copy-menu').getAttribute('aria-label'),
      items: [...document.querySelectorAll('.copy-menu [role="menuitem"]')].map((b) => b.textContent.trim()),
      open: !document.querySelector('.copy-menu').hidden
    })`));
    assert(splitMenu.open, 'the split pane copy menu did not open');
    assert(splitMenu.label === 'copy lane 2 to', `split menu source: ${JSON.stringify(splitMenu.label)}`);
    assert(
      JSON.stringify(splitMenu.items) === JSON.stringify(['lane 1', 'lane 3']),
      `split menu destinations: ${JSON.stringify(splitMenu.items)}`,
    );
    await keydown('Escape');

    /* With a single live lane the opener stays in place, disabled with a reason. */
    await openFramesView();
    for (const key of ['2', '3']) {
      await click(`#framesGrid [data-lane="${key}"] [data-act="del"]`);
      await sleep(180);
      await click(`#framesGrid [data-lane="${key}"] [data-act="confirm"]`);
      await sleep(320);
    }
    await click('#lanesBtn');
    await sleep(250);
    const oneLane = JSON.parse(await evaluate(`JSON.stringify((() => {
      const opener = document.querySelector('#stageBar .pane-head:not([hidden]) .pane-copy');
      return {
        lanes: Object.keys(window.bitwave.getState().lanes).length,
        disabled: opener.getAttribute('aria-disabled'),
        title: opener.title,
        expanded: opener.getAttribute('aria-expanded')
      };
    })())`));
    assert(oneLane.lanes === 1, `lanes after delete: ${oneLane.lanes}`);
    assert(oneLane.disabled === 'true', 'copy should be aria-disabled with one lane');
    assert(/second live lane/.test(oneLane.title), `one-lane copy title: ${JSON.stringify(oneLane.title)}`);
    await click('#stageBar .pane-head:not([hidden]) .pane-copy');
    await sleep(120);
    assert(
      (await evaluate(`document.querySelector('.copy-menu').hidden`)) === true,
      'a disabled copy opener still opened the menu',
    );
    return 'in-place per-pane opener · names source lane · excludes it · Esc/refocus · split source follows the pane · disabled at one lane';
  });

  await runCheck('ia · whole-word hex entry commits, rejects and reverts', async () => {
    await loadApp();
    const commit = async (text) => {
      await evaluate(`(() => {
        const el = document.getElementById('hexEntry');
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        return true;
      })()`);
      await sleep(150);
      return JSON.parse(await evaluate(`JSON.stringify({
        hex: document.getElementById('hex').textContent.trim(),
        invalid: document.getElementById('hexEntry').getAttribute('aria-invalid'),
        value: document.getElementById('hexEntry').value
      })`));
    };

    let result = await commit('DEADBEEF');
    assert(result.hex === '00000000DEADBEEF', `hex entry did not right-align: ${result.hex}`);
    assert(result.invalid === null, 'valid hex was marked invalid');

    result = await commit('ZZZZ');
    assert(result.invalid === 'true', 'invalid hex was not flagged');
    assert(result.hex === '00000000DEADBEEF', `invalid hex reached the register: ${result.hex}`);

    await evaluate(`(() => {
      const el = document.getElementById('hexEntry');
      el.focus();
      el.value = 'ABC';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`);
    const reverted = await evaluate(`document.getElementById('hexEntry').value`);
    assert(reverted === '00000000DEADBEEF', `Esc did not revert the hex entry: ${reverted}`);

    await openFramesView();
    await pickFrameCard('1', 'z');
    const derived = JSON.parse(await evaluate(`JSON.stringify({
      disabled: document.getElementById('hexEntry').disabled,
      value: document.getElementById('hexEntry').value,
      target: document.getElementById('editTarget').textContent.trim()
    })`));
    assert(derived.disabled === true, 'hex entry should be disabled on a derived frame');
    assert(derived.target.includes('read-only'), `edit target: ${derived.target}`);
    return 'right-aligned commit · invalid refused · Esc reverts · derived disabled';
  });

  await runCheck('ia · keyboard map opens with ? and closes with Escape', async () => {
    await loadApp();
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }))`);
    await sleep(120);
    const open = JSON.parse(await evaluate(`JSON.stringify({
      visible: !document.getElementById('helpPanel').hidden,
      expanded: document.getElementById('helpBtn').getAttribute('aria-expanded'),
      rows: document.querySelectorAll('#helpPanel .help-list dt').length,
      focused: document.activeElement.id
    })`));
    assert(open.visible, '? did not open the keyboard map');
    assert(open.expanded === 'true' && open.rows >= 8, `keyboard map state: ${JSON.stringify(open)}`);
    assert(open.focused === 'helpClose', `focus did not move into the map: ${open.focused}`);

    await evaluate(`document.getElementById('helpPanel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await sleep(120);
    const closed = JSON.parse(await evaluate(`JSON.stringify({
      visible: !document.getElementById('helpPanel').hidden,
      expanded: document.getElementById('helpBtn').getAttribute('aria-expanded')
    })`));
    assert(closed.visible === false && closed.expanded === 'false', 'Escape did not close the keyboard map');
    return '? opens · focus moves in · Escape closes';
  });

  await runCheck('ia · truth disclosure: header, table semantics, in-place toggle', async () => {
    await loadApp();
    /* D47: present by default in A-only (no longer gated on A·B). */
    const aOnly = JSON.parse(await evaluate(`JSON.stringify({
      visible: document.getElementById('truthBlock').offsetParent !== null,
      expanded: document.getElementById('truthToggle').getAttribute('aria-expanded'),
      controls: document.getElementById('truthToggle').getAttribute('aria-controls'),
      title: document.querySelector('#truthToggle .truth-title').textContent.trim(),
      label: document.getElementById('truthToggle').getAttribute('aria-label'),
      chev: document.querySelector('#truthToggle .truth-chev').textContent.trim(),
      bodyHidden: document.getElementById('truthBody').hidden,
      tableRole: document.querySelector('#truth [role="table"]')?.getAttribute('role') ?? null,
      rows: document.querySelectorAll('#truth [role="row"]').length,
      headers: document.querySelectorAll('#truth [role="columnheader"]').length,
      cells: document.querySelectorAll('#truth [role="cell"]').length,
      counts: [...document.querySelectorAll('#truth .ct')].map((el) => el.textContent.trim()),
      hexLeft: document.getElementById('hex').getBoundingClientRect().left,
      blockLeft: document.getElementById('truthBlock').getBoundingClientRect().left,
      blockWidth: document.getElementById('truthBlock').getBoundingClientRect().width
    })`));
    assert(aOnly.visible, 'the truth disclosure is missing in A-only');
    assert(aOnly.expanded === 'true' && aOnly.bodyHidden === false, `default open state: ${JSON.stringify(aOnly)}`);
    assert(aOnly.controls === 'truthBody', `aria-controls: ${aOnly.controls}`);
    assert(aOnly.title === 'A ⊕ B → Z1', `header text: ${JSON.stringify(aOnly.title)}`);
    assert(aOnly.label === 'truth table for lane 1 A ⊕ B → Z1', `accessible name: ${JSON.stringify(aOnly.label)}`);
    assert(aOnly.tableRole === 'table', 'truth table has no table role');
    assert(aOnly.rows === 5, `truth rows: ${aOnly.rows}`);
    assert(aOnly.headers === 4, `truth column headers: ${aOnly.headers}`);
    assert(aOnly.cells === 16, `truth cells: ${aOnly.cells}`);
    assert(
      JSON.stringify(aOnly.counts) === JSON.stringify(['23', '11', '9', '21']),
      `A-only truth counts: ${JSON.stringify(aOnly.counts)}`,
    );

    /* Collapsing must not move the hex readout horizontally. */
    await click('#truthToggle');
    await sleep(150);
    const collapsed = JSON.parse(await evaluate(`JSON.stringify({
      expanded: document.getElementById('truthToggle').getAttribute('aria-expanded'),
      bodyHidden: document.getElementById('truthBody').hidden,
      chev: document.querySelector('#truthToggle .truth-chev').textContent.trim(),
      hexLeft: document.getElementById('hex').getBoundingClientRect().left,
      blockWidth: document.getElementById('truthBlock').getBoundingClientRect().width
    })`));
    assert(collapsed.expanded === 'false' && collapsed.bodyHidden === true, `collapsed state: ${JSON.stringify(collapsed)}`);
    assert(collapsed.chev !== aOnly.chev, 'the chevron did not flip with the disclosure');
    assert(
      collapsed.hexLeft === aOnly.hexLeft && collapsed.blockWidth === aOnly.blockWidth,
      `collapsing moved the readouts: hex ${aOnly.hexLeft}→${collapsed.hexLeft}, block ${aOnly.blockWidth}→${collapsed.blockWidth}`,
    );

    /* Keyboard: native button + Enter toggles it back open. */
    await evaluate(`document.getElementById('truthToggle').focus()`);
    await pressActivate();
    await sleep(150);
    const reopened = JSON.parse(await evaluate(`JSON.stringify({
      expanded: document.getElementById('truthToggle').getAttribute('aria-expanded'),
      bodyHidden: document.getElementById('truthBody').hidden,
      hexLeft: document.getElementById('hex').getBoundingClientRect().left
    })`));
    assert(reopened.expanded === 'true' && reopened.bodyHidden === false, 'keyboard Enter did not reopen the disclosure');
    assert(reopened.hexLeft === aOnly.hexLeft, 'reopening moved the hex readout');
    return 'present in A-only · A ⊕ B → Z1 header · role=table 5 rows · Enter/click toggles · readouts stay put';
  });

  await runCheck('ia · truth disclosure is present in every view and follows the lane', async () => {
    await loadApp();
    const read = async () => JSON.parse(await evaluate(`JSON.stringify({
      visible: document.getElementById('truthBlock').offsetParent !== null,
      title: document.querySelector('#truthToggle .truth-title').textContent.trim(),
      label: document.getElementById('truthToggle').getAttribute('aria-label'),
      expanded: document.getElementById('truthToggle').getAttribute('aria-expanded')
    })`));

    /* A·B in 2-D (choose the B card, which returns to the lanes view). */
    await openFramesView();
    await pickFrameCard('1', 'b');
    let state = await read();
    assert(state.visible && state.title === 'A ⊕ B → Z1', `A·B truth: ${JSON.stringify(state)}`);

    /* 3-D. */
    await click('#depthBtn');
    await sleep(200);
    state = await read();
    assert(state.visible && state.title === 'A ⊕ B → Z1', `3-D truth: ${JSON.stringify(state)}`);
    const aLeft3d = await evaluate(`document.getElementById('hexA').getBoundingClientRect().left`);
    await click('#truthToggle');
    await sleep(150);
    const collapsed3d = JSON.parse(await evaluate(`JSON.stringify({
      expanded: document.getElementById('truthToggle').getAttribute('aria-expanded'),
      headerVisible: document.getElementById('truthToggle').offsetParent !== null,
      aLeft: document.getElementById('hexA').getBoundingClientRect().left
    })`));
    assert(collapsed3d.expanded === 'false' && collapsed3d.headerVisible, 'the truth header is not visible while collapsed');
    assert(collapsed3d.aLeft === aLeft3d, `collapsing moved the 3-D hex readout: ${aLeft3d}→${collapsed3d.aLeft}`);
    await click('#truthToggle');
    await sleep(150);

    /* Lane 4 (>1 lane) names its own frames: G ⊕ H → Z4. Add two lanes through
       the frames view's live + tile, leave 3-D (so the blank lane's B stays
       zero), then focus lane 4. */
    await openFramesView();
    await click('#framesGrid .frame-add');
    await click('#framesGrid .frame-add');
    await sleep(300);
    await click('#lanesBtn');
    await sleep(200);
    await click('#depthBtn');
    await sleep(200);
    await selectLaneInPane('4', 0);
    state = await read();
    assert(
      state.title === 'G ⊕ H → Z4' && state.label === 'truth table for lane 4 G ⊕ H → Z4',
      `lane 4 truth header/name: ${JSON.stringify(state)}`,
    );
    const lane4Table = JSON.parse(await evaluate(`JSON.stringify({
      counts: [...document.querySelectorAll('#truth .ct')].map((el) => el.textContent.trim()),
      rows: document.querySelectorAll('#truth [role="row"]').length
    })`));
    assert(JSON.stringify(lane4Table.counts) === JSON.stringify(['64', '0', '0', '0']), `lane 4 counts: ${JSON.stringify(lane4Table.counts)}`);

    /* Arithmetic variant in the same disclosure: ADD gets the carry-out row. */
    await evaluate(`window.bitwave.setBinop('add')`);
    await sleep(200);
    state = await read();
    const arith = JSON.parse(await evaluate(`JSON.stringify({
      title: document.querySelector('#truthToggle .truth-title').textContent.trim(),
      rows: document.querySelectorAll('#truth [role="row"]').length,
      headers: [...document.querySelectorAll('#truth [role="columnheader"]')].map((el) => el.textContent.trim()),
      cells: [...document.querySelectorAll('#truth [role="cell"]')].map((el) => el.textContent.trim())
    })`));
    assert(state.title === 'G + H → Z4', `arithmetic header: ${JSON.stringify(state.title)}`);
    assert(arith.rows === 1 && arith.headers.join(',') === 'carry out', `arithmetic rows: ${JSON.stringify(arith)}`);
    assert(arith.cells.length === 1 && (arith.cells[0] === 'no' || arith.cells[0] === 'yes'), `carry cell: ${JSON.stringify(arith.cells)}`);

    /* Split: the disclosure stays bound to the focused lane (pane 0 focus). */
    await click('#depthBtn');
    await sleep(200);
    await click('#stageBar .op.mini');
    await sleep(250);
    await click('#stageBar .pane-head[data-pane="0"]');
    await sleep(250);
    state = await read();
    assert(
      state.visible && state.title === 'A ⊕ B → Z1',
      `split truth did not follow the focused pane: ${JSON.stringify(state)}`,
    );
    return 'present in A-only/A·B/3-D/split · lane 4 G ⊕ H → Z4 · ADD carry-out variant · follows focus';
  });

  /* 5f. F5 — persistence & reach ---------------------------------------- */
  await runCheck('f5 · project menu: focus-in, Esc, open applies a document, reset returns to boot', async () => {
    await loadApp();
    await click('#projectBtn');
    let menu = JSON.parse(await evaluate(`JSON.stringify({
      open: !document.querySelector('.project-menu').hidden,
      items: [...document.querySelectorAll('.project-menu [role="menuitem"]')].map((b) => b.textContent.trim()),
      expanded: document.getElementById('projectBtn').getAttribute('aria-expanded'),
      focused: document.activeElement.getAttribute('role')
    })`));
    assert(menu.open && menu.expanded === 'true', 'project menu did not open');
    assert(
      JSON.stringify(menu.items) === JSON.stringify(['save project', 'open project…', 'reset instrument']),
      `project menu items: ${JSON.stringify(menu.items)}`
    );
    assert(menu.focused === 'menuitem', `focus not in the project menu: ${menu.focused}`);

    await keydown('Escape');
    menu = JSON.parse(await evaluate(`JSON.stringify({
      open: !document.querySelector('.project-menu').hidden,
      focused: document.activeElement.id
    })`));
    assert(menu.open === false && menu.focused === 'projectBtn', `Esc did not close cleanly: ${JSON.stringify(menu)}`);

    const projectDoc = {
      schema: 2, app: 'bitwave', savedAt: '2026-11-06T00:00:00.000Z', N: 16,
      view: {
        lane: '2', view3d: false, split3d: false, splitPair: ['1', '2'], activePane: 0,
        lfoMode: 'slide', lfoRate: 8,
      },
      lanes: {
        '1': { a: 'DEAD', b: 'BEEF', showB: true, binop: 'and', edit: 'b', seededB: true, lfoB: 'opp', colA: 0, colB: 2, focus: 'b', frameVis: { a: false, b: true, z: true } },
        '2': { a: '0123', b: '4567', showB: false, binop: 'xor', edit: 'a', seededB: false, lfoB: '0', colA: -1, colB: -1, focus: 'a', frameVis: { a: true, b: true, z: true } },
        '3': { a: '89AB', b: 'CDEF', showB: true, binop: 'add', edit: 'a', seededB: true, lfoB: 'q', colA: 1, colB: -1, focus: 'z', frameVis: { a: true, b: false, z: true } },
      },
      routes: [{ from: '1.z', to: '3.a', mix: 'set' }],
      parked: { '3.a': '89AB' },
    };
    await evaluate(`(() => {
      const doc = ${JSON.stringify(projectDoc)};
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(doc)], 'roundtrip.bitwave', { type: 'application/json' }));
      const input = document.getElementById('projectFile');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(450);
    const loaded = JSON.parse(await evaluate(`JSON.stringify({
      size: document.getElementById('sizeOut').textContent.trim(),
      lane: window.BitWave.state().lane,
      a: window.BitWave.state().lanes['1'].frames.A,
      focus: window.BitWave.state().lanes['1'].focus,
      status: document.getElementById('csvStatus').textContent.trim()
    })`));
    assert(loaded.size === '16 bits · 4 nibbles', `opened width: ${loaded.size}`);
    assert(loaded.a === 'DEAD', `opened lane 1 A: ${loaded.a}`);
    assert(loaded.lane === 2, `opened lane: ${loaded.lane}`);
    assert(loaded.focus === 'B', `opened focus: ${loaded.focus}`);
    assert(/opened roundtrip\.bitwave/.test(loaded.status), `open status: ${loaded.status}`);

    await click('#projectBtn');
    await click('.project-menu [role="menuitem"]:last-child');
    await sleep(350);
    const reset = JSON.parse(await evaluate(`JSON.stringify({
      hex: document.getElementById('hex').textContent.trim(),
      size: document.getElementById('sizeOut').textContent.trim(),
      status: document.getElementById('csvStatus').textContent.trim()
    })`));
    assert(
      reset.hex === '8ADEFEDA85210125' && reset.size === '64 bits · 16 nibbles',
      `reset state: ${JSON.stringify(reset)}`
    );
    assert(/reset to the boot state/.test(reset.status), `reset status: ${reset.status}`);

    /* A newer schema is refused with a distinct, visible reason. */
    await evaluate(`(() => {
      const doc = { schema: 99, app: 'bitwave', N: 64, view: {}, lanes: {} };
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(doc)], 'future.bitwave', { type: 'application/json' }));
      const input = document.getElementById('projectFile');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    const future = JSON.parse(await evaluate(`JSON.stringify({
      status: document.getElementById('csvStatus').textContent.trim(),
      error: document.getElementById('csvStatus').classList.contains('is-error')
    })`));
    assert(future.error === true && /newer than supported/.test(future.status), `future schema status: ${future.status}`);
    return 'menu focus-in/Esc · open applies a v2 document · reset returns to boot · newer schema refused';
  });

  await runCheck('f5 · demo dataset loads eight rows and binds the board', async () => {
    await loadApp();
    await click('#demoBtn');
    await sleep(450);
    const demo = JSON.parse(await evaluate(`JSON.stringify({
      step: document.getElementById('exCount').textContent.trim(),
      status: document.getElementById('csvStatus').textContent.trim(),
      size: document.getElementById('sizeOut').textContent.trim(),
      dataset: window.BitWave.state().dataset
    })`));
    assert(demo.step === '1 / 8', `demo stepper: ${demo.step}`);
    assert(/loaded 8 rows · 4 columns from demo dataset/.test(demo.status), `demo status: ${demo.status}`);
    assert(demo.size === '32 bits · 8 nibbles', `demo width: ${demo.size}`);
    assert(
      demo.dataset && demo.dataset.rows === 8 && demo.dataset.columns.length === 4,
      `demo dataset: ${JSON.stringify(demo.dataset)}`
    );
    return '8 rows · 4 columns · 32-bit register · status line reports it';
  });

  await runCheck('f5 · CSV errors are surfaced and stale data is kept', async () => {
    await loadApp();
    const before = await evaluate(`document.getElementById('hex').textContent.trim()`);
    const importText = async (text, name) => {
      await evaluate(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'text/csv' }));
        const input = document.getElementById('csvFile');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(400);
      return JSON.parse(await evaluate(`JSON.stringify({
        status: document.getElementById('csvStatus').textContent.trim(),
        error: document.getElementById('csvStatus').classList.contains('is-error'),
        hex: document.getElementById('hex').textContent.trim()
      })`));
    };

    let state = await importText('label,region\nnorth,east\nsouth,west\n', 'labels.csv');
    assert(state.error === true && /no numeric columns/.test(state.status), `non-token status: ${state.status}`);
    assert(state.hex === before, 'a non-token file replaced the register');

    state = await importText('', 'empty.csv');
    assert(state.error === true && /no data rows/.test(state.status), `empty-file status: ${state.status}`);
    return 'non-token file refused · empty file refused · register untouched';
  });

  await runCheck('f5 · autosave survives a reload', async () => {
    await loadApp({ query: 'keep' });
    await click('[data-preset="square"]');
    await sleep(850);
    const saved = JSON.parse(await evaluate(`JSON.stringify({
      raw: localStorage.getItem('bitwave.autosave.v2'),
      hex: document.getElementById('hex').textContent.trim()
    })`));
    assert(saved.raw, 'autosave key was not written');
    const parsed = JSON.parse(saved.raw);
    assert(parsed.schema === 4 && parsed.lanes['1'].a === saved.hex, `autosave schema/state: ${parsed.schema}`);

    await loadApp({ query: 'keep' });
    const restored = JSON.parse(await evaluate(`JSON.stringify({
      hex: document.getElementById('hex').textContent.trim(),
      status: document.getElementById('csvStatus').textContent.trim()
    })`));
    assert(restored.hex === saved.hex, `reload did not restore: ${restored.hex} vs ${saved.hex}`);
    assert(/restored from autosave/.test(restored.status), `restore status: ${restored.status}`);
    return `restored ${saved.hex} from autosave after a reload`;
  });

  await runCheck('f5 · URL fragment shares the state and restores it', async () => {
    await loadApp();
    await click('[data-preset="max"]');
    await sleep(950);
    const shared = JSON.parse(await evaluate(`JSON.stringify({
      hash: location.hash,
      hex: document.getElementById('hex').textContent.trim()
    })`));
    assert(/^#bw=/.test(shared.hash), `share fragment missing: ${shared.hash.slice(0, 40)}`);
    assert(shared.hash.length <= 2001, `share fragment too long: ${shared.hash.length}`);

    await loadPage(artifactUrl + shared.hash);
    const restored = JSON.parse(await evaluate(`JSON.stringify({
      hex: document.getElementById('hex').textContent.trim(),
      status: document.getElementById('csvStatus').textContent.trim()
    })`));
    assert(restored.hex === shared.hex, `share restore: ${restored.hex} vs ${shared.hex}`);
    assert(/restored from the shared link/.test(restored.status), `share status: ${restored.status}`);

    /* 256 bits is the worst case for the ~2 KB budget. */
    await loadApp();
    await evaluate(`(() => {
      const input = document.getElementById('size');
      input.value = '5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(1100);
    const longHash = await evaluate(`location.hash.length`);
    assert(longHash > 0 && longHash <= 2001, `256-bit share fragment: ${longHash}`);
    return `share link ≤ 2001 chars · round-trips · 256-bit ${longHash} chars`;
  });

  await runCheck('f5 · ?fresh is an ephemeral session', async () => {
    await loadApp({ query: 'fresh' });
    await click('[data-preset="square"]');
    await sleep(900);
    const ephemeral = JSON.parse(await evaluate(`JSON.stringify({
      status: document.getElementById('csvStatus').textContent.trim(),
      saved: localStorage.getItem('bitwave.autosave.v2'),
      hash: location.hash
    })`));
    assert(/fresh session/.test(ephemeral.status), `fresh status: ${ephemeral.status}`);
    assert(ephemeral.saved === null, 'fresh session wrote an autosave');
    assert(ephemeral.hash === '', `fresh session wrote a share fragment: ${ephemeral.hash}`);
    return '?fresh: no autosave write, no share fragment';
  });


  const axeSource = readFileSync(resolve(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
  await runCheck('axe · zero critical/serious across 2-D, 3-D, split, tables and frames views', async () => {
    const states = [
      { name: '2-D', prepare: async () => { await loadApp(); } },
      {
        name: 'A·B 3-D',
        prepare: async () => { await loadApp(); await click('#depthBtn'); await sleep(250); },
      },
      {
        name: 'split 3-D',
        prepare: async () => {
          await loadApp();
          await click('#depthBtn');
          await sleep(200);
          await click('#stageBar .op.mini');
          await sleep(300);
        },
      },
      {
        name: 'source table',
        prepare: async () => {
          await loadApp();
          await importCsv();
          await click('#sourcesBtn');
          await waitFor(`!document.getElementById('sourcesPanel').hidden`, 'source table');
        },
      },
      {
        name: 'frames view',
        prepare: async () => {
          await loadApp();
          await click('#framesBtn');
          await waitFor(`!document.getElementById('framesView').hidden`, 'frames view');
        },
      },
      {
        name: 'frames 8-lane',
        prepare: async () => {
          await loadApp();
          await click('#framesBtn');
          await waitFor(`!document.getElementById('framesView').hidden`, 'frames view');
          for (let i = 0; i < 5; i += 1) await click('#framesGrid .frame-add');
          await sleep(200);
        },
      },
    ];

    const found = [];
    const counts = [];
    for (const state of states) {
      await state.prepare();
      await evaluate(axeSource);
      const summary = JSON.parse(await evaluate(`(async () => {
        const result = await axe.run(document, {
          resultTypes: ['violations'],
          /* The palette is deliberately hands-off (D10 / Q8); the measured
             contrast trade-off is recorded in PLAN §4.3 instead. Everything
             else runs, including the WCAG 2.5.3 Label-in-Name rule. */
          rules: { 'color-contrast': { enabled: false } },
        });
        return JSON.stringify({
          total: result.violations.length,
          criticalSerious: result.violations
            .filter((v) => v.impact === 'critical' || v.impact === 'serious')
            .map((v) => v.id + ' (' + v.impact + ' ×' + v.nodes.length + ') '
              + v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' ; '))
        });
      })()`));
      if (summary.criticalSerious.length) {
        found.push(`${state.name}: ${summary.criticalSerious.join(', ')}`);
      }
      counts.push(`${state.name} ${summary.total}`);
    }
    assert(found.length === 0, `axe critical/serious — ${found.join(' | ')}`);
    return `0 critical/serious · advisory: ${counts.join(' · ')}`;
  });

  await runCheck('lanes · an 8-lane 256-bit compact share round-trips within the budget', async () => {
    await loadApp();
    await openFramesView();
    for (let i = 0; i < 5; i += 1) await click('#framesGrid .frame-add');
    await sleep(250);
    await click('#lanesBtn');
    await sleep(200);
    await evaluate(`(() => {
      const el = document.getElementById('size');
      el.value = '5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`);
    await sleep(400);
    const sized = JSON.parse(await evaluate(`JSON.stringify({
      width: window.BitWave.state().registers.width,
      lanes: Object.keys(window.bitwave.getState().lanes).length
    })`));
    assert(sized.width === 256, `width after resize: ${sized.width}`);
    assert(sized.lanes === 8, `live lanes before sharing: ${sized.lanes}`);

    const link = await evaluate(`window.bitwave.getDeeplink()`);
    const hash = String(link).slice(String(link).indexOf('#'));
    assert(hash.startsWith('#bw='), `share fragment: ${String(hash).slice(0, 40)}`);
    const payloadChars = hash.length - '#bw='.length;
    assert(payloadChars <= 2000, `8-lane 256-bit payload is ${payloadChars} chars (budget 2000)`);

    /* Reloading the compact link reproduces the eight-lane, 256-bit document. */
    await loadPage(artifactUrl + hash);
    await waitFor(`typeof window.bitwave === 'object'`, 'agent bridge');
    const reloaded = JSON.parse(await evaluate(`JSON.stringify({
      lanes: Object.keys(window.bitwave.getState().lanes).sort((a, b) => Number(a) - Number(b)),
      width: window.bitwave.getState().width,
      lane: window.bitwave.getState().lane,
      names: window.bitwave.getState().lanes["8"].frames
    })`));
    assert(reloaded.width === 256, `reloaded width: ${reloaded.width}`);
    assert(reloaded.lanes.length === 8, `reloaded lanes: ${JSON.stringify(reloaded.lanes)}`);
    assert(reloaded.names.O !== undefined && reloaded.names.P !== undefined && reloaded.names.Z8 !== undefined, `lane 8 frames: ${JSON.stringify(reloaded.names)}`);
    return `8 lanes · 256-bit · compact payload ${payloadChars} chars (≤2000) · reload restores`;
  });

  await runCheck('sources · the table shows 2L rows grouped by live lane', async () => {
    await loadApp();
    await openFramesView();
    for (let i = 0; i < 5; i += 1) await click('#framesGrid .frame-add');
    await sleep(250);
    await click('#lanesBtn');
    await sleep(200);
    await click('#sourcesBtn');
    await waitFor(`!document.getElementById('sourcesPanel').hidden`, 'source table');
    const table = JSON.parse(await evaluate(`JSON.stringify({
      rows: document.querySelectorAll('#sourcesRows tr.src-binding').length,
      groups: [...document.querySelectorAll('#sourcesRows tr.src-group-head th')].map((th) => th.textContent.trim()),
      labels: [...document.querySelectorAll('#sourcesRows .src-pick')].map((select) => select.getAttribute('aria-label')),
      lastDest: [...document.querySelectorAll('#sourcesRows .src-dest')].at(-1).textContent.trim(),
      overflow: getComputedStyle(document.querySelector('.src-body')).overflowY
    })`));
    assert(table.rows === 16, `2L rows for 8 lanes: ${table.rows}`);
    assert(table.groups.length === 8, `lane group headers: ${table.groups.length}`);
    assert(/Lane 1 · A\/B\/Z1/.test(table.groups[0]), `first group header: ${table.groups[0]}`);
    assert(/Lane 8 · O\/P\/Z8/.test(table.groups[7]), `last group header: ${table.groups[7]}`);
    assert(table.labels[0] === 'Lane 1 A source', `first source label: ${table.labels[0]}`);
    assert(table.labels.at(-1) === 'Lane 8 P source', `last source label: ${table.labels.at(-1)}`);
    assert(table.lastDest.includes('O') || table.lastDest.includes('P'), `last destination: ${table.lastDest}`);
    assert(table.overflow === 'auto' || table.overflow === 'scroll', `source body is not scrollable: ${table.overflow}`);
    await click('#sourcesClose');
    return '16 rows · 8 lane groups · O/P labels · scrollable body';
  });

  await runCheck('sources · frame binding drives the input, labels it, and unbinds', async () => {
    await loadApp();
    await click('#sourcesBtn');
    await waitFor(`!document.getElementById('sourcesPanel').hidden`, 'source table');
    const bind = async (value) => {
      await evaluate(`(() => {
        const select = document.querySelector('#sourcesRows tr select');
        select.value = ${JSON.stringify(value)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(250);
    };

    await bind('frame:3:z');
    let state = JSON.parse(await evaluate(`JSON.stringify({
      hex: document.getElementById('hex').textContent.trim(),
      z3: window.BitWave.state().lanes['3'].frames.Z3,
      label: document.querySelector('#sourcesRows tr .src-dest').textContent.trim(),
      chip: document.querySelector('#sourcesRows tr .src-state').textContent.trim(),
      readonly: document.getElementById('strip').classList.contains('is-readonly'),
      hint: document.getElementById('hint').textContent
    })`));
    assert(state.hex === state.z3, `Z3 → A: A=${state.hex} Z3=${state.z3}`);
    assert(state.label.includes('A') && state.label.includes('Z3'), `row label: ${state.label}`);
    assert(state.chip === '1:1', `chip: ${state.chip}`);
    assert(state.readonly === true, 'driven strip should be read-only');
    assert(/driven/.test(state.hint), `hint: ${JSON.stringify(state.hint)}`);

    const before = await evaluate(`document.getElementById('hex').textContent.trim()`);
    await click('#nibs .bit');
    const after = await evaluate(`document.getElementById('hex').textContent.trim()`);
    assert(after === before, 'a driven input accepted a local bit edit');

    await bind('frame:1:z');
    const chip = await evaluate(`document.querySelector('#sourcesRows tr .src-state').textContent.trim()`);
    assert(chip === 'z⁻¹', `same-lane feedback chip: ${chip}`);

    await bind('');
    state = JSON.parse(await evaluate(`JSON.stringify({
      hex: document.getElementById('hex').textContent.trim(),
      chip: document.querySelector('#sourcesRows tr .src-state').textContent.trim(),
      readonly: document.getElementById('strip').classList.contains('is-readonly')
    })`));
    assert(state.hex === '8ADEFEDA85210125', `unplug should restore the base: ${state.hex}`);
    assert(state.chip === '—', `chip after unplug: ${state.chip}`);
    assert(state.readonly === false, 'strip should unlock after unplug');
    await click('#sourcesClose');
    return 'Z3 → A (1:1) · Z1 → A (z⁻¹) · unplug restores A';
  });

  const resetCsvValue = async () => {
    await click('#prevEx');
    await waitFor(
      `document.getElementById('hex').textContent.trim() === '${csvPayload}'`,
      'CSV value restored'
    );
  };

  await runCheck('csv · four-column example fills the board with column names', async () => {
    await loadApp();
    const fixture = readFileSync(resolve(ROOT, 'examples/testcsv.csv'), 'utf8');
    await importCsvText(fixture);
    await click('#sourcesBtn');
    await waitFor(`!document.getElementById('sourcesPanel').hidden`, 'source table');
    const state = JSON.parse(await evaluate(`JSON.stringify({
      size: document.getElementById('sizeOut').textContent.trim(),
      rows: document.querySelectorAll('#sourcesRows tr.src-binding').length,
      groupHeads: document.querySelectorAll('#sourcesRows tr.src-group-head').length,
      dests: [...document.querySelectorAll('#sourcesRows .src-dest')].map((el) => el.textContent.trim()),
      chips: [...document.querySelectorAll('#sourcesRows .src-state')].map((el) => el.textContent.trim())
    })`));
    assert(state.rows === 6, `source rows: ${state.rows}`);
    assert(state.groupHeads === 3, `source lane groups: ${state.groupHeads}`);
    assert(
      state.dests[0].includes('A') && state.dests[0].includes('Hex 1'),
      `first row label: ${state.dests[0]}`
    );
    assert(state.chips[0] === 'data', `first row state: ${state.chips[0]}`);
    assert(state.size === '32 bits · 8 nibbles', `example width: ${state.size}`);
    await click('#sourcesClose');
    return `A · Hex 1 → data · 32-bit register · 6 rows`;
  });

  await runCheck('ops · ROL 4 on the imported word (§11)', async () => {
    await loadApp();
    await importCsv();
    await click('[data-op="rol"]');
    await waitFor(`document.getElementById('hex').textContent.trim() === 'EDCBA9876543210F'`, 'ROL result');
    const detail = `ROL 4: ${csvPayload} → EDCBA9876543210F`;
    await resetCsvValue();
    return detail;
  });

  await runCheck('ops · NOT matches the true complement (DESIGN §11 erratum, D8)', async () => {
    await click('[data-op="not"]');
    await waitFor(`document.getElementById('hex').textContent.trim() === '0123456789ABCDEF'`, 'NOT result');
    const detail = `NOT: ${csvPayload} → 0123456789ABCDEF (not 123456789ABCDEF0)`;
    await resetCsvValue();
    return detail;
  });

  await runCheck('ops · BSWAP reverses byte order (§11)', async () => {
    await click('[data-op="bswap"]');
    await waitFor(`document.getElementById('hex').textContent.trim() === '1032547698BADCFE'`, 'BSWAP result');
    await click('[data-op="bswap"]');
    await waitFor(`document.getElementById('hex').textContent.trim() === '${csvPayload}'`, 'BSWAP identity');
    return `BSWAP: ${csvPayload} → 1032547698BADCFE · twice = identity`;
  });

  await runCheck('console · still clean after CSV + every op', async () => {
    assert(
      consoleErrors.length === 0,
      `console errors: ${consoleErrors.slice(0, 3).join(' | ')}`
    );
    return '0 errors, 0 exceptions';
  });

  /* 6. agent surface ---------------------------------------------------- */
  await runCheck('agent · BitWave is a frozen, versioned read-only surface', async () => {
    await loadApp();
    const surface = JSON.parse(await evaluate(`JSON.stringify({
      frozen: Object.isFrozen(window.BitWave),
      schema: window.BitWave.schema,
      artifact: window.BitWave.artifact,
      functions: ['state', 'geometry', 'frames'].every((key) => typeof window.BitWave[key] === 'function'),
      setters: ['set', 'write', 'patch', 'setRegister', 'load'].filter((key) => typeof window.BitWave[key] === 'function'),
      stateFrozen: Object.isFrozen(window.BitWave.state()),
      laneFrozen: Object.isFrozen(window.BitWave.state().lanes['1']),
      framesFrozen: Object.isFrozen(window.BitWave.state().lanes['1'].frames)
    })`));
    assert(surface.frozen === true, 'window.BitWave is not frozen');
    assert(surface.schema === 1, `schema: ${surface.schema}`);
    assert(surface.artifact === 'bitwave-v2.html', `artifact: ${surface.artifact}`);
    assert(surface.functions === true, 'state/geometry/frames are not all functions');
    assert(surface.setters.length === 0, `unexpected write API: ${surface.setters}`);
    assert(surface.stateFrozen && surface.laneFrozen && surface.framesFrozen, 'snapshot is not deep-frozen');
    return 'frozen · schema 1 · state/geometry/frames · no setters';
  });

  await runCheck('agent · state() matches the visible instrument', async () => {
    const snapshot = JSON.parse(await evaluate(`JSON.stringify(window.BitWave.state())`));
    assert(snapshot.registers.width === 64 && snapshot.registers.nibbles === 16, 'register size');
    assert(snapshot.lane === 1 && snapshot.frame === 'A', `focus: ${snapshot.lane}/${snapshot.frame}`);
    assert(snapshot.view.mode === '2d', `view: ${snapshot.view.mode}`);
    const lane1 = snapshot.lanes['1'];
    assert(lane1.frames.A === '8ADEFEDA85210125', `A: ${lane1.frames.A}`);
    assert(lane1.frames.B === 'FFFFFFFF00000000', `B: ${lane1.frames.B}`);
    assert(lane1.frames.Z1 === '7521012585210125', `Z1: ${lane1.frames.Z1}`);
    assert(lane1.binop === 'xor' && lane1.focus === 'A', `lane binop/focus: ${lane1.binop}/${lane1.focus}`);
    assert(snapshot.dataset === null, 'dataset should be empty at boot');
    return '64-bit · lane 1 A · A/B/Z1 values and names · no dataset';
  });

  await runCheck('agent · geometry() control points match the DOM strip (< 1.5px)', async () => {
    await loadApp();
    const geometry = JSON.parse(await evaluate(`JSON.stringify(window.BitWave.geometry())`));
    assert(geometry.nibble.count === 16, `nibbles: ${geometry.nibble.count}`);
    assert(geometry.controlPoints.length === 16, `control points: ${geometry.controlPoints.length}`);
    assert(geometry.dom.nibs.length === 16, `DOM nibbles: ${geometry.dom.nibs.length}`);
    assert(Math.abs(geometry.plot.x0 - geometry.pad) < 0.01, 'plot inset is not --pad');
    assert(geometry.canvas.cssWidth === geometry.viewport.width, 'canvas does not span the viewport');
    let worst = 0;
    for (let j = 0; j < 16; j++) {
      worst = Math.max(worst, Math.abs(geometry.controlPoints[j] - geometry.dom.nibs[j].center));
    }
    assert(worst < 1.5, `a control point is ${worst.toFixed(2)}px from its nibble centre`);
    return `16/16 points · worst offset ${worst.toFixed(2)}px (< 1.5px)`;
  });

  await runCheck('agent · state() follows focus, view and dataset', async () => {
    await click('#depthBtn');
    await openFramesView();
    await pickFrameCard('1', 'z');
    let snapshot = JSON.parse(await evaluate(`JSON.stringify(window.BitWave.state())`));
    assert(snapshot.view.mode === '3d', `view: ${snapshot.view.mode}`);
    assert(snapshot.frame === 'Z1', `focused frame: ${snapshot.frame}`);
    assert(snapshot.lanes['1'].focus === 'Z1', `lane focus: ${snapshot.lanes['1'].focus}`);
    assert(snapshot.editing.enabled === false, 'derived focus should report read-only');

    await loadApp();
    await importCsv();
    snapshot = JSON.parse(await evaluate(`JSON.stringify(window.BitWave.state())`));
    assert(snapshot.dataset !== null, 'dataset missing after CSV import');
    assert(snapshot.dataset.rows === 1 && snapshot.dataset.index === 0, 'dataset row cursor');
    assert(snapshot.lanes['1'].sources.A === 'payload', `lane 1 A source: ${JSON.stringify(snapshot.lanes['1'].sources)}`);
    assert(snapshot.lanes['1'].frames.A === 'FEDCBA9876543210', `lane 1 A after import: ${snapshot.lanes['1'].frames.A}`);
    return '3d/Z1 read-only · dataset payload → A';
  });

  /* 7. parity against a reference artifact ------------------------------- */
  if (opts.compare) {
    const referenceUrl = pathToFileURL(resolve(ROOT, opts.compare)).href;
    await runCheck(
      `parity · ${basename(opts.artifact)} renders identically to ${basename(opts.compare)}`,
      async () => {
        const states = [
          { name: '2d-default', width: 1440, height: 900 },
          {
            name: 'frames-open',
            width: 1440,
            height: 900,
            prepare: async () => { await click('#framesBtn'); },
          },
          {
            name: '3d',
            width: 1440,
            height: 900,
            prepare: async () => { await click('#depthBtn'); },
          },
          {
            name: '3d-focus-z1',
            width: 1440,
            height: 900,
            prepare: async () => {
              await click('#depthBtn');
              await openFramesView();
              await pickFrameCard('1', 'z');
            },
          },
          {
            name: 'csv-import',
            width: 1440,
            height: 900,
            prepare: async () => { await importCsv(); },
          },
          { name: 'breakpoint-720', width: 720, height: 900 },
        ];

        const shoot = async (url, state) => {
          await loadPage(url, { width: state.width, height: state.height, settle: 300 });
          if (state.prepare) await state.prepare();
          await sleep(700);
          return capture();
        };

        const mismatches = [];
        for (const state of states) {
          /* Chromium software compositing can shift a handful of pixels by 1–2
             levels between identical runs (observed even comparing a file with
             itself). A real regression is persistent, so retry a mismatching
             state before failing; a clean pair is still byte-identical. */
          let reference = null;
          let rebuilt = null;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            reference = await shoot(referenceUrl, state);
            rebuilt = await shoot(artifactUrl, state);
            if (sha256(reference) === sha256(rebuilt)) break;
          }
          if (sha256(reference) !== sha256(rebuilt)) mismatches.push({ state, reference, rebuilt });
        }

        if (mismatches.length) {
          const directory = resolve(ROOT, '.tmp-captures/parity');
          mkdirSync(directory, { recursive: true });
          for (const mismatch of mismatches) {
            writeFileSync(join(directory, `${mismatch.state.name}-reference.png`), mismatch.reference);
            writeFileSync(join(directory, `${mismatch.state.name}-rebuilt.png`), mismatch.rebuilt);
          }
          throw new Error(
            `${mismatches.length}/${states.length} states differ ` +
            `(${mismatches.map((m) => m.state.name).join(', ')}; PNGs in .tmp-captures/parity/)`
          );
        }
        return `${states.length}/${states.length} states pixel-identical`;
      }
    );
  }

  /* 8. optional screenshots -------------------------------------------- */
  if (opts.shots) {
    await runCheck('capture · deterministic state screenshots', async () => {
      const directory = resolve(ROOT, opts.shots);
      mkdirSync(directory, { recursive: true });
      const written = [];

      const shoot = async (name, state) => {
        await state.prepare();
        await sleep(state.settle ?? 500);
        const png = await capture();
        writeFileSync(join(directory, name), png);
        written.push(`${name} ${sha256(png)} ${png.length}b`);
        return png;
      };

      const first = await shoot('01-default-1440.png', {
        prepare: async () => loadApp({ width: 1440, height: 900 }),
        settle: 600,
      });

      /* same state, same bytes — the nearest thing to a golden we can assert
         without shipping PNG fixtures: the render is a function of the state. */
      const again = await capture();
      assert(
        sha256(again) === sha256(first),
        `default state is not deterministic: ${sha256(first)} vs ${sha256(again)}`
      );

      await shoot('02-frames-1440.png', {
        prepare: async () => { await click('#framesBtn'); },
        settle: 350,
      });
      await shoot('03-3d-1440.png', {
        prepare: async () => { await click('#lanesBtn'); await click('#depthBtn'); },
        settle: 700,
      });
      await shoot('04-csv-1440.png', {
        prepare: async () => { await loadApp(); await importCsv(); },
        settle: 400,
      });
      await shoot('05-default-360.png', {
        prepare: async () => loadApp({ width: 360, height: 780 }),
        settle: 600,
      });
      await shoot('06-breakpoint-720.png', {
        prepare: async () => loadApp({ width: 720, height: 900 }),
        settle: 600,
      });
      await shoot('07-3d-focus-z1.png', {
        prepare: async () => {
          await loadApp();
          await click('#depthBtn');
          await openFramesView();
          await pickFrameCard('1', 'z');
        },
        settle: 800,
      });
      await shoot('08-2d-focus-z1.png', {
        prepare: async () => {
          await loadApp();
          await openFramesView();
          await pickFrameCard('1', 'z');
        },
        settle: 600,
      });
      await shoot('09-sources-testcsv.png', {
        prepare: async () => {
          await loadApp();
          const fixture = readFileSync(resolve(ROOT, 'examples/testcsv.csv'), 'utf8');
          await importCsvText(fixture);
          await click('#sourcesBtn');
          await waitFor(`!document.getElementById('sourcesPanel').hidden`, 'source table');
        },
        settle: 600,
      });

      console.log(`  screenshots → ${directory}`);
      for (const line of written) console.log(`    ${line}`);
      console.log('');
      return `${written.length} screenshots · default state deterministic`;
    });
  }
} catch (error) {
  console.error(`\n✘ browser check could not run: ${error.message}`);
  if (browser) {
    try { browser.proc.kill(); } catch { /* already gone */ }
    try { rmSync(browser.profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  process.exit(1);
}

/* ────────────────────────────────────────────────────────── teardown ── */

cdp?.close();
try { browser?.proc.kill(); } catch { /* already gone */ }
try { rmSync(browser.profile, { recursive: true, force: true }); } catch { /* best effort */ }

/* ─────────────────────────────────────────────────────────── report ── */

const passed = results.filter((result) => result.ok).length;
const failed = results.length - passed;
const width = Math.max(...results.map((result) => result.name.length));

for (const result of results) {
  const mark = result.ok ? '✔' : '✘';
  const name = result.name.padEnd(width);
  console.log(`${mark} ${name}  ${result.detail}`);
}

console.log('');
console.log(
  `${passed} passed, ${failed} failed — ${artifactName} ` +
  `(${opts.headed ? 'headed' : 'headless'} Chromium, ${results.length} checks)`
);

if (failed > 0) process.exit(1);
