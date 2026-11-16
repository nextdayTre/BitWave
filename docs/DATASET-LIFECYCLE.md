# Dataset lifecycle — design note

**Status: exploration, revised 2026-11-16 (process-centric acceptance test). Not
approved, no shipped change.** Companion to [`ROUTING-IO-MODEL.md`](ROUTING-IO-MODEL.md).
This note started as a data-plane note (read → process → write → compare). The author's
follow-up reframed the acceptance test around **the process itself and its provenance**:
BitWave should not be a visualizer that runs on a black box. The external algorithm still
runs outside the instrument; the intermediate steps and the citation travel with the data,
so a user sees the transformation unfold and another person or agent can reproduce it.

## 0. The test case and the revised acceptance test

The original prompt (paraphrased):

> I imported a one-column CSV of 64-bit hex values called “Colors”. I can step through the
> data and the waveforms update. I'm not a programmer, but I found a sorting-algorithms
> repo. Can we use BitWave to visualize my data before and after it has been processed by
> one of those algorithms?

The first version of this note treated that as a **before/after** problem. The corrected
acceptance test is:

> Given a dataset and a named external process, BitWave can present the **sequence**
> `Colors Input → Bubble Sort Step 1 → … → Sorted Output`, let the user step/play through
> it, and carry a **citation/provenance** for the external algorithm so the run can be
> reproduced and validated.

### 0.1 Success criteria

| # | criterion |
|---|---|
| 1 | The agent can read the loaded dataset, run the algorithm externally, and write back a **step-annotated sequence** (or a single step-annotated dataset) without the user touching files. |
| 2 | The instrument exposes the sequence with **stable step labels**, a step cursor and playback; every step is visualized by the existing wave, nibble strip, binary/nibble readouts and truth table — no new black-box chart. |
| 3 | The user can compare steps: at minimum play/record the progression; A/B can compare two frames/columns within a step, and a step-to-step comparison is a later extension (not required to prove the model). |
| 4 | A **provenance/citation record** (algorithm/library, source URL + commit, parameters, generated-by, optional hashes/notes) is attached to the sequence, visible in the UI, exported with the data, and included in the shared link or a documented companion artifact. |
| 5 | A second person or agent can take the dataset + citation + link and reproduce the external processing, then validate the step labels/hashes — without executing arbitrary code inside BitWave. |
| 6 | The default instrument (no steps, no provenance) is unchanged; schema-4 documents and links still load. |

### 0.2 Principles

1. **The instrument is the record, not the compute engine.** The external library/agent
   does the processing; BitWave shows the states and carries the citation.
2. **Process, not just endpoints.** A visualization that only shows input and output hides
   the thing the user wants to learn/validate. Intermediates are the product.
3. **Motion is analytical.** The LFO and Record features already give data a sense of
   musicality; a step timeline with playback is the data-process analogue of watching a
   filter move. It is not decoration.
4. **Citations are part of the artifact.** A link is not just state; it should be evidence
   of how the state was produced. Core citation fields must not be silently dropped.
5. **Citations are metadata, not proof.** Hashes/labels make reproducible validation
   possible; they are not a security boundary.
6. **No wires, no node canvas, no in-page code runner.** The step control is a transport,
   not a graph; the external boundary stays explicit.
7. **Frames/bitwaves remain the visual primitive.** A step is a dataset state rendered
   through the existing bindings; no new visualization type is required.

## 1. What exists today

### 1.1 Dataset state and import

- Live dataset: `DEMO = { cols: string[], rows: string[][], i: number }` in
  `src/state/dataset.ts` — **one active dataset plus a row cursor**; no step/timeline
  dimension.
- `.bitwave` schema 4 stores `dataset: { cols, rows, index? }`; the compact codec has a
  dataset slot and drops the dataset when the link would overflow (`datasetDropped`).
- `import csv` parses CSV/TSV (`src/core/csv.ts`): header detection, per-column typing
  (`bin`/`hex`), right-aligned into the register, invalid files refused before the live
  board changes.
- A fresh import resets the binding board and auto-assigns the widest column to lane 1 A,
  spreading payload columns across the live operands (`src/ui/csv-import.js`; D11/D15,
  dynamic lanes D46). The source matrix binds a column to an operand per live lane; the
  label carries the column name (`A · Colors`). Stepping writes the current row into bound
  operands.
- The stepper (`◀ ▶`, `n / rows`) moves the **row** cursor; LFO `csvStep` can advance it.

### 1.2 Export and persistence

- `log` / `export` export **observations** (the focused lane's state), not the dataset.
- `record` / `export log` export the **transient take**, not the dataset.
- `project… → save` writes the whole `.bitwave` document including the dataset; `open`
  restores it. `#bw=` links carry the dataset only while the budget allows.
- There is no dataset export control and no provenance/citation field anywhere.

### 1.3 Agent surface

- `getState().dataset` = `{ columns, rows, index, row }` — names, count, cursor and the
  **current row only**; the full matrix is not exposed.
- The bridge setter exists: `setState({ dataset: { csv, index } })` parses and replaces the
  live dataset; `setState({ dataset: { index } })` moves the cursor.
- Tools: `parse_dataset` parses a CSV **string supplied by the caller**; there is no
  `getDataset`/`setDataset`/`setTimeline`/`getProvenance` tool. CLI/MCP expose the same
  registry, so `agent state --json` also shows only the current row.
- `setSource`/`setRoute` bind a column to an operand; `setRegister` writes one word.
- The bridge validates column indexes and requires a loaded dataset for data sources.

### 1.4 Identity and motion today

- Frames are lane-bound (`A/B/Z1`, `C/D/Z2`, …); the column name appears in the binding
  label, but there is no first-class named bitwave object.
- Motion is per-register: LFO animates the focused/edited register; Record appends one row
  per settled update; the dataset row stepper is the only dataset-level navigation.
  There is no concept of an algorithm step, its label, or its provenance.

## 2. The hypothetical, revised

**What the user does:** imports `Colors`; asks an LLM/agent to sort it with a named
library/algorithm.

**What the agent does (external):**

1. Read the data (below: via the new readback; otherwise the user supplies the file).
2. Run the algorithm externally (repo/commit/parameters).
3. Emit a **step-annotated sequence**: `Colors Input`, `Step 1 … Step N`, `Sorted Output`,
   with stable labels and the data for each state.
4. Attach **provenance**: library/algorithm, source URL + commit, parameters, generated-by,
   optional input/output/step hashes.
5. Write the sequence + provenance into BitWave (new dataset/timeline tools).
6. Bind steps/columns as needed and return a link/citation.

**What the user sees:** the same instrument, with a step transport. `Colors Input` is on
screen; pressing play or step advances to `Bubble Sort Step 1`, the waveform/nibbles/
readouts update, Record can capture the run, and the source/data area shows
`sorted with <library>@<commit> · <params>` with a **cite** action. The link/project carries
the sequence and citation; a second person can open it and re-run the external algorithm to
compare labels/hashes.

**What the user does not get (by design):** arbitrary code execution inside the page; a
black-box "process" button that hides what happened; a sparkline with no states.

## 3. What is missing

| capability | today | missing | minimal shape |
|---|---|---|---|
| read the loaded data | `getState().dataset` current-row-only | full matrix / CSV readback | `getDataset` returning columns + rows (bounded) and/or a CSV form, opt-in |
| load processed data | bridge `setState({dataset:{csv}})` | formal discoverable dataset tools | `setDataset`/`importDataset` wrapping the setter |
| step sequence | none | **timeline of states with labels, cursor, playback** | dataset timeline (snapshots or step columns) + step transport |
| compare steps | row stepper only; A·B within a step | a way to see/record a step progression | playback + Record integration; step-to-step comparison later |
| provenance/citation | none | a citation record attached to the sequence and link | `provenance` block, UI line, export, share rule |
| reproducibility | — | hashes/labels so another party can re-run and compare | optional input/output/step hashes + documented external loop |
| names | column label on a lane-bound frame | stable step/dataset labels | labels derived/stored with the timeline; frame labels later |
| external compute | — | — (correctly outside) | keep external; no runner |

## 4. Proposed surface

### 4.1 Data plane (unchanged from the I/O note)

1. **Dataset readback** (`getDataset`): `{ columns, rows, index }` or CSV; bounded,
   deterministic, read-only, never part of change-event state.
2. **Formal dataset write** (`setDataset`/`importDataset`): wrap the existing setter; same
   validation/errors.
3. **Dataset export** (human): explicit `export dataset` CSV; observations/take exports
   stay separate.
4. **Labels**: derive display labels from bound columns (`A · Colors`); no schema change
   for derived labels.

### 4.2 Step timeline (the process)

**Recommended v1 encoding: snapshots.**

- A sequence = an ordered list of dataset snapshots plus a step cursor:
  `steps: [{ label: "Colors Input", dataset: { cols, rows, index? } }, …]`.
- The active step supplies the same `cols`/`rows` to the existing bindings, so the existing
  wave/strip/readouts/truth table visualize it; no new chart type.
- Step labels are stable strings (agent-provided, e.g. `Bubble Sort Step 1`); the step
  cursor selects the active snapshot; a transport (◀ ▶ play/pause, label + `k / N`) sits
  with the source/data controls. Playback speed is a small transport control, not a new
  motion system.
- Record integration: while playing/stepping, Record can capture rows with the step label
  (additive field) so the run is exportable; the take remains transient, the timeline is
  the persisted artifact.
- Share/project: the timeline is persisted; links include the cursor + steps within the
  existing budget rules; if steps/notes overflow, explicit flags plus a companion export
  path (see §4.3).
- **Alternative (later): step columns.** One dataset, one column per step (or column
  groups). This is more compact for sharing and makes A/B comparison of two steps direct,
  but needs a column-group/step mapping and a step-aware binding UI. Start with snapshots
  because they match the user's "sequential bitwaves" mental model and are easy for an
  agent to emit; evaluate columns after the feel is proven.

Open step questions are listed in §9 (what exactly a step renders, step count/size, whether
a step can be a frame, cross-step compare).

### 4.3 Provenance / citation

A first-class record attached to the timeline/dataset (indicative; exact schema in §9):

```
provenance: {
  algorithm?: string        // "bubble sort"
  source?: string           // repo/project name
  url?: string              // source URL
  commit?: string           // tag/sha/version
  parameters?: string       // human-readable or JSON
  generatedBy?: string      // agent/tool/user
  notes?: string
  inputHash?: string        // optional, canonical hash of parsed input
  outputHash?: string       // optional, canonical hash of the final state
  stepHashes?: string[]     // optional, per-step hashes
}
```

- **UI**: a citation line in the data/source area with the core fields and a **cite**
  action that copies an academic-style reference + the BitWave link; the agent panel can
  show the same record. Core citation fields must not be silently dropped.
- **Persistence**: project/save/export includes it; the link includes it if the budget
  allows. For long parameters/notes, define a documented companion/sidecar export rather
  than dropping silently; if a field must be dropped, expose an explicit flag.
- **Agent tools**: `getProvenance`/`setProvenance`; harmless additive tools; the agent
  workflow example in §5 uses them.
- **Trust**: citation is metadata, not proof. Hashes are optional verification handles; the
  note does not promise security or correctness, only reproducibility of the artifact.

### 4.4 Reproducibility loop

- The external agent/script is the compute source; the artifact carries enough to re-run it:
  source + commit + parameters + the input data (or a hash if the data is elsewhere).
- A second agent can: open the link/project → read dataset + provenance → run the same
  external processing → compare step labels/hashes → report differences.
- BitWave itself never executes the algorithm. Hashes, when present, are computed over the
  same canonical parsed data and step states; absence of hashes means validation is by
  labels/data, not failure.

### 4.5 Non-goals

- No in-page algorithm execution; no "process" button that runs user code.
- No wire/node canvas; no new graph UI for steps.
- No function-frame/global-frame-identity rewrite (see [`ROUTING-IO-MODEL.md`](ROUTING-IO-MODEL.md); deferred).
- No new chart type; the waveform/readouts are the visualization.
- No claim that a citation proves correctness; only that it makes reproduction possible.

## 5. Agent workflow example (sorting, process version)

```
user: I have Colors loaded. Sort it with the bubble-sort repo and show me the steps.

agent:
  data = bitwave.getDataset()                    # new: full rows
  steps = external_sort_with_trace(data, params) # external; emits labelled states
  bitwave.setDataset({
    steps: [
      { label: "Colors Input", dataset: { cols, rows } },
      { label: "Bubble Sort Step 1", dataset: { cols, rows } },
      …
      { label: "Sorted Output", dataset: { cols, rows } }
    ],
    cursor: 0
  })
  bitwave.setProvenance({
    algorithm: "bubble sort", source: "…", url: "…", commit: "…",
    parameters: "…", generatedBy: "agent", inputHash: "…", outputHash: "…"
  })
  bitwave.setSource("A", { kind: "data", column: 0 })
  bitwave.setSource("B", { kind: "data", column: 1 })
  bitwave.setState({ view: "2d", frame: "a", showB: true })
  return bitwave.getDeeplink()
```

The user presses play or steps through the timeline; Record can capture the progression;
the link/export carries the sequence and citation. A second agent uses the same provenance
to reproduce and compare.

## 6. Limits and performance

- Step count × rows is the new size dimension; define caps/hints (e.g. step count and total
  cells) so a timeline does not make share/state payloads explode. Large sequences are
  companion-export territory, not link territory.
- Readback is opt-in; the change-event state must not stream the full matrix or all steps.
- Playback is a transport on the existing render loop; do not add per-step chart widgets.
- Provenance is small text; long parameter/notes content may need the companion path.
- Everything stays local; no telemetry; the agent is local or the user chooses what to
  paste.

## 7. What this note deliberately does not solve

- **Function frames / global frame identity / lanes-as-views.** The process acceptance test
  does not require frames to exist outside lanes; a step timeline + data labels gives the
  needed semantics. The v3 model remains in the routing note.
- **In-page algorithm execution.** External only.
- **Multiple named datasets/projects.** A timeline is one sequence; multiple datasets and
  cross-project comparison are later if needed.
- **A new comparison chart or graph view.** The existing instrument plus the step transport
  is the visualization.

## 8. Relation to Nibsort (author's earlier data-surface tool)

The author shared **Nibsort** (`Divine-Beauty-Proportion`, outside this repo): a
zero-dependency tool for sorting/searching/grouping CSV data by positions inside hex and
binary strings, with a Python CLI and a standalone browser spreadsheet GUI. It was
inspected as a possible data-surface starting point.

| part | what | notes |
|---|---|---|
| `gui/engine.js` (~30 KB) | pure browser+Node engine: parse delimited text, normalise hex/bin cells to bit strings, `COLUMN:SELECTOR:MODIFIER` field language (`n5`, `b12-17`, `B3`, `msb/lsb`, `pad`), sort/filter/match/group/profile | DOM-free, zero deps; values compared as bit strings (leading zeros matter); the Python suite (23 tests, passing) is the reference |
| `gui/app.js`, `index.html`, `style.css` (~85 KB) | standalone spreadsheet UI: nibble-ruler sort, sort pipeline, filters, search, lookup/histogram, profile heatmap, cell inspector, CSV paste/open/export, copy CLI | standalone document; not part of BitWave |
| `nibsort/*.py` + tests | Python CLI (`info/sort/find/group/profile`) and 23 unit tests | separate runtime; zero deps |

**Verdict: reference and possible companion, not a merge target.**

- Do not embed the GUI or depend on the Python package: BitWave is a single-file
  instrument with one DOM-free core, one state tree and one agent contract; a second
  spreadsheet app/runtime would duplicate parsers, add a second UX and complicate the
  build/packaging for no lifecycle-slice benefit.
- The interesting reusable artifact is `gui/engine.js`: pure, zero-dep, and its field
  language is close to BitWave's nibble/bit identity. If BitWave later specifies a
  **positional dataset workspace/query tools**, port the field language and comparison
  semantics into a DOM-free `src/core/dataset-query.ts` with its own tests (the Python
  suite is the behavioural reference; the JS port has no dedicated tests) and record a
  provenance/licence note (author's tool, no LICENSE file in the repo).
- For the sorting/process acceptance test, Nibsort is **not required**: it is a human
  positional-sort tool, not a step-producing algorithm tracer. Its CLI can be an external
  companion if positional sorting is needed; no dependency, no bundle.

## 9. Open questions

1. **Step encoding:** snapshots vs step columns (recommended snapshots first). If
   snapshots, does each step repeat `cols`/`rows`, and what is the size cap?
2. **What is a step bitwave?** Does a step render the current row/columns through the
   existing bindings (recommended), or should a step itself be a named frame? If a step is
   a frame, frame identity/labels resurface; the note assumes the former for v1.
3. **Step navigation UI:** a compact transport next to the source/stepper; what does
   play/pause/speed look like, and does LFO grow a "step" mode or stay register-only?
4. **Record integration:** should Record capture the step label automatically, and export
   the progression as rows with a `step` column?
5. **Provenance schema:** exact fields, optional hashes, where it lives (dataset vs
   project), and whether it is part of canonical state/share equality.
6. **Share vs companion:** which provenance fields must always be in the link, which can
   be dropped with an explicit flag, and when a companion JSON/CSV is the right artifact.
7. **Reproducibility hashes:** over parsed data or raw CSV? What canonicalisation, and is
   it worth the bytes in v1?
8. **Cross-step comparison:** is step-to-step A/B (or a diff view) needed to prove the
   model, or is playback/Record enough for the first version?
9. **Multiple sequences:** one active timeline vs multiple named datasets; defer unless the
   workflow demands it.
10. **Citation format:** what a copied citation should look like for researchers/students
    (library, commit, parameters, BitWave link, agent/tool).

## 10. Acceptance tests for a future implementation

**Process + provenance**

- An agent can load a step-annotated sequence for the Colors/Bubble-Sort scenario, with
  labels from `Colors Input` to `Sorted Output`, and set provenance (library, URL, commit,
  parameters, hashes optional).
- The step transport shows the label/count, advances/plays through the states, and the
  wave/strip/readouts update truthfully at each step; Record captures the progression.
- A project save/reload and a `#bw=` link restore the sequence and cursor; the citation is
  visible and exportable; core citation fields are never silently dropped.
- A second agent can take the artifact, re-run the external algorithm, and compare step
  labels/hashes; BitWave executes no algorithm code.
- A schema-4 document without steps/provenance loads and behaves exactly as today.

**Data plane**

- Import a CSV → `getDataset()` returns exactly the parsed columns/rows/index.
- `setDataset({csv})` behaves like today; invalid CSVs are refused with the same errors.
- Dataset export downloads the same matrix; observations/take exports are unaffected.
- Column labels are visible on bound frames and exposed in agent state; derived labels
  clear/persist according to the chosen rule.
- Default rendering/gates unchanged; normal interaction never streams the full matrix.

## 11. Related artifacts

- [`ROUTING-IO-MODEL.md`](ROUTING-IO-MODEL.md) — lanes as computation vs housing, sends and
  the deferred frame/operator graph.
- `spike/multiband-expressor.html` — data-level processor probe (pending its own I/O model).
- [`EXTERNAL-ROUTING.md`](EXTERNAL-ROUTING.md) — expressions, Record and per-operand sources.
- `src/core/csv.ts`, `src/state/dataset.ts`, `src/state/bindings.ts`,
  `src/ui/csv-import.js`, `src/agent/bridge.js`, `src/core/agent-tools.ts`.
