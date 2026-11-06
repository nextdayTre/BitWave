# BitWave — implementation status

**Updated:** 2026-11-06 · **Phase:** F0 **done** (harness + Vite build + parity gate), F1 core **done**, **F2 spine + render + UI modules done** (pointer/lane controllers still in `main.js`), F3 housing spike **done**; frame names, focus lens and the read-only `window.BitWave` seam **shipped**.
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
| **F0 Baseline** | **Done** | Git; Vite 8.3.6 + TypeScript 7 + `vite-plugin-singlefile` installed; `npm run build` emits the single-file `bitwave-v2.html` from `src/`; unit suite (55), typecheck and the browser harness (25 checks) all green; rebuild parity is a gate (`--compare`). |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules; lanes 1/2/3; 38 core tests green. |
| **F2 State spine + renderers** | **Mostly done** | Done: DOM-free tree, transaction store, `actions.ts`, core `evaluateAll()`; render layer (`render/canvas.js`, `strip.js`, `readouts.js`); UI feature modules (`ui/frame-navigator.js`, `stage-bar.js`, `keyboard.js`, `csv-import.js`, `controls.js`) and `io/observations.js`; every writer runs inside `store.patch`. `main.js` is down to 843 lines: composition, pointer input, lane/view controllers, loop/boot and the agent surface. Remaining: extract pointer + lane/view controllers so `main.js` is only composition. |
| **F3 Source-table housing** | **Spike done, next** | Six fixed input rows, one source each; SOURCE = data column or frame output; STATE = `data`/`1:1`/`z⁻¹`. The spine is ready, so the matrix can now be a data change. |
| **F4–F6** | Not started | A11y/IA (no palette changes), persistence UI, distribution. |

## Verified this session

- `npm test` → **55 tests, 55 pass, 0 fail** (38 core + 10 state + 7 actions/routing);
  `npm run typecheck` → **clean**.
- `npm run build` → **`bitwave-v2.html`, 111.2 KB, single file**, no external references
  (`tools/build-artifact.mjs` gate).
- **F2 slice 4 — UI feature modules out:** `src/ui/frame-navigator.js` (panel + focus
  lens), `src/ui/stage-bar.js` (lane selector/split/expression),
  `src/ui/csv-import.js` (import + example stepper), `src/ui/keyboard.js`,
  `src/ui/controls.js` (ops/presets/binop/size + LFO engine) and
  `src/io/observations.js`. `main.js`: 1,659 → **843 lines** of composition,
  pointer input, lane/view controllers, loop/boot and the agent surface.
- **F2 slice 3 — render layer out:** `src/render/canvas.js` (2-D curve, 3-D field,
  legend, `fitCanvas`/`--pad`), `src/render/strip.js` (editor strip + fast patch),
  `src/render/readouts.js` (hex/dec/truth/trend/3-D rows) and `src/state/dataset.ts`.
  The spline now comes from `src/core/spline.ts`, and CSV parsing/typing/alignment
  from `src/core/csv.ts`; the app's duplicate parsers are gone.
- **View state is on the spine too:** lane select, split/3-D mode, copy arming,
  frame visibility, stage bar open and LFO controls all run inside `store.patch`.
- **F2 slice 2 — commands + real evaluation:** `src/state/actions.ts` (unary ops and
  presets delegate to `src/core/ops.ts`; focus/edit/visibility/binop/bit/nibble/copy/
  unpair commands) and `src/state/routing.ts` (core `LaneMap` view over the app slots
  with shared registers + `evaluate()` running the core `evaluateAll()`). All register
  writers run inside `store.patch`; `recomputeZ` is gone from the app.
- **Routing proven in Node:** `tests/actions.test.ts` adds a route from the core
  (`Z3 → A`) through the adapter, checks the app tree updates and that unroute
  restores the parked base byte-identically.
- **Parity still exact:** `--compare` against the hand-written reference →
  **6/6 states pixel-identical**; the browser check now also drives a bit click and
  a wheel nudge on the live artifact (25/25 checks; 26/26 with `--compare`).
- `npm run check:browser` → **25/25 checks pass** (26/26 with `--shots` or
  `--compare`) on the built `bitwave-v2.html`:
  zero console errors; no overflow or clipped controls at 360/420/720/1440;
  `canvas.width` = viewport; `--pad` 40/16 and compact mode per DESIGN §5/§9;
  strip gap/nibble width follow the §5 formula (1440: gap 12.00, nibble 73.75);
  frame navigator + per-lane eye toggles; 3-D `Z = A xor B`, truth counts `23/11/9/21`,
  `popcount(Z) = 20`; CSV import binds the widest column and the §11 ROL/NOT/BSWAP
  vectors hold; frame names A/B C/D E/F + Z1/Z2/Z3 and the focus lens hold in 2-D and
  3-D; `window.BitWave` is frozen/versioned and its state/geometry match the instrument;
  default state renders byte-identically.
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
- **Measured the F4 zoom gap:** at 400 % zoom (360×225 CSS px) **26 controls**
  are clipped and unreachable; at 250 % (560×315) 8; at 320×480 5. The fixed
  `100dvh` + `overflow:hidden` body is the cause.
- Core terminology: no `slots`/`Slot`/A/B/C lane keys in `src/core` except the historical rename note.
- `.bitwave` example regenerated with `"lanes"` and `"1"/"2"/"3"` keys.
- Housing spike (360 lines): six fixed rows; 14 source options per select (1 none + 4 data + 9 frame); destinations fixed; only the changed state cell and status mutate, so focus survives; 32 px targets; palette-only; no add/remove/canvas/SVG/cable/jack markup.

## Key artifacts

| Artifact | Purpose |
|---|---|
| [`src/`](src/index.html) | App source: `index.html` template, `main.js` (843-line composition + controllers), `styles/app.css` |
| [`src/state/instrument.ts`](src/state/instrument.ts) | DOM-free state tree, frame names, factories and selection helpers |
| [`src/state/store.ts`](src/state/store.ts) | Transaction boundary: `get`/`patch`/`subscribe`, nested patches collapse |
| [`src/state/actions.ts`](src/state/actions.ts) | Commands: core unary ops/presets, focus/binop/visibility/bit/nibble/copy/unpair |
| [`src/state/routing.ts`](src/state/routing.ts) | Core `LaneMap` adapter + `evaluate()` running `src/core/routing.ts` |
| [`src/state/dataset.ts`](src/state/dataset.ts) | Dataset state (columns, rows, cursor) shared by the shell and canvas code |
| [`src/render/`](src/render/canvas.js) | Canvas + 3-D field, strip, readouts; the only DOM/canvas renderers |
| [`src/ui/`](src/ui/frame-navigator.js) | Frame navigator, stage bar, CSV stepper, keyboard map and controls + LFO |
| [`src/io/`](src/io/observations.js) | Observation logger and CSV export |
| [`vite.config.mjs`](vite.config.mjs) | Vite 8 build: `src/` → `dist/index.html`, no minification |
| [`tools/build-artifact.mjs`](tools/build-artifact.mjs) | Single-file gate: verifies no external refs, writes `bitwave-v2.html` |
| [`src/core/`](src/core/index.ts) | DOM-free engine (11 modules, ~1,350 lines), lanes 1/2/3 |
| [`tests/`](tests/design-invariants.test.ts) | 6 test files, 55 vectors + properties (state and actions/routing are new) |
| [`examples/demo.bitwave.json`](examples/demo.bitwave.json) | Versioned project document (lanes 1/2/3; routes + parked bases; dataset) |
| [`spike/routing-matrix.html`](spike/routing-matrix.html) | Six-row source-table housing prototype (360 lines) |
| [`tools/browser-check.mjs`](tools/browser-check.mjs) | Zero-dependency CDP harness: 25 checks (26 with `--shots` or `--compare`) |
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example |
| `window.BitWave` in [`bitwave-v2.html`](bitwave-v2.html) | Read-only, schema-1 state/geometry surface; contract in [`AGENTS.md`](AGENTS.md) |
| [`DECISIONS.md`](DECISIONS.md) | D1–D23, including the author decisions above |

## Known gaps and blockers

1. **Reflow/zoom clips controls.** At 400 % zoom (360×225 CSS px) 26 controls are
   unreachable; the fixed `100dvh` + `overflow:hidden` body cannot scroll. F4
   must allow page scroll at zoom while keeping the instrument fixed at normal
   viewports. Measured, reproducible in `npm run check:browser`'s width matrix.
2. **Canvas curve sampling is still not pixel-tested.** `BitWave.geometry()` now
   proves the canvas control points and the DOM nibble centres agree (worst
   offset 0.00 px, §11 limit 1.5 px), but the drawn spline's own pixels are not
   sampled; the §11 check asserts geometry, not raster output.
3. **Two controllers still live in `main.js`.** Pointer input (canvas + strip) and
   lane/view orchestration (select, split, copy, `syncViewUi`) are not yet
   `src/ui/` modules. They do not block F3; the spine, renderers and UI feature
   modules are already separate.
4. **No routing UI yet** — the routing engine evaluates in the app and is covered by
   a Node test (`Z3 → A`), but the six-row source table is not wired and no route is
   created from the UI; that is F3.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It listed `NOT FEDCBA9876543210 →
  123456789ABCDEF0`; the actual complement is `0123456789ABCDEF` (confirmed by
  `invert`, by `index.html`, and now by the browser check). DESIGN §11 corrected;
  the test asserts the true value.

## Next actions

1. **F3 in the app (recommended next):** the spine is done, so build the six-row
   source table as `src/ui/source-table.js` and wire the existing `colA`/`colB`
   bindings + frame sources through `evaluate()`. Keep import/typing/alignment
   identical; rows are the six operand frames A–F (D15); confirm the CSV label
   shape from the author note. `npm run build` + `--compare` remain the gates.
2. **F2 finish (can follow F3):** extract the pointer and lane/view controllers into
   `src/ui/`, leaving `main.js` as pure composition. No behavioural change; parity
   probes it.
3. **F4:** roles/keyboard/targets/reduced motion/reflow, including the measured
   zoom clipping; **do not touch the palette** (Q8 closed).
