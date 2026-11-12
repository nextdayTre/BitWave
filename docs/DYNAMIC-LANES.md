# Dynamic lanes — design note

**Status: design only. No lane-count or schema change is proposed for immediate build.**

The author asked how many lanes the instrument could support, and whether the FRAMES
panel should grow a `+` for new lanes. The answer depends on which ceiling is meant: the
mathematical engine has no meaningful limit; the current **frame-name grammar**, the
1-to-2 KB **share link** and the fixed three-lane UI are the real constraints.

This note records the options, the recommended cap, and the work a dynamic-lane pass
would touch. It is deliberately separate from the 3-D hinge presentation change, which
lands first and does not force a schema decision.

## 1. Short answer

| question | answer |
|---|---|
| Hard ceiling with today's single-letter operand names | **13 lanes** — 26 operands `A`–`Z`, two per lane, plus `Z1`–`Z13` |
| Recommended first shipped cap | **8 lanes** — operands `A`–`P`, derived `Z1`–`Z8` |
| Compute/performance ceiling | effectively none at this UI scale; routing/register cost is linear, expressions roughly quadratic in lane count but tiny |
| Real engineering ceiling | **share-link budget**, then frame naming, then schema/agent/UI surface |
| Can split view show them all? | No: split is exactly two panes. Extra lanes are browsed, not displayed simultaneously. |

## 2. Why 13 with today's naming

Each lane owns two operand frames. The current convention uses the letters `A`–`F` and
derived names `Z1`–`Z3`:

| lane | operands | derived |
|---|---|---|
| 1 | A, B | Z1 |
| 2 | C, D | Z2 |
| 3 | E, F | Z3 |
| 4 | G, H | Z4 |
| … | … | … |
| 13 | Y, Z | Z13 |

26 single-letter operands ÷ 2 = **13 lanes**. Beyond that, operand names must become
two-letter or qualified (`AA/AB`, `L14A/L14B`, `L14.A`). That is a grammar change, not
just a loop bound.

The name table is currently fixed in several places:

- `src/core/types.ts`: `LaneKey = "1" | "2" | "3"`, `LANE_KEYS`, `LaneMap`;
- `src/core/agent-defaults.ts`: `FRAME_NAMES`, `SLOT_OF_LANE`, `FRAME_BY_NAME`;
- `src/core/expression.ts`: evaluator name whitelist `A`–`F`, `Z1`–`Z3`, `N`;
- `src/state/instrument.ts`: `SLOT_KEYS = A/B/C`, `FRAME_NAMES`, LFO bases;
- project schema, agent state/manifest, source table, frame navigator, stage bar,
  split pair, `Alt+1/2/3`, browser selectors.

## 3. Why compute is not the limit

At 256 bits a lane is three registers of 32 bytes. Everything is trivial compared with
the DOM:

- **Routing:** a DAG with at most `2L` destinations; topo-order evaluation and delay
  sampling are linear in edges. 13 lanes is still a tiny graph.
- **LFO:** one clock; per-lane bases; cost linear in `L`. The LFO is not per-lane
  scheduled, so many lanes do not multiply timers.
- **Expressions:** the app currently builds a full frame map for each expression, so the
  work is roughly `O(L²)` BigInt conversions per update. At `L=13` that is ~1k
  conversions at 4 Hz — invisible. At `L=100` it would be worth caching the frame map;
  not relevant for a shipped cap.
- **Canvas:** only the focused lane, or two panes in split 3-D, are ever drawn. Adding
  lanes does not add canvas work until you choose to view them.
- **Frame log:** `3L` frames per row. At 256 bits that is ~192 bytes of hex per lane per
  row; the 2048-row cap is roughly 0.39 MB per lane (plus JS string/object overhead).
  8 lanes ≈ 3 MB transient, 13 ≈ 5 MB. Fine in memory, but it argues for lowering the
  row cap or compressing rows as `L` grows.

The surfaces that grow with `L` are JSON, DOM rows, lane buttons and the share link.

## 4. The share link is the first real gate

The canonical `#bw=` link has a ~2000-character design budget. Three lanes already use a
meaningful fraction of it at 256 bits, especially with expressions; the builder drops the
dataset before giving up.

At 8 or 13 lanes the document itself will likely exceed 2 KB even with no dataset. Before
promising a large cap, choose one:

1. **Compact lane encoding.** Store lanes as a tuple array rather than keyed objects with
   repeated field names; omit defaults; use route triples. This can buy a lot but is a
   second codec to keep canonical.
2. **Raise the budget.** Modern browsers tolerate much longer fragments (tens of KB), but
   chat clients, terminals and the current "portable link" promise do not. This is a UX
   decision, not a technical one.
3. **Share a subset.** Link only the active/top N lanes, or link state without
   expressions/routes, with an explicit "truncated share" warning. Weakest option for
   reproducibility.
4. **Hybrid.** Compact encoding + budget raise, with a documented character count in the
   UI. This is probably the long-term answer if lanes go past 8.

**Recommendation:** cap the first dynamic build at 8 and keep the 2 KB promise while a
compact encoding is designed; do not ship 13 lanes with a link that silently truncates.

## 5. UI shape

### FRAMES panel

- Add `+` to the panel header. It opens a small menu, not an immediate action:
  - **New blank lane** — empty operands, XOR, current width, no routes/expressions;
  - **Duplicate focused lane** — register values, operator, visibility, expressions,
    fold orientation; routing/bindings policy needs a decision (below).
- Lane list becomes scrollable and virtualised only if it ever exceeds a few dozen; 8–13
  rows do not need virtualization.
- Each lane header can carry a small menu (`…`) for duplicate/delete/rename? Keep rename
  out of v1 (renaming frames breaks references); delete with confirmation when the lane is
  referenced.
- `+` disables at the cap with a title such as "8 lanes is this build's maximum".

### Stage bar and split

- Lane buttons become a wrapping/scrolling group. With 8 lanes they fit in a normal row;
  with 13 they need overflow affordance.
- Split stays exactly **two panes**. `splitPair` remains two lane IDs; creating/focusing a
  third lane must not silently replace a pane without the user seeing it.
- Keyboard: extend `Alt+1…8`; decide the 10+ scheme before going past 9. Keep one
  declared shortcut surface (DESIGN §8).

### Source table and expressions

- The six-row source table becomes `2L` rows, grouped by lane, scrollable. At 8 lanes it
  is 16 rows; at 13 it is 26.
- The expression editor becomes per-frame names `A…P`/`Z1…Z8`; `log.<frame>` grows
  accordingly. The evaluator currently couples its whitelist to the fixed six operands, so
  this is a core change.
- The expression dependency limitation (route-topo order) remains; dynamic lanes make a
  proper dependency pass more valuable.

### Copy vs duplicate

`copy to…` currently overwrites another *existing* lane. A dynamic build needs two
distinct actions:

- **copy into lane…** — existing behavior; destructive, explicit destination;
- **duplicate as new lane** — create the next lane and seed it; then focus it.

The author's suggestion to rename/relocate `copy to…` is sound: move lane-management
actions into the FRAMES panel header (`+` menu and lane row menu) and keep the stage bar
focused on view/selection. `copy to…` can become a menu item in that surface rather than a
permanent view-group button.

## 6. Creation, deletion and identity

Lanes need stable IDs independent of display order:

- **Creation:** allocate the next free frame-name pair (`A/B`, `C/D`, …). Never renumber
  existing lanes; frame names are the routing/expression identity.
- **Deletion:** remove the lane, clear its incoming/outgoing routes and parked bases,
  remove its expressions, and drop references from the project. The transient record log
  may keep old rows (they are names, not live references), but export/document should note
  them. Warn before deleting a lane whose frames are referenced.
- **No rename in v1:** a rename would rewrite routing ports, expressions, `log.<frame>`,
  share links and agent state. A future rename must be a transaction with validation.
- **Duplicate routing:** duplicating a lane with incoming routes would create a second
  driver for the same source; duplicating outgoing routes would silently multiply fan-out.
  Recommended v1: duplicate values/operator/visibility/expressions **but not route edges**;
  offer `copy bindings` as an explicit second checkbox later.

## 7. Schema and agent surface

Once lanes are dynamic, `.bitwave` cannot keep a closed three-key `lanes` object as the
only shape. A future schema should:

- store a lane-ID list plus per-lane records, or an ordered array with stable IDs;
- store `fold` (the hinge flag) and any other view state at lane level;
- migrate schema 1–3 documents to the new lane array;
- keep unknown fields.

Agent impact:

- `lane` enum and stage-bar selectors become dynamic;
- `lanes` keys/array and `FRAME_NAMES` become runtime data;
- `window.bitwave` lane setter and `data-agent-lane` selectors need a documented range;
- manifest enums, CLI state, MCP tool args and the verifier all need the new max;
- toolset version bumps; state `schemaVersion` likely bumps if the lanes shape is no
  longer an object keyed by `"1"|"2"|"3"`.

This is broader than the UI plus button; it is a state-model pass.

## 8. Recommended sequence

1. **Hinge presentation** (shipped separately): per-lane A/B depth fold, visual only,
   session state; no schema commitment.
2. **Dynamic-lanes spike**: generalize the core lane/frame name table and routing to a
   supplied lane list (still 8 max in the app), behind a dev flag or temporary build.
3. **Share budget decision + compact encoding**: prove an 8-lane, 256-bit document fits a
   portable link, or explicitly raise the budget.
4. **UI**: `+` menu, dynamic FRAMES list, source table grouping, stage-bar overflow,
   duplicate/delete, keyboard.
5. **Schema/agent migration**: one deliberate schema bump carrying dynamic lanes and the
   hinge fold; update manifest/contract/verifier/screenshots.
6. **Only then** consider 13 or beyond; two-letter/numeric frame names are a separate
   grammar version.

## 9. Open decisions

1. First shipped cap: **8 (recommended)** or 13?
2. Share links: compact encoding, higher budget, or a documented subset?
3. Duplicate lane: copy routes/bindings or only local values/operator/expressions?
4. Dynamic lane state: ordered array vs keyed object with stable IDs?
5. Hinge persistence: lane-level `fold` in the same schema bump (recommended) or a
   separate view preference?
6. Keyboard for lanes 10+: `Alt+0`, next page, or digits only up to 9?
7. Is the frame-name grammar allowed to grow to two-letter names, or is 13 the permanent
   ceiling?

## 10. Relationship to the hinge

The hinge has landed as a **session-only presentation flag** on each lane (`a-far` /
`b-far`): it changes which operand plate is far or near in the 3-D field, never the
computation, and it does not touch `.bitwave`, the agent contract or the source routing.
That kept the quick visual win cheap. When dynamic lanes take their schema bump, `fold`
should be persisted alongside the lane record rather than retrofitted later.
