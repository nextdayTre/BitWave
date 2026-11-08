# BitWave ecosystem map — live and planned

This page is the honest cross-tool map for BitWave: what it *is* connected to, what it
could be connected to, and how a handoff would carry state. It exists so nobody has to
guess from prose or invent a link.

**BitWave is standalone in v1.** In `agent/manifest.json`, `relatedTools` is `[]` — an
empty list, a reserved slot. There is no shared package, no cross-repository import, no
network call and no file exchange with another tool. Every statement below marked
**planned** is design intent, not shipped behaviour. Nothing here claims a live link that
does not exist.

## Live in v1: none

| question | answer | evidence |
|---|---|---|
| Does BitWave call another tool? | No | `agent/manifest.json` → `"relatedTools": []` |
| Does a sibling import BitWave? | No | the sibling tools listed below contain no BitWave references (searched 2026-11-08) |
| Is there a network/telemetry path? | No | single-file app; no fetch of remote origins; no analytics |
| Is there a shared file format with a sibling? | No | `.bitwave` (schema 3) and the `#bw=` fragment are BitWave-only |

Verify from a clean checkout:

```powershell
$manifest = (node agent/cli.mjs manifest --json | ConvertFrom-Json).data
ConvertTo-Json -InputObject $manifest.relatedTools -Compress   # -> []
```

An empty `relatedTools` is deliberate: a manifest that lists integrations that do not
exist would be worse than an empty list.

## Adjacent tools on the author's machine

These are the local tools whose subject matter overlaps BitWave's. They live outside this
repository (`C:\Users\trevor\Documents\…`, as verified 2026-11-08); the paths are *not*
integration links and will differ on another machine. None of them is imported or invoked
by BitWave.

| tool | location | what it is | agent surface | BitWave relationship |
|---|---|---|---|---|
| **sha256lab** | `LEarnTheSHA\sha256algorithm` | SHA-256 visualiser for Bitcoin public-key serialisations (compressed vs uncompressed) | **Yes** — `AGENTS.md`, `docs/AGENT-INTERFACE.md`, `agent/cli.mjs`, `agent/mcp-server.mjs`, `llms.txt`, toolset `1.0.0` / schema 1 | planned: register-vector → message-word handoff |
| **nibsort** | `Divine-Beauty-Proportion` | Python CLI + local web GUI that sorts, searches and groups CSV/TSV rows by nibble/bit/byte position | no (CLI + browser GUI) | planned: dataset/CSV interchange |
| **IEEE 754 Signal Lab** | `Dub64\ieee754-lab.html` | single-file HTML lab for the sign/exponent/mantissa fields of 64-bit floats | no | planned: interpret a 64-bit word as a float bit pattern |
| **CurveLearner** | `CurveLearner` | 256-bit register reference sheet and browser tool; positional-determinism notes | no | planned: shared register-width terminology/reference vectors |
| **SatoshiLab** | `SatoshiLab` | Python Bitcoin scripting/crypto pipeline lab | no | adjacent only; no concrete handoff yet |

The sha256lab row is the closest match in *shape*, not in data: it is the same
agentification pattern (one DOM-free core, one envelope, browser bridge + CLI + MCP), so
it demonstrates the pattern a future link would follow. It does not share code with
BitWave and neither tool knows the other exists.

## What a handoff would carry (planned)

A handoff should carry **data, not pixels**. BitWave already produces the four
ingredients; a future integration would send a subset of them and nothing else.

### 1. Register vectors

The unit of transfer. One lane evaluation or a whole-register analysis, as returned by
`evaluate_lane`, `compare_operands` and `analyze_register` — uppercase hex, an explicit
width, and independently checkable counts:

```json
{
  "width": 64,
  "op": "xor",
  "a": { "hex": "8ADEFEDA85210125", "popcount": 30 },
  "b": { "hex": "FFFFFFFF00000000", "popcount": 32 },
  "z": { "hex": "7521012585210125", "popcount": 20 },
  "truthCounts": [23, 11, 9, 21]
}
```

Deterministic by construction: the same inputs serialize byte-identically, with no
timestamps, randomness or locale formatting. A receiver must respect `width` — the value
`7521` means one thing at 16 bits and another at 64.

### 2. UI state (schema 1)

`window.bitwave.getState()` / `#bitwave-state` carry the view state: `schemaVersion`,
`width`, `lane`, `frame`, `view`, `lanes` (frames, sources, driven flags, derived values),
`lfo`, `dataset`, `editing`, `deeplink`, `bridge`. The shape is additive: keys may be
added, never repurposed without a schema bump. A consumer should accept
`schemaVersion: 1`, and refuse or degrade on newer versions rather than guess.

### 3. Deeplink (`#bw=`)

The whole view state as a URL fragment:
`bitwave-v2.html#bw=<unpadded base64url(UTF-8 JSON of a .bitwave schema-3 document)>`.
Canonical links omit `savedAt`, so equal state ⇒ equal link, and the payload stays within
the 2000-character share budget (a dataset that would overflow is dropped and flagged
`datasetDropped`). This is the human-portable carrier: paste a link and the receiving
BitWave reproduces the state with no server. For a portable base, build it with an
`http(s)` URL; over `file://` the fragment only works against the same file path.

### 4. Envelope and manifest

Every tool answer uses one envelope — `{ ok, schemaVersion, tool, data, deeplink, warnings }`
on success, `{ ok:false, schemaVersion, tool, error:{ code, message, hint? }, warnings }`
on failure — with a closed error-code set. The manifest
(`agent/manifest.json`, byte-identical to `getManifest()`) is the machine-readable
identity: id `bitwave`, toolset `1.1.0`, `schemaVersion: 1`, `urls`, `deeplink`,
`ui` selectors, `tools`, `errorCodes`, `invariants`, and the reserved `relatedTools`.

A future handoff would populate `relatedTools` — for example:

```json
"relatedTools": [
  {
    "id": "sha256lab",
    "title": "SHA-256 Lab",
    "relation": "register-vector handoff",
    "transport": "manifest + CLI",
    "status": "planned"
  }
]
```

This is a **proposal**, not current output: v1 emits `[]`, and adding an entry would be a
contract change (manifest schema, tests, docs) made only when the link is real.

## Rules that keep this map honest

1. **One implementation per tool.** A handoff moves data; neither tool re-implements the
   other's maths. BitWave's numbers always come from `src/core/*`.
2. **Standalone first.** The single-file instrument never gains external references or
   runtime dependencies; an integration is an optional adapter, not a requirement to run.
3. **Deterministic payloads only.** Register vectors, state and deeplinks are stable and
   versioned; screenshots are evidence, never the carrier.
4. **No invented links.** `relatedTools` stays empty until a real, tested link exists;
   planned work lives in prose (this page), not in machine-readable fields.
5. **Additive and revocable.** Surfaces are explicit and local; no background network,
   telemetry or auto-update path is added for a sibling tool.

## Related reading

- [`AGENT-INTERFACE.md`](AGENT-INTERFACE.md) — normative contract (tools, envelope,
  deeplink, state, bridge, CLI, MCP).
- [`AGENTS.md`](../AGENTS.md) — onboarding and the three ways in.
- [`AGENT-SCREENSHOTS.md`](AGENT-SCREENSHOTS.md) — reproducible states and the state
  extraction recipe.
- `agent/manifest.json` and `agent/examples/` — generated identity and one example
  envelope per tool.
