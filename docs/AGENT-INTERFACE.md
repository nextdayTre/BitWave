# Agent Interface Contract — bitwave v1 (toolset 1.1.0)

Normative contract for BitWave's agent layer. The human-facing onboarding is
[`AGENTS.md`](../AGENTS.md); this file is the precise spec the browser bridge, CLI and
MCP server implement. If the code and this document disagree, the code is wrong.

Design rules:

1. **One implementation.** All maths/data live in `src/core/*` (TypeScript, DOM-free).
   The app, `window.bitwave`, the CLI and the MCP server import the same files. No
   transport may re-implement a register operation, a project shape or a deeplink.
2. **Deterministic output.** No timestamps, randomness or locale formatting in tool
   results or generated artifacts. The same input serializes byte-identically.
3. **One envelope, one error shape.** Every tool result is an envelope; every transport
   emits the same one.
4. **Pure tools are read-only.** Only bridge setters change the UI. MCP/CLI tools never
   write files or state.
5. **Additive.** The default rendered instrument (help panel closed) stays
   pixel-identical; the existing `window.BitWave` read-only surface is unchanged.

## 1. Identity

| field | value |
|---|---|
| tool id | `bitwave` |
| title | `BitWave` |
| toolset version | `1.1.0` |
| `schemaVersion` | `1` |
| browser bridge | `window.bitwave` |
| legacy surface | `window.BitWave` (schema 1, read-only, unchanged) |
| app artifact | `bitwave-v2.html` (single file, no external references) |
| project document | `.bitwave` schema 3 (`src/core/project.ts`; schema 1/2 still load) |

Keep the id stable across the manifest, CLI, MCP `serverInfo.name`, the bridge global and
the hidden state node.

## 2. Tool registry — `src/core/agent-tools.ts`

Exports:

```ts
export const SCHEMA_VERSION: 1
export const TOOLSET_VERSION: "1.1.0"
export const TOOL_ID: "bitwave"
export class AgentToolError extends Error { code; hint? }
export const TOOLS: ToolDef[]              // definition order is canonical
export function callTool(name: unknown, args: unknown): Envelope   // never throws
export function buildDeeplink(args: unknown): DeeplinkData          // throws AgentToolError
export function getManifest(): Manifest
export function normalizeAgentPatch(patch: unknown): NormalizedPatch
```

`ToolDef`:

```ts
{
  name: string,          // unique snake_case verb phrase
  title: string,         // short human label
  description: string,   // 1–3 actionable sentences for an LLM
  scope: "pure",
  inputSchema: object,   // object-rooted JSON Schema, additionalProperties:false
  examples: [{ args: object, note: string }],
}
```

`callTool` behaviour:

- `args === undefined` means `{}`; non-object args → `E_BAD_ARGS`.
- unknown name → `E_UNKNOWN_TOOL`; unknown keys → `E_BAD_ARGS`.
- success → `{ ok:true, schemaVersion, tool, data, deeplink, warnings }`
- failure → `{ ok:false, schemaVersion, tool, error:{ code, message, hint? }, warnings }`
- key order is fixed and tested.
- `deeplink` is a string when the result maps to a UI state, else `null`.
- `warnings` is always an array of strings (empty in v1).
- pure tools never mutate UI, state, files or the network.

## 3. Tools (v1) — 6 pure tools

Sizes are the instrument's register widths: `8 | 16 | 32 | 64 | 128 | 256`; default `64`.
Hex input is case-insensitive, an optional `0x` prefix is accepted, and a value wider
than the width truncates its high bits (DESIGN §10.16). Empty hex → `E_EMPTY_INPUT`.

### `manifest`
Args `{}`. Data = `getManifest()` (§8).

### `analyze_register`
Args: `{ hex: string, width?: RegisterSize }`.

Data:

```json
{ "width": 64, "hex": "8ADEFEDA85210125", "decimal": "10006715636553679141",
  "nibbles": [8,10,13,14,15,14,13,10,8,5,2,1,0,1,2,5],
  "popcount": 30, "bitLength": 64 }
```

`bitLength` is the position of the highest set bit (`0` for zero). Errors:
`E_INVALID_HEX`, `E_BAD_ENUM` (width), `E_EMPTY_INPUT`.

### `evaluate_lane`
Args: `{ a: string, b?: string = "0", op?: BinOp = "xor", width?: RegisterSize }`.

`BinOp` is `and | or | xor | add | sub`. Data:

```json
{ "width": 64, "op": "xor",
  "a": { "hex": "8ADEFEDA85210125", "popcount": 30 },
  "b": { "hex": "FFFFFFFF00000000", "popcount": 32 },
  "z": { "hex": "7521012585210125", "popcount": 20 },
  "truthCounts": [23, 11, 9, 21],
  "carry": null, "borrow": null }
```

`truthCounts` is `[n00, n01, n10, n11]` over the input bit pairs and always sums to
`width`. `carry`/`borrow` are booleans for `add`/`sub`, `null` otherwise.

### `compare_operands`
Args: `{ a: string, b: string, width?: RegisterSize }`.

Data: one result per operator, in canonical order `and, or, xor, add, sub`:

```json
{ "width": 64,
  "a": { "hex": "8ADEFEDA85210125", "popcount": 30 },
  "b": { "hex": "FFFFFFFF00000000", "popcount": 32 },
  "truthCounts": [23, 11, 9, 21],
  "results": [
    { "op": "and", "z": "8ADEFEDA00000000", "popcount": 21, "carry": null, "borrow": null },
    { "op": "or",  "z": "FFFFFFFF85210125", "popcount": 41, "carry": null, "borrow": null },
    { "op": "xor", "z": "7521012585210125", "popcount": 20, "carry": null, "borrow": null },
    { "op": "add", "z": "…", "popcount": 0, "carry": true, "borrow": null },
    { "op": "sub", "z": "…", "popcount": 0, "carry": null, "borrow": true }
  ] }
```

### `parse_dataset`
Args: `{ text: string, maxRows?: integer 1..512 = 64 }`.

Parses CSV/TSV with the same reader typing rules as the import path
(`src/core/csv.ts`): delimiter sniffed from the header, header detected when the first
row is not token-shaped, per-column type `bin` when every token is 0/1 else `hex`.
Data:

```json
{ "columns": [
    { "name": "Hex 1", "mode": "bin", "widthBits": 8 },
    { "name": "Hex 2", "mode": "hex", "widthBits": 32 } ],
  "totalRows": 1, "truncated": false,
  "rows": [["00000001", "00000002"]] }
```

Caps: `text` ≤ 262144 characters (`E_INPUT_TOO_LARGE`), at most 64 columns
(`E_INPUT_TOO_LARGE`), empty/no rows → `E_EMPTY_INPUT`. `truncated` is true when
`totalRows > maxRows`.

### `build_deeplink`
Args: `{ project: object, base?: string }` (`project` is a `.bitwave` schema 2 or 3 document).

Validates with `deserializeProject` (throws `E_INVALID_PROJECT` on malformed/newer/
foreign documents), re-serializes canonically **without `savedAt`** (so a state has one
link), and returns:

```json
{ "fragment": "#bw=…", "payloadChars": 1180, "withinBudget": true,
  "datasetDropped": false, "url": "http://localhost:8000/#bw=…" }
```

- `payloadChars` counts the characters after `bw=` (no `#`); budget is `SHARE_MAX_CHARS`
  (2000, §10.41).
- If the dataset would overflow the budget and a dataset is present, drop it, set
  `datasetDropped:true`, and return the smaller link; if it still overflows →
  `E_INPUT_TOO_LARGE`.
- `url` is `null` when `base` is omitted; otherwise `base` (an absolute URL without a
  fragment) with the `#bw=…` fragment appended.
- The fragment must round-trip: `parseShareHash(fragment)` deserializes to the same
  engine state.

## 4. Envelope and error codes

Success / failure exactly as §2. Closed v1 error set:

| code | when |
|---|---|
| `E_BAD_ARGS` | wrong type/shape, unknown key, non-integer where integer required |
| `E_UNKNOWN_TOOL` | name not in the registry |
| `E_EMPTY_INPUT` | empty required text/hex |
| `E_INVALID_HEX` | not hexadecimal |
| `E_INVALID_PROJECT` | `.bitwave` document malformed, newer schema, or foreign app |
| `E_BAD_ENUM` | enum value not in the documented set (width, op, view, frame, …) |
| `E_OUT_OF_RANGE` | bounded integer outside its range (index, rate, maxRows) |
| `E_INPUT_TOO_LARGE` | over a documented cap (text length, columns, share budget) |
| `E_DRIVEN_INPUT` | tried to write an operand that a route or expression drives |
| `E_BAD_STATE` | a well-formed patch that cannot apply (no dataset for an index, CSV with no numeric columns) |
| `E_INVALID_EXPRESSION` | expression did not parse or type-check (message/hint carry the evaluator's reason) |
| `E_INTERNAL` | unexpected failure; never leak a stack |

Setters may also return `E_BAD_STATE` for a well-formed patch that cannot apply. All codes are exported in the manifest (`errorCodes`).

## 5. Deeplink grammar

BitWave's view state is already the URL fragment (`#bw=`), produced by
`shareFragment(doc)` (`src/core/share.ts`):

```
bitwave-v2.html#bw=<unpadded base64url(UTF-8 JSON .bitwave schema 3)>
```

- Parse/validate with `parseShareHash(hash)`; a corrupt payload is refused; a hash
  without `bw=` is ignored.
- Boot priority is shared link → autosave → defaults; `?fresh` disables autosave and
  sharing (an ephemeral session).
- The app mirrors settled state with a debounced `history.replaceState` (~550 ms),
  never `pushState`; reloading a link reproduces the state. Works over `file://`.
- Canonical links omit `savedAt`, so equal state ⇒ equal link (the live app and
  `build_deeplink` share this rule).
- A link is portable only when the app file is available; the CLI/MCP path needs no URL.

## 6. UI state — `getState()` and `#bitwave-state`

The hidden node `<pre id="bitwave-state" data-schema-version="1" hidden>` always exists
once mounted and contains `JSON.stringify(getState())`. `getState()` returns:

```json
{
  "schemaVersion": 1,
  "ready": true,
  "width": 64,
  "lane": 1,
  "frame": "A",
  "view": { "mode": "2d", "splitPair": [1, 2], "activePane": 0 },
  "lanes": {
    "1": {
      "lane": 1,
      "frames": { "A": "8ADEFEDA85210125", "B": "FFFFFFFF00000000", "Z1": "7521012585210125" },
      "binop": "xor", "focus": "A", "edit": "A", "lfoB": "0",
      "showB": true, "seededB": true,
      "visibility": { "A": true, "B": true, "Z1": true },
      "sources": {
        "A": { "kind": "data", "column": "Hex 1", "index": 0 },
        "B": { "kind": "frame", "source": "2:1", "lane": 2, "frame": "C" }
      },
      "driven": { "A": false, "B": true },
      "expressions": { "A": null, "B": "round(1.2599210498948732 * C)" },
      "derived": { "Z1": { "hex": "7521012585210125", "popcount": 20, "truthCounts": [23, 11, 9, 21] } }
    }
  },
  "lfo": { "on": false, "mode": "rotcw", "rate": 4 },
  "dataset": { "columns": ["Hex 1"], "rows": 8, "index": 0, "row": ["00000001"] },
  "editing": { "copyArmed": false, "enabled": true },
  "recording": { "on": false, "rows": 0 },
  "deeplink": "file:///…/bitwave-v2.html#bw=…",
  "bridge": { "schemaVersion": 1, "version": "1.1.0" }
}
```

- Keys `schemaVersion, ready, width, lane, frame, view, lanes, lfo, dataset, editing,
  recording, deeplink, bridge` are always present; `dataset` is `null` when empty.
- Frame names are global: lane 1 `A/B/Z1`, lane 2 `C/D/Z2`, lane 3 `E/F/Z3`.
- `derived` is computed from the shared core (`computeZ`, `truthCounts`, `popcountZ`),
  never copied from the DOM.
- `frame` is the focused frame's global name; `lane` is the focused lane.
- `lfo.on` is transient app state (not stored in `.bitwave`).
- `sources.kind` is `"data"`, `"frame"`, `"expr"` or `"none"`; `driven` is true when a
  route targets that operand. `expressions` carries the expression text per operand
  (`null` when not an expression source); an expression source is read-only locally and
  sets `editing.enabled` false when focused.
- `recording` is transient: the armed flag and the current row count (the rows themselves
  are available only via `getLog()`); the log is not persisted in `.bitwave`/links.
- The shape is stable; add keys, never repurpose them without a schema bump.

## 7. Browser bridge — `window.bitwave`

```js
window.bitwave = {
  schemaVersion: 1, version: "1.1.0", ready: true,
  getState(), getManifest(), tools(), call(name, args),
  getDeeplink(),
  setState(patch), setLane(n), setFrame(name), setView(mode), setWidth(bits),
  setRegister(frame, hex), setBinop(op), setLfo(patch), setDataset(patch),
  stepDataset(delta), reset(),
  setExpression(frame, text), record(on), getLog({ limit } = {}),
  subscribe(fn),
};
```

Behaviour that must hold:

- setters never throw; invalid args return `{ok:false, error:{code,message,hint?}, state}`;
- after a setter returns, `getState()` reflects the new values synchronously;
- a setter that changes nothing returns `{ok:true, state, warnings:[]}` **and emits no
  change event**;
- `subscribe(fn)` fires immediately once with the current state, then on genuine
  changes; unsubscribe is idempotent; throwing subscribers are isolated;
- `call(name, args)` returns the same envelope as CLI/MCP for the same inputs;
- `getDeeplink()` returns the absolute current URL (address bar after the setter's
  immediate `replaceState`).

Setters are applied through the instrument's own commands (store transaction, routing
evaluation, renderers) — never by writing DOM state directly. Patch keys (closed set;
unknown key → `E_BAD_ARGS`; all validation happens before any mutation):

| key | value | effect |
|---|---|---|
| `lane` | `1 \| 2 \| 3` | focus that lane (same as the stage bar) |
| `frame` | `A`–`F`, `Z1`–`Z3` | focus lens; derived frames are allowed (read-only) |
| `view` | `"2d" \| "3d" \| "split"` | view mode (`split` implies 3-D) |
| `width` | `8 \| 16 \| 32 \| 64 \| 128 \| 256` | centre-pinned resize |
| `register` | `{ frame: A–F, hex: string }` | writes an operand; `E_DRIVEN_INPUT` when routed; `E_BAD_ENUM` for derived frames |
| `binop` | `and \| or \| xor \| add \| sub` | lane operator |
| `lfo` | `{ on?: boolean, mode?: "rotcw"\|"rotccw"\|"slide"\|"csvStep", rate?: 1\|2\|4\|8 }` | start/stop keeps the snapshot/restore discipline; mode/rate restart the shape |
| `dataset` | `{ csv?: string, index?: integer }` | load CSV/TSV text and/or step to a row; `index` requires a dataset |
| `expression` | `{ frame: A–F, text: string }` | bind/clear a deterministic expression source (`""` clears; `E_INVALID_EXPRESSION` on bad text; clears any route/data on that operand) |
| `record` | `boolean` | `true` arms a fresh transient take, `false` freezes; rows are read via `getLog()` |
| `reset` | `true` | boot state, same as `reset instrument` |

Individual setters are thin wrappers: `setLane(n)` = `setState({lane:n})`, etc.
`getLog({limit})` returns the newest recorded rows (default all, newest-last), each
`{step, frames:{A,B,Z1,C,D,Z2,E,F,Z3}}` as uppercase hex; `limit` must be a non-negative
integer. Recording is transient and never stored in the project/link.

Automation hooks (additive attributes only):

- `document.body` carries `data-agent-ready="true"` once mounted;
- `<pre id="bitwave-state" data-schema-version="1" hidden>` as in §6;
- `window` events `bitwave:ready` and `bitwave:change` (`detail` = state, exactly one
  change on install);
- help panel tabs carry `data-agent-tab="keys|agent"`; their panels carry
  `data-agent-panel="keys|agent"`; lane buttons carry `data-agent-lane="1|2|3"`; frame
  navigator rows carry `data-agent-frame="A|B|Z1"`;
- agent panel status text: `[data-agent-status="bridge-active"]`.

## 8. Manifest (`getManifest()` / `agent/manifest.json`)

```json
{
  "id": "bitwave", "title": "BitWave", "version": "1.1.0", "schemaVersion": 1,
  "description": "…",
  "urls": { "app": "bitwave-v2.html", "manifest": "agent/manifest.json",
            "agents": "AGENTS.md", "interface": "docs/AGENT-INTERFACE.md" },
  "deeplink": { "template": "bitwave-v2.html#bw={payload}", "prefix": "#bw=",
                "budgetChars": 2000, "defaults": { "lane": 1, "view": "2d" } },
  "ui": { "bridge": "window.bitwave", "ready": "body[data-agent-ready='true']",
          "stateSelector": "#bitwave-state", "panelSelector": "[data-agent-panel]",
          "tabSelector": "[data-agent-tab]", "laneSelector": "[data-agent-lane]",
          "frameSelector": "[data-agent-frame]" },
  "tools": [ /* ToolDefs without run functions, canonical order */ ],
  "errorCodes": [ /* closed set */ ],
  "invariants": [
    "src/core is the only implementation of the maths/data",
    "tool output is deterministic; no timestamps or randomness",
    "pure tools never mutate the UI",
    "the URL is the UI state and reload reproduces the view",
    "default rendered instrument is unchanged by the agent layer"
  ],
  "relatedTools": []
}
```

`agent/manifest.json` must be byte-identical to
`JSON.stringify(getManifest(), null, 2) + "\n"`.

## 9. CLI — `agent/cli.mjs`

```
node agent/cli.mjs <command> [flags] [--json]
```

Commands: `manifest`, `analyze_register`, `evaluate_lane`, `compare_operands`,
`parse_dataset`, `deeplink`, `state`, `artifacts`, `selftest`, `help`.

- Flags accept `--flag value` and `--flag=value`: `--hex`, `--a`, `--b`, `--op`,
  `--width`, `--text`, `--max-rows`, `--project <path>`, `--base`, `--index`,
  `--check`, `--json`.
- Default output is a compact human summary; `--json` prints exactly the envelope and
  nothing else on stdout. Diagnostics go to stderr.
- Exit codes: `0` success, `2` usage, `3` tool error (`E_*`), `4` internal.
- `state` composes the UI-state object headlessly (`--project` optional; boot document
  otherwise) and prints it without an envelope. Headless state has no page URL, so
  `state.deeplink` is the manifest-relative template `bitwave-v2.html#bw=<payload>`;
  `--base` prefixes it. In the browser, `getState().deeplink` is the absolute live URL.
  `--index` sets the dataset cursor for `state` and requires a project that carries a
  dataset.
- `deeplink` accepts `--project <path>`; without it it uses the boot document.
- `artifacts --check` forwards the generator exit code; `selftest` runs
  `agent/selftest.mjs`. `artifacts --json` prints one JSON result
  (`{ok, mode, files, missing, stale}`), which is not a tool envelope.

## 10. MCP stdio server — `agent/mcp-server.mjs`

Newline-delimited JSON-RPC 2.0 over stdio, zero dependencies.

- `initialize` → `{ protocolVersion: "2025-06-18", capabilities: { tools: {} },
  serverInfo: { name: "bitwave", version: "1.1.0" } }`
- `notifications/initialized` → no response.
- `ping` → `{}`.
- `tools/list` → `{ tools: [{ name, description, inputSchema }] }` (pure tools only).
- `tools/call` → `{ content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
  isError: false }`; invalid arguments still return the failure envelope with
  `isError:true`.
- Parse error `-32700`, invalid request `-32600`, unknown method `-32601`, internal
  `-32603`; never log to stdout.

## 11. Static artifacts

Generated by `agent/gen-agent-artifacts.mjs`, committed, deterministic:

```
agent/manifest.json                    # byte-identical to getManifest()
agent/examples/manifest.json           # envelope whose data is the manifest
agent/examples/analyze_register.json
agent/examples/evaluate_lane.json
agent/examples/compare_operands.json
agent/examples/parse_dataset.json
agent/examples/build_deeplink.json
agent/examples/README.md               # generated index
```

`--check` recomputes and exits non-zero on any stale/missing file. `npm run build:pwa`
copies this tree into `dist/hosted/agent/` so a served instance exposes it; the
single-file artifact gains no references.

## 12. Acceptance checks

```powershell
npm test
npm run typecheck
npm run build
node agent/gen-agent-artifacts.mjs --check
node agent/selftest.mjs
node agent/verify-browser.mjs
```

Plus the existing gates: `npm run check:browser` and `npm run check:pwa`. Pixel parity is
compared against the artifact that introduced the current UI slice (the external-routing
slice intentionally adds the Record control, so pre-slice parity no longer applies).

Browser checks must include: readiness marker, hidden state === `getState()`, one
`bitwave:change` on mount, no event for a no-op setter, synchronous setter reads,
invalid setter errors, a deeplink reload reproducing state twice, the agent panel
status, no horizontal overflow at 360/720/1440, and for the external-routing slice:
expression text in `lanes[*].expressions`, `setExpression` changing D/Z2 with one event,
`E_INVALID_EXPRESSION` on bad text with no mutation, `record`/`getLog` rows and
`recording.rows` in state, and the source-table expression editor + Record toggle.

## 13. File ownership (when multiple agents build this)

| Owner | Files |
|---|---|
| Lead | `docs/AGENT-INTERFACE.md`, `AGENTS.md`, `llms.txt`, `src/core/agent-*.ts`, `tests/agent-*.test.ts`, `package.json`, final integration |
| bridge-ui | `src/agent/**`, `src/ui/agent-panel.js`, `src/ui/help.js`, `src/main.js`, `src/index.html`, `src/styles/app.css` |
| node-transports | `agent/cli.mjs`, `agent/mcp-server.mjs`, `agent/selftest.mjs`, `agent/gen-agent-artifacts.mjs`, `agent/examples/**`, `agent/manifest.json` |
| docs-verify | `docs/AGENT-SCREENSHOTS.md`, `docs/BITWAVE-ECOSYSTEM-MAP.md`, `README.md`, `agent/verify-browser.mjs`, `docs/agent/*.png`; reports defects, edits no code |

The verifier derives expectations from `src/core` and the contract, not from the page's
own helpers. The Lead runs final acceptance.


