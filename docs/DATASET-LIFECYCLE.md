# Dataset lifecycle — design note

**Status: exploration (author hypothetical 2026-11-16; not approved, no shipped change).**
Companion to [`ROUTING-IO-MODEL.md`](ROUTING-IO-MODEL.md). This note is scoped to the
**data plane**: getting a user's data into BitWave, letting an agent process it outside the
instrument, bringing the result back, and comparing the two bitwaves. It deliberately does
**not** decide the function-frame / global-frame-identity model; that is a larger v3
question and is deferred (see §8).

## 0. The test case

The author's prompt (paraphrased):

> I imported a one-column CSV of 64-bit hex values called “Colors”. I can step through the
> data and the waveforms update. I'm not a programmer, but I found a sorting-algorithms
> repo. Can we use BitWave to visualize my data before and after it has been processed by
> one of those algorithms?

That is the right acceptance test for the data plane. It needs:

| step | need |
|---|---|
| 1 | the dataset already loads and steps (it does) |
| 2 | something that can read the loaded data (the agent, a script) |
| 3 | an external process — sorting code from the repo — run **outside** BitWave |
| 4 | the processed data loaded back as another bitwave |
| 5 | a way to see before and after together |
| 6 | stable names so the conversation is about “Colors” and “sorted Colors”, not lane slots |

BitWave should be the instrument and the visualization; the LLM/agent is the code runner.
Running arbitrary algorithms inside the page is out of scope by design (security,
determinism, bundle). The lifecycle is the interface between those two roles.

## 1. What exists today

### 1.1 Dataset state

- Live dataset: `DEMO = { cols: string[], rows: string[][], i: number }` in
  `src/state/dataset.ts` — one active imported dataset plus a row cursor.
- `.bitwave` schema 4 stores `dataset: { cols, rows, index? }`; the compact share codec
  has a dataset slot and drops it when the link would overflow (`datasetDropped`).
- The demo dataset is embedded; `demo` reloads it.

### 1.2 Import and binding

- `import csv` reads CSV/TSV via `src/core/csv.ts`: header detection, per-column typing
  (`bin` / `hex`), right-aligned into the register width, invalid files refused before the
  live board changes.
- A fresh import **resets the binding board** (routes dropped, bindings rebuilt) and
  auto-assigns the widest column to lane 1 operand A, with payload columns spread across
  the other live operands (`src/ui/csv-import.js`; historical D11/D15, dynamic-lane D46).
- The source matrix (`sources`) binds a column to an operand, per live lane; the label
  carries the assignment (`A · Colors`). Data-bound inputs are driven/read-only; stepping
  writes the current row into them.
- The stepper (`◀ ▶`, `n / rows`) moves the row cursor; LFO `csvStep` can also advance it.
- Manual entry is independent: the hex-entry field writes an operand; importing is optional.

### 1.3 Export and persistence

- `log` / `export` in the source row export **observations** (the focused lane's state),
  not the dataset.
- `record` / `export log` export the **transient take**, not the dataset.
- `project… → save` writes the whole `.bitwave` document including the dataset; `open`
  restores it. `#bw=` links carry the dataset only while the budget allows.
- There is no visible “export dataset” control.

### 1.4 Agent surface

- `getState().dataset` (contract §6) contains
  `{ columns: string[], rows: number, index: number, row: string[] }` — **column names, row
  count, cursor and the current row only**. The full matrix is not exposed.
- The bridge setter exists: `setState({ dataset: { csv, index } })` parses and replaces the
  live dataset (`src/agent/bridge.js`); `setState({ dataset: { index } })` moves the cursor.
- Tools (`src/core/agent-tools.ts`): `parse_dataset` parses a CSV **string the caller
  supplies**; there is no `getDataset` / `exportDataset` / `setDataset` tool.
- CLI/MCP expose the same registry; `agent state --json` therefore also shows only the
  current row.
- `setSource` / `setRoute` can bind a column to an operand; `setRegister` writes one word at
  a time.
- The bridge refuses writes that need a loaded dataset when none exists, and validates
  column indexes against the live dataset.

### 1.5 Identity today

- Frames are lane-bound: lane 1 `A/B/Z1`, lane 2 `C/D/Z2`, etc. The column name is shown
  in the binding label, but the frame's identity is the lane slot. Agents address frames by
  `A`–`P`/`Z1`–`Z8`, not by data name.
- There is no first-class “Colors bitwave” object: “Colors” is a column string bound to a
  frame.

## 2. The hypothetical, step by step

**Human path (works today, with friction):**

1. Import the one-column `Colors` CSV → it binds to lane 1 A.
2. Ask an LLM/agent; the agent needs the data. Today the agent either gets the CSV from the
   user (paste/file access) or asks the user to save the project; it cannot pull the rows
   from the live instrument.
3. The agent runs the sorting algorithm externally and produces a two-column CSV
   (`before`, `after`).
4. The user imports that CSV: the widest column binds to lane 1 A; the second column goes to
   another operand (B if shown / 3-D, otherwise another lane). The user may need the source
   matrix to bind before→A, after→B explicitly.
5. Switch to A·B view (or a second pane/lane) → the two curves and the truth table show the
   transformation. This already answers the visualization question.
6. To keep the processed data, save the project or step/record; there is no dataset export.

**Agent path (mostly works, missing readback):**

1. User supplies the CSV file to the agent (or the agent runs where it can read it).
2. Agent sorts externally.
3. Agent calls `setState({ dataset: { csv: "before,after\n…" } })` — the bridge setter
   parses it and replaces the dataset.
4. Agent calls `setSource` for A/B (or relies on auto-binding) and sets the view; returns the
   state/link.
5. User inspects; no dataset readback was needed from BitWave because the agent had the file.

So the **algorithm and round-trip are already possible** when the agent has the file. The
blocked case is “the data is only in BitWave, and the agent should fetch it” — and the
ergonomic case of a smooth before/after workflow.

## 3. Gap analysis

| capability | today | missing | minimal fix | risk |
|---|---|---|---|---|
| read the loaded data | `getState().dataset` = names/count/cursor/current row | all rows / CSV | `getDataset()` returning columns + rows (bounded) and/or a `getDatasetCsv` form; bridge + CLI/MCP tool | dataset size, privacy (local only), payload size |
| load processed data | bridge setter `setState({dataset:{csv}})` works | a formal, discoverable dataset tool | wrap the setter as `setDataset`/`importDataset` tool + docs/examples | none beyond toolset bump |
| compare before/after | two-column import; A/B binding; A·B view; truth table | a named/bind-both shortcut and a clear “compare” framing | bind two columns to A/B in one action; label the pair | UI scope creep; keep it small |
| names/identity | column label in source matrix; frame identity is lane slot | a stable data name agents/users can refer to | **frame labels/aliases** derived from the bound column, shown and exposed in agent state; internal lane keys unchanged | persistence choice (derived vs stored) |
| export processed data | project save (JSON) / observations / take | dataset CSV export | `export dataset` (human) and the same data via the agent readback | none |
| run sorting inside BitWave | — | — | keep external; do not add a code runner | security/determinism/bloat |

## 4. Proposed minimal surface (no model rewrite)

1. **Dataset readback** (`getDataset`): return `{ columns, rows, index }` or a CSV string.
   Bounded (see §6), deterministic, read-only. This is the single highest-leverage addition
   for agent workflows.
2. **Formal dataset write** (`setDataset` / `importDataset`): wrap the existing bridge
   setter; validate via the same parser; optional `index`; report `E_BAD_ARGS`/`E_BAD_STATE`
   on invalid input. No schema change.
3. **Frame labels**: when an operand is data-bound, derive a display label from the column
   name (`A · Colors`) in the readout/source matrix/frames view **and** in agent state
   (`lanes[*].operands[].label` or similar). Keep the stable lane/frame identity; the label
   is presentation. Persisting labels is a later schema question; deriving them from the
   binding is free and survives import.
4. **Compare shortcut**: when a dataset has ≥2 numeric columns, a small “compare columns”
   action binds two columns to the lane's A/B (or two lanes) and switches to the A·B view.
   No new chart: the existing wave + truth table are the comparison.
5. **Dataset export**: an explicit `export dataset` control (separate from observations) and
   the same output through the readback tool. Keep the current share-link budget behavior.
6. **Keep the external-processing boundary**: document the agent workflow (“read dataset →
   process externally → write dataset with before/after columns → bind → view”) and add an
   example; do not execute user code in the page.

Toolset impact: new read/write dataset tools are additive; toolset bump (1.5.0), manifest/
examples/docs/tests. No `.bitwave` schema change is required for 1–3 if labels are derived;
schema 5 only if labels must persist or named datasets are added.

## 5. Agent workflow example (the sorting prompt)

```
user: I have Colors loaded in A. Can you sort it and show me before/after?

agent:
  data = bitwave.getDataset()           # new: full rows
  sorted = external_sort(data.columns[0])
  bitwave.setDataset({                  # existing setter, new formal tool
    csv: "Colors,Sorted\n" + join(data.rows, sorted)
  })
  bitwave.setSource("A", { kind: "data", column: 0 })
  bitwave.setSource("B", { kind: "data", column: 1 })
  bitwave.setState({ view: "2d", frame: "a", showB: true })  # A·B comparison
  return bitwave.getDeeplink()
```

The user then sees the original and sorted bitwaves in the A·B view, with the truth table
for their operator. No lane refactor, no function frames, no wires.

## 6. Limits and performance

- Parse/readback is linear in rows; state payloads going to an agent should be bounded
  (e.g. a documented row cap or a separate export file) rather than streaming a large
  matrix through every `getState()` call.
- Readback should be opt-in (`getDataset`), never part of the change-event state payload.
- The share link already drops the dataset on overflow; dataset export is the portable path
  for large data.
- Labels derived from column names are cheap; persisted labels add schema bytes.
- Privacy: everything stays local; the agent is local (CLI/MCP/bridge) or the user chooses
  what to paste; no telemetry.

## 7. What this note deliberately does not solve

- **Global frame identity / function frames / lanes-as-views.** The sorting scenario does
  not require frames to exist outside lanes; a label layer gives most of the feng shui.
  The v3 model question lives in `ROUTING-IO-MODEL.md` and is deferred until a use case
  demands reuse/parallel processing beyond what dataset columns + lanes provide.
- **Running arbitrary algorithms in-page.** External agent/script only.
- **Multiple named datasets / before-after snapshots.** Two columns are enough for the
  first version; named datasets are a later question.
- **A new comparison chart.** The existing A·B wave and truth table are the comparison.

## 8. Relation to the author's other tool

The author has an earlier unrelated data-surface tool that may inform this API. This note
defines the minimal BitWave-side surface independently; if that tool provides a useful
dataset model or export shape, it can be adapted in a follow-up without changing the
lifecycle above. No dependency is assumed.

## 9. Open questions

1. Readback shape: full rows, a CSV artifact, or a documented row cap/window? How large do
   real CSVs get for the teaching/research use case?
2. Should frame labels be **derived from the binding** (free, transient) or persisted in
   `.bitwave` (schema 5, survives unbinding)? Should an agent be able to set a label?
3. Is “compare two columns” a one-click action enough, or does the data plane need a
   two-dataset (before/after) concept?
4. Should dataset tools be top-level tools (`getDataset`/`setDataset`) or bridge-only
   methods? Top-level makes CLI/MCP parity and selftest examples; the setter already exists.
5. What is the acceptable size/format for agent readback (CSV string vs rows array), and
   should it be chunked or file-based above a threshold?
6. When (if ever) should the function-frame / global-identity model follow? What concrete
   workflow would force it beyond the label layer?

## 10. Acceptance tests for a future implementation

- Import a CSV → `getDataset()` returns exactly the parsed columns/rows/index.
- `setDataset({csv})` → project save/reload and share link behave as today; invalid CSVs
  refused with the same errors.
- An agent can run the sorting loop end-to-end locally: read → process → write two columns
  → bind A/B → A·B view shows both curves; state/link reproduces the result.
- Column labels are visible on the bound frames and exposed in agent state; unbinding
  clears them if derived, or persists if a later schema decision says so.
- Dataset export downloads the same matrix; observations/take exports are unaffected.
- Default rendering and existing gates unchanged; toolset bump documented; no agent
  payload/state bloat during normal interaction (readback is opt-in).

## 11. Related artifacts

- [`ROUTING-IO-MODEL.md`](ROUTING-IO-MODEL.md) — lanes as computation vs housing, sends and
  the deferred frame/operator graph.
- `spike/multiband-expressor.html` — data-level processor probe (pending its own I/O model).
- [`EXTERNAL-ROUTING.md`](EXTERNAL-ROUTING.md) — expressions, Record and per-operand sources.
- `src/core/csv.ts`, `src/state/dataset.ts`, `src/state/bindings.ts`,
  `src/ui/csv-import.js`, `src/agent/bridge.js`, `src/core/agent-tools.ts`.
