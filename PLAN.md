# BitWave — Feature Integration Analysis & Long-Term Plan

**Status:** proposal for review · 2026-11-05 · **No source files were modified.**
**Inputs:** [`DESIGN.md`](DESIGN.md) (495 lines, read in full), [`index.html`](index.html) (2,832 lines / 92,991 bytes, read in full), headless-Chrome attempt (blocked by the sandbox; see §10.1).
**Companion deep-dives (written this session):** [routing](docs/analysis/routing.md) · [UX & accessibility](docs/analysis/ux-a11y.md) · [architecture](docs/analysis/architecture.md). Diagrams: [target architecture](docs/diagrams/target-architecture.svg) · [patch model](docs/diagrams/patch-model.svg).

---

## 0. The short version

Your three asks are usually solved as three separate projects. They are not separate here.

> **Routing, keyboard access, persistence and shareable state are four clients of one missing part: a single state-transition spine.** BitWave has the arithmetic and the visual contract; what it lacks is one place where a change is applied, one place where it is evaluated, and one place where it is rendered. `commit()` (`index.html:1595`) is half of that spine and is focused-slot-only.

So the plan is:

1. **Keep exactly what you love.** The instrument, the single-file artifact, the 0 px strip↔curve contract, the two-hue system, the CSV stepper and observation logger, the split 3-D view, the no-onboarding stance. Nothing below replaces them.
2. **Make the source multi-file, keep HTML as an output.** The stifling part is not HTML — it is *authoring inside one inline script with four mutable globals*. Source becomes a tested TypeScript core plus render adapters; `bitwave.html` (one double-clickable file) remains a first-class build artifact for classroom/USB use.
3. **Build the spine once.** A framework-agnostic core, an explicit `evaluateAll()` state transition, and renderers that receive frozen view-models. Routing, keyboard editing, undo, autosave and share links then become features *on* the spine instead of rewrites *of* it.
4. **Ship the patch bay on top of it.** Cross-slot patch cords (`A/B/Z` of any view → `A/B` of any view), within-slot `Z→A/B` feedback with a labelled one-iteration delay, one cable per input, authored in an accessible DOM dock and drawn as read-only garnish in the 3-D field. Z remains derived, never a destination.
5. **Fix the accessibility floor as a first-class milestone, not a cleanup.** Today a keyboard-only user cannot set a single value: no nibble is focusable, the canvas has no text alternative, and the off-bit/label tokens measure 1.97–4.12:1 (all fail 4.5:1). Contrast, roles, target sizes, reduced motion and zoom reflow are P0.
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

The instrument-not-diagram stance; one accent + one structure hue; amber reserved; 0 px column alignment and `--pad` as the single gutter authority; monotone-Hermite spline with honest staircases; LFO stepped/real-state/snapshot-restore/yields-to-manual; CSV per-column typing, right-alignment, widest-column default; observation logger; A/B/C parallel views and split 3-D; zero runtime dependencies; offline single-file delivery; no onboarding, trophies or confetti.

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
| `S.` references | **327** | Most code means "the focused slot" implicitly |
| `getElementById` / `addEventListener` / `innerHTML` | 44 / 36 / 6 | DOM captured at module scope in six clusters |
| Functions | 74 declarations; 22 `curSlot()` calls | Focus-coupling is systemic |
| Controls | 36 buttons, 6 selects, 2 inputs, 18 `title`, 8 `aria-label`, 6 `aria-pressed` | Titles are not names; toggle semantics inconsistent |
| Accessibility signals | **0** `tabindex`, **0** `aria-live`, **0** `prefers-reduced-motion`, **1** `role=` | Not a styling gap; a semantics gap |
| Persistence | **0** `localStorage` / IndexedDB / `location.hash` / history APIs | Every reload is a new instrument |
| Iteration evidence | `index.html.bak` is 2,167 lines and lacks slots/split/observations → the last iteration added ~665 lines in one file | Growth has been feature-by-feature accretion; there is no seam to absorb the next feature |

### 2.2 Why it feels disjointed (root causes, not aesthetics)

1. **Focus is implicit in the model.** `recomputeZ(instant, sl = curSlot())` (`841`), the `S.A/S.B/S.Z` getters (`768–778`) and `commit()`'s focused-only recompute (`1595–1601`) mean a change in the focused view re-derives only that view. Adding routing on top without one evaluator guarantees silent stale registers — exactly the failure class DESIGN §10.9 warns about.
2. **Render is inside the model.** `commit()` renders; `resizeRegister()` calls `lfoStop()` and both renderers (`861–911`); `draw()` calls `renderStrip()` (`1248`); `fitToMappedColumns()` writes `sizeInput.value` (`2484–2498`). The render graph is not a DAG.
3. **Hidden controls move targets.** 15 `hidden` attributes in the markup plus runtime `.hidden` toggles: `toggleB` hides in 3-D, binops/edit target hide until B, CSV controls hide until load, stage bar hides in 2-D, slot badge hides in one case. Every mode change reflows the controls row and changes tab order; several hide the only route to a state.
4. **Two homes for one state.** `slotSeg` and `split` exist both in the controls row (`655–661`) and in the stage bar built at runtime (`2081–2117`), at different sizes and with different state exposure.
5. **A naming collapse.** Slots are `A/B/C`; registers are `A/B/Z`; the edit target is `a|b`. In A·B mode one group contains two `A` buttons, two `B` buttons and a third `B` toggle. Routing will make this untenable ("A.A" — which A?).
6. **Armed modes have no exits.** `copy →` sets `S.copyArmed` with no status, no Escape, and a silently changing label (`2304–2306`).

### 2.3 What is healthy — do not "fix" these

The model is small and pure enough to test (nibble maths, BigInt ADD/SUB wrap, bit-exact ops); the invariants are written down in DESIGN §11; there are no dependencies, no network, no build; the geometry contract is explicit and measurable; the LFO already demonstrates the park/restore discipline routing needs. The problem is structural, not intellectual.

---

## 3. Feature A — in-tool routing ("patch bay")

### 3.1 What a cable is in this instrument

Each view is already a three-frame device: operand **A**, derived **Z = A op B**, operand **B** (`makeSlot`, `735–747`). The missing thing is edges.

- **Sources (9 outputs):** `A`, `B`, `Z` of each of the three views. Because `S.N` is global and every register is exactly `N` bits (`726–733`), a cable is a plain bit-array copy — no scaling, sign extension or sample-rate gymnastics.
- **Destinations (6 inputs):** `A` and `B` of each view. **`Z` is never a destination** — it is a function of its view's operands, resize zeroes it (`899–902`), and an external write to it would survive one transaction then vanish (DESIGN §10.8; the stale-Z failure class).
- **Fan-out:** unlimited (one output can feed several inputs — an audio mult).
- **Fan-in:** **one cable per input in v1.** A second cable replaces the first, as Blender's single-link sockets do. Last-write-wins and priority-replace depend on invisible ordering; the audio-natural alternative — summing at one inlet (`set | add mod 2^N | xor`) — is the v1.1 upgrade and is the bit-level analogue of additive mixing.

### 3.2 Candidate models and verdict

| Model | What it gives | Cost | Verdict |
|---|---|---|---|
| (i) **Cross-view patch cords** | Audio frame; 9→6 ports; topological | Port mapping + dock UI | **Ship** |
| (ii) **Within-view feedback `Z→A/B`** | The teaching jackpot: a two-state oscillator is one cable | Needs an explicit delay rule | **Ship, labelled** |
| (iii) Routing matrix | Dense overview | 54 cells → 54 focus stops; no per-cell mix/delay | Defer (optional overview later, roving tabindex) |
| (iv) Named buses | Scales past ~10 modules | Mapping layer, no payoff at 3 views | Reject for now |
| (v) Linear chain (view order = processing order) | Zero UI | Display order silently changes arithmetic | Reject |
| (vi) General DAG | Maximum power | (i)'s cost + cycle authoring | Ship as restricted DAG: (i)+(ii) |

### 3.3 Recommended semantics

**Authority / normalled-jack rule.** A patched input is *driven*. On the first cable, its pre-patch value is **parked**; when the cable is removed it is restored byte-identically — the LFO promise (DESIGN §10.18) reused. While driven, base writes (drag, bit click, preset, unary op, B seed, CSV column, LFO sweep) skip it; the strip labels the driver (`3·Z → 1·A`) and disables edit affordances with a visible reason instead of silently ignoring input. This is the audio-patching concept of a normalled input: plugging in breaks the normal path, and unplugging restores it.

**One evaluation entry point.** All writers finish their base writes, then `applyRoutes()` runs, then `recomputeZ` + `syncTarget` for **all** views, then render. It runs only on transaction boundaries — drag move, bit click, preset/op, CSV step, LFO tick, route add/remove, resize — **never per animation frame**. Focus never participates; clicking a view changes no numbers.

**Cycle breaking.** Two cycle shapes exist: a self-loop (`3·Z → 3·A`) and a cross-view cycle. A zero-delay cycle has no fixed point (with `A = A xor B`, unless `B = 0`, there is nothing to converge to), so a cycle must be broken by an **implicit one-evaluation delay**. No stored state is needed: snapshot the delayed source values before writing, then write. That snapshot *is* the previous evaluation's result, and it survives resize and unroute. Phase-shift feedback is exactly the digital-audio delay line every feedback patch requires. Label those cables `z⁻¹` — not with a second dash language, because B already owns the dash (DESIGN §8).

**Precedence (single table, no surprises):**

| Event | Base writes first | Then |
|---|---|---|
| Manual edit | the user's port, if not driven | `evaluateAll()` |
| CSV step | mapped columns for non-driven ports | `evaluateAll()` |
| LFO tick | sweep non-driven ports, all views | `evaluateAll()`, then render |
| Route add/remove | park / restore destination | `markDelays()` → `evaluateAll()` → dock render |
| Resize | `lfoStop`; remap A/B **and parked bases**; set `S.N` | recompute + `evaluateAll()` |
| Copy view | copy *base* registers; routes belong to the rack, untouched | `evaluateAll()` |
| Focus change | none | UI render only |

**Worked example (independently recomputed, matches the routing deep-dive to the hex digit).** Boot values from the table formulas: `A.A = 8ADEFEDA85210125`, `A.B = FFFFFFFF00000000`; `C.A = 0123456789ABCDEF`, `C.B = 8ADEFEDA85210125`, so `C.Z = 0002444281210125` (popcount 13).

| Step | Action | A.A | A.Z | B.A |
|---|---|---|---|---|
| 0 | boot | `8ADEFEDA85210125` | `7521012585210125` | `FEDA852101257ADE` |
| 1 | patch `C.Z → A.A` | `0002444281210125` | `FFFDBBBD81210125` | unchanged |
| 2 | patch `A.Z → B.A` | `0002444281210125` | `FFFDBBBD81210125` | `FFFDBBBD81210125` |

After step 1, A's truth counts are `24 / 27 / 8 / 5` (sum 64, invariant holds) and `popcount(A.Z) = 35 = 27 + 8` — the routing deep-dive has the full check and the two-state feedback proof.

### 3.4 UI inside the design system

**Canonical editor: a DOM dock.** A `patch` toggle in the `view` group opens a sixth grid band between `.meta` and `.controls` (taking height from the stage, never overflowing). It is a real table: two labelled selects (nine outputs / six inputs, Z destinations absent), `add cable`, rows reading `3·Z → 1·A` with a per-row remove button (labelled "Remove cable 3·Z to 1·A"), an `aria-live="polite"` status line, and `Alt+P` to toggle. Every action works without a pointer — this is the accessible representation; the canvas is garnish.

**Cables are read-only.** In the 3-D field, draw only the visible view's cables as arcs from the source plate's jack to the destination plate's jack, outside the box; in split view draw cross-pane cables in a final pass over the 1 px divider only when both ends are visible; a source not in frame becomes a caption (`⇠ 3·Z`), never invented geometry. Jacks and cables are indicators: no hit-testing, no dragging (DESIGN §10.12 — the field is a lens, not an editor). Never touch plate alpha or the middle frame (DESIGN §10.15).

**Visual grammar (no third hue, no new token):** `--accent` is data, so cables are accent (1.25 px, α 0.55; selected 1.8 px, α 0.95 — weight, not hue); jacks use `--line-hi` ring / `--dimmer` core, driven inputs get an accent ring; the dock row uses `--panel-hover` + accent border, mirroring `button.op.on`. `--inf` stays reserved for ∞, the zero-crossing and MRB underlines — routing does not get to spend the warmth. Invalid choices are absent from the select, not red.

**720 px:** dock rows stack (selects on one line, remove after); `--pad` is already 16 px there; captions drop because the dock carries the text.

### 3.5 If you do it in today's file (and why I would not)

The routing deep-dive gives the full touch list: new `S.routes` / `S.routePark`, `applyRoutes`, `evaluateAll`, `markDelays`, port helpers, driven-port guards in drag/bit/preset/ops/CSV/LFO/seed, parked remap in `resizeRegister`, `baseOf` in `copySlotInto`, dock DOM/CSS, observation columns. It is ~150 new + ~70 changed lines for the engine and guards, ~190 for the dock, ~90 for canvas cables — a credible **~500 LOC, 4-phase, ~1 week** feature in the current file.

The catch is the second pass. Routing's natural home is the core's evaluation model, and the current file has no seam for it: you would write `evaluateAll()` against the `S` facade, then rewrite it against the extracted store. That is not fatal — it is 1–2 extra days — but it is two chances to regress the invariants. **Recommendation:** build a throwaway *interaction* spike (dock + one cable + one guard, no persistence, no canvas) to validate the feel, then build the engine once in the new core (§7, F1). If routing must ship for a class in the next month, the routing-first path is in §7.2 and is honest about the port cost.

### 3.6 Verification additions (before merge)

1. Boot → `C.Z = 0002444281210125` (pop 13).
2. Add `C.Z→A.A`: `A.A = 0002444281210125`, `A.Z = FFFDBBBD81210125`, pop 35, truth `24/27/8/5`.
3. Add `A.Z→B.A`: `B.A = FFFDBBBD81210125`, `B.Z = FDBB31736D896505`.
4. Remove both: A and B byte-identical to boot; unpatch after resize equals resize without a cable.
5. Cross-view chain A→B→C: resolves in one evaluation, no stale Z.
6. `A.Z→A.A` twice is the identity (the two-state oscillator).
7. Route + LFO: patched inputs are never overwritten; stop restores the pre-LFO snapshot.
8. Route + CSV: a driven destination ignores its column but keeps the mapping; unplug restores it.
9. Keyboard-only: add, inspect, remove a cable; status announced; focus never lost.
10. Zero console errors; no overflow at 420 px; pixel histogram contains no third hue.

### 3.7 Open routing options (defaults chosen, cheap to flip)

- **Fan-in** (v1.1): per-input mix `set | add mod 2^N | xor`. `add mod 2^N` is the additive-synthesis analogue — two wavetables summed at one inlet is a genuinely new teaching state, not just plumbing.
- **Sources:** ship all nine (`A/B/Z`). `A→B` is a direct out; `Z→A` is the interesting one.
- **Slot naming:** see §5 — recommend display 1/2/3 so a caption reads `3·Z → 1·A`, keeping internal/persisted keys `A/B/C` for compatibility.
- **Route presets / "patch memory"** and copy-patch: later; the rack owns routes, views don't.

---

## 4. Feature B — accessibility & reach

### 4.1 The finding that matters most

A keyboard-only user can press presets and unary ops but **cannot set a specific value, flip a bit, or select a nibble** — the core teaching loop is unavailable. Tab reaches the range and the buttons; it never reaches the strip or canvas (`tabindex` count: 0; bit cells are `<i>` with a click handler, `1448–1459`, `1713`). That is the first thing to fix, and the fix is also the base for routing's keyboard model.

### 4.2 P0 fix list (after the IA pass, both part of F4)

| Severity | Issue (evidence) | Fix | Effort | DESIGN amendment first |
|---|---|---|---|---|
| Critical | No keyboard editing path | One focusable **nibble spinbutton** per nibble (`role="spinbutton"`, `aria-valuenow` 0–15, `aria-valuetext` "nibble 5, hex D, bits 20–23, weight 2^20", arrows/Home/End/0–F, roving tabindex); whole nibble becomes the pointer target; add a mono **hex entry** field per register for direct `DEADBEEF` entry | L | §6 + §8 |
| Critical | Bits are `<i>` with no role/name/state; canvas (581) has no role/label/fallback | Make the strip the semantic control; `role="img"` + a text alternative on the canvas updated on commit (edit target, curve summary, Z popcount) | M | §8 |
| Critical | `.seg` selection is colour-only (SC 1.4.1); `[aria-pressed]` selectors at 497/510 are dead for segs; `role="group"` appears once | Real `role="radiogroup"`/`radio` with `aria-checked` + roving tabindex for view/slot/edit/binop; keep `aria-pressed` only for true toggles (LFO, split, copy, operand B) | M | §8 |
| Critical | Contrast: `--dim` 3.95/4.12/3.76, `--dimmer` 2.07/2.16/1.97 against panel/bg/panel-hi — all fail 4.5:1 at 9–11.5 px; focus rings 2.13/1.63; B-mate stroke 1.86; zero-crossing 1.71; `--line` 1.18 against the 3:1 non-text requirement | §4.3 token bump + alpha bump; hierarchy moves to size/weight/tracking, not luminance | M | §3 then §8 |
| Critical | Zoom/reflow: `height:100dvh; overflow:hidden` + 5 fixed grid rows + `minmax(0,1fr)` stage ⇒ at 200 % on a 720p-class viewport the stage can resolve to ~0 px with no scrollbar; at 400 % roughly two-thirds of the UI is clipped | `min-height:100dvh; height:auto; overflow:visible`; stage floor `clamp(220px, 44dvh, 620px)`; page scrolls; verify at 1280×720 @200 % and 320×180 @400 % | M | §5 + §9 |
| Critical | No `prefers-reduced-motion` handling; LFO 1–8 ticks/s mutates real registers | Under `reduce`: LFO defaults off; if started, no easing, rate cap 4/s; drop the hint fade; keep 1:1 drag | S | §7 |
| Critical | No live feedback: every readout changes silently; naïve `aria-live` would flood (drag runs per `pointermove`, LFO 1–8/s) | One `role="status"` `aria-live="polite"` `aria-atomic="true"` region driven only by committed changes, debounced ~150 ms, quiet during drag/LFO ticks | S | §8 |
| Critical | Targets: `.bit` 10.1×17.3 px with 10.1 px spacing (fails 24 px); `.op.mini` 22.3×20.2 px; bits vanish at 128/256 bits | Nibble-level target (spinbutton above) + `.op.mini` min-height 24 + ≥24 px thumb; compact mode still exposes the semantic control | S | §5 + §8 |
| Serious | Armed `copy →` has no cancel; hidden controls hide the only route to states; duplicate slot/split controls | §5 IA: stable modules, reserve space, one canonical home, explicit `copy to…` menu, Escape cancels, `aria-keyshortcuts` + in-page map | L | §8 + §9 |
| Serious | CSV import silently fails/misloads (no error surface; all-non-token file shows `1 / 1` stale data) | Status line ("loaded 120 rows, 4 columns from foo.csv" / "could not read: no data rows"), keyboard drop path, filename | S/M | §8 |

### 4.3 Contrast — measured, with the recommended trade-off

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
- **Shareable state** via URL fragment (`#bw=1.<N>.<slots>` packed → base64url, ≈260 chars at 256 bits; works from `file://`; `history.replaceState` only). This is already promised in DESIGN §12 ("Shareable state").
- **`.bitwave` project file** (versioned JSON; registers as hex strings, never `Z`; dataset inline by default; unknown fields preserved; higher unknown schema opens read-only). Sketch in the architecture deep-dive §G.
- **Embedded demo dataset** behind a `demo` button — data, not onboarding: it makes the stepper and split view discoverable for a first-timer with no CSV, with no tour, trophy or confetti.
- **Delete `index.html.bak`** from the distribution folder; it is a 71 KB older build that a teacher can open by mistake.
- **Keep the no-dependency `file://` path.** No CDN fonts, no fetch, no modules in the artifact. Offline is a feature.

### 4.5 What must not change

The 0 px strip↔curve alignment and `--pad` single-writer rule; the two-hue system (focus, selection, error and high-contrast states must not mint a third hue); `Z` never editable and the 3-D field never editable; hardware bit order and MSB-left display; the no-onboarding stance; zero-dependency single-file delivery.

---

## 5. Feature C — GUI cohesion (the IA pass)

Not a restyle: a **stable module order, one canonical home per control, and names that don't collide.** The patch dock is the first component added under these rules and a useful test of them.

| Module | Before | After |
|---|---|---|
| **Source** (data) | 6 of 9 controls appear only after import; no demo; no errors | fixed: `import` / `demo` / `◀ n/N ▶` / columns / `log` / `export` / status line; disabled placeholders instead of disappearing |
| **Register** | header slider labelled "register" | header `width`; A\|B edit target as a radio pair; hex entry field |
| **Operate** | `op` group last; `amount` also drives the LFO | `operate`: amount + the seven unary ops |
| **Derive** | `logic` third; binops hidden until B; truth table stranded in meta | `derive`: operand B, binop radios, truth/carry attached to the meta band |
| **Motion** | `lfo` | `motion`: LFO, mode, rate, B phase |
| **View** | duplicated slot/split controls; stage bar hidden in 2-D | `view`: 2D/3D, `patch`, `copy to…`; view select + split live in an **always-visible stage bar** |
| **Strip** | four click-only glyphs; vanishes in compact | one focusable nibble spinbutton per nibble; bits become its value text; compact keeps the control |
| **Modes** | armed invisibly | explicit `copy to…` menu (focus moves in, `Escape` cancels, live status) |

Also: slot display names become **1 / 2 / 3** (`VIEW 1 · A ⊕ B → Z`), freeing `A/B/Z` for registers; the stage expression becomes routing-aware (`3·Z ⊕ B → Z`); one declared keyboard map (`?` opens a utility panel, not onboarding); duplicate controls removed rather than synchronised.

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
  render/   theme, canvas (2-D), field3d, strip, readouts, stage-bar, patch-dock
  io/       csvFile, projectFile, share, observations
  ui/       controls, pointer, keyboard
  main.ts   composition root: shell → store → renderers → rAF
styles/     tokens.css + base/stage/strip/controls/responsive
tests/      unit/, e2e/, fixtures/
```

Dependency direction: `core ← state ← render/ui ← main`, plus `io → core`. Core is DOM-free — enforced mechanically by a `tsconfig` with `"lib": ["ES2022"], "types": []` and a test that greps `src/core/**` for `document|window|localStorage|requestAnimationFrame`. That is what makes DESIGN §11 arithmetic run in plain Node.

### 6.3 The state spine (the part that matters)

One command funnel: `dispatch(action) → base writes → evaluateAll() → snapshot view-model → renderers`. `evaluateAll()` = `syncTarget` for all views → `applyRoutes()` → `recomputeZ` for all views. Renderers receive frozen view-models and never read mutable globals; nothing renders as a side effect of a model function; nothing recomputes only the focused view. This is the seam that absorbs routing, keyboard commands, undo (future), autosave (future) and share (future) without new architecture.

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
| A11y | axe-core + manual | zero critical/serious in 2-D, A·B, 3-D and patch-dock states; keyboard-only task script; 200 %/400 % zoom |
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
| **F3 Patch dock UI** | `patch` toggle + dock table, add/remove, driver markers, disabled states, `Alt+P`, live status; optional 3-D jacks/cables (read-only) | The feature you asked for, accessible | §3.6 #1–10; keyboard-only add/remove; no overflow at 420 px; tokens only | 3–5 d |
| **F4 A11y P0 + IA pass** | §4.2 fixes; slots→1/2/3; stable module order; reserve space; canonical homes; explicit `copy to…` + Escape; one keyboard map | A tool a keyboard-only student can use | axe zero critical/serious; keyboard task script; zoom at 200/400 %; contrast tokens pass | 3–5 d |
| **F5 Persistence & reach** | `.bitwave` v1 + migration, autosave, URL share, embedded demo dataset, CSV error status, remove stale `.bak` | Work survives; state is shareable | round-trip fixtures; share URL ≤ ~2 KB; save→reload identical | 3–5 d |
| **F6 Distribution** | PWA manifest/SW for the hosted build; Tauri 2 only if triggered | Installable / native file dialogs | installed offline works; artifact unchanged | 2–4 d web, +5–8 d Tauri |
| **F7 Optional framework** | Svelte 5 only if the flip conditions in §6.1 are met | — | prior gates green; bundle budget | 10–15 d |

**Total to a shippable F5: ≈22–36 engineer-days (roughly 4–7 calendar weeks solo, plus review time).** F3 is the point where the routing ask is genuinely answered; F4/F5 make it accessible and durable.

### 7.2 If you need routing sooner (routing-first alternative)

Do the routing deep-dive's 4 phases in the current file (~5–8 days), then pay ~2–3 days to port engine+UI during F1/F2. It works and it validates the UX with your own hands before the foundation work. The cost is double implementation of `evaluateAll` and a second chance to regress Z/LFO/CSV invariants; the plan's tests make it safe, not free. **Recommendation:** do the 1–2 day UX spike now regardless; choose routing-first only if a class or demo needs it before F3.

### 7.3 What to do in the next two weeks if you do nothing else

1. `git init` + capture the golden trace and the three §11 op vectors as tests (F0, 2–3 days).
2. Build the throwaway patch-bay dock spike (1–2 days) — one cable, one guard, one screenshot; then delete it and keep the design.
3. Fix the two cheapest P0 items: delete `index.html.bak`, add accessible names/roles to the 12 symbol- or glyph-only buttons plus a canvas label (hours).
4. Decide §9 Q1–Q3 and Q8 (accessibility priority, routing meaning, fan-in/feedback policy, contrast trade-off). Those four answers unblock the rest.

---

## 8. DESIGN.md amendment package (edit the doc first, per §13)

Changing the instrument means amending the source of truth **before** code. The full package:

- **§3 Colour:** new `--dim` / `--dimmer` / `--line` values; the alpha bumps for focus ring, B-mate, zero-crossing, ∞ ring; a note that off-bit contrast is a data-legibility requirement, not decoration; optional `prefers-contrast` mode. State the 1.9×→1.1× luminance compression and that hierarchy moves to size/tracking/weight.
- **§5/§7/§9:** stage floor + page scroll at zoom (keep the 100 vh instrument on normal viewports); reduced-motion behaviour; dock band and its 720 px stacking; target sizes (24 px).
- **§8 new components:** `patch dock`, `patch row`, `jack`, `cable`, `z⁻¹` delay label, `driven-port` state, nibble spinbutton/hex entry; each must cite which existing token supplies every value.
- **§10 new invariants:** (a) `evaluateAll()` is the only evaluation entry point and runs on transactions, not frames; (b) routes apply after base writes, before Z/truth/log; (c) patched inputs park and restore byte-identically; (d) Z is never a routing destination; (e) cycles are broken by a labelled one-evaluation delay; (f) focus never changes evaluated values; (g) the strip is the semantic editor and the canvas is a lens; (h) reserved-space layout — no control may be removed from the DOM to change mode.
- **§11:** add routing §3.6 and accessibility/zoom/contrast checks; keep the existing headless-CDP pass.
- **§12 Roadmap:** move "Shareable state" to shipped; add patch bay, project file, a11y pass, source migration.
- **§13 protocol:** add "any new control must declare its keyboard path and accessible name".

---

## 9. Decisions needed from you

| # | Question | Recommendation |
|---|---|---|
| Q1 | Priority: WCAG accessibility first, reach/distribution first, or both in parallel? | Both, but F4 (a11y) before F5 (persistence); the keyboard model is reused by routing and share |
| Q2 | Does "routing Z into another frame A" mean cross-view, within-view feedback, or both? | Both — cross-view as the default, `Z→A/B` feedback with a labelled one-iteration delay |
| Q3 | When a destination is patched, should its local controls be locked (normalled-jack) or should editing break the cable? | Lock with a visible driver label; unplug to restore. Breaking a cable by accident is worse than an extra click |
| Q4 | Fan-in: one cable per input (v1) or mixer/summing immediately? | One cable v1; `set\|add mod 2^N\|xor` in v1.1 (additive synthesis is the payoff) |
| Q5 | Is a one-evaluation (≈ one tick) delay acceptable for feedback? | Yes — it is the honest digital-audio feedback analogue; label it `z⁻¹` |
| Q6 | Rename view slots A/B/C → 1/2/3 in the UI? | Yes, display only (internal keys stay A/B/C); it removes the A.A ambiguity routing would worsen |
| Q7 | Browser + single file, or desktop shell? | Browser + single file now; Tauri later for native file dialogs, same core |
| Q8 | Contrast: bump `--dim`/`--dimmer` (visible change, passes AA) or keep the dim hierarchy (fails AA)? | Bump the tokens and move hierarchy to size/tracking/weight; the off bits are data, not decoration |
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
| **Routing scope creep** | Matrix, buses, route presets, undo, live cables — each additive | The §7 phase gates; MVP cut in §3.5; defer list explicit |
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
- [Target architecture diagram](docs/diagrams/target-architecture.svg) · [Patch model diagram](docs/diagrams/patch-model.svg).

*The picture and the truth should be one object. Right now the truth is trapped in one file; this plan sets it free without changing what it looks like.*
