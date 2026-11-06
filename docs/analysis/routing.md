# Patch Bay: routing one frame into another

**Status:** design analysis + implementation plan. **Source read:** `index.html` (2832 lines; line refs are read-tool). **Constraints:** `DESIGN.md` §2–§3 (two hues), §8, §10, §11.

*Let one view's frame drive another view's operand.* Each view slot is already a three-frame device — operand `A`, derived `Z = A op B`, operand `B` (`makeSlot` `index.html:735-747`) — a small DSP graph with one computed node per slot. Only the edges are missing.

## 1. Ground truth

### 1.1 One state tree, one width

All state hangs off `S` (`index.html:749-779`): one width `S.N = 64` (`:750`), slots `A/B/C` (`:751-755`; default ops `xor`, `xor`, `and`), focus `S.slot` (`:756`), plus view/LFO/drag state. Focus is exposed as getters (`:768-778`), so most code reads "the focused slot" implicitly (`curSlot:781`).

A register is `{ bits, anim, target }` (`makeReg` `:726-733`): `bits` is truth, `anim` the eased paint value. `nibAt`/`setNibAt` read global `S.N` (`:795-806`), which is why `resizeRegister` remaps every slot first (`:861-903`; `DESIGN.md:378-379`). One shared width is a gift: all nine outputs are exactly `N` bits, so a cable is a bit-array copy with no scaling or sign extension.

### 1.2 Z is a pure function of its slot, focused by default

`recomputeZ(instant, sl = curSlot())` (`:841-856`) reads `sl.A.bits`, `sl.B.bits`, `sl.binop`, writes `sl.Z.bits`. Four of eleven call sites use the focused default (`:1598, :1660, :1722, :2052`); the rest pass a slot. Resize resets Z (`:899-902`): it is truly derived.

### 1.3 Every mutation is its own transaction

- **Manual:** drag `:1634-1664`, bit click `:1713-1725`, preset `:1900-1906`, unary ops `:1976-1983`.
- **CSV:** `applyExample:2510-2539`, mapped columns per slot (`:2517-2533`).
- **LFO:** `:1767-1804`, `:1822-1865` — `A` (and `B` if `showB`), all slots, stepped, snapshot/restore.
- **Structural:** `resizeRegister:861-911`, `copySlotInto:2200-2218`, `boot:2790-2828`.

The LFO is the model to copy: real register mutations keep every readout truthful (`DESIGN.md:277-284`), snapshot/restore on stop (`:402-405`), yielding to manual edits (`:406-407`), clamped tick catch-up (`index.html:2760-2775`).

### 1.4 What routing collides with

1. **Focus-coupled evaluation.** `commit()` recomputes only the focused slot (`:1595-1601`); `draw`, `renderTruth`, `updateReadouts` and the logger read `S.A/S.B/S.Z` (`:1318-1347, :1543-1545, :1570-1576, :2554-2560`). A route elsewhere goes stale silently — the failure `DESIGN.md:375-377` prevents.
2. **LFO snapshot is bit-level** (`:1770-1775`; restore `:1786-1799`): routes mutating `A.bits` would be snapshotted as user data, breaking `DESIGN.md:402-405`.
3. **CSV writes operands directly** (`:2517-2533`; auto-assigned columns `:2635-2680`); routes must run after.
4. **Resize remaps every slot before `S.N` changes** (`:881-903`); parked pre-patch values need the same remap.
5. **`copySlotInto` copies bits, not graph** (`:2200-2218`).
6. **The 3-D field is read-only** (`DESIGN.md:383-385`; returns at `:1377`, pointerdown ignores 3-D at `:1667-1673`): no cable-dragging in the box without a design amendment.
7. **Z must never become editable** (`DESIGN.md:372-374`): routing into Z is forbidden (§3.1).
8. **Truth invariants must survive**: counts sum to `N`, `popcount(Z) = Σ n` over output-1 rows (`:1542-1556`, `DESIGN.md:169-177`).
9. **Animation is not truth.** `Z` is eased only when `showB` (`:2777-2781`); hidden slots' `Z.anim` can be stale. Routes read `bits`.

## 2. Candidate models

| Model | Semantics | Strength | Cost / risk | Verdict |
|---|---|---|---|---|
| **(i) Patch cords** | Ports `{slot, reg}`; source A/B/Z → dest A/B | Audio mental model; 9 outputs; topo-resolvable | Port UI; fan-in ambiguity | **Ship** |
| **(ii) Within-slot feedback Z→A** | Z re-enters an operand one evaluation later | Pedagogical jackpot | Needs an explicit delay rule | **Ship, delayed** |
| **(iii) Routing matrix** | Rows sources × cols destinations | Dense; table-accessible | 54 focus stops; no per-cell mix/delay | Defer |
| **(iv) Named buses** | Named sends/subscribes | Scales past ~10 modules | Mapping layer, no payoff at 3 slots | Reject for now |
| **(v) Linear chain** | View order = processing order | Zero UI | Display order changes arithmetic (`DESIGN.md:325-332`) | Reject |
| **(vi) General DAG** | Arbitrary port graph | Maximum power | (i)'s costs plus cycle UI | Restricted DAG: (i)+(ii) |

**Decisions.** Sources: `A`/`B`/`Z` × 3 slots (nine outputs), `Z` first-class. Destinations: `A`/`B` (six inputs), never `Z`. Fan-out unlimited. Fan-in v1: **one cable per input**; a second replaces the first, as Blender's single-link sockets do ([Blender manual](https://docs.blender.org/manual/en/latest/interface/controls/nodes/editing.html)) — last-write-wins and priority-replace depend on invisible ordering. v1.1: per-destination `mix` of `set | add (mod 2^N) | xor`; summing is what MSP does at one inlet ([Cycling '74](https://cycling74.com/forums/msp-do-you-need-to-use-for-combining-signals)), and `add mod 2^N` is its bit analogue. Same-slot v1: only `Z→A/B`, always delayed.

## 3. Semantics

### 3.1 Authority, parking, and the Z rule

A patched input is **driven**. Its pre-patch value is parked when the first cable attaches and restored byte-identically when the last is removed — the LFO promise reused (`DESIGN.md:402-405`). While driven, base writes are inert: drag, bit click, preset, unary op, B-seed, CSV, LFO sweep all skip it (§5.2). The strip label (`:258-268`, `:1470`) names the driver (`A◂C.Z`); edit affordances are disabled, not silently ignored.

**Routing into Z is forbidden.** `recomputeZ` owns `Z.bits` at eleven sites and resize zeroes it (`:899-902`); an external write would survive one transaction and vanish with no error — a stale-Z bug in the shape `DESIGN.md:375-377` prevents. A `Z` that accepts input is no longer a result; the truth-table invariant collapses (`DESIGN.md:372-374`, `:169-177`). It also has no parked base.

### 3.2 Evaluation order

One entry point, `evaluateAll()`: writers finish base writes; `applyRoutes()` resolves; `syncTarget`+`recomputeZ` run for **all** slots; then render. Evaluation runs only on transaction boundaries (edit, CSV step, LFO tick, route change, resize) — never per frame — so feedback advances one iteration per tick and nothing animates uncaused (`DESIGN.md:41-42`). The graph sorts at **slot** granularity (three nodes): each edge source is a port on a slot and `Z` follows from that slot's A/B, so reading sources after their slot resolves makes a chain one pass. Focus never participates; clicking A/B/C must change no numbers.

### 3.3 Cycles and the implicit unit delay

Two cycle shapes exist: a self-loop (`X.Z → X.A/B`) and a cross-slot cycle (A→B→A). `markDelays()` DFSes the ≤3-node slot graph on route change; back-edges get `delay:true`, deterministically in insertion order. A delay needs **no stored state**: `applyRoutes` snapshots delayed source values *before* writing, then writes them — the snapshot is the previous evaluation's result, and it survives resize and unroute.

The delay is mandatory: with `A = A xor B` a zero-delay cycle has no fixed point unless `B = 0`, so the tool must hang or show a number that is not a function of its inputs. It is the register-level analogue of the delay line every digital feedback patch needs; stepping per transaction is a feature for teaching.

### 3.4 Precedence

| Event | Base writes first | Then |
|---|---|---|
| Manual edit | user's port, if not driven | `evaluateAll()` |
| CSV step | mapped columns for non-driven ports | `evaluateAll()` |
| LFO tick | sweep non-driven ports, all slots | `evaluateAll()` then render |
| Route add/remove | park / restore destination | `markDelays` → `evaluateAll` → dock render |
| Resize | `lfoStop`; remap A/B **and parked bases**; set `S.N` | recompute + `evaluateAll` |
| Copy slot | copy *base* registers via `baseOf`; routes untouched | `evaluateAll` |
| Slot focus | none | UI render only |

Two invariants: routes never run before a base write, and focus never changes evaluation order. Routes therefore apply **after** CSV writes and **after** LFO ticks, before any Z recompute, truth render or observation log.

### 3.5 Persistence and side effects

- **Resize:** routes are keyed by slot/port, so they persist; remap parked bases with the existing centre-pinning `remap` (`:868-879`) before `S.N` changes. Unpatch-after-resize must equal resize-without-cable.
- **Copy:** routes belong to the rack, not the slot; copy reads `baseOf(slot, reg)` (parked if driven, live otherwise) and reports skipped driven ports.
- **CSV:** a driven destination ignores its column but keeps the mapping, so unpatching restores column behaviour; `loadCSV` auto-assignment (`:2635-2680`) is untouched.
- **LFO:** sweeps skip driven ports; `lfoStop` restores, `evaluateAll` re-applies cables, Z eases to truth.
- **Truth table:** unchanged; it reads effective `S.A/S.B` (`:1542-1545`), so it reports the patched algebra.
- **Observation logger:** logs effective values (`:2552-2588`) plus `routes` (`C.Z>A.A;A.Z>B.A`) and `delayed`. Add both in one release: the export header derives from `Object.keys(observations[0])` (`:2596`), so a mid-session shape change yields mismatched rows.

### 3.6 Worked example

Boot values are deterministic (`:2790-2805`; computed from the table formulas `:1886-1898`, cross-checked against `DESIGN.md:431-433`):

| Step | Action | A.A | A.Z | B.A |
|---|---|---|---|---|
| 0 | boot | `8ADEFEDA85210125` | `7521012585210125` | `FEDA852101257ADE` |
| 1 | `C.Z → A.A` | `0002444281210125` | `FFFDBBBD81210125` | unchanged |
| 2 | `A.Z → B.A` | `0002444281210125` | `FFFDBBBD81210125` | `FFFDBBBD81210125` |

`C.Z = C.A AND C.B = 0123456789ABCDEF AND 8ADEFEDA85210125 = 0002444281210125` (pop 13). After step 1 A's truth counts are `24, 27, 8, 5` (sum 64) and `popcount(A.Z) = 27+8 = 35`; step 2 shows order in one pass (`B.Z = FDBB31736D896505` after B's XOR against triangle `02468ACEECA86420`). Unpatching returns A to exactly step 0. Feedback test: route `A.Z → A.A` with `A.B = FFFFFFFF00000000`; one evaluation swaps `A.A`/`A.Z`, two are the identity — a two-state oscillator, definable only with the delay.

### 3.7 Verification to add to DESIGN §11

1. Boot as above; `C.Z = 0002444281210125` (pop 13).
2. Add `C.Z→A.A`: `A.A = 0002444281210125`, `A.Z = FFFDBBBD81210125`, pop 35, truth `24/27/8/5`.
3. Add `A.Z→B.A`: `B.A = FFFDBBBD81210125`, `B.Z = FDBB31736D896505`.
4. Remove both: A and B byte-identical to boot.
5. Slot A→B→C→A: no register changes.
6. `A.Z→A.A`, evaluate twice: identity.
7. Resize 64→256 with a cable: cable persists, driven value tracks the new-width source; unpatch equals the no-cable resize.
8. Zero console errors, zero overflow at 420px, no third hue in a pixel histogram.

## 4. UI inside the design system

### 4.1 Where it lives

Name it **patch**, not route: CSV columns are already "routed" to slots (`:2635-2680`) and stage labels say so (`:2131-2138`). Placement: a `patch` group beside `view` (`:649-662`) with one toggle, plus a **dock band** as a sixth grid row between `.meta` and `.controls` (`body` rows `:43-46`; insert after `:602`). Hidden by default; when open it takes height from the stage (`minmax(0,1fr)`), never overflows. DOM, not canvas: it must be focusable.

### 4.2 Visual grammar

`--accent` means data; cables carry data, so they are accent. Structure keeps the achromatic chrome it uses everywhere (`--panel`, `--line`, `--dim`). `--inf` stays reserved for the ∞ marker, zero-crossing and MRB underlines (`DESIGN.md:38-40`, `:72-82`): routing does not get to spend the warmth. No third hue, no new `:root` token.

| Element | Token | Weight / alpha |
|---|---|---|
| Cable | `--accent` | 1.25px, α0.55 (curves use 1.3–2.5px accent, `:1331-1343`) |
| Cable selected | `--accent` | 1.8px, α0.95 (weight, not hue, `DESIGN.md:272-274`) |
| Cable delayed | `--accent` + mono `z⁻¹` label in `--dim` | 1.25px; a label, not a second dash language (B owns dash) |
| Jack, output | `--line-hi` ring, `--dimmer` core | r2.5 canvas / 7px DOM (handles r2.5–4.4, `:1359`) |
| Jack, driven input | `--accent` ring | α0.85 (`button.op.on`, `:496-501`) |
| Dock row selected | `--panel-hover` + accent border | mirrors `button.op.on` |
| Invalid choice | option absent from the select | no red, no third hue |

Direction: a 4px chevron at the destination plus a mono 10.5px `C.Z → A.A` caption. Motion: one 220ms opacity fade on appearance, matching the hint fade (`:159-171`); no travelling pulses.

### 4.3 In the 3-D field

The field renders one slot's three plates — A at 1, Z at 128, B at 256 (`drawField3d:1086-1178`; labels `:1175-1177`). **Single view** draws only that slot's cables: `Z→A/B` arcs from the Z plate's right-edge jack to the A/B plate's left-edge jack, outside the box; a cross-slot source not in frame becomes a caption at the jack (`⇠ C.Z`), never invented geometry. **Split view** (`:1273-1306`) puts a slot per pane, so cross-slot cables draw in a final pass across the 1px divider (`:1301-1306`), only when both ends are visible. Cables draw after the plates, thin; they never alter plate alpha or the middle plane — `DESIGN.md:391-394` forbids highlighting frame 128. Jacks and cables are indicators only: no hit-testing, no dragging (`DESIGN.md:383-385`).

### 4.4 Accessibility is a requirement

The canvas is not focusable and exposes nothing to a screen reader, so the **dock list is the canonical representation** and every action must work without a pointer: two labelled `<select>`s (nine outputs, six inputs; Z destinations absent) plus `add cable`; a real `<table>` of `source → destination` with a per-row remove button labelled "Remove cable C.Z to A.A"; a per-row mix `<select>` when fan-in ships; an `aria-live="polite"` announcement ("Cable added: C.Z → A.A, one tick delay"); `Alt+P` to toggle, joining existing shortcuts (`:2719-2730`) without colliding with the arrow-key stepper guard (`:2726-2729`). Driven ports disable their edit controls with `aria-disabled` and a visible reason.

### 4.5 720px

Dock rows stack: selects on one line, remove after; `--pad` is already 16px there (`fitCanvas:1008`, media block `:551-563`). The toggle joins the wrapping controls row. Cables still draw; captions drop because the dock carries the text.

## 5. Implementation plan

### 5.1 State shape

```js
// inside S (:749-779)
routes: [],  // [{id, from:{slot:"C",reg:"z"}, to:{slot:"A",reg:"a"}, delay:false, mix:"set"}]
routePark: Object.create(null),  // "A.a" -> Uint8Array parked pre-patch base
```

Sources allow `"a"|"b"|"z"`, destinations `"a"|"b"`. No other persistent state: delay is derived at evaluation time.

### 5.2 Functions to add or change

| Function | Change | Current lines |
|---|---|---|
| `portKey`, `readPort`, `writePort`, `isPatched`, `baseOf`, `parkDest`, `restoreDest` | new helpers with explicit `sl` | near `:791` |
| `markDelays` | new DFS; sets `delay` on back-edges | new |
| `applyRoutes` | snapshot delayed → topo order → write + `syncTarget` | new |
| `evaluateAll` | syncTarget A/B → applyRoutes → recompute all slots | new; wraps `:1595-1601` |
| `commit` | call `evaluateAll` instead of focused-only | `:1595-1601` |
| `lfoTick`, `lfoStart`, `lfoStop` | skip driven ports; `evaluateAll` after restore | `:1767-1804`, `:1847-1864` |
| `applyExample` | skip driven ports; `evaluateAll` before render | `:2517-2538` |
| `resizeRegister` | remap `routePark`; re-evaluate | `:861-911` |
| `copySlotInto` | copy `baseOf`; routes untouched | `:2200-2218` |
| drag, bit click, `applyTable`, `OPS`, `toggleB`, `enableBOnSlot` | driven-port guards | `:1634-1664, :1713-1725, :1900-1906, :1976-1983, :2016-2034, :2179-2193` |
| `drawField3d` | jacks + cable pass | `:1086-1178` |
| `renderStrip`/`syncEditUi` | driver marker in `data-edit`; disable edits | `:1435-1472, :2000-2014` |
| dock render + handlers | new DOM band, table, `aria-live` | new (HTML near `:602`, CSS near `:405`) |
| observation log/export | add `routes`, `delayed` | `:2552-2606` |
| `boot` | `evaluateAll` after seeding | `:2807-2812` |

### 5.3 Delivery order

| Phase | Scope | Net LOC | Acceptance check | MVP |
|---|---|---|---|---|
| 1. Model + evaluator | state, port helpers, `markDelays`, `applyRoutes`, `evaluateAll`, rewire commit/resize/copy/boot | ~150 added, ~30 changed | §3.7 steps 1–3, 5–7 from the console; zero exceptions | yes |
| 2. Guards + transactions | LFO, CSV, drag/preset/op/seed guards, parked remap, copy | ~70 changed | route+LFO, route+CSV, resize round-trip, unroute byte-identical | yes |
| 3. Dock + a11y | band, table editor, capture/restore, `Alt+P`, strip marker, disabled states | ~190 (≈40 HTML/CSS, 150 JS) | keyboard-only add/remove; announcements; no overflow at 420px; tokens only | yes |
| 4. Canvas | plate jacks, single-view arcs, split cross-pane cables, captions | ~90 | accent-only cables; frame-128 alpha unchanged; no hit-testing; no errors | no |

### 5.4 MVP cut and where it hurts

Cut for v1: canvas cables (phase 4), fan-in/mix, same-slot non-feedback routes, route presets, URL state. Keep: cross-slot and delayed within-slot `Z→A/B`, dock editor, driven markers, guards, resize/copy semantics. Phases 1–3 are a complete, testable, accessible feature; phase 4 is delight.

Where it helps: one `S.N` (`:750`) makes ports width-identical; one register shape (`:726-733`) makes a cable one `Uint8Array` copy; the LFO park/restore precedent (`DESIGN.md:402-405`) means "never destroy my data" needs no invention; three slots make topo sort trivial.

Where it hurts: `recomputeZ`'s default `sl = curSlot()` (`:841`) and the `S.A/S.B` getters (`:768-778`) make focus implicit; `commit` handles only the focused slot (`:1595-1601`); the drag path writes `anim` and `S.Z.anim` directly (`:1657-1661`), which must keep working for non-driven ports.

**Smallest de-risking refactor:** add `evaluateAll()` as the single evaluation entry point, route every existing `recomputeZ` call through it, and make `commit` loop `SLOT_KEYS` as `boot` already does (`:2807-2812`). ~30 changed lines, no new concepts. Do it in phase 1 before any UI. Do not refactor the getters — they stay the "focused view" API.

## 6. Recommendation

Ship **cross-slot patch cords plus delayed within-slot feedback**: nine outputs, six inputs, one cable per input, slot-level topological evaluation, cycles broken by an implicit one-evaluation delay, authored in a DOM dock, drawn read-only in the field. It covers the author's ask with the smallest state, reuses the LFO's park/restore contract, keeps Z derived, and fits the two-hue system without a new token.

**Top three risks.** (1) *Two writers, one register:* routes, LFO, CSV, drag, presets and boot all write operands; without one evaluation entry point and hard guards a driven port will intermittently show a stale value. (2) *Invisible delay reads as a bug:* label every `z⁻¹` cable, announce it in the dock, keep the two-state oscillator test in §11. (3) *Design drift:* routing tempts a third hue, a floating overlay, or draggable 3-D jacks — each breaks `DESIGN.md` §3 or §10.12; dock-only authoring and a §2–§3 review before merge contain it.
