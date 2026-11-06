# BitWave — agent interoperability intent

**Status: first surface shipped 2026-11-06.** The direction below is stated
intent; the `window.BitWave` read-only contract is now implemented and
version-stamped. Future surfaces stay additive and follow the same rules.

## Why

BitWave's data path already shows the pattern: import CSV/TSV, step rows, and
export observations. State lives in the tool and can leave as a file. The same
should eventually hold for research and creative workflows: an assistant should
be able to ask for state and images directly, rather than driving a mouse, taking
a screenshot and manually cropping the register.

## Principles

1. **State is the source of truth.** Everything visible is a deterministic
   function of registers, operators, lane, view and frame visibility. Export the
   state as structured data; never infer it from pixels.
2. **Capture is a render, not a screenshot.** Frame-state visual capture should
   be requestable from a state snapshot (SVG/PNG first; frame sequences/GIF
   later), independent of animation timing and OS-level automation.
3. **Explicit, local, revocable surfaces.** Prefer a small documented command or
   file contract — a local state/render endpoint, a headless mode, or plain
   files the user chooses — over hidden network calls or background telemetry.
4. **Additive only.** The human instrument stays primary. Agent surfaces must
   not change the visual or interaction contract by accident.
5. **Version what leaves.** Observation rows, state snapshots and image metadata
   carry a schema/version and enough provenance to reproduce the result.

## Existing surfaces

- CSV/TSV import with per-column typing and right-aligned register values.
- Observation logger export (`bitwave_observations_*.csv`).
- Single-file, offline HTML with no network dependency.
- **`window.BitWave`** — a read-only, versioned state/geometry surface inside
  `bitwave-v2.html` (contract below).

## Contract: `window.BitWave` (schema 1)

Present after boot. Every member returns a **deep-frozen plain object**; there
are no setters, so writes stay with the instrument's own controls.

| Member | Returns |
|---|---|
| `BitWave.schema` | `1` — bump this whenever the shape changes |
| `BitWave.artifact` | `"bitwave-v2.html"` |
| `BitWave.frames()` | lane → operand/derived frame names (`1: A/B → Z1`, `2: C/D → Z2`, `3: E/F → Z3`) |
| `BitWave.bindings()` | the six input bindings: lane/operand/frame, source (`data` column or frame output), state chip (`data`/`1:1`/`z⁻¹`/`—`), driven flag |
| `BitWave.state()` | register width, focused lane/frame, view mode, every lane's A/B/Z hex, operator, CSV source names, per-frame focus/visibility, LFO, dataset cursor |
| `BitWave.geometry()` | canvas plot rect, `--pad`, nibble width/gap, computed control-point `xs[]`, and the matching DOM nibble rects |

Example `state()`:

```json
{ "schema": 1, "artifact": "bitwave-v2.html",
  "registers": { "width": 64, "bits": 64, "nibbles": 16 },
  "lane": 1, "frame": "A", "view": { "mode": "2d", "splitPair": [1, 2], "activePane": 0 },
  "lanes": { "1": {
    "frames": { "A": "8ADEFEDA85210125", "B": "FFFFFFFF00000000", "Z1": "7521012585210125" },
    "sources": { "A": null, "B": null }, "binop": "xor", "focus": "A", "edit": "A",
    "showB": false, "lfo": "0", "visibility": { "A": true, "B": true, "Z1": true } } },
  "lfo": { "on": false, "mode": "rotcw", "rate": 4 },
  "dataset": null,
  "editing": { "copyArmed": false, "enabled": true } }
```

Example `bindings()` row:

```json
{ "lane": "A", "laneNumber": 1, "operand": "a", "frame": "A",
  "source": { "kind": "data", "index": 0, "column": "Hex 1" },
  "state": "data", "driven": false }
```

`geometry()` exists so tests and agents compare `controlPoints[j]` with
`dom.nibs[j].center` instead of trusting a shared constant or scraping pixels;
`tools/browser-check.mjs` asserts the DESIGN §11 **< 1.5 px** contract from it.

## Possible next surfaces (not built, not committed)

- A versioned JSON state snapshot/restore, plus a stable URL encoding of it.
- Deterministic image export: `render(state, view, size) → SVG/PNG`, later a
  frame sequence/GIF from an explicit state or CSV step range.
- A **command** surface (set registers/lanes, step examples, capture frames) —
  the read-only surface above is the first half; commands stay explicit,
  local and revocable.
- Agent-readable docs for the above, kept in sync with the human docs.

## Non-goals

- Screenshot-driven automation or manual cropping as the integration method.
- Background network calls, analytics or telemetry.
- Replacing the human UI, or making the agent API the only way to reach state.
