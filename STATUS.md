# BitWave — implementation status

**Updated:** 2026-11-06 · **Phase:** F0 **done**, F1 **done**, F2 spine + render + UI modules done (pointer/lane controllers still in `main.js`), F3 source table + frame routing **done**, F4 accessibility + IA **done**, F5 persistence & reach **done**. **F6 distribution done** — installable offline PWA hosted build with the single-file artifact untouched; Tauri remains deferred (D37). The plan's funded path (F0–F6) is complete.
**Source of truth:** [`PLAN.md`](PLAN.md) for the plan, [`DECISIONS.md`](DECISIONS.md) for choices taken, [`DESIGN.md`](DESIGN.md) for the visual contract. `index.html` is still untouched and remains the shipping instrument.

## Author decisions (2026-11-06)

1. **Lanes are 1 / 2 / 3** — UI, docs and code. Letters belong only to frames/operands. The A/B/C-vs-A/B naming collision is gone.
2. **Routing is the existing CSV column dropdown, not a new subsystem.** The six operand inputs already have source dropdowns (`colA`/`colB` in the `data` group). The matrix is only the structural housing — one fixed row per input — and the only new source group is frame outputs. No separate import path, no routing mode.
3. **No cable graphics, ever.** The cable spike and patch-model diagram are retired.
4. **Dimming is hands-off.** No contrast/token changes; colour and intensity are a future mapping axis. Q8 is closed.
5. **Frame names are global** (D15): lane 1 = A/B/Z1, lane 2 = C/D/Z2, lane 3 = E/F/Z3. The six operand frames A–F are the matrix destinations; A–F + Z1–Z3 are the nine frame sources. `.bitwave` frame keys stay per-lane `a`/`b`/`z`.
6. **A frame click is a focus lens** (D16): it never leaves the current view or closes the navigator; operands stay editable, derived frames are read-only, and the 3-D view no longer keeps B as the static frame.

## Author notes for F3 (2026-11-06)

**Matrix labels follow the CSV import.** Default (no import): the fixed global frame
labels above — six operand rows A–F. With a dataset imported, the frame assignment taken
from a CSV column is what the matrix frame label should show; that information is already
in the existing column dropdown, so it is not a second import path.

Recorded verbatim:

> If CSV Import = True, then [Frame Assignment FROM CSV Column] = [Frame Label in Matrix]

The prototype currently reads `Lane 1 · A | data · sine | data`. Open detail for F3:
should the frame label carry the column (`Lane 1 · A · sine`), or is naming the SOURCE
cell enough? Confirm before the matrix lands in the app.

## Where we are

| Phase | Status | Notes |
|---|---|---|
| **F0 Baseline** | **Done** | Git; Vite 8.3.6 + TypeScript 7 + `vite-plugin-singlefile` installed; `npm run build` emits the single-file `bitwave-v2.html` from `src/`; unit suite (77), typecheck and the browser harness (now 52 checks) all green; rebuild parity is a gate (`--compare`) for refactor-only changes. |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules; lanes 1/2/3; 38 core tests green. |
| **F2 State spine + renderers** | **Mostly done** | DOM-free tree, transaction store, `actions.ts`, core `evaluateAll()`; render layer; UI feature modules; every writer inside `store.patch`. `main.js` is ~1,000 lines of composition, pointer input, lane/view controllers, persistence wiring, loop/boot and the agent surface. Remaining: extract pointer + lane/view controllers. |
| **F3 Source-table housing** | **Done** | Six-row `src/ui/source-table.js` (opened from the data group) over `src/state/bindings.ts`: each input reads a CSV column (`data`), a frame output (`1:1`/`z⁻¹`) or `—`. Labels carry the assignment (`A · Hex 1`, matching the import dropdown). Driven inputs are locked against local edits, CSV/LFO skip them, unplug restores the parked base, resize remaps parked bases, and a fresh import rebuilds the board. |
| **F4 A11y + IA** | **Done** | DESIGN amended first (change protocol §13). Shipped: reflow/zoom contract, nibble spinbutton keyboard editing, landmarks/names/radiogroups, canvas alt, live status, reduced motion, 24 px targets, axe gate — then the author-approved IA pass: always-visible stage bar (lane + frames + split), module order `source | register edit | operate | derive | motion | view`, explicit `copy to…` menu, `width` rename + whole-word hex entry, reserved-space disabled placeholders, `?` keyboard map and truth-table semantics. Palette untouched (D10). |
| **F5 Persistence & reach** | **Done** | `.bitwave` schema 2 (additive focus/frameVis, LFO mode/rate, dataset cursor) with a DOM-free app bridge; explicit `project…` menu (save/open/reset); debounced autosave + boot restore; `#bw=` URL-fragment share that wins over autosave; embedded 8-row demo dataset; visible dataset/status line that refuses empty/non-token CSVs; `?fresh` ephemeral sessions; stale `index.html.bak` deleted. Palette untouched (D10). |
| **F6 Distribution** | **Done** | Hosted/installable PWA build (`dist/hosted/`): manifest + maskable icons, hash-versioned app-shell service worker, relative URLs, offline reload. The committed single-file `bitwave-v2.html` is untouched and still has zero external references (asserted). `npm run check:pwa` proves install/offline against the real built output; deploy/install/privacy guidance in [`docs/hosting.md`](docs/hosting.md). Tauri 2 deferred (D37). |

## F4 progress (2026-11-06) — complete

**DESIGN.md amended first** (change protocol §13): §5 reflow/zoom + 24 px targets + stage-bar
inset, §6 keyboard editing model, §7 reduced motion, §8 nibble spinbutton / hex entry / canvas
alt / live status / radiogroups / landmarks / stage bar / copy menu / register edit, §9 stable
module order + reserve space + zoom, §10.32–38 invariants, §11 keyboard/roles/zoom/motion/
targets/IA/axe checks, §12 roadmap, §13 new-control rule.

**Shipped and verified:**
- **Reflow/zoom (D27).** `body` min-height + page scroll, `main` carries the grid, stage floor
  `clamp(220px,44dvh,620px)`. Normal viewports stay pixel-identical (6/6 parity states); at
  640×360 and 360×225 CSS px the page scrolls, the stage is 220 px and no control is
  unreachable.
- **Keyboard editing (D26).** Every operand nibble is a roving `role="spinbutton"`
  (aria-valuenow/valuetext; ↑/↓ ±1, ←/→ focus, Home/End, 0–F); Tab enters the strip and
  focus survives re-renders; bit clicks return focus; arrows never also step the CSV;
  derived/driven strips are read-only with no tab stop.
- **Semantics (D31).** One `<main>` + named groups, canvas `role="img"` with a commit-updated
  text alternative, lane sets are radiogroups with arrow selection, glyph/preset/navigator
  names satisfy SC 2.5.3, 24 px targets for the stage-bar controls and the width slider.
- **Live status (D29).** One polite atomic region, transaction-driven, 150 ms debounce, quiet
  during drag and LFO ticks, immediate on pointer-up.
- **Reduced motion (D28).** Transitions removed, commits instant, LFO rate capped 4/s; 1:1
  drag unchanged.
- **Automated gate (D30).** `axe-core` 4.14 as a dev dependency, injected over CDP: zero
  critical/serious in 2-D, A·B 3-D, source-table and frame-navigator states
  (`color-contrast` disabled per D10/Q8; Label-in-Name enabled).
- **IA pass (D32, author-approved mockup `spike/f4-ia.html`).** The stage bar is always
  visible and is the single home of lane + frames + split (frames navigator stays
  left-docked per the author; source table right). Controls render six named modules in the
  approved order with `width` replacing `register`, a read-only `edit · A` target and a
  whole-word hex entry (right-aligned, invalid refused, Esc reverts). `copy to…` is an
  explicit focus-in menu that Escape closes and the live region confirms in words. Binops
  are a radiogroup with arrow selection; inapplicable controls are reserved-space
  `aria-disabled`; `?` opens the keyboard map; the truth table is a real ARIA table.

## F5 progress (2026-11-06) — complete

**DESIGN.md amended first** (change protocol §13): §8 demo dataset / project menu / dataset
status line, §10.39–41 persistence invariants, §11 persistence checks, §12 roadmap.

**Shipped and verified:**
- **`.bitwave` schema 2 + bridge (D33).** Core schema gains additive `focus`/`frameVis`,
  view `lfoMode`/`lfoRate` and dataset `index`; schema 1 still loads with defaults; Z is
  never stored; routes/parked bases persist; top-level unknown fields are preserved across
  load/save; schema >2 and widths outside the slider set are refused with codes.
  `src/state/project-bridge.ts` captures/applies the live tree in one transaction.
- **Autosave + share (D34).** Debounced `localStorage` autosave (650 ms after the last
  transaction), boot order shared link → autosave → boot defaults. `#bw=` fragment refreshed
  with `replaceState`; measured 64-bit payload **1230 chars**, 256-bit **1743 chars**
  (budget 2000; dataset dropped only if needed). `?fresh` runs ephemeral.
- **Project surface (D35).** `project…` focus-in menu (save/open/reset), embedded 8-row demo
  dataset through the normal import path, and a visible polite `#csvStatus` line. Empty and
  all-non-token CSVs are refused without replacing the current dataset; export with no
  observations explains why.
- **Cleanup (D36).** `index.html.bak` deleted (author kept it only until F5).

## F6 progress (2026-11-06) — complete

**DESIGN.md amended first**: §10.42 distribution invariant, §11 PWA verification, §12 roadmap.

**Shipped and verified:**
- **Two deliverables, one instrument (D38).** `npm run build:pwa` keeps
  `bitwave-v2.html` byte-unchanged (zero external refs) and writes `dist/hosted/`:
  `index.html` (same app + PWA shell), `manifest.webmanifest`, `sw.js`, `icons/`,
  and a clean `bitwave-v2.html` copy for direct download.
- **PWA shell.** Standalone manifest with 192/512 + maskable icons generated from the
  palette (`tools/make-pwa-icons.py`, committed PNGs), relative `start_url`/`scope` so a
  subpath deploy works, theme/background `#08090c`.
- **Service worker.** Cache-first same-origin `GET` only, cache name
  `bitwave-<artifact-hash10>`, `skipWaiting`+`claim`, offline navigation fallback,
  old-cache cleanup on activate; no telemetry or third-party traffic.
- **Verification (`npm run check:pwa`).** Serves `dist/hosted/` on `127.0.0.1` and drives
  headless Chromium: manifest/icons load, worker registers/activates/controls, app shell
  cached, and a reload **with the origin server stopped** boots from cache with zero console
  errors; also asserts the single-file artifact stayed clean and the hosted page's only
  external refs are the PWA shell. **7/7 checks.**
- **Distribution docs.** [`docs/hosting.md`](docs/hosting.md): build, deploy (GitHub Pages /
  Netlify / any static host), install on desktop/mobile, offline behaviour, update/cache
  versioning, privacy, and when to send the file vs the URL. `npm run verify` runs the full
  gate. Tauri 2 stays deferred (D37).

## Verified this session

- `npm test` → **77 tests, 77 pass, 0 fail** (71 in the main run: 38 core + 10 state +
  7 actions/routing + 6 bindings + 5 share + 5 project; plus 6 app-bridge tests in a
  separate process because they replace the live singletons);
  `npm run typecheck` → **clean**.
- `npm run build` → **`bitwave-v2.html`, 184.7 KB, single file**, no external references
  (`tools/build-artifact.mjs` gate).
- `npm run check:browser` → **52/52 checks pass** on the built `bitwave-v2.html` (53 with
  `--shots`/`--compare`), including the new F5 project-menu/open/reset, demo dataset,
  CSV-refusal, autosave-reload, share-link round-trip/2 KB budget and `?fresh` groups, in
  addition to the F4 reflow/keyboard/semantics/axe groups and the §11 geometry assertion.
- `npm run build:pwa` → **`dist/hosted/`** (index 189.7 KB, sw.js 1.6 KB, manifest 0.9 KB,
  4 icons) with cache version `bitwave-abda27e2a1`; the committed
  `bitwave-v2.html` was **byte-unchanged** (sha256 checked in the build itself).
- `npm run check:pwa` → **7/7 checks pass**: hosted boot + state surface, manifest + all
  icons, worker registers/activates/controls, hash-versioned cache holds the app shell, and
  a reload with the origin server **stopped** still boots from cache with zero console
  errors; the single-file artifact contains no manifest/icon/SW references.
- `npm run verify` wires all of the above into one gate.
- **F4 slice 1 — reflow/zoom (D27):** parity was 6/6 pixel-identical against the pre-F4
  artifact at normal viewports (measured before the IA slice, which intentionally changes the
  layout); at 640×360 and 360×225 CSS px the page scrolls, the stage stays 220 px and every
  control is reachable.
- **F4 slice 2 — keyboard editing (D26):** 16 spinbuttons, one roving tab stop, Tab enters
  from the width slider, ↑/↓/Home/End/0–F edit, focus survives a commit re-render, bit clicks
  focus the nibble, derived strips expose read-only spinbuttons with no tab stop.
- **F4 slice 3 — semantics + a11y gate (D28–D31):** one `<main>` and six named module
  groups; canvas `role="img"` with a live alt; lane and binop sets are radiogroups; one
  polite atomic live region announces committed changes and stays quiet during drag/LFO;
  reduced motion removes transitions and caps the LFO; stage-bar minis and the width slider
  are ≥24 px; axe-core reports zero critical/serious in 2-D, A·B 3-D, source-table and
  frame-navigator states.
- **F4 slice 4 — IA pass (D32):** author-approved `spike/f4-ia.html` (frames left-docked,
  stage bar owns lane+frames+split). Verified: stage bar visible in 2-D and 3-D; six modules
  in order; binops/stepper are reserved-space `aria-disabled` and never removed; copy menu
  focus-in + Esc + copy + spoken confirmation; hex entry right-aligns `DEADBEEF`, refuses
  `ZZZZ`, reverts on Esc, disables on derived; `?` map opens/closes; truth table
  5 rows / 4 column headers / 16 cells; split 3-D shows two panes with the second expression.
- **F3 shipped — source table + frame routing:** `src/state/bindings.ts`
  (six bindings, data/frame/none sources, `z⁻¹` detection, driven helpers,
  parked-base handling) and `src/ui/source-table.js` (panel, six rows, B-style
  labels, state chips). Data/frame/none choices clear each other, trigger the
  core evaluation, and drive the register. Verified in the browser: `Z3 → A`
  (`1:1`), `Z1 → A` (`z⁻¹`), unplug restores the parked base; driven inputs are
  read-only (strip, hint, click blocked).
- **Driven-input guards:** bit/wheel/drag/presets/ops/LFO/CSV step skip driven
  inputs; `evaluate()` syncs their display targets; resize remaps parked bases;
  copy-lane updates parked bases; unpair clears a route first.
- **Your four-column sample** (`testcsv.xlsx` → `examples/testcsv.csv`) imports to
  six rows: `A · Hex 1`, `C · Hex 2`, `D · Grandma Hex`, `E/F · Bananas Hex`,
  32-bit register; the browser check asserts it.
- **Parity note:** the `--compare` gate no longer matches the pre-feature artifact
  because F3 deliberately changes the source-table UI (and F4 deliberately changes the
  shell/layout). It remains the gate for refactor-only changes; the new baseline is the
  committed `bitwave-v2.html`.
- **F2 slice 4 — UI feature modules out:** `src/ui/frame-navigator.js` (panel + focus
  lens), `src/ui/stage-bar.js` (lane selector/split/expression),
  `src/ui/csv-import.js` (import + example stepper), `src/ui/keyboard.js`,
  `src/ui/controls.js` (ops/presets/binop/size + LFO engine) and
  `src/io/observations.js`. `main.js`: 1,659 → ~820 lines.
- **F2 slice 3 — render layer out:** `src/render/canvas.js` (2-D curve, 3-D field,
  legend, `fitCanvas`/`--pad`), `src/render/strip.js` (editor strip + fast patch),
  `src/render/readouts.js` (hex/dec/truth/trend/3-D rows) and `src/state/dataset.ts`.
  The spline now comes from `src/core/spline.ts`, and CSV parsing/typing/alignment
  from `src/core/csv.ts`; the app's duplicate parsers are gone.
- **F2 slice 2 — commands + real evaluation:** `src/state/actions.ts` and
  `src/state/routing.ts` (core `LaneMap` adapter + `evaluate()` running
  `evaluateAll()`). `recomputeZ` is gone from the app.
- `npm run check:browser` → **27/27 checks pass at the time** (now 52/52 — see above)
  on the built `bitwave-v2.html`:
  zero console errors; no overflow or clipped controls at 360/420/720/1440;
  `canvas.width` = viewport; `--pad` 40/16 and compact mode per DESIGN §5/§9;
  strip gap/nibble width follow the §5 formula (1440: gap 12.00, nibble 73.75);
  frame navigator + per-lane eye toggles; 3-D `Z = A xor B`, truth counts `23/11/9/21`,
  `popcount(Z) = 20`; CSV import, the four-column sample, the source table,
  frame driving/unplug and the §11 ROL/NOT/BSWAP vectors all hold; the agent
  surface is frozen/versioned; default state renders byte-identically.
- **Shipped this session:** global frame names (D15) and the frame focus lens (D16/D17)
  in `bitwave-v2.html` and the housing spike: lane 1 A/Z1/B, lane 2 C/Z2/D, lane 3 E/Z3/F
  in the navigator, strip label, legend, stage bar, truth header, readouts and 3-D plate
  labels. Clicking a frame no longer leaves 3-D or closes the navigator; Z1/Z2/Z3 focus
  read-only; `enableBOnSlot()` no longer steals focus; the eyes are per lane.
- **Shipped the agent/test seam (D18):** `window.BitWave` (schema 1, deep-frozen, no
  setters) with `state()`, `geometry()` and `frames()`. The geometry assertion now
  measures control points against DOM nibble centres (worst offset **0.00 px**, §11
  limit 1.5 px), closing the former canvas-alignment gap.
- **Shipped the toolchain (D19):** multi-file source under `src/` builds to the single
  self-contained artifact; `npm run dev` serves the source; no minification.
- Housing visual pass: spike at 360/720/1440 px; six rows × 14 options; rebinding
  updates only the STATE chip + status and keeps focus; no horizontal overflow.
- **Drift found and fixed:** `--pad` was written with a second, hard-coded 680 px
  threshold inside `draw()`, which also recomputed the gutter instead of reading
  the authority `fitCanvas()` had written — the DESIGN §10.4 desync (canvas inset
  ≠ strip gutter). `fitCanvas()` now computes `PAD` once and `draw()` reads it.
- **Measured the F4 zoom gap (now resolved, D27):** at 400 % zoom (360×225 CSS px) 26
  controls were clipped and unreachable; at 250 % (560×315) 8; at 320×480 5. The fixed
  `100dvh` + `overflow:hidden` body was the cause.
- Core terminology: no `slots`/`Slot`/A/B/C lane keys in `src/core` except the historical rename note.
- `.bitwave` example regenerated with `"lanes"` and `"1"/"2"/"3"` keys.
- Housing spike (360 lines): six fixed rows; 14 source options per select (1 none + 4 data + 9 frame); destinations fixed; only the changed state cell and status mutate, so focus survives; 32 px targets; palette-only; no add/remove/canvas/SVG/cable/jack markup.

## Key artifacts

| Artifact | Purpose |
|---|---|
| [`src/`](src/index.html) | App source: `index.html` template, `main.js` (~1,000-line composition + controllers), `styles/app.css` |
| [`src/state/instrument.ts`](src/state/instrument.ts) | DOM-free state tree, frame names, factories and selection helpers |
| [`src/state/store.ts`](src/state/store.ts) | Transaction boundary: `get`/`patch`/`subscribe`, nested patches collapse |
| [`src/state/actions.ts`](src/state/actions.ts) | Commands: core unary ops/presets, focus/binop/visibility/bit/nibble/hex/copy/unpair |
| [`src/state/bindings.ts`](src/state/bindings.ts) | Six input bindings, data/frame/none sources, driven + parked-base helpers |
| [`src/state/routing.ts`](src/state/routing.ts) | Core `LaneMap` adapter + `evaluate()` running `src/core/routing.ts` |
| [`src/state/project-bridge.ts`](src/state/project-bridge.ts) | App ↔ `.bitwave` schema-2 bridge: capture/apply, unknown-field preservation |
| [`src/state/dataset.ts`](src/state/dataset.ts) | Dataset state (columns, rows, cursor) shared by the shell and canvas code |
| [`src/render/`](src/render/canvas.js) | Canvas + 3-D field, strip, readouts; the only DOM/canvas renderers |
| [`src/ui/source-table.js`](src/ui/source-table.js) | The six-row matrix panel: data/frame/none source, B-style labels, state chips |
| [`src/ui/`](src/ui/frame-navigator.js) | Frame navigator, stage bar (lane/frames/split), copy menu, project menu, keyboard map + map panel, CSV stepper, controls + LFO, committed-change live status |
| [`src/ui/copy-menu.js`](src/ui/copy-menu.js) | Explicit `copy to…` menu: focus-in, arrow nav, Esc, spoken copy confirmation |
| [`src/ui/project-menu.js`](src/ui/project-menu.js) | `project…` menu: save/open/reset with the same focus contract |
| [`src/ui/help.js`](src/ui/help.js) | `?` keyboard-map panel — the one declared shortcut surface |
| [`src/io/`](src/io/observations.js) | Observation logger/CSV export, `.bitwave` download/read, autosave, URL share |
| [`testcsv.xlsx`](testcsv.xlsx), [`examples/testcsv.csv`](examples/testcsv.csv) | The four-column layout sample; CSV twin for the importer |
| [`vite.config.mjs`](vite.config.mjs) | Vite 8 build: `src/` → `dist/index.html`, no minification |
| [`tools/build-artifact.mjs`](tools/build-artifact.mjs) | Single-file gate: verifies no external refs, writes `bitwave-v2.html` |
| [`src/core/`](src/core/index.ts) | DOM-free engine (13 modules, ~1,700 lines), lanes 1/2/3, project schema + share codec |
| [`tests/`](tests/design-invariants.test.ts) | 9 test files, 77 vectors + properties (share + app-bridge are new) |
| [`examples/demo.bitwave.json`](examples/demo.bitwave.json) | Versioned project document (lanes 1/2/3; routes + parked bases; dataset) |
| [`spike/routing-matrix.html`](spike/routing-matrix.html) | The reference housing prototype that F3 implements (360 lines) |
| [`spike/f4-ia.html`](spike/f4-ia.html) | The author-approved F4 IA layout mockup (annotated, 1440/720/360 screenshots) |
| [`tools/browser-check.mjs`](tools/browser-check.mjs) | Zero-dependency CDP harness: 52 checks (53 with `--shots` or `--compare`), incl. reflow/zoom, keyboard editing, IA, axe and F5 persistence |
| [`tools/build-pwa.mjs`](tools/build-pwa.mjs) | Hosted/PWA build: `dist/hosted/` from the untouched artifact; injects manifest/SW registration, writes the hash-versioned worker |
| [`tools/check-pwa.mjs`](tools/check-pwa.mjs) | Zero-dependency PWA gate: local static server + CDP; manifest/icons, worker control, hash cache, server-down offline reload, artifact cleanliness (7 checks) |
| [`tools/make-pwa-icons.py`](tools/make-pwa-icons.py) | Reproducible icon set (`assets/pwa/`): 192/512/maskable/32 from the palette, Pillow only |
| [`assets/pwa/`](assets/pwa/icon-512.png) | Committed PWA icons used by the hosted build |
| [`docs/hosting.md`](docs/hosting.md) | Share/deploy/install/offline/privacy guidance for researchers |
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example |
| `window.BitWave` in [`bitwave-v2.html`](bitwave-v2.html) | Read-only, schema-1 state/geometry/bindings surface; contract in [`AGENTS.md`](AGENTS.md) |
| [`DECISIONS.md`](DECISIONS.md) | D1–D38, including the author decisions and the F4–F6 passes (D26–D38) |

## Known gaps and blockers

1. ~~**Reflow/zoom clips controls.**~~ **Resolved in F4 (D27):** the page scrolls at zoom, the
   stage keeps a 220 px floor and normal viewports stay pixel-identical; asserted at 200 % and
   400 % in `npm run check:browser`.
2. **Canvas curve sampling is still not pixel-tested.** `BitWave.geometry()` now
   proves the canvas control points and the DOM nibble centres agree (worst
   offset 0.00 px, §11 limit 1.5 px), but the drawn spline's own pixels are not
   sampled; the §11 check asserts geometry, not raster output.
3. **Two controllers still live in `main.js`.** Pointer input (canvas + strip) and the
   remaining lane/view orchestration (`selectSlot`, `split`, `syncViewUi`, boot) are not yet
   `src/ui/` modules; the stage bar and copy menu own their own DOM. They do not block the
   shipped path; the spine, renderers, bindings and UI feature modules are already separate.
4. ~~**Routes are not persisted yet.**~~ **Resolved in F5 (D33):** schema 2 persists the six
   bindings (data columns + frame routes) and parked bases; a saved patch board reloads
   identically, and the app-bridge round-trip test covers it.
5. **Parked-base resize is core-tested but not browser-tested.** The app calls
   `remapParkedBases()` around a resize; the core test covers the mapping, the
   app path is not yet driven by the browser check.
6. **A newer `.bitwave` schema is refused, not opened read-only.** The plan's "open read-only"
   path for a future schema is not built; the UI reports a clear error and leaves the current
   instrument untouched. Low risk while schema 2 is the only shipped format.
7. **Project save is not browser-asserted end-to-end.** Open/apply/reset, autosave and share
   are driven in Chromium; the `save project` download path is exercised by the unit-tested
   façade but not captured by the harness (no download interception).
8. **Tauri 2 is deferred, by design (D37).** The native shell is only worth paying for if OS
   file associations, native menus or local file watching become real needs; the browser
   file/download/share paths plus the installable PWA cover the current workflow.
9. **Install/update UX is browser-native.** There is no custom install button or service-worker
   update toast: install is the browser's affordance and a new build activates on the next
   visit (hash cache). Acceptable for static hosting; revisit if the hosted deployment gets a
   release process needing forced updates.
10. **`dist/hosted/` is generated, not committed.** `npm run build:pwa` reproduces it
    deterministically from the committed artifact + `assets/pwa/`; deployment pipelines must
    run the build rather than copy a checked-in folder.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It listed `NOT FEDCBA9876543210 →
  123456789ABCDEF0`; the actual complement is `0123456789ABCDEF` (confirmed by
  `invert`, by `index.html`, and now by the browser check). DESIGN §11 corrected;
  the test asserts the true value.

## Next actions

The funded roadmap (F0–F6) is complete. What remains is optional polish and the
design backlog in `DESIGN.md` §12 (which is the creative content of the instrument, not
infrastructure):

1. **Teaching/musical backlog (DESIGN §12 "Next"):** arithmetic delta vs bitwise delta
   (the borrow term `2·(¬a ∧ b)`), a BSWAP mirror affordance, two's-complement toggle,
   fold-vs-truncate comparison, endpoint-trend net displacement, and the silent B seed.
   Each is additive and uses the existing spine.
2. **F2 finish (optional):** extract the pointer controller and the remaining lane/view
   orchestration into `src/ui/`, leaving `main.js` as pure composition. No behavioural
   change; run `npm run verify` and a fresh `--compare` baseline.
3. **Small F5/F6 follow-ups:** read-only newer-schema open (gap 6), browser-level save
   download assertion (gap 7), a `copy link` item next to `save project` for discoverability,
   and Tauri only if its trigger conditions appear (D37). **Do not touch the palette**
   (Q8 closed).
