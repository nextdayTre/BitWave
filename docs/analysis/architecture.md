# BitWave — Architecture & Long-Term Codebase Plan

**Date:** 2026-11-05 · **Scope:** `index.html` (2,832 lines as read by the read tool, 92,991 bytes), `DESIGN.md` (495 lines), and a proposed multi-file source tree. Line numbers are the current `index.html`. Toolchain present: Node 24.14.1, npm 11.11.0, git 2.55.0 (**repo not initialised**), rustc 1.95.0.

**Naming update 2026-11-06:** lanes are 1/2/3 and frame names are global — lane 1 A/B/Z1, lane 2 C/D/Z2, lane 3 E/F/Z3 (D15). This analysis keeps the original slot keys `A`/`B`/`C` for line references; its semantics are unchanged.

**Toolchain update 2026-11-06 (D19):** the Vite 8 + TypeScript + `vite-plugin-singlefile` build is installed. `src/index.html` + `src/main.js` + `src/styles/app.css` build to the single-file `bitwave-v2.html`, and a `--compare` screenshot gate proves rebuild parity. `src/main.js` is still one extracted module; splitting it into `state/`, `render/`, `ui/` is F2.

**State update 2026-11-06 (D20):** `src/state/instrument.ts` (single tree, frame names, selection helpers) and `src/state/store.ts` (nested patches collapse to one transaction) are in, and the app's register/derive math delegates to `src/core`. `commit()` runs inside the store transaction. Renderers, input handlers and the remaining writers still live in `src/main.js`; `evaluateAll()` joins the transaction next.

**Actions/routing update 2026-11-06 (D21):** `src/state/actions.ts` owns the commands and delegates unary ops/presets to `src/core/ops.ts`; `src/state/routing.ts` maps the app slots onto a core `LaneMap` (shared registers) and `evaluate()` runs the core `evaluateAll()` in the transaction. All register writers are wrapped in `store.patch`, and `tests/actions.test.ts` proves a core route reaches the app tree and unroutes byte-identically. Remaining for F2: the render/ui split and the view-state writers.

Governing constraints: `DESIGN.md` is the visual source of truth, no new hue is introduced below, and §11 (lines 419–437) must pass after every phase.

---

## A. Current coupling and seam analysis

The IIFE (705–2829) is ~2,125 JS lines in fourteen regions but only four state singletons: `S` (749–779), `G` (996), `DEMO` (724), `observations` (2380).

| Region | Lines | LOC | Pure / side-effecting |
|---|---|---|---|
| Model: registers, nibbles, Z, resize | 709–911 | 203 | ~150 / ~53 |
| Spline | 913–962 | 50 | 50 / 0 |
| Canvas + 3-D field | 964–1415 | 452 | ~25 / ~427 |
| Bit strip + readouts | 1417–1601 | 184 | ~45 / ~139 |
| Pointer interaction | 1603–1743 | 141 | ~35 / ~106 |
| LFO + unary ops + presets | 1745–1990 | 245 | ~142 / ~103 |
| B/binop + slots/view + size glue | 1992–2353 | 360 | ~34 / ~326 |
| CSV stepper + observations | 2355–2741 | 387 | ~120 / ~267 |
| rAF loop + boot | 2743–2829 | 86 | 0 / 86 |

Totals: ~2,108 LOC, **~601 pure / ~1,507 side-effecting** — the app is mostly DOM and canvas plumbing, which is why a framework would mostly duplicate existing glue.

Counts: **327** `S.`, 44 `getElementById`, 36 `addEventListener`, 6 `innerHTML`, 46 `DEMO.`. CSS is 556 lines / 109 rule blocks (8–563); DOM shell 138 lines (566–703). Worst blockers: `resizeRegister` calls `lfoStop()` (863), `renderStrip()` and `updateReadouts()` (909–910); `draw()` calls `renderStrip()` (1248) and reads `S`/`DEMO` (1086–1172); `setFromPointer` writes `S.Z.anim` (1661).

**Eight extraction hazards.**

1. **Render-on-mutation.** `commit()` (1595–1601) syncs, recomputes and renders; presets (1905) and ops (1981) call it. Render must become a callback.
2. **Model calls UI.** `resizeRegister` → `lfoStop` + both renderers (861–911); `fitToMappedColumns` → `sizeInput.value` (2484–2498).
3. **`recomputeZ` reads `curSlot()`** by default (841); only resize, LFO and copy pass a slot (902, 1797, 1860, 2192, 2217).
4. **`S` is a facade**: 768–778 proxy to the focused slot, so 327 refs mean "current slot". Delete it, don't port it.
5. **`S.N` is global**: `nibAt`/`setNibAt` read it (795–806) — thread `N` or DESIGN §10.10 returns.
6. **DOM captured at module scope** in six clusters (968, 1421–1432, 1756–1760, 2061–2066, 2342–2343, 2366–2379): import order matters, nothing is testable without a document.
7. **Two strip paths** — `innerHTML` rebuild (1469) vs `patchNibble` (1474) — DESIGN §10.11's stale-`wt` bug.
8. **CSS written from JS**: `fitCanvas()` sets `--pad` (1008); one writer or the 0 px contract dies.

**Circular references.** `draw()` → `renderStrip()` (1248); `draw`/`drawField3d` read `S` and `DEMO` (1086–1172); `resizeRegister` → `lfoStop` → `renderStrip`/`updateReadouts` (1801–1802) → `fitToMappedColumns` → `resizeRegister`; `lfoTick` → `applyExample` → `lfoStop` → render; `setFromPointer` → `recomputeZ` + `patchNibble` + `updateReadouts`. The render graph is not a DAG.

**Extraction order (lowest risk first):** spline → register/bit maths with explicit `N` → `derive` (Z, truth counts, carry/borrow) + CSV parser (2391–2462) → geometry helpers (1607–1632) → readout view-model → canvas renderer behind a frozen `FrameInput` → strip reconcile → controllers → view/slot + LFO engines → persistence → boot. Steps 1–4 are §11-provable immediately; the canvas is the irreversible bet, so it moves last.

---

## B. Target module layout

```
src/
  core/        types, numbers, registers, ops, derive, spline, geometry, lfo, csv, project
  state/       store.ts (State + patch + subscribe), actions.ts (commands)
  render/      theme.ts, canvas.ts, field3d.ts, strip.ts, readouts.ts, stageBar.ts
  io/          csvFile.ts, projectFile.ts, share.ts, observations.ts
  ui/          controls.ts, pointer.ts, keyboard.ts
  main.ts      composition root: shell → store → renderers → rAF
  styles/      tokens.css, base.css, stage.css, strip.css, controls.css, responsive.css
tests/         unit/, e2e/, fixtures/
```

| Module | Contract | Side effects |
|---|---|---|
| `core/*` | plain data/functions; `Uint8Array` bits, `number` nibbles | **none** (enforced by TS `lib`) |
| `state/store.ts` | `get()`, `patch(fn)`, `subscribe(cb)` | subscribers only |
| `state/actions.ts` | commands returning the patch they applied | none |
| `render/*` | `draw(frozen FrameInput)`, `renderX(vm)` | canvas / DOM |
| `io/*` | `load(text)→Dataset`, `save(doc)→Blob`, `parseShare(hash)` | pickers, storage, `location` |
| `main.ts` | one store → N renderers; owns rAF + `ResizeObserver` | all |

**One-way rule:** `core ← state ← render/ui ← main`, plus `io → core`. Enforce mechanically: `tsconfig.core.json` with `"lib": ["ES2022"], "types": []` (so `document` does not type-check) plus a 20-line Vitest test grepping `src/core/**` for `window|document|localStorage|requestAnimationFrame|getComputedStyle`.

**TypeScript, yes.** The fragile invariants are numeric: `Uint8Array` vs `number[]`, `bigint` vs `number`, `"a" | "b"` edit keys; Vite strips types, so migration is incremental. `strict` pitfalls: **BigInt** needs `target: ES2022`, is not JSON-serialisable (store hex), and subtraction goes negative — keep the `& ((1n << BigInt(N)) - 1n)` wrap (833); **tuples** — declare `SIZES`/`SLOT_KEYS` `as const` and iterate them, since `Object.keys` widens; leave **`noUncheckedIndexedAccess` off**, or `bits[i]` becomes `number|undefined` and every op loop needs assertions. Enable `verbatimModuleSyntax`, skip `exactOptionalPropertyTypes`.

---

## C. Build and dependency policy

- **Vite.** Verified Vite **8.3.6**; 8.0 stable released **12 Mar 2026**, Rolldown-based, needs Node 20.19+/22.12+ ([announcement](https://vite.dev/blog/announcing-vite8.html)); local Node 24.14.1 qualifies. Its dev server also routes around the `file://` limit (D).
- **Dependencies.** Zero runtime. Dev: `typescript`, `vite`, `vite-plugin-singlefile`, `vitest`, `@playwright/test`, `@axe-core/playwright`. No UI kit, CSS framework, or state library.
- **CSS.** `styles/tokens.css` holds the only `:root`; everything else uses `var(--x)`. `render/theme.ts` keeps the single `getComputedStyle` read plus inline fallbacks — the exception already documented at DESIGN §3 (48–51) and code 975–980, not a new one.
- **Keeping DESIGN honest.** `tests/unit/design-contract.spec.ts`: parse DESIGN §3's token table (55–70) and assert byte-equality with `tokens.css` both ways; ban hex/`rgb(` outside `tokens.css`/`theme.ts`; compare code constants against §5/§9/§10.14 (insets 34/26, `--pad`, breakpoint 720, compact 46, 3-D ratios).

---

## D. Preserving the single-file artifact

**Mechanism.** `<script type="module">` is fetched with CORS, and CORS needs an origin. A `file:///…` document has an opaque origin, so every module request — including `./main.js` — fails before being read. MDN: you "can no longer view your HTML using the `file://` protocol… module requests use CORS, and `file://` URLs are never same-origin" ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules/Modules_on_the_web)). A classic `<script>` cannot contain `import`, and inline code in an inline module runs only until its first static import. A multi-file module app therefore cannot be double-clicked — ever.

**Therefore** source becomes multi-file and distribution stays a built single file. `vite-plugin-singlefile` (verified **2.3.4**, MIT, ~2.5 M weekly downloads) inlines all JS and CSS into one HTML file ([npm](https://www.npmjs.com/package/vite-plugin-singlefile)); its README confirms what still works from `file://` (`localStorage`, hash routing) and what does not (cookies, History-API routing, sourcemaps, chunks from dynamic `import()`).

Consequences: two first-class outputs from one source — `dist/bitwave.html` (classroom/USB) and `dist/` (hosted); ban dynamic `import()` and external asset URLs, CI-asserted; Playwright opens `file:///…/dist/bitwave.html` and runs DESIGN §11, so a failing artifact is not releasable; fail CI above 200 KB uncompressed and report the size each build.

---

## E. UI framework decision

The app is ~60 % imperative canvas (452 lines) and ~40 % a static DOM shell with ~12 text nodes plus one list (strip). A framework only helps the latter, and the strip is already patched per-nibble (1474): it would add a runtime, compiler and reactivity model to replace ~80 lines of `textContent`/`classList`.

| Criterion (weight) | Vanilla TS + ~80-line signals | Svelte 5 | Solid | React | Lit |
|---|---|---|---|---|---|
| Fit: canvas + light reactive DOM (.30) | 5 | 5 | 4 | 3 | 3 |
| Bundle/runtime (.10) | 5 (~0 KB) | 4 | 4 | 2 | 3 |
| Learning cost, solo non-specialist (.20) | 4 | 3 (runes) | 3 | 2 (hooks) | 3 |
| Ecosystem (.10) | 2 | 3 | 2 | 5 | 3 |
| Long-term maintenance (.20) | 5 | 4 | 3 | 4 | 4 |
| Design control, no DOM wrappers (.10) | 5 | 5 | 5 | 4 | 4 |
| **Weighted** | **4.5** | **4.1** | 3.5 | 3.2 | 3.3 |

Evidence: Svelte **5.57** (Sept 2026, [blog](https://svelte.dev/blog/whats-new-in-svelte-september-2026)); Solid stable **1.9.18** with `@solidjs/web@2.0.0-rc.20` mid-transition ([npm](https://registry.npmjs.org/solid-js/latest)); Lit **3.3.3** ([npm](https://registry.npmjs.org/lit/latest)); React on its current major. The size column is qualitative — gzipped sizes were not measured here.

**Recommendation: vanilla TS + a tiny signals layer, no framework.** The DOM shell already exists (566–703) and must stay byte-identical for geometry; there are no repeated component instances except the strip, which wants keyed patching. Hand-roll ~80 lines of `signal/computed/effect` or take ~1 KB; take no compiler. **No framework is a valid long-term answer** and is strongest here, because the risky part is canvas and pixel alignment, which no framework touches.

**Flips if:** surfaces become screen-like (library, settings, routing — more than ~3 screens); a framework-experienced developer joins; or a desktop shell brings menus/multi-window. Then choose **Svelte 5**; React only if hiring dominates; Lit only for web-component embedding elsewhere.

---

## F. Packaging and distribution

| | Static site (+PWA) | Tauri 2 | Electron | Native rewrite |
|---|---|---|---|---|
| Artifact size | ~100–200 KB (order of magnitude) | single-digit MB | 10–100× the web asset | per-OS native |
| Memory | one tab | system WebView | Chromium + Node | lowest |
| Native file access | pickers / File System Access API | dialog + fs plugins | yes | yes |
| Auto-update | service worker (needs HTTPS) | updater plugin | mature | custom |
| Cross-platform | any browser | Win/mac/Linux (+mobile) | Win/mac/Linux | three codebases |
| Build complexity | near zero | Rust + WebView2/bundler | medium, large deps | high |
| Dev velocity | highest | medium (Rust + IPC) | medium-high | lowest |

Evidence: Tauri **2.12** (26 Sep 2026) raises MSRV to Rust 1.90 and drops Windows 7 because the WebView2 installer no longer runs there ([Tauri 2.12](https://tauri.app/blog/tauri-2.12/)); it uses the system WebView — WebView2 on Windows, `webkit2gtk-4.1` on Linux ([prerequisites](https://v2.tauri.app/start/prerequisites/)) — and ships small binaries with documented size options ([app size](https://v2.tauri.app/concept/size/)). Electron **45.0.0** went stable **20 Oct 2026** (Chromium M156, Node 24) ([schedule](https://releases.electronjs.org/schedule)). A PWA needs a service worker, available only in a secure context (HTTPS, `localhost`) ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)) — it helps the hosted path, not `file://`.

**Sequence:** static site + single-file now → manifest/service worker in phase 4 once a stable URL exists → **Tauri 2** when native CSV import and `.bitwave` save/open become daily needs (Rust 1.95.0 is already installed, so toolchain cost is ~0; note the WebView2 dependency in release notes) → skip Electron (10–100× footprint, no missing capability) → no native rewrite.

---

## G. Persistence and state

```json
{ "schema": 1, "app": "bitwave", "savedAt": "2026-11-05T22:00:00Z",
  "N": 64, "slot": "A", "view3d": false, "split3d": false, "splitPair": ["A","B"], "activePane": 0,
  "slots": { "A": { "A": "8ADEFEDA85210125", "B": "FFFFFFFF00000000", "showB": true,
                    "binop": "xor", "edit": "a", "lfoB": "0", "colA": 3, "colB": 7 }, "B": {}, "C": {} },
  "lfo": { "on": false, "mode": "rotcw", "rate": 4 },
  "dataset": { "kind": "inline", "name": "examples.csv", "cols": ["id","sine"],
               "rows": [["1","F0"]], "i": 0 } }
```

| Decision | Choice | Reason |
|---|---|---|
| Width | `N` once per document | mirrors `S.N`; keeps DESIGN §10.10 coherent |
| Registers | hex strings, A and B only | `Z` is derived (841); persisting it invites contradiction |
| Dataset | `inline` default; `reference` only on `http(s)` | `fetch` of sibling files is CORS-blocked under `file://` (D) |
| DEMO in project file | **yes** — dataset, cursor `i`, per-slot `colA/colB` | `loadCSV` rewrites routing for all slots (2650–2680); observations name examples (2553) |
| Migration | pure `migrate(doc)` chain; *higher* unknown schema opens read-only | forward compatibility, no silent rewrite |
| Unknown fields | preserved on save | newer files survive an older build |
| Autosave | debounce 400–750 ms; IndexedDB on `http(s)`, `localStorage` fallback, explicit download always | README vouches for `localStorage` on `file://`; **IndexedDB on `file://` is unverified here** |
| Share URL | `#bw=1.<N>.<3 slots × A,B>` packed → base64url, ≈260 chars at 256 bits | hash routing works from `file://`; ~2 KB stays inside browser URL limits (guideline) |

This implements DESIGN §12's promised shareable state (479–480) with no visual change.

---

## H. Verification strategy

| Layer | Tool | Proves |
|---|---|---|
| Unit | Vitest | DESIGN §11 verbatim: `ROL 4`, `NOT`, `BSWAP` (+involutive, no-op at 8), A·B XOR/AND/OR vectors, counts `23,11,9,21`, `popcount(Zxor)=20`, `popcount(Zand)=21`, B-edit leaves A untouched |
| Property | Vitest (± fast-check) | `popcount(ROL(x,k))==popcount(x)`, `BSWAP²=id`, rotate-by-N = id, spline stays in `[0,15]`, truth counts sum to `N` |
| Golden trace | Vitest | boot→preset→op→toggle B→binop→resize→CSV step, captured **from today's `index.html`** before any move; core must reproduce it byte-for-byte |
| Geometry | Playwright/Chromium | control-point `x(j)` vs hex-cell centre **< 1.5 px**; `body.scrollWidth-clientWidth === 0` at 420 px; `canvas.width === viewport width`; zero `console.error` over load + 2 s |
| Visual | Playwright screenshots | 3 baselines (2-D 64-bit, A·B, 3-D split at 1280×800) with tolerance — canvas AA makes exact matching brittle |
| A11y | `@axe-core/playwright` | zero critical/serious in default, A·B and 3-D states; dim-on-black contrast documented, not blanket-disabled |
| Artifact | Playwright over `file://` | the shipped single file passes §11 |
| Contract | Vitest | tokens ↔ DESIGN §3, colour-literal ban, constants ↔ §5/§9, `src/core` DOM-free |

Expose a test-only `window.__bitwave.debug.geometry()` returning `xs[]` and hex rects, not pixel scraping. **Shipped 2026-11-06** as the read-only `window.BitWave.geometry()` (schema 1) returning `controlPoints[]` and DOM nibble rects; `tools/browser-check.mjs` asserts the < 1.5 px contract from it. CI: `npm ci` → `tsc -p tsconfig.core.json --noEmit` → `vitest run` → `build:single` → `playwright test` → upload artifact + failure screenshots.

**Done means:** golden trace matches; §11 green on the dev server *and* `file:// dist/bitwave.html`; screenshot baselines unchanged or explained; token contract passes; no `console.error`.

---

## I. Phased migration roadmap

| Phase | Goal / steps | Gate | Effort | Risk | Rollback |
|---|---|---|---|---|---|
| **0 Scaffold** | `git init`, Vite 8 + TS + Vitest + Playwright, `dist/bitwave.html`, CI, golden traces; leave `index.html` untouched | CI green on the untouched file; artifact passes §11 | 1–2 d | low | delete branch |
| **1 Core** | spline → numbers/registers → ops → derive → geometry → csv; explicit `N`; no DOM | core `tsc` with no DOM lib; unit + golden green; tiny artifact diff | 4–6 d | medium | modules land standalone; `index.html` stays the reference |
| **2 Renderers/UI** | store + actions; readout VM; canvas `FrameInput`; strip reconcile; controllers; delete `S` facade and `commit()` | §11 + screenshots unchanged; frame budget holds at 256 bits; core has no render call | 5–8 d | **high** | revert phase 2; core is additive |
| **3 Persistence** | `.bitwave` v1 + migrate, autosave, URL fragment, dataset inline/reference | round-trip fixtures; share URL ≤ ~2 KB; save→reload identical | 3–5 d | low | feature-flag it |
| **4 Packaging** | PWA manifest/SW (hosted), then Tauri 2 if triggered | installed offline app works; Tauri opens/saves real files | 2–4 d web, +5–8 d Tauri | medium | web artifact remains the only shipped path |
| **5 Optional framework** | only if E's flip conditions are met (Svelte 5) | prior gates green; bundle budget respected | 10–15 d | high | stay on vanilla |

**Do not:** adopt a framework before the core is extracted and tested; stop shipping the single file; componentise the CSS; add a UI kit or new hue; move the canvas before `FrameInput` exists; persist `Z`; make autosave synchronous; adopt Tauri before a hosted build exists; let DESIGN and `tokens.css` drift.

---

## J. Recommendation

**Stack:** vanilla TypeScript (strict, ES2022) · Vite 8 · Vitest + Playwright + axe-core · zero runtime deps · `tokens.css` as the only colour source · two outputs (single file + static site) · versioned `.bitwave` hex-string JSON · Tauri 2 deferred, not rejected.

**Sequence:** phases 0→1→2 are one continuous ~10–16 day effort and deliver the actual ask — a codebase that no longer stifles — with the visual contract proven intact. Phases 3–4 are independently shippable and do not depend on phase 5, which may never happen. The framework is the last decision, not the first: it is the only choice here that cannot be reversed cheaply.

**Top 3 risks.** (1) *Behavioural drift*: the LFO snapshot/restore (1767–1804), Z easing and the 1:1 drag path (1657–1663) — mitigated by the phase-0 golden trace and phase gates. (2) *Geometry regression*: `--pad`, `gap`/`x(j)` and rect-based sizing break invisibly — mitigated by the 1.5 px assertion on every CI run and one writer for `--pad`. (3) *Toolchain churn*: Vite 8 is a fresh Rolldown major and `vite-plugin-singlefile` is a small single-maintainer plugin carrying the whole classroom path — mitigate with exact pins, the `file://` artifact test, and a documented esbuild fallback.

**Safely deferred:** framework, desktop shell, PWA/service worker, share-link compression, `FrameInput`'s shape. **Not deferrable:** the golden trace, the schema version field, the single-file artifact — cheap now, expensive to retrofit.
