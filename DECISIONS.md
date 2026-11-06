# Decision log

Implementation decisions taken to keep the plan moving. Each one is reversible
while the codebase is small; the ones the plan marked for the author are noted.
Format is deliberately short: decision, basis, how to reverse it.

**Status:** 2026-11-05 · applies to the `src/core` extraction and F0 baseline.

| # | Decision | Basis | Reverse by |
|---|---|---|---|
| D1 | **Accessibility is in scope in both senses** (WCAG and reach); WCAG P0 (F4) lands before persistence (F5). | PLAN §9 Q1 recommendation. The keyboard/nibble model is reused by routing and share. | Reorder F4/F5 in the roadmap; no code implication yet. |
| D2 | **Routing semantics:** cross-view cords + within-view feedback; sources `A/B/Z`×3; destinations `A/B`×3; Z is never a destination; **one cable per input**; feedback gets one-evaluation `z⁻¹` delay; patched inputs are driven and lock local edits. | PLAN §9 Q2–Q5 recommendations; routing deep-dive §2–§3. Implemented in `src/core/routing.ts`. | Change `addRoute`/`evaluateAll`; tests pin the current contract. |
| D3 | **Park/restore is byte-identical on unplug**, including across resize via `remapParked`. | Reuses the LFO's promise (DESIGN §10.18); routing §3.1. | Replace park map with a different policy; tests assert the contract. |
| D4 | **Lane naming:** lanes are **1 / 2 / 3** in UI, docs and code; letters belong only to frames/operands (A, Z, B). Persisted keys are `"1"/"2"/"3"` too. | Author decision 2026-11-06 (closes PLAN Q6); removes the "A.A" ambiguity. | Pre-release `.bitwave` schema stays 1; a rename migration would be one field. |
| D5 | **Core technology:** native Node TypeScript (type stripping) + `node --test` with **zero dependencies**; Vite/`tsc`/Playwright scaffolding is deferred until the environment can run them. | Node 24.14.1 runs `.ts` directly; the sandbox blocks Chromium and process-piped test runners, so a dependency-free harness is the only verifiable path in-session. | Swap the runner for Vitest later; module imports already use explicit `.ts` extensions and `tsconfig.core.json` is ready. |
| D6 | **`N` is an explicit parameter in the core**; no global state, no `curSlot()` default. The app's one shared width becomes a store concern. | DESIGN §10.10; PLAN §6.3. Implemented throughout `src/core`. | Reintroduce a façade in `state/`, never in `core/`. |
| D7 | **Evaluation is clocked, not algebraic:** `evaluateAll` runs on transactions, samples delayed sources before writing, resolves views in dependency order, then derives Z. | routing §3.2–§3.3; avoids stale Z and hung loops. | Change evaluation policy in one function; tests cover chains/cycles. |
| D8 | **DESIGN §11 `NOT` vector is an erratum.** The real complement of `FEDCBA9876543210` is `0123456789ABCDEF`; the doc lists `123456789ABCDEF0`, which is neither the complement nor consistent with `invert`. | Verified independently; index.html's `invert` agrees with the engine. | Correct DESIGN.md §11 (recommended); the test documents which value is authoritative. |
| D9 | **The `.bitwave` document persists A/B hex, lane settings, routes and parked bases — never Z.** Schema 1; a newer schema is rejected with a distinct `newer-schema` code so the UI can offer read-only. | PLAN §6.5; DESIGN §10.8; routing park/restore needs its bases to survive reload. | Bump `PROJECT_SCHEMA` + add a migration chain; old files keep loading through the old branch. |
| D10 | **Dimming is hands-off.** No changes to `--dim`, `--dimmer`, `--line`, alpha values or contrast. Colour and intensity are a future mapping axis. | Author decision 2026-11-06 (closes PLAN Q8): "The tool is not a toy." | Reopen only as an explicit mapping-layer design task. |
| D11 | **Routing is the existing CSV column mechanism, housed as a six-row source table.** Each fixed operand input (A/B × lanes 1–3) gets one SOURCE select listing imported data columns first and frame outputs second. STATE is `data` / `1:1` / `z⁻¹` / `—`. No add/remove rows, no matrix toggle, no separate import path, no cables/jacks/drag/3-D overlays. CSV loading, typing and alignment are unchanged. | Author decision 2026-11-06: "Matrix is the structural housing for this, that is all." | UI-only; the routing engine and CSV path are unchanged. |
| D12 | **The cable dock spike is retired.** `spike/patch-dock.html` and `docs/diagrams/patch-model.svg` are removed; `spike/routing-matrix.html` is the single reference prototype. | Same decision: one clear prototype beats two. | Git history retains both. |

## Open decisions still with the author

- **Contrast trade-off** (PLAN §9 Q8): bump `--dim`/`--dimmer` to pass AA, or keep the dim hierarchy. Not executed yet — DESIGN.md must be amended first.
- **Timeline path** (PLAN §9 Q9): foundation-first (current) vs routing-in-the-old-file first. If the latter, `src/core/routing.ts` ports cleanly but the old `index.html` work would be a second implementation.
- Whether to keep `index.html.bak` until F5; it is tracked in git so deleting it is recoverable.
