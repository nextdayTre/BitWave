# BitWave

**A register you can see — every nibble is a sample.**

BitWave renders a bit register as a wavetable: dragging a nibble rewrites its
bits and reshapes the wave; bitwise operations behave like DSP operations.
Two operands (A, B) feed a derived result (Z), across three numbered lanes,
with 2-D and 3-D views, an LFO, CSV/TSV import and observation export.

## Run it

**`bitwave-v2.html`** is the instrument: one self-contained HTML file, no server,
no network, no dependencies — **open it directly in a browser.**

- **`bitwave-v2.html`** — the current build, generated from `src/`. Lanes 1/2/3,
  the always-visible stage bar (lane, frames, split), the Pro-Q4-style frame navigator,
  per-frame visibility eyes, the frame focus lens (A/B/Z1, C/D/Z2, E/F/Z3), the six-input
  **source table** (CSV columns or frame outputs, with driven inputs locked), wheel-to-adjust
  hex, an explicit copy-to-lane menu, a whole-word hex entry, CSV stepper, observation CSV
  export, LFO, split 3-D, and a keyboard-editable strip (every nibble is a spinbutton).
  Work is **persisted**: `.bitwave` save/open, autosave across reloads, and the state is
  shareable through the URL fragment. A `demo` button loads an embedded 8-row dataset.
- **`index.html`** — untouched original reference build.

**Persistence at a glance.** The address bar always carries the current state as
`#bw=…`, so copying the URL shares the instrument; a reload restores your last session.
`project…` saves/opens a versioned `.bitwave` JSON file and resets the instrument.
Append **`?fresh`** to the URL for an ephemeral session that neither reads nor writes the
autosave or share state.

**Hosted install.** `npm run build:pwa` produces `dist/hosted/`, an installable
progressive web app: serve it over HTTPS, install from the browser, and it runs fully
offline. See [`docs/hosting.md`](docs/hosting.md). The single file stays the canonical
artifact and never gains external references.

## Build

```bash
npm install          # once — Vite, TypeScript, vite-plugin-singlefile
npm run build        # src/ → dist/ → bitwave-v2.html (single self-contained file)
npm run build:pwa    # same, then dist/hosted/ (installable offline PWA)
npm run dev          # Vite dev server for the modular source
npm run typecheck    # tsc --noEmit on the DOM-free core
```

The source is `src/index.html` + `src/main.js` + `src/styles/app.css`. The build
inlines everything, and `tools/build-artifact.mjs` verifies the result has no
external references before writing `bitwave-v2.html`. No minification, on purpose:
the artifact stays readable.

## Share and deploy

Two deliverables, one instrument:

- **The file** — [`bitwave-v2.html`](bitwave-v2.html), double-clickable, works over
  `file://` with no server and no network.
- **The URL** — `dist/hosted/` from `npm run build:pwa`: the same app plus a manifest,
  icons and a service worker, so it can be installed and used fully offline from any static
  HTTPS host. The single-file artifact stays untouched (no manifest/icon/SW references —
  asserted by `npm run check:pwa`).

Deploy `dist/hosted/` to GitHub Pages, Netlify, Cloudflare Pages or any static host; the
URLs are relative so a subpath works. Full deployment, install, offline-update and privacy
notes: [`docs/hosting.md`](docs/hosting.md).

```bash
npm run check:pwa    # serves dist/hosted/, proves worker control + a server-down offline reload
npm run verify       # unit + typecheck + build + browser checks + hosted build + PWA check
```

Paths: `assets/pwa/` holds the committed icons (regenerate with
`python tools/make-pwa-icons.py`); `tools/build-pwa.mjs` produces the hosted tree.

## Verify

```bash
npm test               # DOM-free core + state + bindings + project/share: 77 tests, zero dependencies
npm run check:browser  # 52 artifact checks in headless Chromium (53 with --shots or --compare)
npm run check:pwa      # 7 hosted/PWA checks incl. a server-down offline reload
npm run capture        # state screenshots → .tmp-captures/
```

The built `bitwave-v2.html` is committed so the double-clickable file is always in
the repo; edit `src/`, then `npm run build`.

`check:browser` auto-detects Chromium (Playwright's browser cache, a Chrome/Edge
install, or `BITWAVE_CHROME=…`). It opens the artifact over `file://` — the way a
user opens it — and asserts console cleanliness, layout at 360/420/720/1440, the
DESIGN §5 strip geometry, the 2-D/3-D states, the frame navigator and focus lens,
the 3-D truth table, CSV import, the source table, the §11 operation vectors, the
agent surface, the F4 reflow (200 %/400 %), keyboard editing, roles/live status,
reduced motion, targets, the IA pass (stage bar, module order, copy menu, hex entry,
keyboard map), the F5 persistence paths (project open/reset, autosave reload, share
link round-trip and budget, `?fresh`) and an axe-core audit (dev-only; zero
critical/serious).
**Keyboard editing:** Tab into the strip, then ↑/↓ adjust a nibble, ←/→ move
between nibbles, Home/End jump, 0–F set the digit; `?` opens the keyboard map and
Esc closes a menu or panel.

`--compare` is the rebuild gate: it loads a reference artifact and the new one in
the same Chromium and asserts identical screenshots across six states.

```bash
node tools/browser-check.mjs --compare path/to/reference.html
```

## Agent surface

`bitwave-v2.html` exposes a read-only, versioned state/geometry surface after boot:

```js
BitWave.state()      // frozen snapshot: lanes, frames A–F/Z1–Z3, values, focus, view, dataset
BitWave.bindings()   // the six input bindings: data column / frame source / state chip
BitWave.geometry()   // plot rect, nibble geometry, control-point xs[], DOM nibble rects
BitWave.frames()     // the frame-name table per lane
```

No setters: the instrument's controls stay the only write path. The full contract
and example snapshot are in [`AGENTS.md`](AGENTS.md).

## Design and intent

- [`DESIGN.md`](DESIGN.md) — the visual/geometric source of truth.
- [`AGENTS.md`](AGENTS.md) — stated intent for AI-agent interoperability:
  state/render surfaces rather than screenshot automation.

## Repository map

| Path | What it is |
|---|---|
| `bitwave-v2.html` | The build: one self-contained file, generated from `src/` by `npm run build`. |
| `index.html` | Untouched original reference build. |
| `src/` | App source: `index.html`, `main.js` (composition + controllers), `styles/app.css`; `state/`, `render/`, `ui/`, `io/` modules and the `core/` engine. |
| `tools/` | `browser-check.mjs` (artifact verification + parity gate), `build-artifact.mjs` (single-file gate), `build-pwa.mjs` + `check-pwa.mjs` (hosted/PWA build + offline gate), `make-pwa-icons.py`, the example generator. |
| `assets/pwa/` | Committed PWA icons (192/512/maskable/32) generated from the palette. |
| `testcsv.xlsx`, `examples/testcsv.csv` | The four-column import sample (`Hex 1`, `Hex 2`, `Grandma Hex`, `Bananas Hex`); the CSV twin is what the instrument imports. |
| `vite.config.mjs`, `package.json`, `tsconfig.core.json` | Build, test and typecheck setup. |
| `docs/`, `PLAN.md`, `DECISIONS.md`, `STATUS.md`, `tests/`, `spike/`, `examples/` | Design analysis + hosting guide, plan/status, core tests, spikes and project example. |

## Preservation

This directory is a Git repository. Each checkpoint is tagged and also backed up
as a single-file bundle under `backups/` (ignored by Git), so it can be restored
or cloned without a remote:

```bash
git clone backups/bitwave-v2-2026-11-06-distribution.bundle bitwave-restore
```

Tags: `v2-checkpoint-2026-11-06` (frame navigator, eyes, wheel-step),
`v2-focus-2026-11-06` (global frame names, focus lens, browser harness),
`v2-agent-seam-2026-11-06` (read-only `window.BitWave` state/geometry surface),
`v2-toolchain-2026-11-06` (Vite build, `src/` source tree, rebuild parity gate),
`v2-state-2026-11-06` (DOM-free state tree + transaction store),
`v2-transaction-2026-11-06` (actions, core `evaluateAll` in the transaction),
`v2-render-2026-11-06` (render layer split),
`v2-ui-2026-11-06` (UI feature modules),
`v2-source-matrix-2026-11-06` (six-row source table, frame routing, driven inputs),
`v2-a11y-2026-11-06` (F4 accessibility floor + IA pass),
`v2-persistence-2026-11-06` (F5: `.bitwave` schema 2 save/open, autosave, URL-fragment
share, demo dataset, CSV status; `index.html.bak` removed) and
`v2-distribution-2026-11-06` (F6: hosted/installable PWA build, offline gate, deployment
docs; single-file artifact untouched; Tauri deferred).

For off-machine safety, add a remote and push the `main` branch and tags.
