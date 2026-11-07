# BitWave — implementation status

**Updated:** 2026-11-06 · **Phase:** F0 **done**, F1 **done**, F2 spine + render + UI modules done (pointer/lane controllers still in `main.js`), F3 source table + frame routing **done**; frame names, focus lens and the read-only `window.BitWave` seam **shipped**. **F4 in flight:** DESIGN amended, reflow/zoom + keyboard editing + a11y semantics/live status/reduced motion/targets + axe gate **landed and verified**; the IA layout waits on author sign-off of `spike/f4-ia.html`.
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
| **F0 Baseline** | **Done** | Git; Vite 8.3.6 + TypeScript 7 + `vite-plugin-singlefile` installed; `npm run build` emits the single-file `bitwave-v2.html` from `src/`; unit suite (61), typecheck and the browser harness (27 checks) all green; rebuild parity is a gate (`--compare`) for refactor-only changes. |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules; lanes 1/2/3; 38 core tests green. |
| **F2 State spine + renderers** | **Mostly done** | DOM-free tree, transaction store, `actions.ts`, core `evaluateAll()`; render layer; UI feature modules; every writer inside `store.patch`. `main.js` is ~860 lines of composition, pointer input, lane/view controllers, loop/boot and the agent surface. Remaining: extract pointer + lane/view controllers. |
| **F3 Source-table housing** | **Done** | Six-row `src/ui/source-table.js` (opened from the data group) over `src/state/bindings.ts`: each input reads a CSV column (`data`), a frame output (`1:1`/`z⁻¹`) or `—`. Labels carry the assignment (`A · Hex 1`, matching the import dropdown). Driven inputs are locked against local edits, CSV/LFO skip them, unplug restores the parked base, resize remaps parked bases, and a fresh import rebuilds the board. |
| **F4 A11y + IA** | **In flight** | DESIGN amended first (change protocol §13). Landed: reflow/zoom contract, nibble spinbutton keyboard editing, landmarks/names/radiogroups, canvas alt, live status, reduced motion, 24 px targets, axe gate. **Waiting on the author: `spike/f4-ia.html` layout mockup** (module order, always-visible stage bar, `copy to…` menu, `width`/hex-entry row). Palette untouched (D10). |
| **F5–F6** | Not started | Persistence UI, distribution. |

## F4 progress (2026-11-06)

**DESIGN.md amended first** (change protocol §13): §5 reflow/zoom + 24 px targets, §6 keyboard
editing model, §7 reduced motion, §8 nibble spinbutton / hex entry / canvas alt / live status /
radiogroups / landmarks, §9 reserve space + zoom, §10.32–38 invariants, §11 keyboard/roles/
zoom/motion/targets/axe checks, §13 new-control rule.

**Shipped and verified:**
- **Reflow/zoom (D27).** `body` min-height + page scroll, `main` carries the grid, stage floor
  `clamp(220px,44dvh,620px)`. Normal viewports stay pixel-identical (6/6 parity states); at
  640×360 and 360×225 CSS px the page scrolls, the stage is 220 px and no control is
  unreachable.
- **Keyboard editing (D26).** Every operand nibble is a roving `role="spinbutton"`
  (aria-valuenow/valuetext; ↑/↓ ±1, ←/→ focus, Home/End, 0–F); Tab enters the strip and
  focus survives re-renders; bit clicks return focus; arrows never also step the CSV;
  derived/driven strips are read-only with no tab stop.
- **Semantics (D31).** One `<main>` + named groups, canvas `role="img"` with a commit-updated
  text alternative, lane sets are radiogroups with arrow selection, glyph/preset/navigator
  names satisfy SC 2.5.3, 24 px targets for the stage-bar controls and the width slider.
- **Live status (D29).** One polite atomic region, transaction-driven, 150 ms debounce, quiet
  during drag and LFO ticks, immediate on pointer-up.
- **Reduced motion (D28).** Transitions removed, commits instant, LFO rate capped 4/s; 1:1
  drag unchanged.
- **Automated gate (D30).** `axe-core` 4.14 as a dev dependency, injected over CDP: zero
  critical/serious in 2-D, A·B 3-D, source-table and frame-navigator states
  (`color-contrast` disabled per D10/Q8; Label-in-Name enabled).

**Next in F4 (after mockup sign-off):** the IA slice — module order
`source | width·edit | operate | derive | motion | view`, always-visible stage bar owning
lane + split, explicit `copy to…` menu with Esc, `width` rename, hex entry beside the edit
target, disabled placeholders instead of hidden controls, and the `?` keyboard-map panel.
Also queued: binop set → radiogroup (inside the new derive module) and truth-table semantics.

## Verified this session

- `npm test` → **61 tests, 61 pass, 0 fail** (38 core + 10 state + 7 actions/routing + 6 bindings);
  `npm run typecheck` → **clean**.
- `npm run build` → **`bitwave-v2.html`, 138.2 KB, single file**, no external references
  (`tools/build-artifact.mjs` gate).
- `npm run check:browser` → **40/40 checks pass** on the built `bitwave-v2.html` (41 with
  `--shots`/`--compare`), including the new reflow (200 %/400 %), keyboard-editing,
  semantics/live-status/radiogroup/target, reduced-motion and **axe** groups (zero
  critical/serious in four states) plus the §11 geometry assertion (0.00 px).
- **F4 slice 1 — reflow/zoom (D27):** normal-viewport parity is 6/6 pixel-identical against
  the pre-F4 artifact; at 640×360 and 360×225 CSS px the page scrolls, the stage stays
  220 px and every control is reachable.
- **F4 slice 2 — keyboard editing (D26):** 16 spinbuttons, one roving tab stop, Tab enters
  from the width slider, ↑/↓/Home/End/0–F edit, focus survives a commit re-render, bit clicks
  focus the nibble, derived strips expose read-only spinbuttons with no tab stop.
- **F4 slice 3 — semantics + a11y gate (D29–D31):** one `<main>` and seven named groups;
  canvas `role="img"` with a live alt; lane sets are radiogroups; one polite atomic live
  region announces committed changes and stays quiet during drag/LFO; reduced motion removes
  transitions and caps the LFO; stage-bar minis and the width slider are ≥24 px; axe-core
  reports zero critical/serious in 2-D, A·B 3-D, source-table and frame-navigator states.
- **F3 shipped — source table + frame routing:** `src/state/bindings.ts`
  (six bindings, data/frame/none sources, `z⁻¹` detection, driven helpers,
  parked-base handling) and `src/ui/source-table.js` (panel, six rows, B-style
  labels, state chips). Data/frame/none choices clear each other, trigger the
  core evaluation, and drive the register. Verified in the browser: `Z3 → A`
  (`1:1`), `Z1 → A` (`z⁻¹`), unplug restores the parked base; driven inputs are
  read-only (strip, hint, click blocked).
- **Driven-input guards:** bit/wheel/drag/presets/ops/LFO/CSV step skip driven
  inputs; `evaluate()` syncs their display targets; resize remaps parked bases;
  copy-lane updates parked bases; unpair clears a route first.
- **Your four-column sample** (`testcsv.xlsx` → `examples/testcsv.csv`) imports to
  six rows: `A · Hex 1`, `C · Hex 2`, `D · Grandma Hex`, `E/F · Bananas Hex`,
  32-bit register; the browser check asserts it.
- **Parity note:** the `--compare` gate no longer matches the pre-feature artifact
  because F3 deliberately changes the source-table UI (and drops the per-lane
  column selects). It remains the gate for refactor-only changes; the new
  baseline is the committed artifact.
- **F2 slice 4 — UI feature modules out:** `src/ui/frame-navigator.js` (panel + focus
  lens), `src/ui/stage-bar.js` (lane selector/split/expression),
  `src/ui/csv-import.js` (import + example stepper), `src/ui/keyboard.js`,
  `src/ui/controls.js` (ops/presets/binop/size + LFO engine) and
  `src/io/observations.js`. `main.js`: 1,659 → ~820 lines.
- **F2 slice 3 — render layer out:** `src/render/canvas.js` (2-D curve, 3-D field,
  legend, `fitCanvas`/`--pad`), `src/render/strip.js` (editor strip + fast patch),
  `src/render/readouts.js` (hex/dec/truth/trend/3-D rows) and `src/state/dataset.ts`.
  The spline now comes from `src/core/spline.ts`, and CSV parsing/typing/alignment
  from `src/core/csv.ts`; the app's duplicate parsers are gone.
- **F2 slice 2 — commands + real evaluation:** `src/state/actions.ts` and
  `src/state/routing.ts` (core `LaneMap` adapter + `evaluate()` running
  `evaluateAll()`). `recomputeZ` is gone from the app.
- `npm run check:browser` → **27/27 checks pass** (28/28 with `--shots` or
  `--compare`) on the built `bitwave-v2.html`:
  zero console errors; no overflow or clipped controls at 360/420/720/1440;
  `canvas.width` = viewport; `--pad` 40/16 and compact mode per DESIGN §5/§9;
  strip gap/nibble width follow the §5 formula (1440: gap 12.00, nibble 73.75);
  frame navigator + per-lane eye toggles; 3-D `Z = A xor B`, truth counts `23/11/9/21`,
  `popcount(Z) = 20`; CSV import, the four-column sample, the source table,
  frame driving/unplug and the §11 ROL/NOT/BSWAP vectors all hold; the agent
  surface is frozen/versioned; default state renders byte-identically.
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
| [`src/`](src/index.html) | App source: `index.html` template, `main.js` (~850-line composition + controllers), `styles/app.css` |
| [`src/state/instrument.ts`](src/state/instrument.ts) | DOM-free state tree, frame names, factories and selection helpers |
| [`src/state/store.ts`](src/state/store.ts) | Transaction boundary: `get`/`patch`/`subscribe`, nested patches collapse |
| [`src/state/actions.ts`](src/state/actions.ts) | Commands: core unary ops/presets, focus/binop/visibility/bit/nibble/copy/unpair |
| [`src/state/bindings.ts`](src/state/bindings.ts) | Six input bindings, data/frame/none sources, driven + parked-base helpers |
| [`src/state/routing.ts`](src/state/routing.ts) | Core `LaneMap` adapter + `evaluate()` running `src/core/routing.ts` |
| [`src/state/dataset.ts`](src/state/dataset.ts) | Dataset state (columns, rows, cursor) shared by the shell and canvas code |
| [`src/render/`](src/render/canvas.js) | Canvas + 3-D field, strip, readouts; the only DOM/canvas renderers |
| [`src/ui/source-table.js`](src/ui/source-table.js) | The six-row matrix panel: data/frame/none source, B-style labels, state chips |
| [`src/ui/`](src/ui/frame-navigator.js) | Frame navigator, stage bar, CSV stepper, keyboard map, controls + LFO, committed-change live status |
| [`src/io/`](src/io/observations.js) | Observation logger and CSV export |
| [`testcsv.xlsx`](testcsv.xlsx), [`examples/testcsv.csv`](examples/testcsv.csv) | The four-column layout sample; CSV twin for the importer |
| [`vite.config.mjs`](vite.config.mjs) | Vite 8 build: `src/` → `dist/index.html`, no minification |
| [`tools/build-artifact.mjs`](tools/build-artifact.mjs) | Single-file gate: verifies no external refs, writes `bitwave-v2.html` |
| [`src/core/`](src/core/index.ts) | DOM-free engine (11 modules, ~1,350 lines), lanes 1/2/3 |
| [`tests/`](tests/design-invariants.test.ts) | 7 test files, 61 vectors + properties (bindings.test.ts is new) |
| [`examples/demo.bitwave.json`](examples/demo.bitwave.json) | Versioned project document (lanes 1/2/3; routes + parked bases; dataset) |
| [`spike/routing-matrix.html`](spike/routing-matrix.html) | The reference housing prototype that F3 implements (360 lines) |
| [`tools/browser-check.mjs`](tools/browser-check.mjs) | Zero-dependency CDP harness: 40 checks (41 with `--shots` or `--compare`), incl. reflow/zoom, keyboard editing and axe |
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example |
| `window.BitWave` in [`bitwave-v2.html`](bitwave-v2.html) | Read-only, schema-1 state/geometry/bindings surface; contract in [`AGENTS.md`](AGENTS.md) |
| [`DECISIONS.md`](DECISIONS.md) | D1–D31, including the author decisions above and the F4 a11y floor (D26–D31) |

## Known gaps and blockers

1. ~~**Reflow/zoom clips controls.**~~ **Resolved in F4 (D27):** the page scrolls at zoom, the
   stage keeps a 220 px floor and normal viewports stay pixel-identical; asserted at 200 % and
   400 % in `npm run check:browser`.
2. **Canvas curve sampling is still not pixel-tested.** `BitWave.geometry()` now
   proves the canvas control points and the DOM nibble centres agree (worst
   offset 0.00 px, §11 limit 1.5 px), but the drawn spline's own pixels are not
   sampled; the §11 check asserts geometry, not raster output.
3. **Two controllers still live in `main.js`.** Pointer input (canvas + strip) and
   lane/view orchestration (select, split, copy, `syncViewUi`) are not yet
   `src/ui/` modules. They do not block F4/F5; the spine, renderers, bindings and
   UI feature modules are already separate.
4. **Routes are not persisted yet.** `.bitwave` (schema 1) stores lanes/registers/
   dataset but not the app's route table; save/reload of a patched rack is F5.
5. **Parked-base resize is core-tested but not browser-tested.** The app calls
   `remapParkedBases()` around a resize; the core test covers the mapping, the
   app path is not yet driven by the browser check.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It listed `NOT FEDCBA9876543210 →
  123456789ABCDEF0`; the actual complement is `0123456789ABCDEF` (confirmed by
  `invert`, by `index.html`, and now by the browser check). DESIGN §11 corrected;
  the test asserts the true value.

## Next actions

1. **F4 finish (next):** author sign-off on `spike/f4-ia.html`, then the IA slice
   (module order, always-visible stage bar, `copy to…`, `width` + hex entry, disabled
   placeholders, `?` map), binop radiogroup and truth-table semantics. The rest of F4 is
   shipped and gated. **Do not touch the palette** (Q8 closed).
2. **F5 persistence & reach:** `.bitwave` schema 2 (or additive fields) for the six
   bindings/routes + parked bases, autosave, URL share, embedded demo dataset,
   CSV error status.
3. **F2 finish (optional before F4):** extract the pointer and lane/view controllers
   into `src/ui/`, leaving `main.js` as pure composition. No behavioural change;
   run the browser check and a fresh `--compare` baseline.
