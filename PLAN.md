# BitWave — Feature Integration Analysis & Long-Term Plan

**Status:** proposal for review · 2026-11-05 · **No source files were modified.**
**Inputs:** [`DESIGN.md`](DESIGN.md) (495 lines, read in full), [`index.html`](index.html) (2,832 lines / 92,991 bytes, read in full), headless-Chrome attempt (blocked by the sandbox; see §10.1).
**Companion deep-dives (written this session):** [routing](docs/analysis/routing.md) · [UX & accessibility](docs/analysis/ux-a11y.md) · [architecture](docs/analysis/architecture.md). Diagram: [target architecture](docs/diagrams/target-architecture.svg).

> **Author decisions (2026-11-06) — these supersede conflicting text below.**
> 1. **No A/B/C lanes.** The three parallel instruments are **lanes 1/2/3** in UI, docs and code; letters belong only to frames/operands (A, Z, B). The naming collision is closed.
> 2. **No cable graphics.** Routing is a compact **SOURCE → DESTINATION matrix table** (Serum-2 style) with drop-down rows — no cables, no jacks, no drag, no overlay in the 3-D field. Simplicity over spectacle.
> 3. **Dimming is hands-off.** No `--dim`/`--dimmer`/contrast token changes. Colour and intensity are a future mapping axis, and the instrument is not a toy. Q8 is closed; accessibility work must not alter the palette.
> 4. **Routing is the existing CSV column import, housed as a matrix.** The six operand inputs already bind to sources through dropdowns (`colA`/`colB` in the `data` group, populated by the imported file); loading, importing, per-column typing and right-alignment stay exactly as they are. The matrix is only the structural housing for those six bindings — one fixed row per input — and the one new capability is that a binding may also point at a frame output. No separate routing mode, no second import path, no dynamic add/remove rows.
> 5. **Frame names are global.** Lane 1 = A/B/Z1, lane 2 = C/D/Z2, lane 3 = E/F/Z3. The six operand frames A–F are the matrix destinations; A–F + Z1–Z3 are the nine sources. Persisted `.bitwave` frame keys stay per-lane `a`/`b`/`z`.
> 6. **A frame click is a focus lens.** Clicking a frame in the navigator never leaves the current 2-D/3-D view and never closes the navigator; operands stay editable, derived frames focus read-only, and 3-D no longer keeps B as the static frame.

---

## 0. The short version

Your three asks are usually solved as three separate projects. They are not separate here.

> **Routing, keyboard access, persistence and shareable state are four clients of one missing part: a single state-transition spine.** BitWave has the arithmetic and the visual contract; what it lacks is one place where a change is applied, one place where it is evaluated, and one place where it is rendered. `commit()` (`index.html:1595`) is half of that spine and is focused-slot-only.

So the plan is:

1. **Keep exactly what you love.** The instrument, the single-file artifact, the 0 px strip↔curve contract, the two-hue system, the CSV stepper and observation logger, the split 3-D view, the no-onboarding stance. Nothing below replaces them.
2. **Make the source multi-file, keep HTML as an output.** The stifling part is not HTML — it is *authoring inside one inline script with four mutable globals*. Source becomes a tested TypeScript core plus render adapters; `bitwave.html` (one double-clickable file) remains a first-class build artifact for classroom/USB use.
3. **Build the spine once.** A framework-agnostic core, an explicit `evaluateAll()` state transition, and renderers that receive frozen view-models. Routing, keyboard editing, undo, autosave and share links then become features *on* the spine instead of rewrites *of* it.
4. **Ship the source table that houses routing.** Six fixed rows, one per operand input (lanes 1/2/3 × A/B); each SOURCE drop-down lists the imported CSV columns first (the existing mechanism) and frame outputs second. One source per input, a `z⁻¹` chip for same-lane feedback, no cables/jacks/dragging. Z remains derived, never a destination.
5. **Fix the accessibility floor as a first-class milestone, not a cleanup.** Today a keyboard-only user cannot set a single value: no nibble is focusable and the canvas has no text alternative. Roles, names, keyboard editing, target sizes, reduced motion and zoom reflow are P0. **Contrast token changes are out of scope by author decision** — the palette stays as-is.
6. **Defer the reversible decisions, not the expensive ones.** Framework, desktop shell and PWA can wait; the golden trace, the state spine, the schema version field and the single-file artifact test cannot.

**Rough size:** the funded path is ≈22–36 engineer-days (about 4–7 calendar weeks solo, depending on availability), or 1–2 days for a deliberately throwaway routing spike now with the proper build later in F3. Details and gates in §7. The literal "non-HTML" answer in one line: *HTML becomes an output, not the source; the carryable state becomes a versioned `.bitwave` JSON file; a Tauri desktop shell is the optional later step, not the starting point.*

---

## 1. Reading the request

### 1.1 What "more accessible" means here — both senses, and they converge

| Sense | Today | Plan |
|---|---|---|
| **WCAG / product accessibility** | No keyboard value editing, unlabelled canvas, 9–11.5 px labels at 1.97–4.12:1, 10×17 px bit targets, no `prefers-reduced-motion`, fixed `100dvh` + `overflow:hidden` breaks at 200–400 % zoom | P0 pass in §4: semantic nibble controls + hex entry, roles/names/state, contrast tokens, reduced motion, reflow, live status |
| **Reach / access to the work** | Reload loses everything; no shareable state; no project file; observations are memory-only; first-time users without a CSV cannot discover the stepper | §4.5: `.bitwave` project file, debounced autosave, URL-fragment share, embedded demo dataset, remove stale `index.html.bak` |

Both senses are "can I actually use this thing". The plan sequences WCAG P0 first because it also forces the DOM/keyboard model that routing and persistence will reuse.

### 1.2 What "non-HTML file solution" can mean — and what to choose

There are three distinct readings; only one is advisable immediately.

| Reading | What it is | Verdict |
|---|---|---|
| **A. A real source tree** (HTML is a build output) | ES modules + TypeScript + Vite; output `dist/bitwave.html` (single file) *and* `dist/` (hosted) | **Adopt now.** Fixes the stifling format without losing double-click delivery. |
| **B. A native-feeling app with a project file** | Tauri 2 shell around the same web core; native open/save; `.bitwave` documents | **Defer to phase F6**, when CSV import + save/open are daily needs. Add the `.bitwave` *format* earlier (F5) so it is shell-independent. |
| **C. A native rewrite** | Qt/Slint/Avalonia canvas + controls | **Reject.** Discards the canvas/spline/CSS work and the exact geometry contract for no capability you cannot get from A+B. |

The key fact that makes A non-negotiable: a multi-file `type="module"` app **cannot run from `file://`** — module requests are CORS-fetched and a `file://` document has an opaque origin ([MDN: modules on the web](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules/Modules_on_the_web)). So the multi-file source must emit a single-file artifact; the classroom/USB path is a **build product**, not the authoring format. `vite-plugin-singlefile` inlines everything; the artifact itself is then opened over `file://` in Playwright and must pass DESIGN §11 before release.

### 1.3 Preserve list (explicit)

The instrument-not-diagram stance; one accent + one structure hue; amber reserved; 0 px column alignment and `--pad` as the single gutter authority; monotone-Hermite spline with honest staircases; LFO stepped/real-state/snapshot-restore/yields-to-manual; CSV per-column typing, right-alignment, widest-column default; observation logger; lanes 1/2/3 and split 3-D; zero runtime dependencies; offline single-file delivery; no onboarding, trophies or confetti.

### 1.4 Success criteria for this plan

- A keyboard user can boot, set a 64-bit value, flip bits, pick operands/ops, step a CSV, and read the result — without a mouse.
- A patched view behaves deterministically: no stale registers, no focus-dependent results, no silent data loss on patch/unpatch.
- A teacher can send either one `.html` file or one shared URL/`.bitwave` file and the student sees the exact state.
- DESIGN §11 + a new routing/accessibility test set pass on the built artifact over `file://`.
- The single-file artifact stays under ~250 KB (today 93 KB; routing UI adds an estimated 15–25 KB).

---

## 2. Where the file is today (measured, not impressionistic)

### 2.1 Shape

| Metric | Value | Implication |
|---|---|---|
| `index.html` | 2,832 lines / 92,991 bytes, 0 dependencies | Self-contained and fast; everything shares one scope |
| Structure | 1 doc, 1 inline `<style>` (556 lines), 1 IIFE (~2,125 JS lines), 4 mutable singletons (`S`, `G`, `DEMO`, `observations`) | Global state is the coupling |
| `S.` references | **327** | Most code means "the focused lane" implicitly |
| `getElementById` / `addEventListener` / `innerHTML` | 44 / 36 / 6 | DOM captured at module scope in six clusters |
| Functions | 74 declarations; 22 `curSlot()` calls | Focus-coupling is systemic |
| Controls | 36 buttons, 6 selects, 2 inputs, 18 `title`, 8 `aria-label`, 6 `aria-pressed` | Titles are not names; toggle semantics inconsistent |
| Accessibility signals | **0** `tabindex`, **0** `aria-live`, **0** `prefers-reduced-motion`, **1** `role=` | Not a styling gap; a semantics gap |
| Persistence | **0** `localStorage` / IndexedDB / `location.hash` / history APIs | Every reload is a new instrument |
| Iteration evidence | `index.html.bak` is 2,167 lines and lacks the lane model/split/observations → the last iteration added ~665 lines in one file | Growth has been feature-by-feature accretion; there is no seam to absorb the next feature |

### 2.2 Why it feels disjointed (root causes, not aesthetics)

1. **Focus is implicit in the model.** `recomputeZ(instant, sl = curSlot())` (`841`), the `S.A/S.B/S.Z` getters (`768–778`) and `commit()`'s focused-only recompute (`1595–1601`) mean a change in the focused lane re-derives only that view. Adding routing on top without one evaluator guarantees silent stale registers — exactly the failure class DESIGN §10.9 warns about.
2. **Render is inside the model.** `commit()` renders; `resizeRegister()` calls `lfoStop()` and both renderers (`861–911`); `draw()` calls `renderStrip()` (`1248`); `fitToMappedColumns()` writes `sizeInput.value` (`2484–2498`). The render graph is not a DAG.
3. **Hidden controls move targets.** 15 `hidden` attributes in the markup plus runtime `.hidden` toggles: `toggleB` hides in 3-D, binops/edit target hide until B, CSV controls hide until load, stage bar hides in 2-D, lane badge hides in one case. Every mode change reflows the controls row and changes tab order; several hide the only route to a state.
4. **Two homes for one state.** `slotSeg` and `split` exist both in the controls row (`655–661`) and in the stage bar built at runtime (`2081–2117`), at different sizes and with different state exposure.
5. **A naming collapse (now fixed).** Lanes were `A/B/C` while frames are `A/B/Z`; in A·B mode one group held two `A` buttons, two `B` buttons and a third `B` toggle, and routing would have made "A.A" ambiguous. Lanes are now 1/2/3; this bullet records why the rename happened.
6. **Armed modes have no exits.** `copy →` sets `S.copyArmed` with no status, no Escape, and a silently changing label (`2304–2306`).

### 2.3 What is healthy — do not "fix" these

The model is small and pure enough to test (nibble maths, BigInt ADD/SUB wrap, bit-exact ops); the invariants are written down in DESIGN §11; there are no dependencies, no network, no build; the geometry contract is explicit and measurable; the LFO already demonstrates the park/restore discipline routing needs. The problem is structural, not intellectual.

---

## 3. Feature A — input routing (matrix housing)

**This is not a second data path.** The instrument already binds each operand input to a source through the CSV column dropdowns in the `data` group (`colA`/`colB`; `loadCSV` populates them, `applyExample` writes the cell into A or B on every step). That mechanism is the routing system. The matrix is its structural housing: the same six bindings, one fixed row per operand input, made visible as a table instead of six scattered selects. Loading a file stays trivial and unchanged; the only genuinely new thing is that a binding's source may also be a frame output, evaluated by the clocked `evaluateAll()` pass. Everything else below is the existing data path, organised.

### 3.1 What a binding is in this instrument

Each lane is already a three-frame device: operand **A**, derived **Z = A op B**, operand **B** (`makeSlot`, `735–747`). The six operand inputs (`A`/`B` × lanes 1/2/3) each bind to exactly one source. That is the rule the existing CSV column dropdowns already enforce.

- **Primary source — a CSV column.** The imported dataset supplies the options; loading/importing is unchanged. Per-column typing (`bin`/`hex`), right-alignment, overflow truncation and the widest-column default stay exactly as they are (DESIGN §10.16, §10.17, §10.21). `applyExample()` writes the cell into the bound input on every CSV step — this is the working mechanism, not something to replace.
- **Optional source — a frame output.** `A`/`B`/`Z` × lanes 1–3 (nine outputs), evaluated by the clocked route pass. This is the **only new capability**; it occupies the same row and obeys the same one-source-per-input rule.
- **Destinations (6 inputs):** the six operand frames — `A`/`B` (lane 1), `C`/`D` (lane 2), `E`/`F` (lane 3) — fixed. **A derived frame is never a destination** — `Z1`/`Z2`/`Z3` are functions of their lane's operands, resize zeroes them (`899–902`), and an external write to one would survive one transaction then vanish (DESIGN §10.8; the stale-Z failure class).
- **Fan-out:** unlimited (one frame output can feed several inputs — an audio mult).
- **Fan-in:** **one source per input in v1.** A second frame route replaces the first, as Blender's single-link sockets do. Last-write-wins and priority-replace depend on invisible ordering; the audio-natural alternative — summing at one inlet (`set | add mod 2^N | xor`) — is the v1.1 upgrade and is the bit-level analogue of additive mixing.

### 3.2 Candidate models and verdict

| Model | What it gives | Cost | Verdict |
|---|---|---|---|
| (i) **Source table / bindings** | Reuses the existing CSV column dropdowns; six fixed inputs; frame sources additive | One housing table + frame optgroup | **Ship** |
| (ii) **Within-lane feedback `Z→A/B`** | The teaching jackpot: a two-state oscillator is one source choice | Needs an explicit delay rule | **Ship, labelled** |
| (iii) Crosspoint grid | Dense overview | 54 cells → 54 focus stops; no per-cell mix/delay | Reject: six fixed input rows are clearer |
| (iv) Named buses | Scales past ~10 lanes | Mapping layer, no payoff at 3 lanes | Reject for now |
| (v) Linear chain (lane order = processing order) | Zero UI | Display order silently changes arithmetic | Reject |
| (vi) General DAG | Maximum power | (i)'s cost + cycle authoring | Ship as restricted DAG: (i)+(ii) |

### 3.3 Recommended semantics

**Authority / normalled-jack rule.** A patched input is *driven*. On the first route, its pre-patch value is **parked**; when the route is removed it is restored byte-identically — the LFO promise (DESIGN §10.18) reused. While driven, base writes (drag, bit click, preset, unary op, B seed, CSV column, LFO sweep) skip it; the strip labels the driver (`3·Z → 1·A`) and disables edit affordances with a visible reason instead of silently ignoring input. This is the audio-patching concept of a normalled input: plugging in breaks the normal path, and unplugging restores it.

**One evaluation entry point.** All writers finish their base writes, then `applyRoutes()` runs, then `recomputeZ` + `syncTarget` for **all** lanes, then render. It runs only on transaction boundaries — drag move, bit click, preset/op, CSV step, LFO tick, binding change, resize — **never per animation frame**. Focus never participates; clicking a lane changes no numbers.

**Cycle breaking.** Two cycle shapes exist: a self-loop (`3·Z → 3·A`) and a cross-lane cycle. A zero-delay cycle has no fixed point (with `A = A xor B`, unless `B = 0`, there is nothing to converge to), so a cycle must be broken by an **implicit one-evaluation delay**. No stored state is needed: snapshot the delayed source values before writing, then write. That snapshot *is* the previous evaluation's result, and it survives resize and unroute. Phase-shift feedback is exactly the digital-audio delay line every feedback patch requires. Label those rows `z⁻¹` — not with a second dash language, because B already owns the dash (DESIGN §8).

**Precedence (single table, no surprises):**

| Event | Base writes first | Then |
|---|---|---|
| Manual edit | the user's port, if not driven | `evaluateAll()` |
| CSV step | mapped columns for non-driven ports | `evaluateAll()` |
| LFO tick | sweep non-driven ports, all lanes | `evaluateAll()`, then render |
| Binding change | re-park / restore destination | `markDelays()` → `evaluateAll()` → source-table render |
| Resize | `lfoStop`; remap A/B **and parked bases**; set `S.N` | recompute + `evaluateAll()` |
| Copy lane | copy *base* registers; routes belong to the rack, untouched | `evaluateAll()` |
| Lane focus | none | UI render only |

**Worked example (independently recomputed, matches the routing deep-dive to the hex digit).** Boot values from the table formulas: `A = 8ADEFEDA85210125`, `B = FFFFFFFF00000000`; `E = 0123456789ABCDEF`, `F = 8ADEFEDA85210125`, so `Z3 = 0002444281210125` (popcount 13).

| Step | Action | A | Z1 | C |
|---|---|---|---|---|
| 0 | boot | `8ADEFEDA85210125` | `7521012585210125` | `FEDA852101257ADE` |
| 1 | route `Z3 → A` | `0002444281210125` | `FFFDBBBD81210125` | unchanged |
| 2 | route `Z1 → C` | `0002444281210125` | `FFFDBBBD81210125` | `FFFDBBBD81210125` |

After step 1, lane 1's truth counts are `24 / 27 / 8 / 5` (sum 64, invariant holds) and `popcount(Z1) = 35 = 27 + 8` — the routing deep-dive has the full check and the two-state feedback proof.

### 3.4 UI inside the design system

**The matrix is the housing, not a new mode.** It belongs where the CSV column dropdowns already live — the `data` group — and adds no toggle, no sixth band, no separate view. One compact table with **six fixed rows**, one per operand frame (A–F): `SOURCE` select · `DESTINATION` (static frame label) · `STATE` chip. SOURCE options are grouped:

- `data · <column>` from the imported file — the existing `colA`/`colB` behaviour, default when a file is loaded and unchanged in typing/alignment;
- `frame · A` … `frame · Z3` — the nine global frame outputs (D15); the same select, no second subsystem;
- `—` — unbound.

STATE reads `data` (column applied on step), `1:1` (live frame), `z⁻¹` (same-lane feedback: Z1→A, Z2→C, Z3→E), or `—`. A loaded CSV fills the six rows exactly as today's pickers would; the table simply makes the whole binding board visible at once. There is no add/remove and no replacement logic — the inputs are fixed, one source each. Loading a file is still the same easy action it is today. The six rows stay visible even with no file so frame sources work; data options appear/disable with the dataset.

**No new state, no duplicate truth.** Each row is a view over the two facts that already exist for that input: the CSV column index (`colA`/`colB`) and any incoming frame route. Choosing a data column writes the column index and clears the frame route; choosing a frame writes the route and clears the column index; `—` clears both. The table stores nothing of its own, so import, typing, alignment and the observation logger cannot drift.

**No cable graphics anywhere.** Not on the stage, not in the 3-D field, no jack hit-testing, no drag. The table is the whole interface; the field stays read-only (DESIGN §10.12) and never gains routing overlays.

**Visual grammar (no third hue, no new token):** `--accent` carries live frame bindings and the `z⁻¹` chip; `data` bindings stay muted chrome; the `--inf` warmth stays reserved for ∞, the zero-crossing and MRB underlines. Invalid choices are absent from the select, not red. Typography follows DESIGN §4: mono for source/destination labels, sans for column headers and prose.

**720 px:** the table compresses — DESTINATION abbreviates to the bare frame label (`A`…`F`), the STATE chip wraps under it, and the table scrolls horizontally inside its own wrapper while the page itself never overflows. `--pad` is already 16 px there.

### 3.5 If you do it in today's file (and why I would not)

The routing deep-dive gives the full touch list: new `S.routes` / `S.routePark`, `applyRoutes`, `evaluateAll`, `markDelays`, port helpers, driven-port guards in drag/bit/preset/ops/CSV/LFO/seed, parked remap in `resizeRegister`, `baseOf` in `copySlotInto`, source-table DOM/CSS, observation columns. The engine and guards are ~150 new + ~70 changed lines; the source table is mostly a re-housing of the existing `colA`/`colB` selects plus the frame optgroup, ~60–100 lines — a credible **~250–300 LOC, 2–3 phase** change with a much smaller UI risk than a new view.

The catch is the second pass. Routing's natural home is the core's evaluation model, and the current file has no seam for it: you would write `evaluateAll()` against the `S` facade, then rewrite it against the extracted store. That is not fatal — it is 1–2 extra days — but it is two chances to regress the invariants. **Recommendation:** build a throwaway *interaction* spike (six fixed rows + source options + one data/frame chip, no persistence) to validate the housing, then build the engine once in the new core (§7, F1). If routing must ship for a class in the next month, the routing-first path is in §7.2 and is honest about the port cost.

### 3.6 Verification additions (before merge)

1. Boot → `Z3 = 0002444281210125` (pop 13).
2. Add `Z3→A`: `A = 0002444281210125`, `Z1 = FFFDBBBD81210125`, pop 35, truth `24/27/8/5`.
3. Add `Z1→C`: `C = FFFDBBBD81210125`, `Z2 = FDBB31736D896505`.
4. Remove both: lanes 1 and 2 byte-identical to boot; unroute after resize equals resize without a route.
5. Cross-lane chain 1→2→3: resolves in one evaluation, no stale derived frame.
6. `Z1→A` twice is the identity (the two-state oscillator).
7. Route + LFO: patched inputs are never overwritten; stop restores the pre-LFO snapshot.
8. Route + CSV: a driven destination ignores its column but keeps the mapping; unplug restores it.
9. Keyboard-only: add, inspect, remove a route; status announced; focus never lost.
10. Source table: exactly six rows (fixed destinations A–F); the destination column never contains a derived frame (`Z1`/`Z2`/`Z3`); every row has one source; the `data` / `1:1` / `z⁻¹` / `—` chip matches the binding.
11. Zero console errors; no overflow at 360/420 px; pixel histogram contains no third hue; no cable/jack/canvas routing chrome exists.
12. CSV regression: load a file → the six rows populate exactly as today's per-lane pickers did; per-column typing, right-alignment and truncation are unchanged; stepping writes each bound input.

### 3.7 Open routing options (defaults chosen, cheap to flip)

- **Fan-in** (v1.1): per-input mix `set | add mod 2^N | xor`, exposed as a `MIX` column in the source table. `add mod 2^N` is the additive-synthesis analogue — two wavetables summed at one inlet is a genuinely new teaching state, not just plumbing.
- **Sources:** data columns are the primary/default source and stay exactly as they are; frame outputs are the new optional group in the same select.
- **Lane naming:** settled (author, 2026-11-06) — **lanes 1/2/3** in UI, docs and code; letters only for frames/operands.
- **Frame naming:** settled (author, 2026-11-06) — lane 1 A/B/Z1, lane 2 C/D/Z2, lane 3 E/F/Z3; six operand destinations A–F and nine frame sources (D15).
- **Route presets / "patch memory"** and copy-patch: later; the rack owns routes, lanes don't.

---

## 4. Feature B — accessibility & reach

### 4.1 The finding that matters most

A keyboard-only user can press presets and unary ops but **cannot set a specific value, flip a bit, or select a nibble** — the core teaching loop is unavailable. Tab reaches the range and the buttons; it never reaches the strip or canvas (`tabindex` count: 0; bit cells are `<i>` with a click handler, `1448–1459`, `1713`). That is the first thing to fix, and the fix is also the base for routing's keyboard model.

### 4.2 P0 fix list (after the IA pass, both part of F4)

**Author decision (2026-11-06): dimming/contrast token changes are out of scope.** Colour and intensity are a future mapping axis, and the instrument is not a toy. The contrast row below is recorded as a measurement, not as work; roles, names, keyboard editing, targets, reduced motion and reflow remain in scope.

| Severity | Issue (evidence) | Fix | Effort | DESIGN amendment first |
|---|---|---|---|---|
| Critical | No keyboard editing path | One focusable **nibble spinbutton** per nibble (`role="spinbutton"`, `aria-valuenow` 0–15, `aria-valuetext` "nibble 5, hex D, bits 20–23, weight 2^20", arrows/Home/End/0–F, roving tabindex); whole nibble becomes the pointer target; add a mono **hex entry** field per register for direct `DEADBEEF` entry | L | §6 + §8 |
| Critical | Bits are `<i>` with no role/name/state; canvas (581) has no role/label/fallback | Make the strip the semantic control; `role="img"` + a text alternative on the canvas updated on commit (edit target, curve summary, Z popcount) | M | §8 |
| Critical | `.seg` selection is colour-only (SC 1.4.1); `[aria-pressed]` selectors at 497/510 are dead for segs; `role="group"` appears once | Real `role="radiogroup"`/`radio` with `aria-checked` + roving tabindex for lane/edit/binop; keep `aria-pressed` only for true toggles (LFO, split, copy, operand B) | M | §8 |
| Deferred | Contrast: `--dim` 3.95/4.12/3.76, `--dimmer` 2.07/2.16/1.97 against panel/bg/panel-hi — measured 4.5:1 failures at 9–11.5 px; focus rings 2.13/1.63; B-mate stroke 1.86; zero-crossing 1.71; `--line` 1.18 against the 3:1 non-text requirement | **Hands-off by author decision.** No token or alpha changes. Colour/intensity is reserved as a mapping axis for later; do not "fix" the dim hierarchy as part of this pass. | — | — |
| Critical | Zoom/reflow: `height:100dvh; overflow:hidden` + 5 fixed grid rows + `minmax(0,1fr)` stage ⇒ at 200 % on a 720p-class viewport the stage can resolve to ~0 px with no scrollbar; at 400 % roughly two-thirds of the UI is clipped | `min-height:100dvh; height:auto; overflow:visible`; stage floor `clamp(220px, 44dvh, 620px)`; page scrolls; verify at 1280×720 @200 % and 320×180 @400 % | M | §5 + §9 |
| Critical | No `prefers-reduced-motion` handling; LFO 1–8 ticks/s mutates real registers | Under `reduce`: LFO defaults off; if started, no easing, rate cap 4/s; drop the hint fade; keep 1:1 drag | S | §7 |
| Critical | No live feedback: every readout changes silently; naïve `aria-live` would flood (drag runs per `pointermove`, LFO 1–8/s) | One `role="status"` `aria-live="polite"` `aria-atomic="true"` region driven only by committed changes, debounced ~150 ms, quiet during drag/LFO ticks | S | §8 |
| Critical | Targets: `.bit` 10.1×17.3 px with 10.1 px spacing (fails 24 px); `.op.mini` 22.3×20.2 px; bits vanish at 128/256 bits | Nibble-level target (spinbutton above) + `.op.mini` min-height 24 + ≥24 px thumb; compact mode still exposes the semantic control | S | §5 + §8 |
| Serious | Armed `copy →` has no cancel; hidden controls hide the only route to states; duplicate lane/split controls | §5 IA: stable modules, reserve space, one canonical home, explicit `copy to…` menu, Escape cancels, `aria-keyshortcuts` + in-page map | L | §8 + §9 |
| Serious | CSV import silently fails/misloads (no error surface; all-non-token file shows `1 / 1` stale data) | Status line ("loaded 120 rows, 4 columns from foo.csv" / "could not read: no data rows"), keyboard drop path, filename | S/M | §8 |

### 4.3 Contrast — measured, deliberately unchanged

**Author decision (2026-11-06):** keep the palette and dimming exactly as they are. Colour and intensity are a later mapping axis; this pass does not spend them on accessibility. The measurements below are kept because they are true and because a future mapping layer will need them — not because there is work to do now.

All text is 9–16 px, so every printable pair needs 4.5:1 (the 16 px/600 `h1` is below the large-text threshold). Measured with the WCAG sRGB formula:

| Pair | Ratio | Need | Result |
|---|---|---|---|
| `--text` on `--panel` | 16.21 | 4.5 | pass |
| `--dim` on `--panel` | **3.95** | 4.5 | **fail** |
| `--dim` on `--bg` | **4.12** | 4.5 | **fail** |
| `--dim` on `--panel-hi` | **3.76** | 4.5 | **fail** |
| `--dimmer` on `--panel` | **2.07** | 4.5 | **fail** |
| `--dimmer` on `--bg` | **2.16** | 4.5 | **fail** |
| `--dimmer` on `--panel-hi` | **1.97** | 4.5 | **fail** |
| `--accent` on `--panel` / `--bg` / active fill | 9.91 / 10.36 / 7.91 | 4.5 | pass |
| `--inf` on `--panel` | 10.50 | 4.5 | pass |
| focus ring 35 % / 25 %, B-mate 30 %, amber guide 26 %, ∞ ring 45 %, `--line` on panel | 2.13 / 1.63 / 1.86 / 1.71 / 2.93 / 1.18 | 3.0 | fail |
| MRB amber 55 % | 3.88 | 3.0 | pass |

Proposed minimal, no-third-hue fix (all verified): `--dim: #7e879c` (5.29/5.53/5.04), `--dimmer: #768096` (4.81/5.02/4.57), `--line: #5f646b` (3.20); B-mate α 0.30→0.55 (3.69), zero-crossing 0.26→0.55 (3.88), ∞ ring 0.45→0.55 (3.88), focus ring 0.35→0.55 (3.69).

**The honest trade-off:** `--dimmer` exists to make off bits recede ("do not fix the dim zeros", DESIGN §8), and raising it to pass 4.5:1 compresses that hierarchy. The designer's options are (a) accept the bump and move hierarchy to size/tracking/weight + accent chroma (recommended — the off bits are *text* conveying data, so 4.5:1 applies); (b) keep the dim look and add a genuine `prefers-contrast: more` mode (but the default still fails AA); (c) shrink the role of off bits by making the nibble's value the primary readout. This is a decision for you (§9, Q8) — it is the one recommended change that visibly alters the instrument.

### 4.4 Reach (the second sense of accessible)

- **Autosave + restore** (debounced 400–750 ms; Chromium supports `localStorage` from `file://` — verify on target browsers; IndexedDB on `file://` is unverified — keep a fallback and an explicit export).
- **Shareable state** via URL fragment (`#bw=1.<N>.lanes` packed → base64url, ≈260 chars at 256 bits; works from `file://`; `history.replaceState` only). This is already promised in DESIGN §12 ("Shareable state").
- **`.bitwave` project file** (versioned JSON; registers as hex strings, never `Z`; dataset inline by default; unknown fields preserved; higher unknown schema opens read-only). Sketch in the architecture deep-dive §G.
- **Embedded demo dataset** behind a `demo` button — data, not onboarding: it makes the stepper and split view discoverable for a first-timer with no CSV, with no tour, trophy or confetti.
- **Delete `index.html.bak`** from the distribution folder; it is a 71 KB older build that a teacher can open by mistake.
- **Keep the no-dependency `file://` path.** No CDN fonts, no fetch, no modules in the artifact. Offline is a feature.

### 4.5 What must not change

The 0 px strip↔curve alignment and `--pad` single-writer rule; the two-hue system (focus, selection, error and high-contrast states must not mint a third hue); `Z` never editable and the 3-D field never editable; hardware bit order and MSB-left display; the no-onboarding stance; zero-dependency single-file delivery.

---

## 5. Feature C — GUI cohesion (the IA pass)

Not a restyle: a **stable module order, one canonical home per control, and names that don't collide.** The source table is the first component added under these rules and a useful test of them.

| Module | Before | After |
|---|---|---|
| **Source** (data) | 6 of 9 controls appear only after import; no demo; no errors | fixed: `import` / `demo` / `◀ n/N ▶` / **six-row source table (data columns + frame outputs)** / `log` / `export` / status line; disabled placeholders instead of disappearing |
| **Register** | header slider labelled "register" | header `width`; A\|B edit target as a radio pair; hex entry field |
| **Operate** | `op` group last; `amount` also drives the LFO | `operate`: amount + the seven unary ops |
| **Derive** | `logic` third; binops hidden until B; truth table stranded in meta | `derive`: operand B, binop radios, truth/carry attached to the meta band |
| **Motion** | `lfo` | `motion`: LFO, mode, rate, B phase |
| **View** | duplicated lane/split controls; stage bar hidden in 2-D | `view`: 2D/3D, `copy to…`; lane select + split live in an **always-visible stage bar** |
| **Strip** | four click-only glyphs; vanishes in compact | one focusable nibble spinbutton per nibble; bits become its value text; compact keeps the control |
| **Modes** | armed invisibly | explicit `copy to…` menu (focus moves in, `Escape` cancels, live status) |

Also: lanes are **1 / 2 / 3** everywhere — UI, docs and code — so letters belong only to frames and operands; the stage expression becomes routing-aware (`3·Z ⊕ B → Z`); one declared keyboard map (`?` opens a utility panel, not onboarding); duplicate controls removed rather than synchronised. **The source table is not a new view**: it turns the existing per-lane column dropdowns into one six-row housing; frame sources are the only addition.

---

## 6. Long-term architecture (the non-HTML answer)

### 6.1 Recommended stack

**Vanilla TypeScript (strict, ES2022) · Vite · Vitest + Playwright + axe-core · zero runtime dependencies · `tokens.css` as the only `:root` · two build outputs (single-file + hosted) · versioned `.bitwave` JSON · Tauri 2 deferred, not rejected.**

Why no framework: about a fifth of the JS is the imperative canvas (452 lines) and the DOM shell is a static 138-line skeleton with ~12 text nodes plus one list. A framework would replace ~80 lines of `textContent`/`classList` and add a runtime + compiler + reactivity model. The risky part is pixel alignment, which no framework touches. Weighted comparison (fit, bundle, learning cost, ecosystem, maintenance, design control) put vanilla+signals at 4.5 vs Svelte 5 at 4.1, on a 1–5 scale. **Flip to Svelte 5 if** the app grows more than ~3 screen-like surfaces, a web-specialist joins, or the desktop shell adds menus/multi-window. The framework is the last decision, not the first, because it is the only one here that cannot be reversed cheaply.

### 6.2 Module layout and the one-way rule

```
src/
  core/     types, numbers, registers, ops, derive (Z/truth/carry), spline, geometry, routing, lfo, csv parse, project schema
  state/    store.ts (State + patch + subscribe), actions.ts (commands)
  render/   theme, canvas (2-D), field3d, strip, readouts, stage-bar, routing-matrix
  io/       csvFile, projectFile, share, observations
  ui/       controls, pointer, keyboard
  main.ts   composition root: shell → store → renderers → rAF
styles/     tokens.css + base/stage/strip/controls/responsive
tests/      unit/, e2e/, fixtures/
```

Dependency direction: `core ← state ← render/ui ← main`, plus `io → core`. Core is DOM-free — enforced mechanically by a `tsconfig` with `"lib": ["ES2022"], "types": []` and a test that greps `src/core/**` for `document|window|localStorage|requestAnimationFrame`. That is what makes DESIGN §11 arithmetic run in plain Node.

### 6.3 The state spine (the part that matters)

One command funnel: `dispatch(action) → base writes → evaluateAll() → snapshot view-model → renderers`. `evaluateAll()` = `syncTarget` for all views → `applyRoutes()` → `recomputeZ` for all views. Renderers receive frozen view-models and never read mutable globals; nothing renders as a side effect of a model function; nothing recomputes only the focused lane. This is the seam that absorbs routing, keyboard commands, undo (future), autosave (future) and share (future) without new architecture.

### 6.4 Keeping the single-file artifact, and packaging

- Source multi-file; runtime output `dist/bitwave.html` (all JS/CSS inlined) **and** `dist/` (hosted). Ban dynamic `import()` and external asset URLs in the artifact (CI-asserted); open the artifact over `file://` in Playwright and run DESIGN §11; fail CI above ~250 KB uncompressed.
- **Static site now** (simple hosting, shareable link). **PWA later** once a stable HTTPS URL exists (service worker needs a secure context; it does not help `file://`). **Tauri 2** when native CSV open/save and `.bitwave` documents matter — small binaries, system WebView, Rust 1.95 already installed here; note the Windows WebView2 dependency. **Skip Electron** (10–100× footprint, no missing capability) and **no native rewrite**.
- Version facts to pin at implementation time (researched as existing as of Nov 2026; re-verify before pinning): Vite 8.x, `vite-plugin-singlefile` 2.x, Tauri 2.x (2.12+), Electron 45 (not used), Svelte 5.x (not used until a flip), Node 24 locally.

### 6.5 Verification / CI

| Layer | Tool | Proves |
|---|---|---|
| Unit | Vitest | DESIGN §11 verbatim: `ROL 4`, `NOT`, `BSWAP` (involutive, no-op at 8), A·B vectors, counts `23,11,9,21`, popcounts `20/21`, B-edit leaves A untouched |
| Property | Vitest | `popcount(ROL(x,k)) == popcount(x)`, `BSWAP² = id`, rotate-by-N = id, spline stays in `[0,15]`, truth counts sum to `N` |
| Golden trace | Vitest | boot→preset→op→toggle B→binop→resize→CSV step captured **from today's `index.html`**; the new core must reproduce it byte-for-byte |
| Geometry | Playwright | control-point `x(j)` vs hex-cell centre **< 1.5 px**; `scrollWidth − clientWidth = 0` at 420 px; canvas width = viewport; zero console errors over load + 2 s |
| Routing | Vitest | §3.6 vectors, park/restore byte-identity, delay semantics, one-pass chain, focus-independence |
| A11y | axe-core + manual | zero critical/serious in 2-D, A·B, 3-D and routing-matrix states; keyboard-only task script; 200 %/400 % zoom |
| Artifact | Playwright `file://` | the shipped single file passes all of the above |
| Contract | Vitest | DESIGN §3 token table ↔ `tokens.css` both ways; ban hex/`rgb(` outside the token/theme files; constants ↔ §5/§9 |

Done means: golden trace matches, §11 green on the dev server **and** on `file:// dist/bitwave.html`, geometry assertion passes, token contract passes, no console errors.

---

## 7. One roadmap

### 7.1 Recommended path — foundation first, routing shipped once

| Phase | Work | Delivers | Gate | Est. |
|---|---|---|---|---|
| **F0 Baseline** | `git init`; Vite+TS+Vitest+Playwright scaffold; capture golden trace from today's file; CI; single-file build of the *existing* app | A safety net before any move | CI green on untouched `index.html`; artifact passes §11 | 2–3 d |
| **F1 Core + routing engine** | Extract spline → register/number maths (explicit `N`) → ops → derive → geometry → CSV parser into DOM-free core; add `routes`/`routePark`/`evaluateAll`/`markDelays` **as pure model** | Tested engine, routing included | core `tsc` no-DOM; §11 + §3.6 unit green; golden trace matches | 4–6 d |
| **F2 State spine + renderers** | store + commands; `evaluateAll` on every transaction; canvas `FrameInput`; strip reconcile; readouts; stage bar; pointer + keyboard controllers; delete `S` facade and focused-only `commit` | The app on the spine | §11 + screenshots unchanged or explained; 256-bit frame budget holds; core has no render calls | 5–8 d |
| **F3 Source-table housing** | Turn the existing `colA`/`colB` picks into one six-row table; add the `frame` optgroup, `data`/`1:1`/`z⁻¹` state chips and live status; no toggle, no add/remove, no cable/jack/3-D chrome | Routing, without a second import path | CSV import regression (same typing/alignment) + §3.6 #1–12; keyboard-only; 360 px | 1–2 d |
| **F4 A11y P0 + IA pass** | §4.2 fixes; lanes 1/2/3 UI; stable module order; reserve space; canonical homes; explicit `copy to…` + Escape; one keyboard map | A tool a keyboard-only student can use | axe zero critical/serious; keyboard task script; zoom at 200/400 %; no palette changes | 3–5 d |
| **F5 Persistence & reach** | `.bitwave` v1 + migration, autosave, URL share, embedded demo dataset, CSV error status, remove stale `.bak` | Work survives; state is shareable | round-trip fixtures; share URL ≤ ~2 KB; save→reload identical | 3–5 d |
| **F6 Distribution** | PWA manifest/SW for the hosted build; Tauri 2 only if triggered | Installable / native file dialogs | installed offline works; artifact unchanged | 2–4 d web, +5–8 d Tauri |
| **F7 Optional framework** | Svelte 5 only if the flip conditions in §6.1 are met | — | prior gates green; bundle budget | 10–15 d |

**Total to a shippable F5: ≈22–36 engineer-days (roughly 4–7 calendar weeks solo, plus review time).** F3 is the point where the routing ask is genuinely answered; F4/F5 make it accessible and durable.

### 7.2 If you need routing sooner (routing-first alternative)

Do the routing deep-dive's 4 phases in the current file (~5–8 days), then pay ~2–3 days to port engine+UI during F1/F2. It works and it validates the UX with your own hands before the foundation work. The cost is double implementation of `evaluateAll` and a second chance to regress Z/LFO/CSV invariants; the plan's tests make it safe, not free. **Recommendation:** do the 1–2 day UX spike now regardless; choose routing-first only if a class or demo needs it before F3.

### 7.3 What to do in the next two weeks if you do nothing else

1. `git init` + capture the golden trace and the three §11 op vectors as tests (F0, 2–3 days).
2. Build the throwaway routing-matrix spike (1 day) — a SOURCE/DESTINATION table, one driven guard, no cable graphics; then fold it into F3.
3. Fix the two cheapest P0 items: delete `index.html.bak`, add accessible names/roles to the 12 symbol- or glyph-only buttons plus a canvas label (hours).
4. Decide §9 Q1–Q3 and Q8 (accessibility priority, routing meaning, fan-in/feedback policy, contrast trade-off). Those four answers unblock the rest.

---

## 8. DESIGN.md amendment package (edit the doc first, per §13)

Changing the instrument means amending the source of truth **before** code. The full package:

- **§3 Colour:** new `--dim` / `--dimmer` / `--line` values; the alpha bumps for focus ring, B-mate, zero-crossing, ∞ ring; a note that off-bit contrast is a data-legibility requirement, not decoration; optional `prefers-contrast` mode. State the 1.9×→1.1× luminance compression and that hierarchy moves to size/tracking/weight.
- **§5/§7/§9:** stage floor + page scroll at zoom (keep the 100 vh instrument on normal viewports); reduced-motion behaviour; source table in the data group and its 720 px stacking; target sizes (24 px).
- **§8 new components:** `source table`, `binding row`, `source select` (data columns + frame outputs), `state chip` (`data` / `1:1` / `z⁻¹`), `driven-port` state, nibble spinbutton/hex entry; each must cite which existing token supplies every value. **Also rename lane terminology in §8 and §9 (done in core; UI pending)**; no jack or cable component exists; there is no matrix toggle or separate route view.
- **§10 new invariants:** (a) `evaluateAll()` is the only evaluation entry point and runs on transactions, not frames; (b) routes apply after base writes, before Z/truth/log; (c) patched inputs park and restore byte-identically; (d) Z is never a routing destination; (e) cycles are broken by a labelled one-evaluation delay; (f) focus never changes evaluated values; (g) the strip is the semantic editor and the canvas is a lens; (h) reserved-space layout — no control may be removed from the DOM to change mode.
- **§11:** add routing §3.6 and accessibility/zoom/contrast checks; keep the existing headless-CDP pass.
- **§12 Roadmap:** move "Shareable state" to shipped; add source-table housing, project file, a11y pass, source migration.
- **§13 protocol:** add "any new control must declare its keyboard path and accessible name".

---

## 9. Decisions (author answers recorded)

Q6 and Q8 were answered by the author on 2026-11-06 and are closed. Q1–Q5, Q7 and Q9 remain open, with the plan's recommended defaults in effect until changed.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Priority: WCAG accessibility first, reach/distribution first, or both in parallel? | Both, but F4 (a11y) before F5 (persistence); the keyboard model is reused by routing and share |
| Q2 | Does "routing Z into another frame A" mean cross-view, within-view feedback, or both? | Both — cross-view as the default, `Z→A/B` feedback with a labelled one-iteration delay |
| Q3 | When a destination is patched, should its local controls be locked (normalled-jack) or should editing break the route? | Lock with a visible driver label; unplug to restore. Breaking a route by accident is worse than an extra click |
| Q4 | Fan-in: one route per input (v1) or mixer/summing immediately? | One route v1; `set\|add mod 2^N\|xor` in v1.1 (additive synthesis is the payoff) |
| Q5 | Is a one-evaluation (≈ one tick) delay acceptable for feedback? | Yes — it is the honest digital-audio feedback analogue; label it `z⁻¹` |
| Q6 | Rename the three lanes A/B/C → 1/2/3? | **Resolved (author, 2026-11-06): yes — UI, docs and code. Letters belong only to frames/operands.** |
| Q7 | Browser + single file, or desktop shell? | Browser + single file now; Tauri later for native file dialogs, same core |
| Q8 | Contrast/dimming | **Resolved (author): hands-off. Keep the palette; colour/intensity is a future mapping axis. No token changes.** |
| Q9 | Timeline: routing now on the current file, or foundation-first? | Foundation-first with a 1–2 day UX spike; choose routing-first only if a demo/class forces it |

---

## 10. Risks, limits and what would change my mind

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Two writers, one register** | Routes, LFO, CSV, drag, presets and boot all write operands; without one evaluator a driven port intermittently shows a stale value — the silent failure DESIGN §10.9 exists to prevent | Single `evaluateAll()` funnel + hard driven-port guards + §3.6 tests |
| **Geometry regression during extraction** | The 0 px contract breaks invisibly; `--pad`, `gap` and `x(j)` are coupled | Playwright geometry assertion on every CI run; one writer for `--pad`; golden screenshots |
| **Behavioural drift in the LFO/drag/easing path** | Snapshot/restore, 1:1 drag and eased Z are easy to "clean up" and lose | Golden trace captured from today's file; phase gates |
| **Contrast change hurts the look** | The dim hierarchy is a deliberate design decision | Token bump + hierarchy vehicle change; author decides (§9 Q8); `prefers-contrast` if needed |
| **Toolchain churn** | Vite 8 is a fresh Rolldown major; `vite-plugin-singlefile` is a small single-maintainer plugin carrying the classroom path | Pin exact versions; artifact test over `file://`; documented esbuild fallback |
| **Routing scope creep** | Bus definitions, mix columns, route presets, undo — each additive | The §7 phase gates; MVP cut in §3.5; defer list explicit |
| **Scope of this analysis itself** | Line numbers are this file today; estimates are engineer-days, not commitments | Re-measure before starting; treat phases as budget ranges |

### 10.1 What was verified vs estimated

- **Verified by reading/running:** all line references; all counts in §2.1; contrast ratios (WCAG formula, computed twice); the routing worked example and feedback identities (independent script); toolchain (`node v24.14.1`, `npm 11.11.0`, `git 2.55.0`, `rustc 1.95.0`); no persistence/tabindex/aria-live/reduced-motion usage; `index.html.bak` size/feature delta; Vite 8 / Tauri 2.12 / Electron 45 releases exist.
- **Estimated, not measured:** zoom/reflow clipping (headless Chrome could not launch in this sandbox — the DSH sandbox blocks the named-pipe/Mojo channel Chromium requires; this is a confinement boundary, not an app bug); exact pixel sizes that depend on the resolved `ui-monospace` font metrics; framework gzipped sizes and installer MBs; LOC/time estimates.
- **Recommendation:** run the reflow/geometry checks with your existing headless-CDP harness outside this sandbox before committing to §4.2's zoom fix.

### 10.2 What did not change

`index.html`, `DESIGN.md`, `index.html.bak` are untouched (lengths and modification times unchanged; no edits were made this session). Only this plan and the three analysis companions plus two diagrams were added.

---

## Appendix — evidence and companions

- [Routing deep-dive](docs/analysis/routing.md) — full semantics, 4-phase implementation, LOC, verification vectors, UI grammar.
- [UX & accessibility audit](docs/analysis/ux-a11y.md) — interaction inventory, severity table, measured contrast, target sizes, reflow analysis, IA before/after.
- [Architecture plan](docs/analysis/architecture.md) — coupling map, module contracts, framework matrix, packaging, persistence schema, CI, migration gates.
- [Target architecture diagram](docs/diagrams/target-architecture.svg). The routing UI is the matrix described in §3.4; the earlier cable/patch-model diagram has been removed (author decision 2026-11-06).
- [Routing matrix prototype](spike/routing-matrix.html) — six fixed input rows; source selects list data columns and frame outputs; no cables.

*The picture and the truth should be one object. Right now the truth is trapped in one file; this plan sets it free without changing what it looks like.*
