# BitWave — implementation status

**Updated:** 2026-11-06 · **Phase:** F0 baseline (partial), F1 core **done**, F3 source-table housing spike **done**.
**Source of truth:** [`PLAN.md`](PLAN.md) for the plan, [`DECISIONS.md`](DECISIONS.md) for choices taken, [`DESIGN.md`](DESIGN.md) for the visual contract. `index.html` is still untouched and remains the shipping instrument.

## Author decisions (2026-11-06)

1. **Lanes are 1 / 2 / 3** — UI, docs and code. Letters belong only to frames/operands (A, Z, B). The A/B/C-vs-A/B naming collision is gone. Done in the core; the app UI follows at F2/F4.
2. **Routing is the existing CSV column dropdown, not a new subsystem.** The six operand inputs already have source dropdowns (`colA`/`colB` in the `data` group). The matrix is only the structural housing — one fixed row per input — and the only new source group is frame outputs. No separate import path, no routing mode.
3. **No cable graphics, ever.** The cable spike and patch-model diagram are retired.
4. **Dimming is hands-off.** No contrast/token changes; colour and intensity are a future mapping axis. Q8 is closed.

## Where we are

| Phase | Status | Notes |
|---|---|---|
| **F0 Baseline** | **Partial** | Git, zero-dependency harness, model-level golden vectors. Vite/`tsc`/Playwright/CI not installed; headless Chromium is blocked by this sandbox, so browser-level verification is a user-machine task. |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules; lanes 1/2/3; 38 tests green. |
| **F2 State spine + renderers** | Next | Wire the core through a store + renderer adapters; join the CSV column bindings and frame routes into one binding model. |
| **F3 Source-table housing** | **Spike done** | Six fixed input rows, one source each; SOURCE = data column or frame output; STATE = `data`/`1:1`/`z⁻¹`. No add/remove, no new mode, no new state. |
| **F4–F6** | Not started | A11y/IA (no palette changes), persistence UI, distribution. |

## Verified this session

- `npm test` → **38 tests, 38 pass, 0 fail, ~90 ms** after the lane rename.
- DESIGN §11 invariants, routing §3.7 vectors, CSV typing, geometry contract, `.bitwave` round-trip all still covered.
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
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example |
| [`DECISIONS.md`](DECISIONS.md) | D1–D12, including the author decisions above |

## Known gaps and blockers

1. **Browser automation is blocked in this sandbox** (headless Chromium cannot launch), so the source table, 360/720 px layout, focus rings and live-region announcements are statically checked but not visually verified.
2. **Toolchain not installed** — Vite/TypeScript/Vitest/Playwright deferred; core runs via Node 24 native TS.
3. **The app is not wired yet** — F2 must route all changes through `evaluateAll`; the current column bindings live in `colA`/`colB`.
4. **Goldens are model-level**, not captured from a live browser session.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It lists `NOT FEDCBA9876543210 → 123456789ABCDEF0`; the actual complement is `0123456789ABCDEF` (confirmed by `invert` and by index.html's own implementation). The test asserts the true value.

## Next actions

1. **Housing visual pass:** open the spike at 360 / 720 / 1440 px; check select widths, focus and the data/frame legend.
2. **F2 spine:** `src/state/store.ts` + `actions.ts`; renderer adapters. Join the existing CSV column bindings and frame routes into one per-input binding model (no behaviour change for CSV).
3. **F3 in the app:** replace the per-lane `colA`/`colB` selects with the six-row source table; keep import/typing/alignment identical; add frame sources and `z⁻¹` state.
4. **F4:** roles/keyboard/targets/reduced motion/reflow; **do not touch the palette** (Q8 closed).
