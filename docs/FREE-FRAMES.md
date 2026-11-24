# Free Frames — design note & specification

**Status: approved (author decisions 2026-11-22, D52).**
Companion to [`ROUTING-IO-MODEL.md`](ROUTING-IO-MODEL.md),
[`DYNAMIC-LANES.md`](DYNAMIC-LANES.md), [`DATASET-LIFECYCLE.md`](DATASET-LIFECYCLE.md)
and [`CONSTRAINTS.md`](CONSTRAINTS.md).

Lanes (`A <op> B → Z`) remain BitWave's default instrument and its binary-operator
primitive, but they should not be the *only* container that can hold a register.
**Free Frames** (`F1`, `F2`, …, `F16`) decouple standalone registers from the
three-register lane housing so a user or agent can build linear chains (e.g. a 7-stage
signal pipeline `F1 → F2 → … → F7`) and map external library outputs (e.g. NumPy
processing stages with explicit labels and provenance notes) directly into registers
without dragging unused `B`/`Z` slots along.

---

## 1. Constraint classification (D50)

| tier | what applies here | status |
|---|---|---|
| **Tier 1 (Invariants)** | One DOM-free core (`src/core/*`) shared by UI, `window.bitwave`, CLI and MCP; deterministic clocked evaluation; state is truth; fixed envelope & closed error set; schema 1–4 documents keep loading; BitWave remains offline/single-file and never executes external code (NumPy/Python runs externally; BitWave holds the registers, signal flow and provenance notes). | Preserved verbatim. |
| **Tier 2 (Product commitments)** | Frames may exist either inside a paired `A/B/Z` lane OR as standalone **Free Frames** of the same shared register width `N`. The instrument still has one focused target (a lane frame *or* a free frame). Persistence bumps to `.bitwave` **schema 5**; agent toolset bumps to **`1.6.0`**. | Approved (D52). |
| **Tier 3 (Provisional)** | Initial free-frame cap `APP_FREE_FRAME_CAP = 16` (`F1`–`F16`); `F<n>` grammar has no 13-lane ceiling. Compact share tag `5` keeps 0-byte overhead when no free frames exist; link budget (`SHARE_MAX_CHARS = 2000`) drops `dataset` → `expressions` → `notes` on overflow. | Owned & measured in tests. |

---

## 2. Model (DOM-free core)

### 2.1 Identity & naming (`src/core/lanedefs.ts`)

- Stable numeric key `"1"`, `"2"`, … `"16"` (gaps allowed on delete; existing frames are
  never renumbered — identical to D43 lane stability).
- Canonical global name: **`F<key>`** (`F1`, `F2`, …, `F16`).
- Zero ambiguity across the entire system:
  - Never collides with single-letter lane operands (`A`–`Z`, specifically `F` is 1 char
    while `F1` is 2+ chars, mirroring `Z` vs `Z1`).
  - Never collides with derived lane frames (`Z1`–`Z13`).
  - Never collides with integer literals (`1`, `2`, `3`) or width constant `N` in
    [`src/core/expression.ts`](../src/core/expression.ts).
  - Works natively in `log.<frame>` expressions (`log.F1`, `log.F2`, …).

### 2.2 FreeFrame structure (`src/core/types.ts`)

Each free frame is a standalone register of the instrument's shared width `N`:

```ts
export type FreeFrameKey = string; // "1".."16"

export interface FreeFrame {
  key: FreeFrameKey;
  reg: Register;         // { bits, anim, target } of width N
  col: number;           // -1 = local, >= 0 = CSV dataset column index
  label?: string;        // optional short stage name (e.g. "hanning", max 48 chars)
  sourceNote?: string;   // optional external library/function tag (e.g. "numpy.hanning(16)", max 160 chars)
}
```

In view/document state, each free frame also carries:
- `visible: boolean` (default `true`; per-frame 2-D overlay eye toggle).
- `expression: string` (default `""`; deterministic register expression).

### 2.3 Unified routing ports & evaluation (`src/core/routing.ts`)

Routes connect **any source port** to **any writable destination port**:

- **Source ports:**
  - Lane frame: `{ lane: LaneKey, frame: "a" | "b" | "z" }` — serialized `"1.a"`, `"1.b"`, `"1.z"`.
  - Free frame: `{ free: FreeFrameKey }` — serialized **`"F1"`**…**`"F16"`**.
- **Destination ports:**
  - Lane operand: `{ lane: LaneKey, frame: "a" | "b" }` — serialized `"1.a"`, `"1.b"`, parked key `"1:a"`.
  - Free frame: `{ free: FreeFrameKey }` — serialized **`"F1"`**…**`"F16"`**, parked key **`"F1"`**.

`markDelays()` and `topoOrder()` operate over the unified node set
`lanes ∪ freeFrames` (deterministic order: live lane keys ascending, then live free-frame
keys ascending). Every clocked tick (`evaluateAll`):

1. Classify cycle-closing edges (`delay = true`) and compute topological order over
   non-delayed edges.
2. Snapshot all delayed sources (`z⁻¹`) before any writes.
3. Visit each node in topological order:
   - **Lane node:** apply incoming routes to `A`/`B`, run `applyExpression` for `A`/`B`,
     compute `Z = A <op> B`.
   - **Free-frame node:** apply incoming route to `reg`, run `applyExpression` for `reg`.
4. Parked bases work identically on free frames: first route parks the pre-patch word,
   unplugging restores it byte-identically, and `remapParked()` remaps across width
   changes.
5. An expression that cannot evaluate (most often a referenced free frame was deleted)
   leaves the register at its **last settled value** and records the reason; the reason is
   exposed per frame in state, on the cards and in the source editor (D53, §5).

### 2.4 Record take (`src/state/record.ts`)

Each recorded snapshot row captures all `3L` live lane frames (`A`–`P`, `Z1`–`Z8`) **plus**
all live free frames (`F1`–`F16`), so `log.F1` works in expressions and Record exports
carry the entire pipeline.

---

## 3. Document & Share Codec (Schema 5)

### 3.1 `.bitwave` Schema 5 (`src/core/project.ts`)

- `PROJECT_SCHEMA = 5`.
- Additive top-level field (omitted when empty):
  ```ts
  frames?: Record<FreeFrameKey, {
    hex: string;
    col?: number;          // omitted when -1
    visible?: boolean;     // omitted when true
    expression?: string;   // omitted when ""
    label?: string;        // omitted when ""
    sourceNote?: string;   // omitted when ""
  }>;
  ```
- Additive view field (omitted when a lane is focused):
  ```ts
  view: {
    lane: LaneKey;
    activeFree?: FreeFrameKey;
    ...
  }
  ```
- `routes` accept `"1.a"`/`"1.b"`/`"1.z"` and `"F1"`..`"F16"`. `parked` accepts `"1:a"`/`"1:b"`
  and `"F1"`..`"F16"`.
- **Compatibility:** schemas 1, 2, 3 and 4 load cleanly with `frames = {}` and
  `activeFree = undefined`. Default boot remains 3 lanes + 0 free frames.

### 3.2 Compact share codec (`src/core/share.ts`)

- Compact tag `4` links continue decoding forever.
- Compact tag `5` keeps slots `0..5` identical (`[5, N, view, lanes, routes, parked]`) and
  adds optional `frames` tuples (when non-empty) alongside `dataset` and `x`.
- Route triples encode free-frame endpoints directly as their canonical name (`"F1"`) while
  lane endpoints remain compact tuples.
- When there are no free frames, a compact tag-5 payload has **zero extra bytes** over tag 4.

---

## 4. Views & Interaction

### 4.1 Frames browser (`src/ui/frame-navigator.js`)

- Left sidebar gains a **`FREE FRAMES (K / 16)`** section right under `LANES (L / 8)`,
  with a quick `+` button and per-frame jump entries showing `F1` + optional `label`.
- Top-right filter bar adds a **`Free`** pill (`All | Free | Operands | Derived | Visible`).
- Card grid shows a **`FREE FRAMES`** track/section alongside the Lane cards:
  - Each free frame card renders the same isometric 3D wavetable preview (with LFO tail),
    eye toggle (2D visibility), role/binding badge (`free` / `1:1` / `z⁻¹` / `expr` / `data`),
    optional `label` and `sourceNote`, compact hex preview, and inline `DUP` / `DEL`
    controls (with route/expression impact confirmation on delete).
  - **`+ ADD FRAME`** tile sits right beside **`+ ADD LANE`**.

### 4.2 Single-register stage view

Clicking a free frame focuses it on the main stage:
- **Stage bar:** native selector groups `Lanes` and `Free Frames` via `<optgroup>`;
  `split` and `hinge` disable gracefully (single register, no `A/B` pair).
- **2D Canvas:** draws the focused free frame as the primary solid curve and overlays any
  other visible frames (free frames or lane frames with eye enabled) for direct stage-to-stage
  comparison.
- **3D Canvas:** renders the focused free frame as a clean single wavetable plate.
- **Strip & Readouts:** shows and edits the focused free frame's nibbles, hex, binary,
  popcount, and optional `label` / `sourceNote` badge.
- **Controls dock:**
  - `01 // SOURCE`: CSV column, frame route (from any lane frame or free frame), expression,
    plus inline `label` & `sourceNote` metadata fields.
  - `02 // REGISTER EDIT`, `03 // OPERATE`, `05 // MOTION`: act directly on the focused free frame.
  - `04 // DERIVE`: disabled/dimmed with a clear note ("Free frame — route into a lane for binary ops").

### 4.3 Source matrix (`src/ui/source-table.js`)

- Adds a `Free Frames` section below the lane rows.
- Every route source selector lists live lane frames (`A`–`P`, `Z1`–`Z8`) **and** live free
  frames (`F1`–`F16`).

---

## 5. Agent surface (`window.bitwave`, CLI, MCP — Toolset 1.6.0)

- `getState()` adds:
  - `activeFree: string | null` (e.g. `"F1"` or `null`)
  - `freeFrames: Record<string, UiFreeFrameState>` (omitted or `{}` when none? Always `{}`
    so callers never guard `undefined`, keyed by `"F1"`..`"F16"`).
- `window.bitwave` bridge additions (additive, never throw, return `{ ok, state }`):
  - `addFreeFrame(opts?)` — creates the next free frame (optional `hex`, `label`, `sourceNote`,
    `expression`, `source`, `focus`).
  - `removeFreeFrame(ref)` — deletes a live free frame and cleans up routes referencing it.
  - `setFreeFrameMeta(ref, { label?, sourceNote? })` — sets or clears display label and
    external library/function provenance note.
  - Existing `setFrame("F1")`, `setRegister("F1", hex)`, `setExpression("F1", expr)`,
    `setRoute("F2", "F1")`, `setSource("F2", source)` and `setState({ freeFrames, ... })`
    accept `"F1"`–`"F16"` seamlessly alongside lane frame names.
- `freeFrames.*.expressionError` and `lanes.*.expressionErrors[<frame>]` (toolset 1.6.1,
  D53) are non-null when the last clocked pass could not evaluate an expression, e.g.
  after deleting a frame that another stage references. The register keeps its last
  settled bits by design, so this field is the **only** agent-visible signal that the
  value is frozen; cards, the stage badge and the source-table editor show the same
  warning. Adding the missing key back resumes the chain on the next pass.

### External library signal-flow workflow (e.g. NumPy)

BitWave stays a pure, offline record:
1. An agent runs an external pipeline (e.g. `numpy.hanning` → `numpy.fft.rfft` → quantize).
2. The agent populates `F1`–`F7` via `addFreeFrame` / `setState` (or imports a multi-column
   CSV and binds `F1`–`F7`), tagging each register with `label` (stage name) and `sourceNote`
   (e.g. `"numpy.fft.rfft(x)"`).
3. The user inspects the 7-stage chain in the Frames browser, overlays stages in 2D via eye
   toggles, steps through rows, or routes `F1` and `F7` into `Lane 1` (`A ⊕ B → Z1`) for a
   live bitwise diff.

---

## 6. Delivery slices

1. **Slice 1 — Core Free Frames & Unified Routing (`src/core/`):** naming, types, unified
   routing graph, expression support, core tests.
2. **Slice 2 — Schema 5 Persistence & Compact Share Codec (`src/core/project.ts`, `share.ts`):**
   serialize/deserialize, backward-compat schema 1–4 upgrades, compact codec tag 5 + tests.
3. **Slice 3 — App State, Bindings, Record & Project Bridge (`src/state/`):** `S.freeFrames`,
   `S.activeFree`, unified evaluation, bindings, Record rows, project bridge + state tests.
4. **Slice 4 — UI & Renderers (`src/ui/`, `src/render/`, `src/styles/`, `src/main.js`):**
   Frames browser (`FREE FRAMES` section, `+ ADD FRAME`, `DUP`/`DEL`, `Free` filter),
   single-register 2D/3D stage, readouts, dock controls, stage bar, source matrix.
5. **Slice 5 — Agent Bridge, CLI, MCP, Artifacts & Full Verification:** toolset `1.6.0`,
   bridge methods, regenerated `agent/manifest.json` & examples, `DECISIONS.md` D52, full
   test + browser verification + `dsh-plugin` rebuild.
