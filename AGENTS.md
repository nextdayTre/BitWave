# AGENTS.md — BitWave

BitWave is a single-file, offline instrument that renders a bit register as a wavetable:
every nibble is a sample, bitwise/arithmetic operators behave like DSP operations, and
up to **eight lanes** (`1`–`8`; the default instrument boots with three, `1/2/3`) each
compute `Z = A <op> B`. It answers "what does this word look
like, and what does this operation do to it?" — for teaching, research and bit-level
play.

Everything the agent layer exposes is derived from the same DOM-free core
(`src/core/*.ts`), so the UI, `window.bitwave`, the CLI and the MCP server cannot
disagree: one implementation, one envelope, deterministic output.

Onboarding path: this file → the normative contract
[`docs/AGENT-INTERFACE.md`](docs/AGENT-INTERFACE.md). User docs:
[`README.md`](README.md). Version: toolset `1.4.0`, state schema `1`, `.bitwave` schema
`4` (schema 1/2/3 still load and upgrade). Toolset 1.4.0 is the dynamic-lanes slice:
lanes are a live 1–8 set, frames are `A`–`P`/`Z1`–`Z8`, and the bridge focuses only lanes
the tree carries.

## Quick start

The instrument needs no install: open **`bitwave-v2.html`** in any browser (works from
`file://`, no server, no network). The agent transports need **Node ≥ 23.6** (the repo's
tests use native TypeScript type-stripping) and, for tests/build, `npm install` once.

```powershell
npm test                                   # DOM-free core + app state tests
npm run typecheck                          # core typecheck
npm run build                              # src/ -> bitwave-v2.html (single file)
node agent/cli.mjs help                    # agent CLI
node agent/cli.mjs manifest --json         # capability manifest
node agent/cli.mjs selftest                # CLI + MCP + vectors
node agent/mcp-server.mjs                  # MCP server over stdio
node agent/gen-agent-artifacts.mjs --check # generated manifest/examples current
```

The CLI and MCP server have **zero extra dependencies** and need neither a browser nor a
server. The browser layer works directly from the committed single file.

## The mental model

A lane is three frames: operand `A`, derived `Z`, operand `B`. One shared register width
(`8/16/32/64/128/256` bits). Frame names are global and derive from the stable lane key:
lane 1 `A/B/Z1`, lane 2 `C/D/Z2`, lane 3 `E/F/Z3`, lane 4 `G/H/Z4`, … lane 8 `O/P/Z8`
(the closed agent vocabulary is `A`–`P` plus `Z1`–`Z8`; the `1`–`13` ceiling remains a
grammar limit, not a shipped cap). The live instrument holds 1–8 lanes; the default
document still boots with three and new lanes are added in the frames view. A CSV/TSV
dataset can drive any of the `2L` operands; a routed input is *driven* and
read-only. An operand can also be a deterministic **expression source** (`expr`),
evaluated on every clocked update with the current frames plus the previous
`log.<frame>` snapshot; **Record** appends one transient row of all `3L` frames per
settled update (in memory only, not in the project or link).

| step | object | what happens |
|---|---|---|
| 0 | operand bits | drag/click/wheel, presets, unary ops, CSV, LFO |
| 1 | routes | driven inputs are sampled and written in dependency order |
| 2 | derived `Z` | `A <op> B` for each lane (`and or xor add sub`) |
| 3 | render | canvas wave, strip, truth table, readouts follow the state |

Canonical values (64-bit; also tested in `tests/design-invariants.test.ts`):

| check | value |
|---|---|
| XOR `8ADEFEDA85210125 ⊕ FFFFFFFF00000000` | `7521012585210125` (popcount 20) |
| AND / OR | `8ADEFEDA00000000` (popcount 21) / `FFFFFFFF85210125` |
| truth counts for that pair | `23 11 9 21` (sum 64) |
| `ROL 4 FEDCBA9876543210` | `EDCBA9876543210F` |
| `NOT FEDCBA9876543210` | `0123456789ABCDEF` (DESIGN §11 errata) |
| `BSWAP FEDCBA9876543210` | `1032547698BADCFE` |

Defaults: 64-bit, lane 1 focused, 2-D view, sine/square lane 1, cosine/triangle lane 2,
saw-up/sine `AND` lane 3.

## Three ways for an agent to interact

### 1. URL deep links

The URL fragment is the whole view state, written by the canonical **compact codec**
(D45; legacy JSON links from earlier builds still decode and upgrade — schemas 1–4):

```
bitwave-v2.html#bw=<unpadded base64url(UTF-8 compact JSON array)>
```

- The compact payload is `[tag=4, N, view, lanes, routes, parked, dataset?, x?]`: lane
  tuples with documented defaults omitted, route triples, parked bases, register words
  as raw-bit base64url, and unknown top-level fields carried under `x`. The full layout is
  in `docs/AGENT-INTERFACE.md` §5 and `DECISIONS.md` D45.
- A document is a lane map keyed by the stable lane key (`"1"`..`"13"`, gaps allowed, at
  most 8 lanes, ascending numeric key order); a schema 1/2/3 document is the closed
  three-lane object. Z is never stored. The shipped live range is 1–8, matching the agent
  enums; a document may carry a subset (e.g. `examples/eight-lanes.bitwave.json`).
- Build canonical links headlessly with `node agent/cli.mjs deeplink --project
  examples/demo.bitwave.json --base "file:///C:/path/to/bitwave-v2.html" --json`
  (or `window.bitwave.getDeeplink()` in a live page). The address bar, `getDeeplink()`,
  `build_deeplink` and the CLI all write the same payload for the same state.
- Canonical links omit `savedAt`, so equal state ⇒ equal link; the app mirrors settled
  state with `history.replaceState` (debounced, no history entries).
- The 2000-character budget drops the dataset first (`datasetDropped`) and expression
  sources second (`expressionsDropped`) with explicit flags; an 8-lane 256-bit document
  measures 1260 characters (`node tools/share-budget.mjs`).
- Reloading a link reproduces the state; a corrupt payload is refused; `?fresh` disables
  autosave and sharing.
- Links work over `file://` because only the fragment is used. Over `file://` a copied
  link is only portable to the same file path.

### 2. Browser bridge — `window.bitwave`

```js
window.bitwave.schemaVersion            // 1
window.bitwave.version                  // "1.4.0"
window.bitwave.getState()               // full UI state (§6 of the contract)
window.bitwave.getManifest()            // manifest data
window.bitwave.tools()                  // tool definitions
window.bitwave.call("compare_operands", { a: "8ADEFEDA85210125", b: "FFFFFFFF00000000" })
window.bitwave.setState({ lane: 2 })    // setters never throw; lanes 1–8, live only
window.bitwave.setLane(8)               // E_OUT_OF_RANGE unless lane 8 is live
window.bitwave.setFrame("O")            // frame names A–P / Z1–Z8 (live lane only)
window.bitwave.setRegister("A", "DEADBEEF")
window.bitwave.setExpression("D", "round(1.2599210498948732 * C)") // expr source
window.bitwave.setRoute("D", "1.z")     // or setSource("D", {kind:"frame", from:"1.z"})
window.bitwave.setSource("D", { kind: "none" })
window.bitwave.record(true)             // arm a transient take
window.bitwave.getLog({ limit: 8 })     // recorded frame rows
window.bitwave.record(false)
window.bitwave.setLfo({ on: true })
window.bitwave.stepDataset(+1)
window.bitwave.reset()
window.bitwave.getDeeplink()            // absolute current URL
const off = window.bitwave.subscribe(state => console.log(state));
```

`call` returns the same envelope as the CLI/MCP. Setters return `{ok, state}` or
`{ok:false, error, state}`; after one returns, `getState()` already reflects it; a no-op
setter emits no change event. Lane/frame setters accept the shipped 1–8 range but require
the lane to be live in the tree, so `setLane(8)` on the three-lane boot returns
`E_OUT_OF_RANGE` rather than creating a lane. The legacy read-only `window.BitWave`
(`state/bindings/geometry/frames`, schema 1) is unchanged.

**Headless state extraction without a driver.** The page exposes
`body[data-agent-ready="true"]`, a hidden
`<pre id="bitwave-state" data-schema-version="1">` containing
`JSON.stringify(getState())`, and `bitwave:ready` / `bitwave:change` events:

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
& $chrome --headless=new --disable-gpu --no-first-run `
  --user-data-dir="$env:TEMP\bitwave-chrome" --virtual-time-budget=5000 `
  --dump-dom "file:///C:/path/to/bitwave-v2.html" |
  Select-String -Pattern 'id="bitwave-state"'
```

On Windows use a fresh `--user-data-dir` per invocation and wait for the process; see
[`docs/AGENT-SCREENSHOTS.md`](docs/AGENT-SCREENSHOTS.md).

The in-app human-readable surface is the **agent tab of the help panel**: open `?`, then
the `agent` tab, for bridge status, copy-prompt/deeplink/state buttons, the live state
JSON and the tool catalogue.

### 3. Node CLI and MCP server

Both import `src/core/agent-tools.ts` directly — no browser, no dev server.

```powershell
node agent/cli.mjs manifest --json
node agent/cli.mjs analyze_register --hex 8ADEFEDA85210125 --width 64 --json
node agent/cli.mjs evaluate_lane --a 8ADEFEDA85210125 --b FFFFFFFF00000000 --op xor --json
node agent/cli.mjs compare_operands --a 8ADEFEDA85210125 --b FFFFFFFF00000000 --json
node agent/cli.mjs parse_dataset --text "Hex 1,Hex 2`n00000001,00000002" --json
node agent/cli.mjs deeplink --project examples/demo.bitwave.json --json
node agent/cli.mjs state --json
node agent/cli.mjs artifacts --check
node agent/cli.mjs selftest
```

`--json` prints only the envelope on stdout (diagnostics to stderr). Exit codes:
`0` success, `2` usage, `3` tool error (`E_*`), `4` internal.

**MCP stdio server** — newline-delimited JSON-RPC 2.0, protocol `2025-06-18`, zero
dependencies. Exposes every pure tool via `tools/list` / `tools/call`; results are the
JSON envelope as text. Start with `node agent/mcp-server.mjs`. Client config (absolute
path required):

```json
{ "mcpServers": { "bitwave": {
  "command": "node",
  "args": ["C:\\Users\\<you>\\Documents\\BitWave\\agent\\mcp-server.mjs"]
} } }
```

## Where the truth lives

| file | role |
|---|---|
| `src/core/registers.ts`, `ops.ts`, `derive.ts`, `routing.ts`, `project.ts`, `share.ts`, `csv.ts` | the only implementation of the maths/data (DOM-free) |
| `src/core/agent-tools.ts` | registry, envelope, deeplink builder, manifest, patch validation |
| `src/core/agent-state.ts` | pure UI-state builder shared by browser and CLI |
| `src/state/project-bridge.ts` | app ↔ `.bitwave` schema-4 mapping (`captureProject`/`applyProject`; lane-key map) |
| `src/agent/bridge.js` | `window.bitwave` installation and event semantics |
| `src/ui/agent-panel.js` | the help-panel agent tab |
| `agent/cli.mjs`, `agent/mcp-server.mjs` | headless transports |
| `agent/manifest.json`, `agent/examples/` | generated static artifacts |
| `docs/AGENT-INTERFACE.md` | normative contract |

Rules:

1. One implementation; never re-implement in a transport or panel.
2. Deterministic output; no timestamps, randomness or locale formatting.
3. Fixed envelope; closed error-code set.
4. Pure tools are read-only; UI changes only through bridge setters.
5. Additive changes only; the default instrument's visual/behavioral contract stays
   unless a reviewed UI slice explicitly changes it (the external-routing slice added the
   Record control and expression editors by design; the dynamic-lanes slice replaced the
   stage-bar lane buttons with a lane dropdown and added the frames-view lane-management
   controls by design; the GUI-rearrangement slice (D47) re-homed the view toggle into the
   top bar, the hinge and copy menu into each pane head, and the truth table into an
   always-present readout disclosure — a layout change with unchanged behaviour).

Acceptance checks:

```powershell
npm test
npm run build
node agent/gen-agent-artifacts.mjs --check
node agent/selftest.mjs
node agent/verify-browser.mjs
```

## Resource map

| path | what |
|---|---|
| `bitwave-v2.html` | the shipped single-file instrument (generated from `src/`) |
| `docs/AGENT-INTERFACE.md` | contract: tools, envelope, deeplink, state, bridge, CLI, MCP |
| `docs/AGENT-SCREENSHOTS.md` | reproducible states + headless Chrome recipes |
| `docs/BITWAVE-ECOSYSTEM-MAP.md` | sibling tools and what a handoff would carry |
| `docs/DYNAMIC-LANES.md` | design note (shipped): lane-count ceiling (13/8), the live 1–8 lane set, `+`/dup/del, compact share budget; D43–D46 |
| `docs/EXTERNAL-ROUTING.md` | shipped slice: Record/log and expression operands (schema 3, toolset 1.1.0) |
| `agent/manifest.json` | generated capability manifest (tools, selectors, errors) |
| `agent/examples/` | generated example envelopes, one per tool |
| `agent/README.md` | transports guide: CLI commands, MCP server, selftest, generator |
| `agent/verify-browser.mjs` | independent CDP checklist for the agent layer |
| `examples/eight-lanes.bitwave.json` | committed eight-lane schema-4 fixture (used by the tests, verifier and screenshot recipe) |
| `docs/agent/*.png` | reproducible screenshots of the documented states (six now, including eight-lanes) |
| `llms.txt` | compact machine onboarding |
| `spike/` | design spikes (not shipped) |

## Screenshot and teaching workflow

The URL state is the screenshot contract: reloading a deeplink reproduces the view.
Serve the file (or open it directly) and capture with headless Chrome using a fresh
profile:

```powershell
& $chrome --headless=new --disable-gpu --hide-scrollbars `
  --window-size=1440,900 --virtual-time-budget=5000 `
  --screenshot="docs\agent\default.png" `
  "file:///C:/path/to/bitwave-v2.html#bw=..."
```

Useful states: default 64-bit lane 1; an A·B pair (`8ADE… ⊕ FFFF…`); a width change; the
agent tab; and an eight-lane document (`examples/eight-lanes.bitwave.json`, lane 8
focused). Prefer a deeplink + state JSON pair over prose for teaching material.

## Troubleshooting

- **`window.bitwave` missing** — the page did not boot, or was built before the agent
  layer; check the console and `body[data-agent-ready]`.
- **Hidden state empty** — page not mounted; the node is filled on install and after
  every change.
- **CLI/MCP fails on `.ts` imports** — use Node ≥ 23.6 (native type-stripping).
- **Blank headless screenshot** — a normal Chrome session swallowed it; use a unique
  `--user-data-dir` and wait for the process (`Start-Process -Wait` on Windows).
- **Deeplink from `file://` in another browser** — a fragment is local to that file path;
  use `build_deeplink` with a served `base` for portable links.
- **Port/served mode** — the hosted build (`npm run build:pwa` → `dist/hosted/`) also
  serves `agent/` and `llms.txt`; the single-file artifact never fetches them.

## Preserved interop intent (author, 2026-11-06)

The original direction still governs this layer: state is the source of truth (never
infer it from pixels); capture is a render, not a screenshot; surfaces are explicit,
local and revocable; changes are additive and the human instrument stays primary; what
leaves carries a schema/version and provenance. The previous read-only
`window.BitWave` contract (schema 1) remains exactly as documented in the contract's
legacy appendix — this layer adds a command bridge beside it, it does not replace it.

**Non-goals:** screenshot-driven automation, telemetry/background network calls,
replacing the human UI, or making the agent API the only way to reach state.
