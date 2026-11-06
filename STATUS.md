# BitWave — implementation status

**Updated:** 2026-11-06 · **Phase:** F0 browser harness **done**, F1 core **done**, F3 source-table housing spike **done**.
**Source of truth:** [`PLAN.md`](PLAN.md) for the plan, [`DECISIONS.md`](DECISIONS.md) for choices taken, [`DESIGN.md`](DESIGN.md) for the visual contract. `index.html` is still untouched and remains the shipping instrument.

## Author decisions (2026-11-06)

1. **Lanes are 1 / 2 / 3** — UI, docs and code. Letters belong only to frames/operands (A, Z, B). The A/B/C-vs-A/B naming collision is gone. Done in the core; the app UI follows at F2/F4.
2. **Routing is the existing CSV column dropdown, not a new subsystem.** The six operand inputs already have source dropdowns (`colA`/`colB` in the `data` group). The matrix is only the structural housing — one fixed row per input — and the only new source group is frame outputs. No separate import path, no routing mode.
3. **No cable graphics, ever.** The cable spike and patch-model diagram are retired.
4. **Dimming is hands-off.** No contrast/token changes; colour and intensity are a future mapping axis. Q8 is closed.

## Author notes for F3 (2026-11-06)

**Matrix labels follow the CSV import.** When a dataset is imported, the frame
assignment taken from a CSV column is what the matrix frame label should show;
without an import the matrix falls back to the fixed `Lane 1/2/3 · Frame A/B/Z`
labels. The existing CSV column dropdown is the intended mechanism, not a second
import path. Cross-lane routing (`1·Z → 2·A`) remains a wanted feature.

Recorded verbatim:

> If CSV Import = True, then [Frame Assignment FROM CSV Column] = [Frame Label in Matrix]

The exact label shape (which column shows the imported name) is pinned down
before F3 ships.

## Where we are

| Phase | Status | Notes |
|---|---|---|
| **F0 Baseline** | **Unblocked** | Git, zero-dep unit suite (38) and a checked-in browser harness (17 checks) now verify the shipped artifact over `file://`; Vite/`tsc`/Vitest/Playwright stay deferred by D5. |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules; lanes 1/2/3; 38 tests green. |
| **F2 State spine + renderers** | Next | Wire the core through a store + renderer adapters; join the CSV column bindings and frame routes into one binding model. |
| **F3 Source-table housing** | **Spike done** | Six fixed input rows, one source each; SOURCE = data column or frame output; STATE = `data`/`1:1`/`z⁻¹`. No add/remove, no new mode, no new state. |
| **F4–F6** | Not started | A11y/IA (no palette changes), persistence UI, distribution. |

## Verified this session

- `npm test` → **38 tests, 38 pass, 0 fail, ~120 ms**.
- `npm run check:browser` → **16/16 checks pass** (17/17 with `--shots`) on `bitwave-v2.html`:
  zero console errors; no overflow or clipped controls at 360/420/720/1440;
  `canvas.width` = viewport; `--pad` 40/16 and compact mode per DESIGN §5/§9;
  strip gap/nibble width follow the §5 formula (1440: gap 12.00, nibble 73.75);
  frame navigator + eye toggles; 3-D `Z = A xor B`, truth counts `23/11/9/21`,
  `popcount(Z) = 20`; CSV import binds the widest column and the §11
  ROL/NOT/BSWAP vectors hold; default state renders byte-identically.
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
| [`src/core/`](src/core/index.ts) | DOM-free engine (11 modules, ~1,350 lines), lanes 1/2/3 |
| [`tests/`](tests/design-invariants.test.ts) | 4 test files, ~630 lines, 38 vectors + properties |
| [`examples/demo.bitwave.json`](examples/demo.bitwave.json) | Versioned project document (lanes 1/2/3; routes + parked bases; dataset) |
| [`spike/routing-matrix.html`](spike/routing-matrix.html) | Six-row source-table housing prototype (360 lines) |
| [`tools/browser-check.mjs`](tools/browser-check.mjs) | Zero-dependency CDP harness: 17 checks on the shipped file over `file://` |
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example |
| [`DECISIONS.md`](DECISIONS.md) | D1–D14, including the author decisions above |

## Known gaps and blockers

1. **Reflow/zoom clips controls.** At 400 % zoom (360×225 CSS px) 26 controls are
   unreachable; the fixed `100dvh` + `overflow:hidden` body cannot scroll. F4
   must allow page scroll at zoom while keeping the instrument fixed at normal
   viewports. Measured, reproducible in `npm run check:browser`'s width matrix.
2. **Canvas control-point alignment is not asserted end-to-end.** The harness
   checks the strip formula, `--pad` and canvas width; the F2
   `window.__bitwave.debug.geometry()` hook is what lets it compare `x(j)` with
   the canvas control points instead of trusting the shared constant.
3. **Toolchain not installed** — Vite/TypeScript/Vitest/Playwright deferred (D5);
   core runs via Node 24 native TS and the browser harness uses built-in
   WebSocket/fetch.
4. **The app is not wired yet** — F2 must route all changes through
   `evaluateAll`; the current column bindings live in `colA`/`colB`.
5. **Goldens are model-level + deterministic hashes**, not stored PNG baselines;
   a cross-machine baseline would need a tolerance comparison.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It listed `NOT FEDCBA9876543210 →
  123456789ABCDEF0`; the actual complement is `0123456789ABCDEF` (confirmed by
  `invert`, by `index.html`, and now by the browser check). DESIGN §11 corrected;
  the test asserts the true value.

## Next actions

1. **F2 spine:** `src/state/store.ts` + `actions.ts`; renderer adapters. Join the
   existing CSV column bindings and frame routes into one per-input binding model
   (no behaviour change for CSV). Add the `window.__bitwave.debug` read surface as
   the first agent/test seam.
2. **F3 in the app:** replace the per-lane `colA`/`colB` selects with the six-row
   source table; keep import/typing/alignment identical; add frame sources and
   `z⁻¹` state. Labels follow the author note above — confirm the label shape first.
3. **F4:** roles/keyboard/targets/reduced motion/reflow, including the measured
   zoom clipping; **do not touch the palette** (Q8 closed).
