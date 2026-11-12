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
  **source table** (CSV columns, frame outputs or deterministic expressions, with driven
  inputs locked), wheel-to-adjust hex, an explicit copy-to-lane menu, a whole-word hex
  entry, CSV stepper, observation CSV export, DAW-style Record/log, LFO, split 3-D with a
  per-lane **hinge** that swaps which operand is far vs near, and a keyboard-editable strip
  (every nibble is a spinbutton).
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
npm test               # DOM-free core + state + bindings + project/share + agent layer: 112 + 6 tests, zero dependencies
npm run check:browser  # 52 artifact checks in headless Chromium (53 with --shots or --compare)
npm run check:pwa      # 8 hosted/PWA checks incl. a server-down offline reload + served agent files
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
the same Chromium and asserts identical screenshots across six states. The harness
uses grayscale AA and retries a mismatching state up to three times, because Chromium
software compositing can shift a few glyph-edge pixels between two runs of the same
artifact; a persistent difference still fails.

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

## Agent interface

BitWave is also driveable by software. Everything the agent layer exposes is derived from
the same DOM-free core (`src/core/*.ts`) as the UI, so the page, `window.bitwave`, the CLI
and the MCP server cannot disagree: one implementation, one result envelope
(`{ ok, schemaVersion, tool, data, deeplink, warnings }`), deterministic output. The layer
is **additive** — the stage rendering and the legacy read-only `window.BitWave` surface
above stay exactly as documented (schema 1); writes go through the new setters on
`window.bitwave` only. The external-routing slice later adds expression source rows and
the Record control to the transient source panel by design (D40); the stage itself is
unchanged.

Onboarding: [`AGENTS.md`](AGENTS.md) → normative contract
[`docs/AGENT-INTERFACE.md`](docs/AGENT-INTERFACE.md). Machine-readable identity:
`agent/manifest.json`; one example envelope per tool: `agent/examples/`; compact index:
[`llms.txt`](llms.txt). The agent transports need **Node ≥ 23.6** (native TypeScript
type-stripping) and zero extra dependencies.

### Expressions and Record (toolset 1.1.0)

Each of the six source rows can be a deterministic **expression** (`expr`) instead of a
data column or route. Expressions are text in the `.bitwave` schema-3 document, evaluated
in the shared core on every clocked update after routes and before `Z`, with the current
frames plus the previous recorded row as `log.<frame>`. Coefficients from float/DSP tooling
are welcome: a float is converted once at the boundary to an exact value, so the register
bits remain reproducible. Invalid text never mutates registers (the bridge reports
`E_INVALID_EXPRESSION`).

**Record** is the DAW-style take beside the observation log: arm it, and one row of all
nine frame registers is appended per settled update (in memory only; starting clears the
take; the pointer-drag stream is skipped). `export log` downloads CSV. Expressions can
read the previous row, so a recorded feedback loop is well-defined. The bridge can build
the whole patch headlessly too (`setRoute`/`setSource`, `setExpression`, `record`,
`getLog`); see [`docs/EXTERNAL-ROUTING.md`](docs/EXTERNAL-ROUTING.md) for the model and the
remaining boundary (expression-only dependency ordering, float-valued mode).

### 1. URL deep links

The URL fragment is the whole view state, encoded by the `.bitwave` schema-3 codec. Build
canonical links headlessly:

```powershell
node agent/cli.mjs deeplink --project examples/demo.bitwave.json `
  --base "file:///C:/path/to/bitwave-v2.html" --json
```

Canonical links omit `savedAt`, so equal state gives an equal link; the app mirrors its
settled state into the address bar with `history.replaceState` and a reload reproduces
the view. `?fresh` opens an ephemeral session (no autosave, no share mirroring). Over
`file://` a copied link is portable only to the same file path; pass an `http(s)` `--base`
for a portable link.

### 2. Browser bridge — `window.bitwave`

After boot the page installs a command bridge beside the legacy read-only surface. Paste
this in the console:

```js
window.bitwave.schemaVersion            // 1
window.bitwave.version                  // "1.1.0"
window.bitwave.getState()               // full UI state (schema 1)
window.bitwave.getManifest()            // manifest data
window.bitwave.tools()                  // tool definitions
window.bitwave.call("compare_operands", { a: "8ADEFEDA85210125", b: "FFFFFFFF00000000" })
window.bitwave.setLane(2)               // setters never throw
window.bitwave.setRegister("A", "DEADBEEF")
window.bitwave.setExpression("D", "round(1.2599210498948732 * C)") // expr source
window.bitwave.setRoute("D", "1.z")     // bind an input to a frame route
window.bitwave.setSource("D", { kind: "none" })
window.bitwave.record(true)             // arm a transient take
window.bitwave.getLog({ limit: 8 })     // recorded frame rows
window.bitwave.record(false)
window.bitwave.getDeeplink()            // absolute current URL
const off = window.bitwave.subscribe(state => console.log(state));
```

`call` returns the same envelope as the CLI/MCP. Setters return `{ok, state}` or
`{ok:false, error, state}`; `getState()` already reflects a successful setter when it
returns, and a no-op setter emits no change event. Headless state extraction needs no
driver — the page exposes `body[data-agent-ready="true"]`, a hidden
`<pre id="bitwave-state" data-schema-version="1">` containing `JSON.stringify(getState())`,
and the `bitwave:ready` / `bitwave:change` events.

### 3. Node CLI and MCP server

Both import `src/core/agent-tools.ts` directly — no browser, no dev server:

```powershell
node agent/cli.mjs help
node agent/cli.mjs manifest --json
node agent/cli.mjs analyze_register --hex 8ADEFEDA85210125 --width 64 --json
node agent/cli.mjs evaluate_lane --a 8ADEFEDA85210125 --b FFFFFFFF00000000 --op xor --json
node agent/cli.mjs parse_dataset --text "Hex 1,Hex 2`n00000001,00000002" --json
node agent/cli.mjs deeplink --project examples/demo.bitwave.json --json
node agent/cli.mjs state --json
node agent/cli.mjs selftest
node agent/mcp-server.mjs
```

`--json` prints only the envelope on stdout (diagnostics go to stderr); flags accept
`--flag value` and `--flag=value`. Exit codes: `0` success, `2` usage, `3` tool error
(`E_*`), `4` internal. The MCP server speaks newline-delimited JSON-RPC 2.0 over stdio
(protocol `2025-06-18`, zero dependencies); point an MCP client at the absolute server
path:

```json
{ "mcpServers": { "bitwave": {
  "command": "node",
  "args": ["C:\\Users\\<you>\\Documents\\BitWave\\agent\\mcp-server.mjs"]
} } }
```

The in-app human surface is the **agent tab of the help panel**: open `?`, then `agent`,
for bridge status, copy-prompt/deeplink/state buttons, the live state JSON and the tool
catalogue.

### Agent checks

```powershell
node agent/gen-agent-artifacts.mjs --check   # manifest + examples current (deterministic)
node agent/selftest.mjs                      # CLI + MCP + canonical vectors
node agent/verify-browser.mjs                # independent headless-browser checklist
npm test                                     # includes the agent-tools/state tests
```

The same commands have npm aliases: `npm run agent:check`, `npm run agent:selftest`,
`npm run agent:verify`, and `npm run mcp`.

Reproducible states, `#bitwave-state` extraction and headless-Chrome recipes:
[`docs/AGENT-SCREENSHOTS.md`](docs/AGENT-SCREENSHOTS.md). Sibling tools and what a future
handoff would carry (no live cross-tool links in v1; manifest `relatedTools` is empty):
[`docs/BITWAVE-ECOSYSTEM-MAP.md`](docs/BITWAVE-ECOSYSTEM-MAP.md).

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
