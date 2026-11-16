# BitWave — implementation status

**Updated:** 2026-11-14 · **Phase:** F0 **done**, F1 **done**, F2 spine + render + UI modules done (pointer/lane controllers still in `main.js`), F3 source table + frame routing **done**, F4 accessibility + IA **done**, F5 persistence & reach **done**, **F6 distribution done**, the **agent interface done** (2026-11-08), the **external-routing slice done** (2026-11-08, D40) — expression sources, a DAW-style Record/log, `.bitwave` schema 3, and bridge `setExpression`/`record`/`getLog` (toolset 1.1.0) — the **frame-navigation pair done** (2026-11-14, D41/D42), the **dynamic-lanes pass complete** (D43–D46, 2026-11-14): core naming primitives, state lane-key identity, `.bitwave` schema 4 + migration (D44), the compact `#bw=` codec + budget proof (D45), the live 1–8 lane UI (D46: native per-pane lane dropdown, frames-view add/duplicate/delete, `2L` source rows, `3L` Record rows), the **agent-surface + docs slice** (toolset 1.4.0: agent lane range 1–8, frames `A`–`P`/`Z1`–`Z8`, lane dropdown selector in the manifest, eight-lane verification + fixture, docs/screenshots), and the **GUI rearrangement done** (2026-11-14, D47: top-bar VIEW + 2D/3D toggle, per-pane hinge + copy menu, always-present readout truth disclosure, bottom VIEW row removed). The plan's funded path is complete; Tauri remains deferred (D37).
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
| **F0 Baseline** | **Done** | Git; Vite 8.3.6 + TypeScript 7 + `vite-plugin-singlefile` installed; `npm run build` emits the single-file `bitwave-v2.html` from `src/`; unit suite (77), typecheck and the browser harness (now 52 checks) all green; rebuild parity is a gate (`--compare`) for refactor-only changes. |
| **F1 Core + routing engine** | **Done** | 11 DOM-free modules; lanes 1/2/3; 38 core tests green. |
| **F2 State spine + renderers** | **Mostly done** | DOM-free tree, transaction store, `actions.ts`, core `evaluateAll()`; render layer; UI feature modules; every writer inside `store.patch`. `main.js` is ~1,000 lines of composition, pointer input, lane/view controllers, persistence wiring, loop/boot and the agent surface. Remaining: extract pointer + lane/view controllers. |
| **F3 Source-table housing** | **Done** | Six-row `src/ui/source-table.js` (opened from the data group) over `src/state/bindings.ts`: each input reads a CSV column (`data`), a frame output (`1:1`/`z⁻¹`) or `—`. Labels carry the assignment (`A · Hex 1`, matching the import dropdown). Driven inputs are locked against local edits, CSV/LFO skip them, unplug restores the parked base, resize remaps parked bases, and a fresh import rebuilds the board. |
| **F4 A11y + IA** | **Done** | DESIGN amended first (change protocol §13). Shipped: reflow/zoom contract, nibble spinbutton keyboard editing, landmarks/names/radiogroups, canvas alt, live status, reduced motion, 24 px targets, axe gate — then the author-approved IA pass: always-visible stage bar (lane + frames + split), module order `source | register edit | operate | derive | motion | view`, explicit `copy to…` menu, `width` rename + whole-word hex entry, reserved-space disabled placeholders, `?` keyboard map and truth-table semantics. Palette untouched (D10). **D47 (2026-11-14) re-homed the later additions**: the `view` module moved to the top bar (`VIEW` + 2D/3D left of `?`), the hinge and copy menu moved into each pane head, the truth table became an always-present readout disclosure, and the controls row now renders five modules. |
| **F5 Persistence & reach** | **Done** | `.bitwave` schema 2 (additive focus/frameVis, LFO mode/rate, dataset cursor) with a DOM-free app bridge; explicit `project…` menu (save/open/reset); debounced autosave + boot restore; `#bw=` URL-fragment share that wins over autosave; embedded 8-row demo dataset; visible dataset/status line that refuses empty/non-token CSVs; `?fresh` ephemeral sessions; stale `index.html.bak` deleted. Palette untouched (D10). |
| **Agent interface** | **Done** | Additive agent layer (2026-11-08): `src/core/agent-*.ts` one registry/state/deeplink source; `window.bitwave` bridge (state/setters/call/subscribe/events) beside the untouched `window.BitWave`; hidden `#bitwave-state` + `body[data-agent-ready]`; `keys | agent` help-panel tab; `agent/cli.mjs` + `agent/mcp-server.mjs` (zero deps); generated `agent/manifest.json` + examples (`--check`); AGENTS/contract/llms/screenshot/ecosystem docs; hosted build serves the agent files. Default rendering pixel-identical (D39). |
| **External routing** | **Done** | `.bitwave` schema 3 (expressions additive; schema 1/2 load); six source rows gain a validated `expr` editor; DAW-style Record toggle + bounded transient frame log + `export log`; expression-aware clocked pass (routes → expression sources → Z) with the previous row as `log.<frame>`; bridge `setExpression`/`record`/`getLog`, state `recording` + per-lane `expressions`; toolset 1.1.0. Float is a boundary authoring format (converted once to exact values). D40. |
| **Frame navigation** | **Done (2026-11-14)** | A/B/Z1 readout labels are focus buttons bound to the whole-word hex entry (D41); the pop-out frame navigator is replaced by the stage-level **frames view** — equal cards per frame, lane columns, mini-splines, per-card eyes, `unpair B`, horizontal scroll arrows/track, `Lanes`/Esc return, and a perpetual `+` tile that names the 3-lane cap until dynamic lanes (D42). Canvas hidden while open; strip/meta/controls stay live; default pixels unchanged when closed. |
| **Dynamic lanes (D43–D46)** | **Done (2026-11-14)** | **Core naming primitives** and **state lane-key identity** landed; **`.bitwave` schema 4 + migration (D44)**: `lanes` keyed by the stable lane key (`"1"`..`"13"`, gaps allowed, at most `APP_LANE_CAP` (8) lanes, ascending numeric order), schema 1/2/3 documents and `#bw=` links load and upgrade on read, 9 lanes/invalid keys refused, Z never stored; **compact share codec + budget proof (D45)**: canonical `#bw=` links are compact (8 lanes/256-bit = 1260 chars against the unchanged 2000 budget), legacy JSON links load, dataset then expressions drop with explicit flags; **live lane UI (D46)**: the tree holds the document's whole 1–8 lane set, the stage bar uses a native per-pane lane dropdown (`Lane 1`…`Lane 8`, `[data-agent-lane]`), the frames view `+` adds lanes and each lane head duplicates/deletes (reference-counted inline confirmation), the source table shows `2L` grouped rows and Record rows are `3L`; **agent-surface + docs slice (toolset 1.4.0)**: agent lane range 1–8 (`FrameRef.slotKey` optional, legacy lanes 1–3 only), frames `A`–`P`/`Z1`–`Z8`, `laneSelect` manifest selector, bridge refuses non-live lanes with `E_OUT_OF_RANGE`, `examples/eight-lanes.bitwave.json` + eight-lane verifier/screenshot, contract/AGENTS/llms/README/DESIGN/ecosystem docs updated. Gate counts at the time of the slice: `npm test` 179, browser harness 59/59 (60/60 with parity vs the then-current D46 UI artifact — 6/6 states pixel-identical), `agent/selftest.mjs` 26/26, `agent/verify-browser.mjs` 34/34, PWA 8/8. The later **D47 GUI rearrangement** intentionally changes the rendered re-homed regions (top bar, pane heads, readout row, removed bottom row), so `--compare` parity stops at the D47 artifact and the current browser gate is 61/61. |
| **Routing I/O exploration** | **Note only** | [`docs/ROUTING-IO-MODEL.md`](docs/ROUTING-IO-MODEL.md) (2026-11-16) inventories the current frame/lane/route/source model and separates the essential graph semantics (shared width, `Z = A op B`, clocked evaluation, delays) from the lane housing (fixed three-register groups, lane-scoped names, columns/split/source-row grouping). It compares rack-view-only, reference operands (schema 5) and a frame/operator port graph (schema 6), maps the Multiband-Expressor sidechain through each, lists the I/O semantics to settle and a headless measurement plan. **No code, contract or schema change; the expressor remains a committed spike.** |
| **Dataset lifecycle exploration** | **Note only** | [`docs/DATASET-LIFECYCLE.md`](docs/DATASET-LIFECYCLE.md) (2026-11-16) starts from the author's sorting-prompt acceptance test. Audits the current data plane (one active dataset, CSV import/auto-binding, dataset stepping, project/share persistence, `getState().dataset` current-row-only, bridge dataset setter, no dataset readback/export tool, observations/take exports are separate) and proposes the minimal surface: dataset readback/export, formal dataset tools, labels derived from column bindings, a compare-columns shortcut, and the external-agent workflow; explicitly defers function frames/global frame identity. **No code or contract change.** |
| **F6 Distribution** | **Done** | Hosted/installable PWA build (`dist/hosted/`): manifest + maskable icons, hash-versioned app-shell service worker, relative URLs, offline reload. The committed single-file `bitwave-v2.html` is untouched and still has zero external references (asserted). `npm run check:pwa` proves install/offline against the real built output; deploy/install/privacy guidance in [`docs/hosting.md`](docs/hosting.md). Tauri 2 deferred (D37). |

## F4 progress (2026-11-06) — complete

**DESIGN.md amended first** (change protocol §13): §5 reflow/zoom + 24 px targets + stage-bar
inset, §6 keyboard editing model, §7 reduced motion, §8 nibble spinbutton / hex entry / canvas
alt / live status / radiogroups / landmarks / stage bar / copy menu / register edit, §9 stable
module order + reserve space + zoom, §10.32–38 invariants, §11 keyboard/roles/zoom/motion/
targets/IA/axe checks, §12 roadmap, §13 new-control rule.

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
  text alternative, lane sets are radiogroups with arrow selection, glyph/preset/card
  names satisfy SC 2.5.3, 24 px targets for the stage-bar controls and the width slider.
- **Live status (D29).** One polite atomic region, transaction-driven, 150 ms debounce, quiet
  during drag and LFO ticks, immediate on pointer-up.
- **Reduced motion (D28).** Transitions removed, commits instant, LFO rate capped 4/s; 1:1
  drag unchanged.
- **Automated gate (D30).** `axe-core` 4.14 as a dev dependency, injected over CDP: zero
  critical/serious in 2-D, A·B 3-D, source-table and frames-view states
  (`color-contrast` disabled per D10/Q8; Label-in-Name enabled).
- **IA pass (D32, author-approved mockup `spike/f4-ia.html`).** The stage bar is always
  visible and is the single home of lane + frames + split (the frames view replaced the
  left-docked navigator under D42; source table right). Controls render six named modules in the
  approved order with `width` replacing `register`, a read-only `edit · A` target and a
  whole-word hex entry (right-aligned, invalid refused, Esc reverts). `copy to…` is an
  explicit focus-in menu that Escape closes and the live region confirms in words. Binops
  are a radiogroup with arrow selection; inapplicable controls are reserved-space
  `aria-disabled`; `?` opens the keyboard map; the truth table is a real ARIA table.

## F5 progress (2026-11-06) — complete

**DESIGN.md amended first** (change protocol §13): §8 demo dataset / project menu / dataset
status line, §10.39–41 persistence invariants, §11 persistence checks, §12 roadmap.

**Shipped and verified:**
- **`.bitwave` schema 2 + bridge (D33).** Core schema gains additive `focus`/`frameVis`,
  view `lfoMode`/`lfoRate` and dataset `index`; schema 1 still loads with defaults; Z is
  never stored; routes/parked bases persist; top-level unknown fields are preserved across
  load/save; schema >2 and widths outside the slider set are refused with codes.
  `src/state/project-bridge.ts` captures/applies the live tree in one transaction.
- **Autosave + share (D34).** Debounced `localStorage` autosave (650 ms after the last
  transaction), boot order shared link → autosave → boot defaults. `#bw=` fragment refreshed
  with `replaceState`; measured 64-bit payload **1230 chars**, 256-bit **1743 chars**
  (budget 2000; dataset dropped only if needed). `?fresh` runs ephemeral.
- **Project surface (D35).** `project…` focus-in menu (save/open/reset), embedded 8-row demo
  dataset through the normal import path, and a visible polite `#csvStatus` line. Empty and
  all-non-token CSVs are refused without replacing the current dataset; export with no
  observations explains why.
- **Cleanup (D36).** `index.html.bak` deleted (author kept it only until F5).

## F6 progress (2026-11-06) — complete

**DESIGN.md amended first**: §10.42 distribution invariant, §11 PWA verification, §12 roadmap.

**Shipped and verified:**
- **Two deliverables, one instrument (D38).** `npm run build:pwa` keeps
  `bitwave-v2.html` byte-unchanged (zero external refs) and writes `dist/hosted/`:
  `index.html` (same app + PWA shell), `manifest.webmanifest`, `sw.js`, `icons/`,
  and a clean `bitwave-v2.html` copy for direct download.
- **PWA shell.** Standalone manifest with 192/512 + maskable icons generated from the
  palette (`tools/make-pwa-icons.py`, committed PNGs), relative `start_url`/`scope` so a
  subpath deploy works, theme/background `#08090c`.
- **Service worker.** Cache-first same-origin `GET` only, cache name
  `bitwave-<artifact-hash10>`, `skipWaiting`+`claim`, offline navigation fallback,
  old-cache cleanup on activate; no telemetry or third-party traffic.
- **Verification (`npm run check:pwa`).** Serves `dist/hosted/` on `127.0.0.1` and drives
  headless Chromium: manifest/icons load, worker registers/activates/controls, app shell
  cached, and a reload **with the origin server stopped** boots from cache with zero console
  errors; also asserts the single-file artifact stayed clean and the hosted page's only
  external refs are the PWA shell. **7/7 checks** (the agent layer added an eighth: served
  agent manifest + example envelope + `llms.txt` — 8/8 on 2026-11-08).
- **Distribution docs.** [`docs/hosting.md`](docs/hosting.md): build, deploy (GitHub Pages /
  Netlify / any static host), install on desktop/mobile, offline behaviour, update/cache
  versioning, privacy, and when to send the file vs the URL. `npm run verify` runs the full
  gate. Tauri 2 stays deferred (D37).

## Agent interface (2026-11-08) — done

**Additive agent layer (D39).** The agentify-local-tool build is complete on the shared
`.bitwave` project state and DOM-free core:

- **One source of truth.** `src/core/agent-tools.ts` (6 pure tools, one envelope, closed
  12-code error set, manifest, bridge patch validation), `agent-state.ts` (UI-state
  builder), `agent-share.ts` (canonical `#bw=` links, no `savedAt`) and `agent-defaults.ts`
  (identity, enums, global frame names) are imported by the browser, CLI and MCP server.
- **Browser.** `window.bitwave` (getState/getManifest/tools/call/getDeeplink, 10 setters +
  setExpression/record/getLog in the external-routing slice, subscribe,
  `bitwave:ready`/`bitwave:change`) beside the untouched read-only `window.BitWave`; hidden
  `<pre id="bitwave-state" data-schema-version="1">`; readiness marker; a `keys | agent` tab
  in the `?` help panel with status/copy controls/live state/tool catalogue.
- **Headless.** `agent/cli.mjs` (10 commands, envelope-only `--json`, exit 0/2/3/4),
  `agent/mcp-server.mjs` (NDJSON JSON-RPC 2.0, protocol 2025-06-18, zero deps),
  `agent/selftest.mjs` (23 checks) and generated `agent/manifest.json` +
  `agent/examples/` (`--check` gated).
- **Docs.** `AGENTS.md` onboarding, `docs/AGENT-INTERFACE.md` contract, `llms.txt`,
  `docs/AGENT-SCREENSHOTS.md`, `docs/BITWAVE-ECOSYSTEM-MAP.md`, README section.
- **Distribution.** `build:pwa` copies `agent/`, `AGENTS.md`, `llms.txt` and the agent docs
  into `dist/hosted/`; `check:pwa` asserts the served manifest/example/llms.txt (8 checks).

## External routing (2026-11-08) — done

**Schema 3 expressions + DAW-style Record (D40).** The approved design note
[`docs/EXTERNAL-ROUTING.md`](docs/EXTERNAL-ROUTING.md) is implemented as a vertical slice:

- **Core.** `src/core/expression.ts` (deterministic exact-rational evaluator; no `eval`;
  float is a boundary authoring format converted once), `external-routing.ts` (reference
  clocked pipeline), schema 3 in `project.ts`, expression hook in `core/routing.ts` and
  `state/routing.ts` (routes → expression sources → Z; previous row as `log.<frame>`).
- **State/UI.** `S.slots[*].expressions`, `src/state/record.ts` (bounded transient log),
  source-table `expr` rows with a validated one-line editor, Record toggle/count/export log,
  expression-driven inputs read-only locally. Toolset 1.1.0; `window.bitwave` gains
  `setExpression`/`setSource`/`setRoute`/`record`/`getLog`, state gains `recording` +
  per-lane `expressions`.
- **Persistence.** `.bitwave` schema 3 additive (schema 1/2 load); expressions round-trip;
  the record log is session-only and never enters the project or share link.
- **Float policy.** Float coefficients from audio/DSP tools are legitimate; conversion to
  exact values happens once at the expression/import boundary with a declared rounding
  contract. Exact internals are a reproducibility rule, not an anti-float stance.

## 3-D hinge (2026-11-12) — done

**Presentation-only, session state (D40 follow-up).** The 3-D field can now fold which
operand wing is far vs near per lane:

- `S.lanes[*].fold` (`"a-far"` default / `"b-far"`), toggled by the bottom-view `#foldBtn`
  at the time (D47 later re-homed the control into each pane head as a per-pane
  `A far`/`B far` button). Z stays the fixed middle plate and the Z label keeps the
  true operand order (`A ⊕ B`); line style follows the operand (A solid, B dashed), not the
  position. Registers, bindings, operator and Z are unchanged (asserted in the browser
  harness).
- Session-only by design: not in `.bitwave`, not in the agent state. The dynamic-lanes
  design note reserves `lanes.<n>.fold` for the next schema bump.
- [`docs/DYNAMIC-LANES.md`](docs/DYNAMIC-LANES.md) records the lane-count analysis:
  **13-lane naming ceiling** (`A`–`Z` operands), **8-lane recommended v1 cap**, the 2 KB
  share-link gate, `+`/duplicate/delete semantics, schema/agent impact and the staged plan.
- The step/level readout jitter is **fixed**: `#trend` now owns a fixed 86 px slot, so
  `level`/`step-up`/`step-down` no longer reflow the meta row in 2-D or 3-D (asserted by
  the browser harness).

## Readout stability (2026-11-12) — done

`#trend` was a content-sized badge in a wrapping flex row, so each word length pushed the
hex readouts sideways. It now has a fixed `inline-size: 86px` with centered text; the
browser check measures `#hex`/`#hexA`/`#hexZ` positions across all three words in 2-D and
3-D and asserts the badge text does not overflow. This is a CSS/layout-only fix; state,
schema, agent API and the canvas are untouched. The five `docs/agent/*.png` screenshots
were recaptured from the rebuilt artifact so the documentation shows the fixed slot.

## Dynamic lanes — schema 4 (2026-11-14) — persistence slice landed

**`.bitwave` schema 4 + migration (D44).** The approved dynamic-lanes pass (D43) now has
the document shape it needs, with no UI change yet:

- **Shape.** `lanes` stays an object keyed by the stable lane key (`"1"`..`"13"`, D43)
  with the same schema-3 per-lane record, but it is an open map: gaps are allowed
  (`"1"`,`"3"`,`"4"`), at most `APP_LANE_CAP` (8) lanes per document, keys outside
  `"1"`..`"13"` are malformed, 9 lanes are refused with a clear error, and canonical
  serialization is ascending numeric lane key. `view.lane`/`splitPair`, routes and parked
  ports may name any carried lane; Z is never stored.
- **Migration.** A schema 1/2/3 document (the closed three-lane object) loads and upgrades
  on read; the writer always emits schema 4; a schema 5 payload takes the existing
  `newer-schema` refusal; unknown top-level fields survive load/save and now canonical
  links too. The share codec was still the JSON + base64url form in this slice (dataset
  dropped only on overflow and reported); the compact codec landed next (D45, below).
- **Core/state.** `src/core/project.ts` owns the keyed map, cap and migration;
  `markDelays`/`topoOrder`/`evaluateAll` are lane-set aware so an 8-lane document derives
  every Z and routes across new lanes; `src/state/project-bridge.ts` maps by key and still
  boots the shipped three lanes (lanes the live tree cannot represent are ignored until
  the UI slice, and a route it must drop restores the parked base).
- **Agent.** `bootProjectDoc`/`exampleProjectDoc` are schema-4; `build_deeplink` accepts
  schema 1–4 and canonicalises to schema 4; `TOOLSET_VERSION` is **1.2.0** (document
  schema acceptance changed); `agent/manifest.json` + `agent/examples/` regenerated;
  lane-count/selector enums stay three-lane until the agent-surface slice.
- **Tests.** Migration fixtures for schema 1/2/3; canonical round-trip determinism;
  ascending key order with gaps; boot document values unchanged; 8-lane accepted
  (A–P/Z1–Z8) and 9 refused; schema 5 refused; legacy `#bw=` links load; app-bridge
  round-trip for three lanes and a wider/gapped document; agent tool/transport/example
  artifacts updated.

## Dynamic lanes — compact share codec (2026-11-14) — slice 3 landed

**Compact `#bw=` payload + budget proof (D45).** No UI or lane-count change: the default
three-lane instrument still renders pixel-identically, and every legacy link still loads.

- **Codec.** The canonical link is now `#bw=<unpadded base64url(UTF-8 compact JSON
  array)>`: `[tag=4, N, view, lanes, routes, parked, dataset?, x?]` (lane tuples with
  defaults omitted, route triples, raw-bit register words, unknown fields under `x`).
  Decode inspects the JSON value: array = compact (expanded to a schema-4 document),
  object = legacy JSON (upgraded on read). `parseShareHash` is the front door; a corrupt
  or truncated payload is refused, and a newer tag takes the existing `newer-schema`
  refusal.
- **Canonical rules.** Ascending lane key, destination-sorted routes, port-sorted parked
  bases, no `savedAt`; equal state ⇒ equal link. The app path
  (`src/io/share-url.js` → `buildShareLink(captureProject())`, i.e. the address bar and
  `getDeeplink()`), `build_deeplink` and the CLI `deeplink` command share one builder.
- **Budget proof (unchanged `SHARE_MAX_CHARS` = 2000).** Measured payload characters:
  3/64 no dataset 243, 3/256 500, **8/256 no dataset 1260** (740 headroom),
  8/256 + 3×3 dataset 1475, 8/256 + expressions 1978, 8/256 + dataset + expressions
  2192 → dataset dropped → 1978, 8/256 + 8 routes + expressions 2658 → expressions
  dropped → 1940. Full table: `docs/DYNAMIC-LANES.md` §4; reproducible with
  `node tools/share-budget.mjs`. Drop order is dataset first (`datasetDropped`, existing)
  then expression sources (`expressionsDropped`, additive) — never silent; a document that
  still overflows returns `withinBudget:false` (the app writes no link).
- **Agent.** `TOOLSET_VERSION` bumps to **1.3.0** (canonical link format changed; legacy
  links load); `agent/manifest.json` + `agent/examples/` regenerated; `build_deeplink`
  reports `expressionsDropped`; the bridge surface, state shape and lane enums are
  unchanged.
- **Tests.** Compact round-trip/determinism, defaults omission/restoration, unknown-field
  `x`, legacy JSON decode/upgrade, corrupt/truncated refusal, the measured budget table and
  drop flags, and app-vs-agent canonical agreement; existing assertions were kept.

## Dynamic lanes — agent surface + docs (2026-11-14) — final slice landed

**Toolset 1.4.0: the agent surface and documentation match the live 1–8 lane instrument
(D43–D46 complete).** No visible UI change: the rebuilt artifact is 6/6 states
pixel-identical to the D46 UI artifact.

- **Agent range.** `laneKeyFromNumber` accepts 1..`APP_LANE_CAP` (8) and rejects others;
  `frameRefFromName` resolves the global names `A`–`P`/`Z1`–`Z8` case-insensitively;
  `FRAME_NAMES` is generated for the cap (lanes 1–8). `FrameRef.slotKey` is now optional:
  old `A`–`F`/`Z1`–`Z3` refs keep the legacy `A`/`B`/`C` slot letter, lanes 4–8 omit it.
  `SLOT_OF_LANE`/`LANE_OF_SLOT` stay as the legacy lanes-1–3 map.
- **Live-tree behaviour.** `buildUiState` already reported exactly the document's lanes;
  it is now covered for eight lanes. The bridge accepts a `lane`/`frame` only when the
  live tree carries that lane and otherwise returns the closed-set `E_OUT_OF_RANGE`
  (never creates a lane); `setLane(8)` on a real eight-lane document works.
- **Manifest/selectors.** `agent/manifest.json` (regenerated with the examples) carries
  toolset `1.4.0`, a description naming the 1–8 lane range, and the explicit
  `ui.laneSelect: "#stageBar .lane-select"` selector beside
  `ui.laneSelector: "[data-agent-lane]"`. The active stage-bar lane `<select>` carries
  `[data-agent-lane]` synchronously (hidden panes and the frames view carry none).
- **Verification.** `agent/selftest.mjs` pins 1.4.0 and adds manifest-selector and
  eight-lane-headless-state checks; `agent/verify-browser.mjs` adds three checks: the
  dropdown is the documented selector and follows setLane, non-live lane/frame setters are
  truthful `E_OUT_OF_RANGE` no-ops with no event, and an eight-lane schema-4 document loads
  through its canonical compact deeplink (8 stable keys, frames `A`–`P`/`Z1`–`Z8`,
  `setLane(8)`, 24 frames-view cards). `examples/eight-lanes.bitwave.json` is the
  committed fixture (payload 568 chars).
- **Docs.** `docs/AGENT-INTERFACE.md` (1.4.0), `AGENTS.md`, `llms.txt`, `README.md`,
  `DESIGN.md` §11/§12, `docs/DYNAMIC-LANES.md` (shipped), `docs/BITWAVE-ECOSYSTEM-MAP.md`
  and `docs/AGENT-SCREENSHOTS.md` (six states incl. an eight-lane screenshot, all
  recaptured from the current artifact).
- **Deferred.** `fold` (the 3-D hinge) remains session-only by design; the Record/
  observation logger stays focused-lane by design; share length is a measured metric, not
  a lane constraint.

## GUI rearrangement (2026-11-14) — done (D47)

**Layout re-homing, not new logic.** The author's 2026-11-14 mockup (`minor-guiflip`) moved
the wave-view control, the hinge and the copy menu out of the bottom row and folded the
truth table into the readout row; every behaviour kept its old semantics and no hue,
token, font or style was added.

- **Top bar.** `VIEW` + the existing `#depthBtn` now sit in a named `view` group in
  `header`, immediately left of the help `?`; id, `aria-pressed`, title and
  Tab + `Enter`/`Space` are unchanged, and the digit `3` is still the `Alt+3` lane
  shortcut (there was never a dedicated `3` view shortcut). The bottom VIEW group is
  deleted; the controls row renders five named modules with no empty band.
- **Pane heads (stage bar).** Each visible pane head keeps dot, lane dropdown,
  frames/split, expression and gains its own 3-D hinge (`A far`/`B far`, that lane's
  `fold`, hidden in 2-D, independent per pane in split) and its own `copy to…` opener.
  `createCopyMenu` is now `open(anchor, sourceLane)`: items are the live lanes except the
  pane's lane, the menu name is `copy lane <source> to`,
  focus-in/arrows/Home/End/Esc/outside-click/refocus and the copy transaction are
  unchanged; the opener is `aria-disabled` with a reason at one lane. Heads wrap at
  360/720 instead of scrolling sideways.
- **Truth disclosure.** `#truth` is no longer `.abOnly`; `#truthBlock` wraps a
  `#truthToggle` header button (live algebra, chevron,
  `aria-expanded`/`aria-controls`, 24 px target, accessible name
  `truth table for lane <n> <algebra>`) and the unchanged `role="table"` body. It is
  present in A-only/A·B/3-D/split, default expanded, toggles in place, and its fixed
  inline size keeps the hex readouts from moving. Open state is the transient
  `S.truthOpen` — never in `.bitwave`, the share link or the agent state.
- **A11y/no-regression.** Native buttons, focus-visible, reduced-motion removes the
  disclosure transition; the five `data-agent-*` selectors and `#depthBtn` are unchanged,
  so `agent/manifest.json`/toolset do not bump; `verify-browser` stays 34/34.
- **Docs/screens.** DESIGN §2/§8/§10.60–62/§11/§12/§13 amended first and D47 recorded;
  the six `docs/agent/*.png` shots are recaptured from the rearranged artifact and
  `docs/AGENT-SCREENSHOTS.md` names the new control homes; README/STATUS/AGENTS updated
  where layout references changed. The re-homed regions are the documented parity
  exception (the toolset-1.4.0 artifact differs there by design).

## Verified this session

### GUI-rearrangement slice gates (2026-11-14, D47)

- `npm test` → **179 tests, all pass, 0 fail** (unchanged; the change is DOM/UI only).
- `npm run typecheck` → **clean**.
- `node agent/gen-agent-artifacts.mjs --check` → **8 files current** (no agent contract
  change; `manifest.json`/examples byte-identical).
- `node agent/selftest.mjs` → **26/26**.
- `npm run build` → **`bitwave-v2.html` 341.8 KB**, single file, no external references.
- `node tools/browser-check.mjs` → **61/61** (up from 59: top-bar re-homing, per-pane
  hinge/copy source semantics, always-present truth disclosure with readout-stability
  assertions); `--compare` against the pre-D47 artifact is intentionally not a parity
  gate for this slice — measured, it reports **6/6 states differing** (`2d-default`,
  `frames-open`, `3d`, `3d-focus-z1`, `csv-import`, `breakpoint-720`) exactly in the
  re-homed regions (canvas, strip, values and readout order otherwise identical; D47
  records the exception).
- `node agent/verify-browser.mjs` → **34/34** (five documented `data-agent-*` selectors
  unchanged).
- `node tools/build-pwa.mjs && node tools/check-pwa.mjs` → **8/8**.


### Agent-surface slice gates (2026-11-14, D46 / toolset 1.4.0)

- `npm test` → **179 tests, all pass, 0 fail** (the widened agent enum, eight-lane state,
  fixture round-trip and 1.4.0 pins are additive; existing assertions kept).
- `npm run typecheck` → **clean**.
- `node agent/gen-agent-artifacts.mjs --check` → **8 files current** after intentional
  regeneration (toolset 1.4.0, `laneSelect` selector, 1–8 description).
- `node agent/selftest.mjs` → **26/26**.
- `npm run build` → **`bitwave-v2.html` 333.4 KB**, single file, no external references.
- `node tools/browser-check.mjs` → **59/59**; `--compare` against the D46 HEAD artifact →
  **6/6 states pixel-identical** (60/60 with parity).
- `node agent/verify-browser.mjs` → **34/34** (adds the lane-dropdown selector, non-live
  refusal and eight-lane-document checks).
- `node tools/build-pwa.mjs && node tools/check-pwa.mjs` → **8/8**.

### Compact-codec slice gates (2026-11-14, D45)

- `npm test` → **159 + 10 tests, all pass, 0 fail** (adds compact round-trip/determinism,
  legacy-payload, unknown-field, corrupt/truncated, measured-budget/drop-flag and
  app-vs-agent-agreement tests; the existing share/project assertions are kept).
- `npm run typecheck` → **clean**.
- `node agent/gen-agent-artifacts.mjs --check` → **8 files current** after intentional
  regeneration (toolset 1.3.0, compact `build_deeplink` example, 162-char payload).
- `node agent/selftest.mjs` → **23/23**.
- `npm run build` → **`bitwave-v2.html` 322,222 B (314.7 KB)**, single file, no external
  references.
- `node tools/browser-check.mjs` → **54/54**; the F5 share check now mirrors the compact
  payload (256-bit link **496 characters**, down from the legacy JSON size) and still
  round-trips.
- `node agent/verify-browser.mjs` → **31/31** (the `#bw=` reload check decodes the compact
  payload back to a schema-4 document with expression sources).
- `node tools/build-pwa.mjs && node tools/check-pwa.mjs` → **8/8**.
- Parity: `node tools/browser-check.mjs --compare <HEAD artifact>` → **6/6 states
  pixel-identical** (55/55 checks with `--compare`). One first run flagged the known
  compositing-flaky `3d-focus-z1` state (24 pixels at ≤2 channel levels, the exact
  software-rasterisation jitter the harness comments describe); the retry was clean and
  byte-identical, so the default three-lane instrument is unchanged.

### Schema-4 persistence slice gates (2026-11-14)

- `npm test` → **151 + 10 tests, all pass, 0 fail** (core/state/share/project incl. the
  new migration/gap/cap fixtures, agent registry/state/transports, and the 10 app-bridge
  tests in a separate process).
- `npm run typecheck` → **clean**.
- `node agent/gen-agent-artifacts.mjs --check` → **8 files current** after intentional
  regeneration (manifest/examples carry schema-4 documents and toolset 1.2.0).
- `node agent/selftest.mjs` → **23/23**.
- `npm run build` → **`bitwave-v2.html` 298.4 KB**, single file, no external references.
- `node tools/browser-check.mjs` → **54/54** (F5 groups now assert schema-4 autosave/
  share documents; legacy schema-2 `open project…` still applies).
- `node agent/verify-browser.mjs` → **31/31** (the real `#bw=` reload check now asserts a
  schema-4 payload).
- `node tools/build-pwa.mjs && node tools/check-pwa.mjs` → **8/8**;
  `dist/hosted/` rebuilt and the committed single-file artifact stayed byte-unchanged.
- Parity: `node tools/browser-check.mjs --compare <HEAD artifact>` → **6/6 states
  pixel-identical** (55/55 checks with `--compare`), so the default three-lane instrument
  is unchanged.

- `npm test` → **126 + 7 tests, all pass, 0 fail** (core/state/actions/bindings/share/
  project, expression routing, the agent registry/state/transports, and the 7 app-bridge
  tests in a separate process because they replace the live singletons);
  `npm run typecheck` → **clean**.
- `npm run build` → **`bitwave-v2.html`, 277.1 KB / 283,752 bytes, single file**, no
  external references (`tools/build-artifact.mjs` gate). The default control row now
  intentionally includes Record; pixel parity resumes from this slice's artifact, not the
  pre-agent one.
- `npm run check:browser` → **54/54 checks pass** on the built `bitwave-v2.html` (55 with
  `--shots`/`--compare`), including the F5 persistence groups (schema 4 since D44), the F4
  reflow/keyboard/semantics/axe groups, the §11 geometry assertion and the source-table/
  record controls; the hidden agent node and bridge do not alter the rendered stage.
- `npm run build:pwa` → **`dist/hosted/`** (index 284.3 KB, sw.js 1.6 KB, manifest 0.9 KB,
  4 icons) with a hash cache version; the committed `bitwave-v2.html` was
  **byte-unchanged** (sha256 checked in the build itself); the build also serves `agent/`,
  `AGENTS.md`, `llms.txt` and the agent docs.
- `npm run check:pwa` → **8/8 checks pass**: hosted boot + state surface, manifest + all
  icons, worker registers/activates/controls, hash-versioned cache holds the app shell,
  served agent manifest + example envelope + `llms.txt`, and a reload with the origin
  server **stopped** still boots from cache with zero console errors; the single-file
  artifact contains no manifest/icon/SW references.
- **External routing (schema 3):** temp CDP harness **28/28** (source-table `expr` commit
  → D/Z2 change, invalid text restored/aria-invalid with zero events, bridge
  `setExpression`/`record`/`getLog` lifecycle, no-op silence while armed, axe with the
  editor open, export-log click, legacy bridge intact); `tests/share.test.ts` asserts
  canonical links preserve expression sources (D1 regression); schema-3 project
  round-trip/lenient tests and the app expression→log integration test pass. Agent
  `selftest` 23/23 after the state-shape update; independent verifier now also checks
  `setRoute`/`setSource` (bind Z1→D, self-route `E_BAD_ARGS`, clear to none) → **31/31**.
- **Agent layer:** `node agent/gen-agent-artifacts.mjs --check` → 8 files current;
  `node agent/selftest.mjs` → 23/23; `node agent/verify-browser.mjs` → **31/31 PASS**
  against the rebuilt artifact (expression/record/getLog lifecycle, route/source setters,
  invalid/no-op silence, a real `#bw=` reload twice with autosave cleared proving schema-3
  expression sources survive, legacy surface, agent tab, overflow 360/720/1440, 0 console
  errors). Screenshots: `docs/agent/{default,ab-xor,width-16,agent-tab,record}.png`
  (1440×900, 146–247 KB) visually inspected; `record.png` shows an armed take with an `expr`
  source open. The shared link now preserves expressions (D1 regression fixed).
- `npm run verify` → **exit 0** on the final tree: 126 + 7 tests, typecheck, deterministic
  single-file build (`bitwave-v2.html` 277.1 KB), generated artifacts current, CLI/MCP
  selftest 23/23, independent `agent/verify-browser.mjs` 31/31, existing browser harness
  54/54, hosted build + PWA 8/8. Pre-slice `--compare` is retired as the baseline because
  the Record control is an intentional default-view change; compare against this slice's
  artifact if needed.
- **F4 slice 1 — reflow/zoom (D27):** parity was 6/6 pixel-identical against the pre-F4
  artifact at normal viewports (measured before the IA slice, which intentionally changes the
  layout); at 640×360 and 360×225 CSS px the page scrolls, the stage stays 220 px and every
  control is reachable.
- **F4 slice 2 — keyboard editing (D26):** 16 spinbuttons, one roving tab stop, Tab enters
  from the width slider, ↑/↓/Home/End/0–F edit, focus survives a commit re-render, bit clicks
  focus the nibble, derived strips expose read-only spinbuttons with no tab stop.
- **F4 slice 3 — semantics + a11y gate (D28–D31):** one `<main>` and six named module
  groups; canvas `role="img"` with a live alt; lane and binop sets are radiogroups; one
  polite atomic live region announces committed changes and stays quiet during drag/LFO;
  reduced motion removes transitions and caps the LFO; stage-bar minis and the width slider
  are ≥24 px; axe-core reports zero critical/serious in 2-D, A·B 3-D, source-table and
  frame-navigator states.
- **F4 slice 4 — IA pass (D32):** author-approved `spike/f4-ia.html` (frames left-docked,
  stage bar owns lane+frames+split). Verified: stage bar visible in 2-D and 3-D; six modules
  in order; binops/stepper are reserved-space `aria-disabled` and never removed; copy menu
  focus-in + Esc + copy + spoken confirmation; hex entry right-aligns `DEADBEEF`, refuses
  `ZZZZ`, reverts on Esc, disables on derived; `?` map opens/closes; truth table
  5 rows / 4 column headers / 16 cells; split 3-D shows two panes with the second expression.
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
  because F3 deliberately changes the source-table UI (and F4 deliberately changes the
  shell/layout). It remains the gate for refactor-only changes; the new baseline is the
  committed `bitwave-v2.html`.
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
- `npm run check:browser` → **27/27 checks pass at the time** (now 52/52 — see above)
  on the built `bitwave-v2.html`:
  zero console errors; no overflow or clipped controls at 360/420/720/1440;
  `canvas.width` = viewport; `--pad` 40/16 and compact mode per DESIGN §5/§9;
  strip gap/nibble width follow the §5 formula (1440: gap 12.00, nibble 73.75);
  frames view + per-lane eye toggles; 3-D `Z = A xor B`, truth counts `23/11/9/21`,
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
- **Measured the F4 zoom gap (now resolved, D27):** at 400 % zoom (360×225 CSS px) 26
  controls were clipped and unreachable; at 250 % (560×315) 8; at 320×480 5. The fixed
  `100dvh` + `overflow:hidden` body was the cause.
- Core terminology: no `slots`/`Slot`/A/B/C lane keys in `src/core` except the historical rename note.
- `.bitwave` example regenerated with `"lanes"` and `"1"/"2"/"3"` keys.
- Housing spike (360 lines): six fixed rows; 14 source options per select (1 none + 4 data + 9 frame); destinations fixed; only the changed state cell and status mutate, so focus survives; 32 px targets; palette-only; no add/remove/canvas/SVG/cable/jack markup.

## Key artifacts

| Artifact | Purpose |
|---|---|
| [`src/`](src/index.html) | App source: `index.html` template, `main.js` (~1,000-line composition + controllers), `styles/app.css` |
| [`src/state/instrument.ts`](src/state/instrument.ts) | DOM-free state tree, frame names, factories and selection helpers; transient session fields (`truthOpen`, fold, view) |
| [`src/state/store.ts`](src/state/store.ts) | Transaction boundary: `get`/`patch`/`subscribe`, nested patches collapse |
| [`src/state/actions.ts`](src/state/actions.ts) | Commands: core unary ops/presets, focus/binop/visibility/bit/nibble/hex/copy/unpair |
| [`src/state/bindings.ts`](src/state/bindings.ts) | Six input bindings, data/frame/none sources, driven + parked-base helpers |
| [`src/state/routing.ts`](src/state/routing.ts) | Core `LaneMap` adapter + `evaluate()` running `src/core/routing.ts` |
| [`src/state/project-bridge.ts`](src/state/project-bridge.ts) | App ↔ `.bitwave` schema-4 bridge: lane-key map, capture/apply, expressions, wider-document filtering, unknown-field preservation |
| [`src/state/record.ts`](src/state/record.ts) | Transient DAW-style frame log (bounded ring, `lastLog`, CSV export) |
| [`src/state/dataset.ts`](src/state/dataset.ts) | Dataset state (columns, rows, cursor) shared by the shell and canvas code |
| [`src/render/`](src/render/canvas.js) | Canvas + 3-D field, strip, readouts; the only DOM/canvas renderers (readouts owns the truth disclosure render) |
| [`src/ui/source-table.js`](src/ui/source-table.js) | The six-row matrix panel: data/frame/expr/none source, validated expression editor, B-style labels, state chips |
| [`src/ui/record.js`](src/ui/record.js) | Record toggle/count/export-log UI + store subscription |
| [`src/ui/`](src/ui/frame-navigator.js) | Frames view (stage card grid + focus lens), stage bar (lane/frames/split/per-pane hinge+copy/`Lanes`), copy menu, project menu, keyboard map + map panel, CSV stepper, controls + LFO, committed-change live status |
| [`src/ui/copy-menu.js`](src/ui/copy-menu.js) | Explicit per-pane `copy to…` menu (`open(anchor, sourceLane)`): focus-in, arrow nav, Esc, spoken copy confirmation |
| [`src/ui/project-menu.js`](src/ui/project-menu.js) | `project…` menu: save/open/reset with the same focus contract |
| [`src/ui/help.js`](src/ui/help.js) | `?` keyboard-map panel — the one declared shortcut surface |
| [`src/io/`](src/io/observations.js) | Observation logger/CSV export, `.bitwave` download/read, autosave, URL share |
| [`testcsv.xlsx`](testcsv.xlsx), [`examples/testcsv.csv`](examples/testcsv.csv) | The four-column layout sample; CSV twin for the importer |
| [`vite.config.mjs`](vite.config.mjs) | Vite 8 build: `src/` → `dist/index.html`, no minification |
| [`tools/build-artifact.mjs`](tools/build-artifact.mjs) | Single-file gate: verifies no external refs, writes `bitwave-v2.html` |
| [`src/core/`](src/core/index.ts) | DOM-free engine, lanes 1/2/3, schema-4 project + share codec, exact expression evaluator |
| [`src/core/expression.ts`](src/core/expression.ts) | Deterministic rational register-expression evaluator (no `eval`; float is a boundary format) |
| [`src/core/external-routing.ts`](src/core/external-routing.ts) | Reference clocked pipeline and prototype checks |
| [`src/core/agent-tools.ts`](src/core/agent-tools.ts) | Agent registry, one envelope, closed error set, manifest, canonical deeplink, bridge patch validation |
| [`src/core/agent-state.ts`](src/core/agent-state.ts) | Pure UI-state builder shared by bridge, `#bitwave-state` and CLI `state` |
| [`src/core/agent-share.ts`](src/core/agent-share.ts) | Canonical `#bw=` link builder (no `savedAt`, dataset-drop budget) |
| [`src/agent/bridge.js`](src/agent/bridge.js) | `window.bitwave` install: events, hidden state, setters through the instrument's commands |
| [`src/ui/agent-panel.js`](src/ui/agent-panel.js) | `agent` tab in the `?` help panel: status, copy actions, live state, tool catalogue |
| [`agent/`](agent/cli.mjs) | Zero-dependency CLI + MCP stdio server, selftest, generator, manifest + example envelopes |
| [`docs/AGENT-INTERFACE.md`](docs/AGENT-INTERFACE.md) | Normative agent contract (tools, envelope, deeplink, state, bridge, CLI, MCP) |
| [`docs/AGENT-SCREENSHOTS.md`](docs/AGENT-SCREENSHOTS.md) | Reproducible agent-state screenshots + headless extraction recipes |
| [`docs/BITWAVE-ECOSYSTEM-MAP.md`](docs/BITWAVE-ECOSYSTEM-MAP.md) | Honest cross-tool map (live = none; planned handoffs) |
| [`AGENTS.md`](AGENTS.md), [`llms.txt`](llms.txt) | Agent onboarding + compact machine index |
| [`tests/`](tests/design-invariants.test.ts) | 13 test files: core/state/app, expression routing, plus agent registry, state and transports |
| [`examples/demo.bitwave.json`](examples/demo.bitwave.json) | Versioned project document (lanes 1/2/3; routes + parked bases; dataset) |
| [`spike/routing-matrix.html`](spike/routing-matrix.html) | The reference housing prototype that F3 implements (360 lines) |
| [`spike/f4-ia.html`](spike/f4-ia.html) | The author-approved F4 IA layout mockup (annotated, 1440/720/360 screenshots) |
| [`tools/browser-check.mjs`](tools/browser-check.mjs) | Zero-dependency CDP harness: **61 checks (62 with `--shots` or `--compare`)**, incl. reflow/zoom, keyboard editing, top-bar view control, per-pane hinge/copy, truth disclosure, IA, axe, F5 persistence, the 3-D hinge and readout stability |
| [`tools/build-pwa.mjs`](tools/build-pwa.mjs) | Hosted/PWA build: `dist/hosted/` from the untouched artifact + served agent files; injects manifest/SW registration, writes the hash-versioned worker |
| [`tools/check-pwa.mjs`](tools/check-pwa.mjs) | Zero-dependency PWA gate: local static server + CDP; manifest/icons, worker control, hash cache, served agent files, server-down offline reload, artifact cleanliness (8 checks) |
| [`tools/make-pwa-icons.py`](tools/make-pwa-icons.py) | Reproducible icon set (`assets/pwa/`): 192/512/maskable/32 from the palette, Pillow only |
| [`assets/pwa/`](assets/pwa/icon-512.png) | Committed PWA icons used by the hosted build |
| [`docs/hosting.md`](docs/hosting.md) | Share/deploy/install/offline/privacy guidance for researchers |
| [`tools/make-example-project.ts`](tools/make-example-project.ts) | Regenerates the example |
| `window.BitWave` in [`bitwave-v2.html`](bitwave-v2.html) | Legacy read-only, schema-1 state/geometry/bindings surface; contract in [`AGENTS.md`](AGENTS.md) |
| [`DECISIONS.md`](DECISIONS.md) | D1–D40, including the author decisions, F4–F6 passes, the agent layer (D39) and external routing (D40) |

## Known gaps and blockers

1. ~~**Reflow/zoom clips controls.**~~ **Resolved in F4 (D27):** the page scrolls at zoom, the
   stage keeps a 220 px floor and normal viewports stay pixel-identical; asserted at 200 % and
   400 % in `npm run check:browser`.
2. **Canvas curve sampling is still not pixel-tested.** `BitWave.geometry()` now
   proves the canvas control points and the DOM nibble centres agree (worst
   offset 0.00 px, §11 limit 1.5 px), but the drawn spline's own pixels are not
   sampled; the §11 check asserts geometry, not raster output.
3. **Two controllers still live in `main.js`.** Pointer input (canvas + strip) and the
   remaining lane/view orchestration (`selectSlot`, `split`, `syncViewUi`, boot) are not yet
   `src/ui/` modules; the stage bar and copy menu own their own DOM. They do not block the
   shipped path; the spine, renderers, bindings and UI feature modules are already separate.
4. ~~**Routes are not persisted yet.**~~ **Resolved in F5 (D33):** schema 2 persists the six
   bindings (data columns + frame routes) and parked bases; a saved patch board reloads
   identically, and the app-bridge round-trip test covers it.
5. **Parked-base resize is core-tested but not browser-tested.** The app calls
   `remapParkedBases()` around a resize; the core test covers the mapping, the
   app path is not yet driven by the browser check.
6. **A newer `.bitwave` schema is refused, not opened read-only.** The plan's "open read-only"
   path for a future schema is not built; the UI reports a clear error and leaves the current
   instrument untouched. Low risk while schema 4 is the only format this build writes.
7. **Project save is not browser-asserted end-to-end.** Open/apply/reset, autosave and share
   are driven in Chromium; the `save project` download path is exercised by the unit-tested
   façade but not captured by the harness (no download interception).
8. **Tauri 2 is deferred, by design (D37).** The native shell is only worth paying for if OS
   file associations, native menus or local file watching become real needs; the browser
   file/download/share paths plus the installable PWA cover the current workflow.
9. **Install/update UX is browser-native.** There is no custom install button or service-worker
   update toast: install is the browser's affordance and a new build activates on the next
   visit (hash cache). Acceptable for static hosting; revisit if the hosted deployment gets a
   release process needing forced updates.
10. **`dist/hosted/` is generated, not committed.** `npm run build:pwa` reproduces it
    deterministically from the committed artifact + `assets/pwa/`; deployment pipelines must
    run the build rather than copy a checked-in folder.
11. **Parity jitter is absorbed by the harness, not ignored.** `--compare` uses grayscale
    AA and retries a mismatching state up to three times: Chromium software compositing can
    shift a handful of glyph-edge pixels by 1–2 levels between two runs of the *same*
    artifact (reproduced on 2026-11-08; the 3d-focus-z1 state showed a 21-pixel text-AA
    difference). A persistent difference still fails the gate. This is test-tooling
    robustness, not an app change. Since the external-routing slice adds the Record control,
    pre-slice `--compare` runs are no longer the baseline; compare against this artifact.
12. **Expressions are ordered by the route graph, not by their own references.** In v1 an
    expression reads the current frames of lanes already settled in route-topo order; a
    forward reference to a lane not yet visited sees its previous-transaction value. The
    documented Z1→C / D / Z2→E / F / Z3 pipeline is correct; arbitrary expression-only
    dependency chains need a future dependency pass.
13. **Float input is a boundary format, not a float-valued expression mode.** Float
    coefficients are converted once to exact rationals/declared precision; a full
    float-valued expression mode with its own rounding/precision contract is not shipped.
14. **The 3-D hinge is session-only.** `fold` is not persisted in `.bitwave` or exposed in
    agent state yet; reloading resets each lane to `a-far`. Schema 4 (D44) intentionally
    left it out; persisting it belongs to the dynamic-lanes UI slice (see
    [`docs/DYNAMIC-LANES.md`](docs/DYNAMIC-LANES.md)).
15. **The live app tree still ships three lanes.** Schema 4 can carry up to 8 lanes and the
    core (plus the CLI/`build_deeplink`) handles them, but `src/state` still has the
    default three-lane tree: opening a wider document loads the representable lanes, and
    the frames view `+` remains the cap-note placeholder. The live lane UI and the widened
    agent enums are later D43 slices.

## Errata found

- **DESIGN.md §11 `NOT` vector is wrong.** It listed `NOT FEDCBA9876543210 →
  123456789ABCDEF0`; the actual complement is `0123456789ABCDEF` (confirmed by
  `invert`, by `index.html`, and now by the browser check). DESIGN §11 corrected;
  the test asserts the true value.

## Next actions

The funded roadmap (F0–F6) is complete. What remains is optional polish and the
design backlog in `DESIGN.md` §12 (which is the creative content of the instrument, not
infrastructure):

1. **Teaching/musical backlog (DESIGN §12 "Next"):** arithmetic delta vs bitwise delta
   (the borrow term `2·(¬a ∧ b)`), a BSWAP mirror affordance, two's-complement toggle,
   fold-vs-truncate comparison, endpoint-trend net displacement, and the silent B seed.
   Each is additive and uses the existing spine.
2. **F2 finish (optional):** extract the pointer controller and the remaining lane/view
   orchestration into `src/ui/`, leaving `main.js` as pure composition. No behavioural
   change; run `npm run verify` and a fresh `--compare` baseline.
3. **Small F5/F6 follow-ups:** read-only newer-schema open (gap 6), browser-level save
   download assertion (gap 7), a `copy link` item next to `save project` for discoverability,
   and Tauri only if its trigger conditions appear (D37). **Do not touch the palette**
   (Q8 closed).
4. **Agent layer upkeep:** after any `src/` change, run `npm run verify` (it now includes
   the artifact check, CLI/MCP selftest and the independent `agent/verify-browser.mjs`);
   regenerate `agent/manifest.json` + examples when `src/core/agent-tools.ts` changes.
   Populate `relatedTools` only when a real, tested handoff exists (ecosystem map).
5. **External routing (shipped 2026-11-08, D40):** expressions, Record/log, schema 3, the
   bridge/state surface and `setSource`/`setRoute` are live; the design record is
   [`docs/EXTERNAL-ROUTING.md`](docs/EXTERNAL-ROUTING.md), with the Node reference model at
   `node tools/prototype-external-routing.mjs --check` (27 checks) and
   `tests/external-routing.test.ts`. Follow-ups: expression dependency ordering (gap 12),
   a float-valued mode only if requested (gap 13), and optional log export through the
   observation CSV path.
6. **Dynamic lanes (design only):** [`docs/DYNAMIC-LANES.md`](docs/DYNAMIC-LANES.md)
   recommends an 8-lane first cap (13 is the single-letter naming ceiling) and records the
   share-link budget, `+`/duplicate/delete semantics, schema/agent impact and sequencing.
   The 3-D hinge is shipped as session-only presentation; persist `fold` with the
   dynamic-lanes schema bump (gap 14). The readout jitter fix is shipped (`#trend` fixed
   slot, browser check).
