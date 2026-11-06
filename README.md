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
  the Pro-Q4-style frame navigator, per-frame visibility eyes, the frame focus
  lens (A/B/Z1, C/D/Z2, E/F/Z3), wheel-to-adjust hex, copy-to-lane, CSV stepper,
  observation CSV export, LFO, split 3-D.
- **`index.html`** — untouched original reference build.
- `index.html.bak` — an older snapshot, kept only as history.

## Build

```bash
npm install          # once — Vite, TypeScript, vite-plugin-singlefile
npm run build        # src/ → dist/ → bitwave-v2.html (single self-contained file)
npm run dev          # Vite dev server for the modular source
npm run typecheck    # tsc --noEmit on the DOM-free core
```

The source is `src/index.html` + `src/main.js` + `src/styles/app.css`. The build
inlines everything, and `tools/build-artifact.mjs` verifies the result has no
external references before writing `bitwave-v2.html`. No minification, on purpose:
the artifact stays readable.

## Verify

```bash
npm test               # DOM-free core: 38 tests, zero dependencies
npm run check:browser  # 24 artifact checks in headless Chromium (25 with --shots or --compare)
npm run capture        # state screenshots → .tmp-captures/
```

The built `bitwave-v2.html` is committed so the double-clickable file is always in
the repo; edit `src/`, then `npm run build`.

`check:browser` auto-detects Chromium (Playwright's browser cache, a Chrome/Edge
install, or `BITWAVE_CHROME=…`). It opens the artifact over `file://` — the way a
user opens it — and asserts console cleanliness, layout at 360/420/720/1440, the
DESIGN §5 strip geometry, the frame navigator and focus lens, the 3-D truth table,
CSV import, the §11 operation vectors, and the agent surface.

`--compare` is the rebuild gate: it loads a reference artifact and the new one in
the same Chromium and asserts identical screenshots across six states.

```bash
node tools/browser-check.mjs --compare path/to/reference.html
```

## Agent surface

`bitwave-v2.html` exposes a read-only, versioned state/geometry surface after boot:

```js
BitWave.state()      // frozen snapshot: lanes, frames A–F/Z1–Z3, values, focus, view, dataset
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
| `src/` | App source (`index.html`, `main.js`, `styles/app.css`) plus the DOM-free core (`src/core/`). |
| `tools/` | `browser-check.mjs` (verification + parity gate), `build-artifact.mjs` (single-file gate), the example generator. |
| `vite.config.mjs`, `package.json`, `tsconfig.core.json` | Build, test and typecheck setup. |
| `docs/`, `PLAN.md`, `DECISIONS.md`, `STATUS.md`, `tests/`, `spike/`, `examples/` | Design analysis, plan/status, core tests, housing spike and project example. |

## Preservation

This directory is a Git repository. Each checkpoint is tagged and also backed up
as a single-file bundle under `backups/` (ignored by Git), so it can be restored
or cloned without a remote:

```bash
git clone backups/bitwave-v2-2026-11-06-toolchain.bundle bitwave-restore
```

Tags: `v2-checkpoint-2026-11-06` (frame navigator, eyes, wheel-step),
`v2-focus-2026-11-06` (global frame names, focus lens, browser harness),
`v2-agent-seam-2026-11-06` (read-only `window.BitWave` state/geometry surface) and
`v2-toolchain-2026-11-06` (Vite build, `src/` source tree, rebuild parity gate).

For off-machine safety, add a remote and push the `main` branch and tags.
