# BitWave agent transports

The headless half of BitWave's agent layer: a zero-dependency CLI and an MCP
stdio server that import the same DOM-free core as the browser instrument
(`src/core/*.ts`). Neither needs a browser, a server, a build step or a package
beyond Node ≥ 23.6 (native TypeScript type-stripping).

Normative contract: [`docs/AGENT-INTERFACE.md`](../docs/AGENT-INTERFACE.md) §9
(CLI), §10 (MCP), §11 (static artifacts). Onboarding: [`AGENTS.md`](../AGENTS.md).

## CLI — `node agent/cli.mjs`

```
node agent/cli.mjs <command> [flags] [--json]
```

| command | what it prints |
|---|---|
| `manifest` | capability manifest: tools, schemas, selectors, error codes, invariants |
| `analyze_register` | normalized hex, decimal, nibbles, popcount, bit length |
| `evaluate_lane` | `Z = A <op> B`, truth counts, carry/borrow |
| `compare_operands` | all five operators for one A/B pair, in canonical order |
| `parse_dataset` | CSV/TSV columns (bin/hex typing), row count, first rows |
| `deeplink` | canonical `#bw=` compact link from a `.bitwave` document (legacy JSON links still load; boot document when `--project` is omitted) |
| `state` | the headless UI state object (`getState()` shape, no envelope) |
| `artifacts` | regenerate `agent/manifest.json` and `agent/examples/**` (`--check` verifies) |
| `selftest` | runs `node agent/selftest.mjs` |
| `help` | usage text |

Flags accept both forms, `--flag value` and `--flag=value`: `--hex`, `--a`,
`--b`, `--op`, `--width`, `--text`, `--max-rows`, `--project <path>`, `--base`,
`--index`, `--check`, `--json`.

- `--json` prints exactly one JSON envelope (the tool result) on stdout; all
  diagnostics go to stderr. Human output is compact and deterministic.
- `state --json` prints the UI-state object itself (no envelope), because §6 is
  what the browser also exposes. Its `deeplink` is the canonical relative
  `bitwave-v2.html#bw=…` link, or `--base` + fragment when supplied. `--index`
  moves the dataset cursor before the state is captured.
- `deeplink` validates the document through `build_deeplink`; malformed,
  newer-schema or foreign documents fail with `E_INVALID_PROJECT`. The result
  reports `payloadChars`, `withinBudget` and the explicit `datasetDropped` /
  `expressionsDropped` flags (the dataset drops first, then expression sources,
  when the 2000-character budget would overflow; `node tools/share-budget.mjs`
  prints the measured table).

Exit codes: `0` success, `2` usage (bad flag/command/file), `3` tool error
(closed `E_*` set), `4` internal. `artifacts --check` forwards the generator's
exit code (`1` when a generated file is stale or missing).

```powershell
node agent/cli.mjs manifest --json
node agent/cli.mjs analyze_register --hex 8ADEFEDA85210125 --width 64 --json
node agent/cli.mjs evaluate_lane --a 8ADEFEDA85210125 --b FFFFFFFF00000000 --op xor --json
node agent/cli.mjs compare_operands --a 8ADEFEDA85210125 --b FFFFFFFF00000000 --json
node agent/cli.mjs parse_dataset --text "Hex 1,Hex 2`n00000001,00000002" --json
node agent/cli.mjs deeplink --project examples/demo.bitwave.json --base "http://localhost:8000/" --json
node agent/cli.mjs state --json
node agent/cli.mjs artifacts --check
node agent/cli.mjs selftest
```

## MCP stdio server — `node agent/mcp-server.mjs`

Newline-delimited JSON-RPC 2.0 over stdio, protocol `2025-06-18`, zero
dependencies. Stdout is the protocol channel and never carries logs; a clean
stdin EOF exits 0.

- `initialize` → `{ protocolVersion: "2025-06-18", capabilities: { tools: {} },
  serverInfo: { name: "bitwave", version: "1.3.0" } }`
- `notifications/initialized` → no response
- `ping` → `{}`
- `tools/list` → `{ tools: [{ name, description, inputSchema }] }` (the six pure tools)
- `tools/call` → `{ content: [{ type: "text", text: <envelope JSON> }], isError }`;
  a failure envelope is returned with `isError: true` (never a crash)
- parse error `-32700`, invalid request `-32600`, unknown method `-32601`,
  internal `-32603`

Client configuration (absolute path required):

```json
{ "mcpServers": { "bitwave": {
  "command": "node",
  "args": ["C:\\Users\\<you>\\Documents\\BitWave\\agent\\mcp-server.mjs"]
} } }
```

## Generated artifacts

`node agent/gen-agent-artifacts.mjs` writes, deterministically and with no
timestamps:

```
agent/manifest.json                 byte-identical to JSON.stringify(getManifest(), null, 2) + "\n"
agent/examples/<tool>.json          one success envelope per pure tool (its first documented example)
agent/examples/README.md            generated index
```

`--check` recomputes in memory and exits `1` on any stale or missing file, so a
commit or CI run can gate on `node agent/gen-agent-artifacts.mjs --check` (also
available as `node agent/cli.mjs artifacts --check`). Regenerate after changing
`src/core/agent-tools.ts`; never hand-edit these files.

## Selftest

`node agent/selftest.mjs` spawns the CLI and MCP server as child processes and
recomputes the expected vectors here instead of trusting the core: nibbles and
popcount from the hex text, XOR/AND/OR/ADD/SUB with BigInt maths, truth counts
from a per-bit loop. It also checks that `--json` stdout is exactly one
envelope, that the canonical deeplink round-trips through `parseShareHash` to a
loadable project, that generated artifacts are current, and that the MCP
handshake/`tools/list`/`tools/call`/error paths behave. It prints one
`PASS`/`FAIL` line per check plus a final count and exits non-zero on failure.

## Design rules this directory follows

1. One implementation — the CLI/MCP call `callTool`/`getManifest`; they never
   re-implement register maths, project shapes or deeplinks.
2. Deterministic output — no timestamps, randomness or locale formatting; the
   same input serializes byte-identically.
3. One envelope, one closed error-code set — the CLI/MCP/browser envelopes are
   the same object.
4. Pure tools are read-only — no transport writes project state or files (the
   artifact generator is an explicit, separate command).
5. Additive — the default rendered instrument is unchanged by this directory.
