# BitWave — implementation status

**Updated:** 2026-11-05 (implementation session) · **Phase:** F0 baseline (partial) + F1 core extraction (partial).
**Source of truth:** [`PLAN.md`](PLAN.md) for the plan, [`DECISIONS.md`](DECISIONS.md) for the choices taken, [`DESIGN.md`](DESIGN.md) for the visual contract. `index.html` is still untouched and remains the shipping instrument.

## Where we are

| Phase | Status | Notes |
|---|---|---|
| **F0 Baseline** | **Partial** | Git repo + baseline commit; zero-dependency test harness; golden vectors captured. Vite/`tsc`/Playwright/CI not installed — headless Chromium is blocked by this sandbox, so the full artifact/geometry golden trace is a user-machine task. |
| **F1 Core + routing engine** | **Partial** | Extracted: types, registers/nibble maths, unary ops + presets, derive (Z/truth/carry), spline, slots/boot/resize, routing engine. Remaining: CSV parser + column typing, geometry helpers (`x(j)`, `nearestNibble`, `valueFromY`), project schema. |
| **F2 State spine + renderers** | Not started | Core is ready to be wired through a store; `index.html` still uses the old focused-slot `commit()`. |
| **F3 Patch dock UI** | Spike in progress | `spike/patch-dock.html` is the throwaway interaction prototype. |
| **F4–F6** | Not started | A11y/IA, persistence, distribution. |

## Verified this session

- `npm test` (or `node --test --test-isolation=none tests/design-invariants.test.ts tests/routing.test.ts`) → **22 tests, 22 pass, 0 fail, ~70 ms**.
- DESIGN §11 invariants covered: `ROL 4`, `NOT`, `BSWAP` (involutive, no-op at 8 bits), A·B XOR/AND/OR vectors, truth counts `23/11/9/21`, popcounts `20/21`, right-align + truncation, positional weight, centre-pinned resize, spline range/endpoints/smoothstep.
- Routing §3.7 vectors covered: boot values, `C.Z→A.A`, one-pass chain, unpatch byte-identity, one-cable-per-input replacement, invalid wiring, two-state feedback oscillator, deterministic cross-view cycle, `clearRoutes`, resize + parked remap, focus-free idempotent evaluation.
- `src/core` is DOM-free (grep-verified; no `document`/`window`/`localStorage`/`requestAnimationFrame` usage).
- Core is headless and runs in plain Node 24 via native TypeScript type stripping — no install step.

## Key artifacts

| Artifact | Purpose |
|---|---|
| [`src/core/`](src/core/index.ts) | DOM-free engine (8 modules, ~835 lines) |
| `tests/design-invariants.test.ts` | DESIGN §11 golden vectors + spline properties |
| `tests/routing.test.ts` | Routing semantics + golden patch vectors |
| [`package.json`](package.json) / [`tsconfig.core.json`](tsconfig.core.json) | `npm test` script; future strict, DOM-free typecheck config |
| [`DECISIONS.md`](DECISIONS.md) | D1–D8 assumptions and reversibility notes |
| `spike/patch-dock.html` | Standalone patch-dock interaction prototype (see file header) |

## Known gaps and blockers

1. **Browser automation is blocked in this sandbox.** Headless Chromium cannot launch (named-pipe/Mojo access denied), so Playwright, the real interaction golden trace, screenshots, zoom/reflow and the §11 geometry assertion (control-point x vs hex-cell centre < 1.5 px) must run on your machine / normal terminal.
2. **Toolchain not installed.** Vite/TypeScript/Vitest/Playwright are deliberately deferred; the core currently runs via Node 24 native TS. When `npm i -D` is available, the plan's toolchain can be added without touching the module contracts.
3. **The app is not wired yet.** `index.html` still derives Z only for the focused view. That is the F2 job, and it must go through the `evaluateAll` spine rather than bolting routing onto the old `commit()`.
4. **Goldens are model-level.** The boot values were recomputed from the same table formulas and cross-checked against DESIGN §11, not captured from a live browser session (blocker 1). They still pin the arithmetic and routing exactly.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It lists `NOT FEDCBA9876543210 → 123456789ABCDEF0`; the actual bitwise complement is `0123456789ABCDEF` (confirmed by `invert`, by index.html's own implementation, and by hand). The test asserts the true value and documents the discrepancy. Recommend correcting DESIGN.md §11 before using it as a release gate.

## Next actions (in order)

1. **F1 remainder:** port the CSV parser + per-column typing (`loadCSV`/`columnMode`/`cellToBits`), geometry helpers and the `.bitwave` project schema into `src/core`, each with vectors from index.html.
2. **Finish the patch-dock spike review:** check keyboard flow, driven-state feedback, cable geometry at 720 px and 360 px, and the `z⁻¹` affordance; then treat it as the reference for the real dock.
3. **F2 spine:** `src/state/store.ts` + `actions.ts`, then renderer adapters. First milestone: boot the new engine and reproduce today's 2-D view pixel-for-pixel behind a feature flag, keeping `index.html` shippable.
4. **Then** F3 dock UI in the real app, F4 a11y/IA, F5 persistence.
