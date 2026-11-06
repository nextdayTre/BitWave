# BitWave — agent interoperability intent

**Status: stated intent, 2026-11-06.** Not a spec and not a promise. It records a
direction so future decisions do not accidentally paint AI agents out of the
instrument.

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

## Possible next surfaces (not built, not committed)

- A versioned JSON state snapshot/restore, plus a stable URL encoding of it.
- Deterministic image export: `render(state, view, size) → SVG/PNG`, later a
  frame sequence/GIF from an explicit state or CSV step range.
- A tiny local command surface (e.g. a documented `window.BitWave` object or a
  headless mode) to read state, set registers/lanes, step examples and capture
  frames.
- Agent-readable docs for the above, kept in sync with the human docs.

## Non-goals

- Screenshot-driven automation or manual cropping as the integration method.
- Background network calls, analytics or telemetry.
- Replacing the human UI, or making the agent API the only way to reach state.
