# Routing I/O — design note

**Status: exploration (author question 2026-11-16; not approved, no shipped change).**
Written after the Multiband-Expressor spike (`spike/multiband-expressor.html`, D47-era UI).
The question: are **lanes** a computation model or a housing model, and does the fixed
`A/B → Z` housing become a constraint once one source wants to feed several operators —
the same question the expressor's sidechain input raises? This note inventories the
current routing model, separates what is essential from what is housing, lays out three
candidate directions with their costs, and proposes a measurement/decision path. It
deliberately makes no code or contract change.

## 0. Short answer

| question | answer (current reading) |
|---|---|
| Is a lane the computation unit? | Yes, in the shipped model: one operator, two operands, one derived output. |
| Is a lane only a computation unit? | No — it also owns global names, frame visibility/focus/expressions/CSV bindings, the frames-view column, the split pane and the source-matrix row group. That fusion is the friction. |
| Is source fan-out possible today? | Yes, from the data flow: one source frame can drive any number of destinations (each destination is a copy). It is not visible as a send, and each copy occupies a frame in a lane. |
| Does the A → B/D/F scenario need a new engine? | Not necessarily. The graph already exists in the `routes` edge list; what is missing is a **send/rack view** and/or **reference operands**. |
| Should the expressor be a separate subsystem? | Probably not. It is the same I/O problem: a processor with two inputs (a target region and an optional sidechain) writing a region. |

## 1. What the current model actually is

### 1.1 Frames, lanes, names

- One shared width `N` (`8/16/32/64/128/256` bits) for every frame.
- A lane key is a stable `"1"`..`"13"` identity; the shipped live set is **1–8**.
- A lane owns two operand frames `A`, `B` and one derived frame `Z = A <op> B`
  (`and/or/xor/add/sub`).
- Global names derive from the lane key: lane 1 `A/B/Z1`, lane 2 `C/D/Z2`, … lane 8
  `O/P/Z8`. The names are lane-scoped, not graph-scoped.
- `Z` is never stored and never a route destination; it is a function of the operands.

### 1.2 Edges

- **Source ports**: `A`, `B`, or `Z` of any live lane (`3L` outputs; `24` at the cap).
- **Destination ports**: `A` or `B` of any live lane (`2L` inputs; `16` at the cap).
- **One route per input** in the shipped model: a second route to the same operand
  replaces the first (the old pre-patch value is parked and restored on unplug).
- A source may already fan out: many routes can name the same source port. Each route
  copies the sampled source into a destination frame.
- **Parked bases**: on first attach, the destination's pre-patch bits are captured and
  restored byte-identically on unplug — the same discipline the LFO uses.
- Route records carry `mix` (`set/add/xor`) in the document and the evaluator has a
  combine path for several values, but the shipped route API/UI enforces one route per
  input (a second replaces the first); any multi-input design must decide how mixing
  composes.

### 1.3 Per-operand sources

Each operand slot resolves one of:

| source kind | what it does | driven? |
|---|---|---|
| `none` | the operand is a freely editable register | no |
| `data` | a dataset column drives the operand | yes |
| `expr` | a deterministic expression over the current frames (`log.<frame>` = previous record row) | yes |
| `frame` | a route from another frame (a copy) | yes |

Precedence/pipeline today: routes and expressions resolve into the operand registers,
then `Z` is computed. Evaluation is **clocked on transaction boundaries**, never per
render frame: `markDelays()` finds back edges on the lane graph and flags them `delay`;
`topoOrder()` orders the acyclic remainder; `evaluateAll()` samples delayed sources
before writing, then resolves dependency order. Cycles are explicit one-tick delays.

### 1.4 The graph is already there — it is just not shown as a graph

`routes` is an edge list; lanes are nodes; frames are registers; dataset/expressions are
source nodes. In the A → B/D/F scenario:

```
lane 1: A, B  -> Z1          (A with its own B)
lane 2: C, D  -> Z2          (C has a route from A, so C is a copy of A)
lane 3: E, F  -> Z3          (E has a route from A, so E is a copy of A)
```

The sends exist (`A→C`, `A→E`) but the UI presents them as lanes with duplicated data,
and the 3-D split can only show two operator instances at a time. The frames view shows
all lanes, but without the wires it reads as "three separate lanes", not "one A with
three operators".

## 2. Essential vs incidental

| concern | essential to BitWave? | current home | notes |
|---|---|---|---|
| one shared width | yes | global `N` | keep |
| `Z = A op B` primitive | yes | lane | keep |
| deterministic clocked evaluation; delays for cycles | yes | routing engine | keep regardless of model |
| graph edges (what feeds what) | yes | routes | keep; model can change |
| fan-out from a source | desirable | routes (copies) | already possible; visibility is the gap |
| multi-input processors (sidechain, band) | desirable | none | needs a read-only second input/port |
| operator instance per output | yes | lane | more outputs ⇒ more operators; this is not the problem |
| fixed three-register housing per operator | incidental | lane | the duplication/column cost lives here |
| lane-scoped naming/identity | incidental | frames/UI/schema/agent | a global-port model would rename |
| lane as frames-view column / split pane | incidental | UI | could become a view/group |
| per-lane LFO/CSV/expression bindings | convenient | lane | can stay per operand/node |
| 2-pane split | deliberate | UI | a performance view, not the whole graph |

The thesis of this note: **the computation primitive is right; the housing is over-fused
with it.** The useful target is to let a source port feed several operator instances
without duplicating its storage or hiding the sends, while keeping the instrument's
default three-lane picture legible.

## 3. Candidate models

### M0 — Rack view only (no data-model change)

Keep lanes exactly as they are. Upgrade the frames view into the signal-flow view:
draw `routes` as wires between frame cards, cluster fan-outs around their source,
allow collapsing a group, and make the wires legible at 3–8 lanes. Optionally show a
band/processor node later.

```
        A ──wire──▶ C (driven copy) ──▶ Z2
        │
        └──wire──▶ E (driven copy) ──▶ Z3
```

- **Solves**: comprehension of the whole procedure on one screen; the A → B/D/F story
  becomes visible at once; no schema/agent/share change.
- **Does not solve**: the duplicated copies still occupy registers and lanes; the operator
  count still grows the column count; the 2-pane split limit remains.
- **Cost**: view-layer only. One spike; browser checks; no migration.
- **Risk**: wires can become a tangle at 8 lanes; needs focus+context/collapse. Low.

### M1 — Reference operands (keep the lane/operator housing)

An operand slot may be a **read-only reference** to a source port instead of a copied
register. Lane 2's `C` slot becomes a reference to `A`; it displays as a send, stores no
bits and has no parked base. The operator instance still exists and still produces `Z2`.

```
lane 2: C ← A (reference)   D   -> Z2 = A op D
lane 3: E ← A (reference)   F   -> Z3 = A op F
```

- **Solves**: no duplicated data; the send is explicit; fewer registers; the source cell
  in the matrix can show `A → C`; writes to a referenced operand are refused exactly as
  driven inputs already are.
- **Does not solve**: operator instances still need housing/columns; the output count is
  still bounded by lanes; split still shows two.
- **Cost**: medium. New source kind (reference) in schema 5, project bridge, share codec,
  agent state/tools, source-matrix UI, tests; evaluation order is the same as routes
  (reference sampled before writes; cycle ⇒ delay). Migration from schema 4.
- **Risk**: the difference between "route/copy" and "reference" must be taught clearly;
  two visually similar edge kinds can confuse. Medium-low.

### M2 — Frames as ports, operators as nodes (graph model)

Frames become global ports; every operator is a node with two input ports and one output
frame; routes are fan-out edges. A lane becomes a **view/rack group** of nodes rather
than the owner of frames.

```
ports:  A   B   D   F   …
nodes:  op1(A,B) -> Z1
        op2(A,D) -> Z4
        op3(A,F) -> Z7
lane views: "rack 1" groups op1; "rack 2" groups op2/op3 sharing A
```

- **Solves**: true sends/fan-out; one source into any number of operators; multi-input
  processors (sidechain) naturally; the 2-pane split becomes a window into the rack.
- **Does not solve cheaply**: naming/identity (lane-scoped names must become graph
  identities), schema/migration, agent contract, share codec, record/export, the whole
  UI. It is a v3-scale change.
- **Cost**: high. New routing engine (topo over operator nodes and read ports), schema 6
  and migration, agent 1.x bump, frames-view redesign, source matrix redesign, test
  surface, docs. Authoring complexity and visual tangle are real risks.
- **Risk**: turns a legible instrument into a modular playground; the teaching clarity is
  exactly the thing the three-lane default buys. High.

### Comparison

| | M0 rack view | M1 references | M2 port graph |
|---|---|---|---|
| Visible sends | yes | yes | yes |
| No duplicated source storage | no | yes | yes |
| Operators independent of fixed housing | no | partial | yes |
| Multi-input processors (sidechain) | not really | needs a new port model | natural |
| Schema/agent/share migration | none | schema 5 | schema 6 |
| Default picture unchanged | yes | yes (with reference cells) | needs a default grouping story |
| Implementation cost | low | medium | high |
| Risk of bloat | low | medium-low | high |

## 4. The expressor through each candidate

The expressor needs: a **target region** (nibble span on an operand), an optional
**sidechain source** read from another frame, a per-nibble transform, and a write-back
into the region. That is a processor with two inputs and a region destination.

- **M0**: a route-attached band processor is enough — a route gains a region and a
  transform, and an optional sidechain source read under the same sampling rules. No new
  node type; the rack view can show the sidechain wire. This is the smallest expressor
  that still has the sidechain feel.
- **M1**: the same route-attached processor works; the sidechain is a second read-only
  port on the processor (not an operand reference). The reference model and the processor
  model are related but not identical; do not conflate them.
- **M2**: the expressor is just another node with ports; sidechain and band I/O fall out
  naturally. This is the cleanest long-term home, but only if M2 is chosen for its own
  reasons.

Convergence worth noting: **the expressor's sidechain and the A→B/D/F question are both
requests for read-only, multi-input ports and visible sends.** Settle the port/send
semantics once; both features then use the same vocabulary.

## 5. I/O semantics to settle before building any of it

1. **Copy vs reference vs send.** Is a route a copy, a reference, or a send? Can the two
   coexist? The current model always copies; M1 adds references; M2 makes sends the
   normal edge.
2. **Input arity and mixing.** One route per input today; a processor needs two (or more)
   inputs. Does `mix` (set/add/xor) compose, or is each input socket single-source with
   an explicit mixer node later?
3. **Ordering and delays.** Sampling delayed sources before writes works for lane nodes;
   with processors and read-only sidechains, the topological order must include every
   read port. A sidechain read of a downstream node is a delay, exactly like a route back
   edge. Define the rule once.
4. **Region writes.** Is a band destination a nibble span on an operand? Can it write `Z`?
   (Today `Z` is never a destination; keep that.) What happens to the parked base of a
   partially-written operand? (Probably park the whole operand, restore the whole operand
   on unplug; the band is a transform of the destination, not a separate register.)
5. **Naming/identity.** If lanes stop owning frames, the global names `A/B/Z1` can no
   longer be derived from lane indices. Any M2 design must choose stable frame IDs and a
   display-name scheme; migration must preserve links and agent frame refs.
6. **Persistence.** Schema 5 for references/bands (M1) or schema 6 for a port graph (M2);
   schema-4 documents still load; the default 3-lane document must round-trip unchanged.
7. **Share link.** The compact codec enumerates lane tuples and route triples; references,
   ports and band records need new slots and a budget check at 8 lanes/256 bits.
8. **Agent surface.** State lanes/operands/routes/sources, `setSource`/`setRoute`,
   selectors and the closed error set all assume the lane model. M1 is additive; M2 is a
   contract rewrite with a toolset bump.
9. **Record/export.** Record already carries `3L` live-lane frames. If outputs become
   graph nodes, the row set is not `3L` any more; decide whether Record follows the
   visible rack or every live frame.
10. **UI.** Sends need a legible representation (wires, grouping, collapse, focus). The
    frames view is the natural rack; the 2-pane split is a performance view, not the
    whole graph. Any animated ducking/sidechain visualization belongs to the render
    layer and must be independent of state evaluation.

## 6. Cost model and what to measure

Separate the costs; they are not the same problem:

- **State evaluation** (per transaction, not per render frame):
  - current: routes + expression sources + one operator per lane + one `Z` per lane.
  - M1: reference reads are extra sampled sources; same order as routes.
  - M2: topological order over operator nodes and read ports; per-nibble processors add
    `lanes × bands × nibbles` evaluations per tick (worst case at the 8-lane/256-bit cap:
    e.g. 8 × 4 × 64 = 2048 nibble evaluations). Expression ASTs should be parsed once and
    cached; measure with a synthetic graph before promising it.
- **Presentation**: wires are cheap to draw; animated sidechain "ducking" is the risk.
  Animate only the visible pane/band(s), no per-band shadows, and decouple from state
  evaluation (render-only interpolation from the last two samples). Measure at 360/720/
  1440 with 8 lanes and a scrolling frames view.
- **Documents/links/agent payloads**: schema-5/6 records, share budget at 8×256, agent
  state and examples. Measure before choosing.

Suggested measurements (all headless, no UI):

| case | measure |
|---|---|
| current 8-lane, 8 routes, expressions | evaluations/tick, ms/tick (baseline) |
| M1 with reference operands | +reads, ms/tick |
| M2 synthetic graph, 8 lanes × 4 processors | topo cost, ms/tick |
| per-nibble expressor, 8 × 4 bands × 64 nibbles | ms/tick, AST-cache benefit |
| render overlay, 8 lanes, 4 band animations | frame budget at 1440/720/360 |
| share link at 8 lanes with references/bands | payload characters vs 2000 |

## 7. Recommendation

Keep the shipped instrument untouched for now. In order:

1. **Write this note** (this document); no code change.
2. **Rack-view spike (M0)** — draw routes as sends in the frames view with fan-out
   grouping. It is cheap and tests whether the pain is primarily comprehension. If the
   A → B/D/F picture becomes clear and three lanes still feel acceptable, stop there.
3. **If duplication still hurts**, specify **M1 reference operands** as schema 5: one new
   source kind, no new routing engine. This is the smallest real model change and it
   directly removes the "A copied into C/E" cost.
4. **Only if multi-input processors and arbitrary fan-out are needed**, specify **M2**.
   The expressor's sidechain is the strongest pressure in that direction; if it is the
   only reason, the route-attached band processor (M0/M1) is enough.
5. The author's visual instinct — the frames view as the rack — is the right first test;
   it is a presentation change, not an instrument rewrite.

## 8. Open questions for the author

1. Is a "lane" meant to be a *column of the instrument* (a fixed group of three frames)
   or a *view grouping* of operator instances? (The note assumes the former is shipped
   today; the question is what should stay true.)
2. For A → B/D/F, is the pain **seeing** the sends, or **not wanting to pay** for the
   copies (registers/lanes)? That decides M0 vs M1.
3. Should an operator output always occupy a named frame, or can an output feed a
   processor directly without becoming a frame? (M2 decides this.)
4. Does the expressor need a sidechain as a first-class input, or is a route-attached
   band with an optional read port enough for the next version?
5. Are 8 operator instances/outputs the intended ceiling, or should the rack be a graph
   whose size is bounded by legibility rather than lane count?
6. Would you accept lane-scoped frame names changing if the model becomes a graph, or are
   `A/B/Z1` names part of the instrument's identity?

## 9. Non-goals

- No audio-product emulation (no frequency-domain or dynamics terminology).
- No UI or engine change in this note.
- No removal of the lane default; any model change must keep a legible three-lane default.
- No unbounded node graph without a visual grouping story.
- The expressor remains a spike until its I/O model is approved.

## 10. Related artifacts

- `spike/multiband-expressor.html` — one nibble-snapped band, per-band expression/amount,
  snapshot apply/revert; the current expressor probe.
- `docs/DYNAMIC-LANES.md` — the lane set, naming and cap precedent (D43–D46).
- `docs/EXTERNAL-ROUTING.md` — expressions, Record and the per-operand source model.
- `DECISIONS.md` D33–D47 — persistence, routes, source kinds, lane set, re-homing.
