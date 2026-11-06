# BitWave — implementation status

**Updated:** 2026-11-06 · **Phase:** F0 baseline (partial), F1 core **done**, F3 routing-matrix spike **done**.
**Source of truth:** [`PLAN.md`](PLAN.md) for the plan, [`DECISIONS.md`](DECISIONS.md) for choices taken, [`DESIGN.md`](DESIGN.md) for the visual contract. `index.html` is still untouched and remains the shipping instrument.

## Author decisions (2026-11-06)

1. **Lanes are 1 / 2 / 3** — UI, docs and code. Letters belong only to frames/operands (A, Z, B). The A/B/C-vs-A/B naming collision is gone. Done in the core; the app UI follows at F2/F4.
2. **Routing is a SOURCE → DESTINATION matrix table** (Serum-2 style), not a cable diagram. No cables, jacks, drag or 3-D overlays. The old cable spike and patch-model diagram are retired.
3. **Dimming is hands-off.** No contrast/token changes; colour and intensity are a future mapping axis. Q8 is closed. Accessibility work must not alter the palette.

## Where we are

| Phase | Status | Notes |
|---|---|---|
| **F0 Baseline** | **Partial** | Git, zero-dependency harness, model-level golden vectors. Vite/`tsc`/Playwright/CI not installed; headless Chromium is blocked by this sandbox, so browser-level verification is a user-machine task. |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules; lanes 1/2/3 renamed throughout; 38 tests green. |
| **F2 State spine + renderers** | Next | Wire the core through a store + renderer adapters. `index.html` still uses the old focused-lane `commit()`. |
| **F3 Routing matrix UI** | **Spike done** | [`spike/routing-matrix.html`](spike/routing-matrix.html) — 517 lines, static-checked, no cable chrome. Needs a visual pass on your machine. |
| **F4–F6** | Not started | A11y/IA (no palette changes), persistence UI, distribution. |

## Verified this session

- `npm test` → **38 tests, 38 pass, 0 fail, ~90 ms** after the lane rename.
- DESIGN §11 invariants, routing §3.7 vectors, CSV typing, geometry contract, `.bitwave` round-trip (see previous status detail; all still covered).
- Core terminology: `grep` finds no `slots`/`Slot`/A/B/C lane keys in `src/core` except the historical rename note.
- `.bitwave` example regenerated with `"lanes"` and `"1"/"2"/"3"` keys; engine round-trips it.
- Matrix spike: inline script passes `node --check`; 7 ids, no duplicates; 15 hex colours all from the DESIGN palette; `var(--inf)` unused; no external refs; no canvas/SVG/cable/jack markup; 9 sources / 6 destinations (Z never a destination); 32 px targets; table scrolls at 360 px; `aria-live` status; disabled taken destinations.
- Architecture diagram label updated from patch dock to routing matrix; cable diagram and cable spike removed from the repo.

## Key artifacts

| Artifact | Purpose |
|---|---|
| [`src/core/`](src/core/index.ts) | DOM-free engine (11 modules, ~1,350 lines), lanes 1/2/3 |
| [`tests/`](tests/design-invariants.test.ts) | 4 test files, ~630 lines, 38 vectors + properties |
| [`examples/demo.bitwave.json`](examples/demo.bitwave.json) | Versioned project document (lanes 1/2/3; routes + parked bases; dataset) |
| [`spike/routing-matrix.html`](spike/routing-matrix.html) | The new reference prototype: source/destination table |
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example |
| [`DECISIONS.md`](DECISIONS.md) | D1–D12, including the three author decisions above |

## Known gaps and blockers

1. **Browser automation is blocked in this sandbox** (headless Chromium cannot launch), so the matrix table, cable removal, 360/720 px layout, focus rings and live-region announcements are statically checked but not visually verified.
2. **Toolchain not installed** — Vite/TypeScript/Vitest/Playwright deferred; core runs via Node 24 native TS.
3. **The app is not wired yet** — F2 must route all changes through `evaluateAll`.
4. **Goldens are model-level**, not captured from a live browser session.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It lists `NOT FEDCBA9876543210 → 123456789ABCDEF0`; the actual complement is `0123456789ABCDEF` (confirmed by `invert` and by index.html's own implementation). The test asserts the true value. Correct DESIGN.md §11 before using it as a release gate.

## Next actions

1. **F2 spine:** `src/state/store.ts` + `actions.ts`; renderer adapters. Boot the new engine behind a flag and reproduce today's 2-D view, keeping `index.html` shippable.
2. **Matrix visual pass:** open `spike/routing-matrix.html` at 360 / 720 / 1440 px; check row density, focus flow, disabled-option clarity and the `1:1`/`z⁻¹` chips.
3. **F3 in the app:** matrix band with SOURCE/DESTINATION rows, replacement rule, `z⁻¹` state, live status. No cables.
4. **F4:** roles/keyboard/targets/reduced motion/reflow; **do not touch the palette** (Q8 closed). Amend DESIGN §8/§9 for lanes and the matrix instead.
