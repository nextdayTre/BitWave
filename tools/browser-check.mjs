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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const USAGE = `BitWave browser check — zero-dependency headless Chromium.

  node tools/browser-check.mjs [options]

Options:
  --artifact <file>   HTML artifact to verify (default: bitwave-v2.html)
  --shots <dir>       also write deterministic state screenshots to <dir>
  --headed            run a visible Chromium window (debugging)
  --help, -h          show this help

Chromium is auto-detected, or set BITWAVE_CHROME to an executable path.`;

/* ─────────────────────────────────────────────────────────── arguments ── */

function parseArgs(argv) {
  const opts = { artifact: 'bitwave-v2.html', shots: null, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--artifact') opts.artifact = argv[++i];
    else if (arg === '--shots') opts.shots = argv[++i];
    else if (arg === '--headed') opts.headed = true;
    else if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0); }
    else throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
  }
  if (!opts.artifact || !existsSync(resolve(ROOT, opts.artifact))) {
    throw new Error(`artifact not found: ${opts.artifact}`);
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

async function loadApp({ width = 1440, height = 900, settle = 300 } = {}) {
  consoleErrors.length = 0;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: artifactUrl });
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

async function click(selector) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('missing element: ' + ${JSON.stringify(selector)});
    el.click();
    return true;
  })()`);
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

  cdp.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails;
    const text = details?.exception?.description || details?.text || 'unknown exception';
    consoleErrors.push(`exception: ${String(text).split('\n')[0]}`);
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

  /* 3. frame navigator -------------------------------------------------- */
  await runCheck('frames · navigator lists lane 1 A/Z/B and all lanes', async () => {
    await loadApp();
    await click('#framesBtn');
    await waitFor(`!document.getElementById('framesPanel').hidden`, 'frame navigator');
    const summary = JSON.parse(await evaluate(`JSON.stringify({
      rows: [...document.querySelectorAll('.frame-row')].map((row) => row.dataset.frame),
      lanes: document.querySelectorAll('.lane-btn').length,
      eyes: document.querySelectorAll('#framesBody .eye-btn').length
    })`));
    assert(
      JSON.stringify(summary.rows) === JSON.stringify(['a', 'z', 'b']),
      `frame rows: ${JSON.stringify(summary.rows)}`
    );
    assert(summary.lanes === 3, `lane buttons: ${summary.lanes}`);
    assert(summary.eyes === 3, `eye buttons: ${summary.eyes}`);
    return '3 frames · 3 lanes · 3 visibility toggles';
  });

  await runCheck('frames · eye toggle flips aria-pressed and hides the frame', async () => {
    await click('#framesBody .frame-row[data-frame="a"] .eye-btn');
    const hidden = JSON.parse(await evaluate(`JSON.stringify({
      pressed: document.querySelector('#framesBody .frame-row[data-frame="a"] .eye-btn').getAttribute('aria-pressed'),
      hidden: document.querySelector('#framesBody .frame-row[data-frame="a"]').classList.contains('is-hidden'),
      label: document.querySelector('#framesBody .frame-row[data-frame="a"] .eye-btn').getAttribute('aria-label')
    })`));
    assert(hidden.pressed === 'false', `aria-pressed: ${hidden.pressed}`);
    assert(hidden.hidden === true, 'row did not gain .is-hidden');
    assert(/^Show frame A\b/.test(hidden.label), `eye label did not change: ${hidden.label}`);
    return 'A hidden · aria-pressed=false · label now "Show frame A"'
  });

  const frameGlyphs = async () => JSON.parse(await evaluate(`JSON.stringify(
    [...document.querySelectorAll('#framesBody .frame-row .frame-glyph')].map((el) => el.textContent.trim())
  )`));
  const clickSlot = async (key) => {
    await click(`#slotSeg [data-slot="${key}"]`);
    await sleep(120);
  };

  /* 3b. global frame names: A/B C/D E/F + Z1/Z2/Z3 ---------------------- */
  await runCheck('naming · lanes map to A/B, C/D, E/F and Z1/Z2/Z3', async () => {
    await loadApp();
    const labels = {};
    labels['1'] = await evaluate(`document.getElementById('strip').dataset.edit`);
    await clickSlot('B');
    labels['2'] = await evaluate(`document.getElementById('strip').dataset.edit`);
    await clickSlot('C');
    labels['3'] = await evaluate(`document.getElementById('strip').dataset.edit`);
    assert(
      JSON.stringify(labels) === JSON.stringify({ 1: 'A', 2: 'C', 3: 'E' }),
      `strip labels per lane: ${JSON.stringify(labels)}`
    );

    await clickSlot('A');
    await click('#framesBtn');
    await waitFor(`!document.getElementById('framesPanel').hidden`, 'frame navigator');
    const lane1 = await frameGlyphs();
    await click('#framesBody .lane-btn[data-lane="B"]');
    await sleep(120);
    const lane2 = await frameGlyphs();
    await click('#framesBody .lane-btn[data-lane="C"]');
    await sleep(120);
    const lane3 = await frameGlyphs();
    assert(
      JSON.stringify(lane1) === JSON.stringify(['A', 'Z1', 'B']),
      `lane 1 frames: ${JSON.stringify(lane1)}`
    );
    assert(
      JSON.stringify(lane2) === JSON.stringify(['C', 'Z2', 'D']),
      `lane 2 frames: ${JSON.stringify(lane2)}`
    );
    assert(
      JSON.stringify(lane3) === JSON.stringify(['E', 'Z3', 'F']),
      `lane 3 frames: ${JSON.stringify(lane3)}`
    );
    return 'lane 1 A/Z1/B · lane 2 C/Z2/D · lane 3 E/Z3/F';
  });

  await runCheck('visibility · eye toggles are per lane', async () => {
    await click('#framesBody .lane-btn[data-lane="A"]');
    await sleep(120);
    await click('#framesBody .frame-row[data-frame="a"] .eye-btn');
    const lane1Hidden = await evaluate(
      `document.querySelector('#framesBody .frame-row[data-frame="a"] .eye-btn').getAttribute('aria-pressed')`
    );
    await click('#framesBody .lane-btn[data-lane="B"]');
    await sleep(120);
    const lane2Visible = await evaluate(
      `document.querySelector('#framesBody .frame-row[data-frame="a"] .eye-btn').getAttribute('aria-pressed')`
    );
    assert(lane1Hidden === 'false', `lane 1 A after hide: ${lane1Hidden}`);
    assert(lane2Visible === 'true', `lane 2 C should be unaffected: ${lane2Visible}`);
    return 'hiding A leaves C visible (per-lane visibility)';
  });

  /* 3c. focus: a frame click is a lens, not a view switch ---------------- */
  await runCheck('focus · a frame click in 3-D stays in 3-D and retargets the strip', async () => {
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
    await click('#framesBtn');
    await waitFor(`!document.getElementById('framesPanel').hidden`, 'frame navigator');

    await click('#framesBody .frame-row[data-frame="a"] .frame-btn');
    await sleep(150);
    let state = JSON.parse(await evaluate(`JSON.stringify({
      view3d: document.getElementById('depthBtn').getAttribute('aria-pressed'),
      panelOpen: !document.getElementById('framesPanel').hidden,
      strip: document.getElementById('strip').dataset.edit,
      readonly: document.getElementById('strip').classList.contains('is-readonly'),
      stage: document.getElementById('stageBar').textContent
    })`));
    assert(state.view3d === 'true', 'focusing A left the 3-D view');
    assert(state.panelOpen === true, 'the frame navigator closed on focus');
    assert(state.strip === 'A', `strip after focusing A: ${state.strip}`);
    assert(state.readonly === false, 'A should be editable');
    assert(/→ Z1/.test(state.stage), `stage bar: ${JSON.stringify(state.stage)}`);

    const before = JSON.parse(await evaluate(`JSON.stringify({
      a: document.getElementById('hexA').textContent,
      z: document.getElementById('hexZ').textContent
    })`));
    await click('#framesBody .frame-row[data-frame="z"] .frame-btn');
    await sleep(150);
    state = JSON.parse(await evaluate(`JSON.stringify({
      view3d: document.getElementById('depthBtn').getAttribute('aria-pressed'),
      strip: document.getElementById('strip').dataset.edit,
      readonly: document.getElementById('strip').classList.contains('is-readonly'),
      ariaReadonly: document.getElementById('strip').getAttribute('aria-readonly'),
      bits: document.querySelectorAll('#nibs .bit').length,
      hint: document.getElementById('hint').textContent
    })`));
    assert(state.view3d === 'true', 'focusing Z1 left the 3-D view');
    assert(state.strip === 'Z1', `strip after focusing Z1: ${state.strip}`);
    assert(state.readonly === true && state.ariaReadonly === 'true', 'Z strip is not read-only');
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

    await click('#framesBody .frame-row[data-frame="b"] .frame-btn');
    await sleep(150);
    const b = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      readonly: document.getElementById('strip').classList.contains('is-readonly')
    })`));
    assert(b.strip === 'B' && b.readonly === false, `focusing B: ${JSON.stringify(b)}`);
    return 'A → B editable · Z1 read-only · 3-D stayed on · panel stayed open';
  });

  await runCheck('focus · names follow the lane in the stage bar and readouts', async () => {
    await click('#framesBody .lane-btn[data-lane="B"]');
    await sleep(150);
    const lane2 = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      stage: document.getElementById('stageBar').textContent,
      a: document.getElementById('hexA').previousElementSibling.textContent,
      b: document.getElementById('hexB').previousElementSibling.textContent,
      z: document.getElementById('hexZ').previousElementSibling.textContent,
      truth: document.querySelector('#truth .truth-h').textContent
    })`));
    assert(lane2.strip === 'C', `lane 2 strip: ${lane2.strip}`);
    assert(/LANE 2 · C.*D.*→ Z2/.test(lane2.stage), `lane 2 stage: ${JSON.stringify(lane2.stage)}`);
    assert(lane2.a === 'C' && lane2.b === 'D' && lane2.z === 'Z2', `lane 2 readout labels: ${JSON.stringify(lane2)}`);
    assert(/C.*D.*→ Z2/.test(lane2.truth), `lane 2 truth header: ${JSON.stringify(lane2.truth)}`);

    await clickSlot('C');
    const lane3 = JSON.parse(await evaluate(`JSON.stringify({
      strip: document.getElementById('strip').dataset.edit,
      stage: document.getElementById('stageBar').textContent
    })`));
    assert(lane3.strip === 'E', `lane 3 strip: ${lane3.strip}`);
    assert(/LANE 3 · E.*F.*→ Z3/.test(lane3.stage), `lane 3 stage: ${JSON.stringify(lane3.stage)}`);
    return 'lane 2 C/D/Z2 · lane 3 E/F/Z3 in strip, stage bar, readouts and truth';
  });

  /* 4. 3-D field -------------------------------------------------------- */
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

  /* 5. CSV import + §11 op vectors ------------------------------------- */
  const csvPayload = 'FEDCBA9876543210';
  const importCsv = async () => {
    await evaluate(`(() => {
      const csv = 'id,payload\\n1,${csvPayload}\\n';
      const transfer = new DataTransfer();
      transfer.items.add(new File([csv], 'check.csv', { type: 'text/csv' }));
      const input = document.getElementById('csvFile');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(
      `!document.getElementById('stepSeg').hidden && document.getElementById('colA').options.length > 1`,
      'CSV load'
    );
    await waitFor(
      `document.getElementById('hex').textContent.trim() === '${csvPayload}'`,
      'CSV value in register A'
    );
    await sleep(250);
  };

  await runCheck('csv · import types and binds the widest column to lane 1 A', async () => {
    await loadApp();
    await importCsv();
    const state = JSON.parse(await evaluate(`JSON.stringify({
      size: document.getElementById('sizeOut').textContent.trim(),
      options: [...document.getElementById('colA').options].map((o) => o.textContent.trim()),
      colA: document.getElementById('colA').value,
      hex: document.getElementById('hex').textContent.trim()
    })`));
    assert(state.options.includes('payload'), `colA options: ${JSON.stringify(state.options)}`);
    assert(state.colA === '1', `lane 1 A column index: ${state.colA}`);
    assert(state.hex === csvPayload, `A after import: ${state.hex}`);
    assert(state.size === '64 bits · 16 nibbles', `size after import: ${state.size}`);
    return `payload column → A = ${state.hex} · 64 bits`;
  });

  const resetCsvValue = async () => {
    await click('#prevEx');
    await waitFor(
      `document.getElementById('hex').textContent.trim() === '${csvPayload}'`,
      'CSV value restored'
    );
  };

  await runCheck('ops · ROL 4 on the imported word (§11)', async () => {
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

  /* 6. optional screenshots -------------------------------------------- */
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
        prepare: async () => { await click('#framesClose'); await click('#depthBtn'); },
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
          await click('#framesBtn');
          await click('#framesBody .frame-row[data-frame="z"] .frame-btn');
        },
        settle: 800,
      });
      await shoot('08-2d-focus-z1.png', {
        prepare: async () => {
          await loadApp();
          await click('#framesBtn');
          await click('#framesBody .frame-row[data-frame="z"] .frame-btn');
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
