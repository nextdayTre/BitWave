# BitWave — implementation status

**Updated:** 2026-11-05 (implementation session) · **Phase:** F0 baseline (partial), F1 core **done**, F3 spike **done**.
**Source of truth:** [`PLAN.md`](PLAN.md) for the plan, [`DECISIONS.md`](DECISIONS.md) for the choices taken, [`DESIGN.md`](DESIGN.md) for the visual contract. `index.html` is still untouched and remains the shipping instrument.

## Where we are

| Phase | Status | Notes |
|---|---|---|
| **F0 Baseline** | **Partial** | Git repo + baseline commit; zero-dependency test harness; model-level golden vectors. Vite/`tsc`/Playwright/CI not installed — headless Chromium is blocked by this sandbox, so the full artifact/geometry golden trace is a user-machine task. |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules: types, registers/nibble maths, ops/presets, derive (Z/truth/carry), spline, slots/boot/resize, **routing engine**, CSV parse/typing, geometry, `.bitwave` project format. 38 tests green. |
| **F2 State spine + renderers** | Next | Wire the core through a store + renderer adapters; `index.html` still uses the old focused-slot `commit()`. |
| **F3 Patch dock UI** | **Spike done** | [`spike/patch-dock.html`](spike/patch-dock.html) — standalone interaction prototype, 805 lines, static-checked. Needs a visual pass on your machine (browser blocked here). |
| **F4–F6** | Not started | A11y/IA, persistence UI, distribution. |

## Verified this session

- `npm test` → **38 tests, 38 pass, 0 fail, ~90 ms** across four files.
- DESIGN §11 invariants: `ROL 4`, `NOT`, `BSWAP` (involutive, no-op at 8 bits), A·B XOR/AND/OR vectors, truth counts `23/11/9/21`, popcounts `20/21`, right-align + truncation, positional weight, centre-pinned resize, spline range/endpoints/smoothstep.
- Routing §3.7 vectors: boot values, `C.Z→A.A`, one-pass chain, unpatch byte-identity, one-cable-per-input replacement, invalid wiring, two-state feedback oscillator, deterministic cross-view cycle, `clearRoutes`, resize + parked remap, focus-free idempotent evaluation.
- CSV: quoted/CRLF/tab parsing, header detection, per-column bin/hex typing, widest-column default, right-alignment and overflow truncation.
- Geometry: §5 insets, gap clamp, 0-px column contract (`x(j)` centre + symmetry), compact threshold, nearest nibble, inverse vertical mapping, ∞ point.
- `.bitwave` project: serialize → JSON → deserialize round-trip, no Z persisted, routes + parked bases preserved, unpatch after load restores byte-identically, 256-bit round-trip, malformed/future schema rejection codes.
- `src/core` is DOM-free (grep-verified; no browser globals).
- Spike static checks: inline script passes `node --check`; every referenced id exists; no external assets/fetch/imports; palette contains only DESIGN tokens; amber token defined but unused; `--inf` reserved.

## Key artifacts

| Artifact | Purpose |
|---|---|
| [`src/core/`](src/core/index.ts) | DOM-free engine (11 modules, ~1,350 lines) |
| [`tests/`](tests/design-invariants.test.ts) | 4 test files, ~630 lines, 38 vectors + properties |
| [`examples/demo.bitwave.json`](examples/demo.bitwave.json) | Real `.bitwave` document generated from the engine (2 routed views + 3-row dataset) |
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example (`node tools/make-example-project.ts`) |
| [`spike/patch-dock.html`](spike/patch-dock.html) | Standalone patch-dock interaction prototype |
| [`package.json`](package.json) / [`tsconfig.core.json`](tsconfig.core.json) | `npm test`; future strict DOM-free typecheck |
| [`DECISIONS.md`](DECISIONS.md) | D1–D9 assumptions and reversibility notes |

## Known gaps and blockers

1. **Browser automation is blocked in this sandbox.** Headless Chromium cannot launch (named-pipe/Mojo access denied), so Playwright, the interaction golden trace, screenshots, zoom/reflow and the §11 geometry assertion (control-point x vs hex-cell centre < 1.5 px) must run on your machine / normal terminal.
2. **Toolchain not installed.** Vite/TypeScript/Vitest/Playwright are deliberately deferred; the core runs via Node 24 native TS. The module contracts do not change when the toolchain arrives.
3. **The app is not wired yet.** `index.html` still derives Z only for the focused view; F2 must route all changes through `evaluateAll`.
4. **Goldens are model-level**, not captured from a live browser session (blocker 1). They pin the arithmetic and routing exactly.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It lists `NOT FEDCBA9876543210 → 123456789ABCDEF0`; the actual bitwise complement is `0123456789ABCDEF` (confirmed by `invert`, by index.html's own implementation, and by hand). The test asserts the true value and documents the discrepancy. Recommend correcting DESIGN.md §11 before using it as a release gate.

## Next actions

1. **F2 spine:** `src/state/store.ts` + `actions.ts`; renderer adapters (canvas `FrameInput`, strip reconcile, readouts, stage bar). First milestone: boot the new engine behind a feature flag and reproduce today's 2-D view, keeping `index.html` shippable.
2. **Spike visual pass:** open `spike/patch-dock.html` and check cable geometry at 360/720/1440 px, focus flow, driven-state readability and the `z⁻¹` affordance; then fold the confirmed interaction into the real dock.
3. **F4 prep:** amend DESIGN.md §3/§8/§10 per PLAN.md §8 before the contrast/role changes (author decision Q8 still open).
