# BitWave — implementation status

**Updated:** 2026-11-06 · **Phase:** F0 **done** (harness + Vite build + parity gate), F1 core **done**, F3 housing spike **done**; frame names, focus lens and the read-only `window.BitWave` seam **shipped**.
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
| **F0 Baseline** | **Done** | Git; Vite 8.3.6 + TypeScript 7 + `vite-plugin-singlefile` installed; `npm run build` emits the single-file `bitwave-v2.html` from `src/`; zero-dep unit suite (38), typecheck and the browser harness (24 checks) all green; rebuild parity is a gate (`--compare`). |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules; lanes 1/2/3; 38 tests green. |
| **F2 State spine + renderers** | Next | Source is now modular (`src/main.js` is still one extracted module): split it into `state/`, `render/`, `ui/` through a store, with `evaluateAll` and screenshot-hash parity as the gate. |
| **F3 Source-table housing** | **Spike done** | Six fixed input rows, one source each; SOURCE = data column or frame output; STATE = `data`/`1:1`/`z⁻¹`. No add/remove, no new mode, no new state. |
| **F4–F6** | Not started | A11y/IA (no palette changes), persistence UI, distribution. |

## Verified this session

- `npm test` → **38 tests, 38 pass, 0 fail, ~120 ms**; `npm run typecheck` → **clean**.
- `npm run build` → **`bitwave-v2.html`, 99.3 KB, single file**, no external references
  (`tools/build-artifact.mjs` gate). Source: `src/index.html` + `src/main.js` (92.8 KB)
  + `src/styles/app.css` (19.6 KB).
- **Parity proven:** `node tools/browser-check.mjs --compare .tmp-captures/legacy-bitwave-v2.html`
  → **6/6 states pixel-identical** (2-D default, frames open, 3-D, 3-D Z1 focus,
  CSV import, 720 px breakpoint). The extracted source builds an artifact that
  renders exactly like the hand-written file.
- `npm run check:browser` → **24/24 checks pass** (25/25 with `--shots`, 25/25 with
  `--compare`, 26/26 with both) on the built `bitwave-v2.html`:
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
| [`src/`](src/index.html) | App source: `index.html` template, `main.js` (extracted module), `styles/app.css`; `src/core/` untouched |
| [`vite.config.mjs`](vite.config.mjs) | Vite 8 build: `src/` → `dist/index.html`, no minification |
| [`tools/build-artifact.mjs`](tools/build-artifact.mjs) | Single-file gate: verifies no external refs, writes `bitwave-v2.html` |
| [`src/core/`](src/core/index.ts) | DOM-free engine (11 modules, ~1,350 lines), lanes 1/2/3 |
| [`tests/`](tests/design-invariants.test.ts) | 4 test files, ~630 lines, 38 vectors + properties |
| [`examples/demo.bitwave.json`](examples/demo.bitwave.json) | Versioned project document (lanes 1/2/3; routes + parked bases; dataset) |
| [`spike/routing-matrix.html`](spike/routing-matrix.html) | Six-row source-table housing prototype (360 lines) |
| [`tools/browser-check.mjs`](tools/browser-check.mjs) | Zero-dependency CDP harness: 24 checks (25 with `--shots`, 25 with `--compare`) |
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example |
| `window.BitWave` in [`bitwave-v2.html`](bitwave-v2.html) | Read-only, schema-1 state/geometry surface; contract in [`AGENTS.md`](AGENTS.md) |
| [`DECISIONS.md`](DECISIONS.md) | D1–D19, including the author decisions above |

## Known gaps and blockers

1. **Reflow/zoom clips controls.** At 400 % zoom (360×225 CSS px) 26 controls are
   unreachable; the fixed `100dvh` + `overflow:hidden` body cannot scroll. F4
   must allow page scroll at zoom while keeping the instrument fixed at normal
   viewports. Measured, reproducible in `npm run check:browser`'s width matrix.
2. **Canvas curve sampling is still not pixel-tested.** `BitWave.geometry()` now
   proves the canvas control points and the DOM nibble centres agree (worst
   offset 0.00 px, §11 limit 1.5 px), but the drawn spline's own pixels are not
   sampled; the §11 check asserts geometry, not raster output.
3. **`src/main.js` is still one extracted module.** The toolchain is in place, but
   the IIFE has not been split into `state/`, `render/` and `ui/` yet — that is F2.
   Likewise `src/core` is tested but not imported by the app; wiring it in is F2/F3.
4. **The app is not wired to the core** — F2 must route all changes through
   `evaluateAll`; the current column bindings live in `colA`/`colB`.
5. **Goldens are model-level + deterministic hashes**, not stored PNG baselines;
   a cross-machine baseline would need a tolerance comparison. The `--compare`
   parity gate is same-machine, same-browser.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It listed `NOT FEDCBA9876543210 →
  123456789ABCDEF0`; the actual complement is `0123456789ABCDEF` (confirmed by
  `invert`, by `index.html`, and now by the browser check). DESIGN §11 corrected;
  the test asserts the true value.

## Next actions

1. **F2 spine:** split `src/main.js` into modules behind a store: `state/store.ts`
   (`get`/`patch`/`subscribe`), `state/actions.ts`, `render/*` and `ui/*`, with the
   app's mutations routed through one transaction and `evaluateAll()` as the only
   evaluator. Join the CSV column bindings and frame routes into one per-input
   binding model (no behaviour change for CSV). `npm run build` +
   `--compare` screenshots are the regression proof at every step.
2. **F3 in the app:** replace the per-lane `colA`/`colB` selects with the six-row
   source table; keep import/typing/alignment identical; add frame sources and
   `z⁻¹` state. Rows are the six operand frames A–F (D15); confirm the CSV label
   shape from the author note before wiring the imported column name.
3. **F4:** roles/keyboard/targets/reduced motion/reflow, including the measured
   zoom clipping; **do not touch the palette** (Q8 closed).
