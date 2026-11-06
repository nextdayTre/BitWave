# BitWave

**A register you can see — every nibble is a sample.**

BitWave renders a bit register as a wavetable: dragging a nibble rewrites its
bits and reshapes the wave; bitwise operations behave like DSP operations.
Two operands (A, B) feed a derived result (Z), across three numbered lanes,
with 2-D and 3-D views, an LFO, CSV/TSV import and observation export.

## Run it

Both builds are single, self-contained HTML files. No build step, no server, no
network, no dependencies: **open the file directly in a browser.**

- **`bitwave-v2.html`** — current working build. Lanes 1/2/3, the Pro-Q4-style
  frame navigator, per-frame visibility eyes, wheel-to-adjust hex, copy-to-lane,
  CSV stepper, observation CSV export, LFO, split 3-D.
- **`index.html`** — untouched original reference build.
- `index.html.bak` — an older snapshot, kept only as history.

## Design and intent

- [`DESIGN.md`](DESIGN.md) — the visual/geometric source of truth.
- [`AGENTS.md`](AGENTS.md) — stated intent for AI-agent interoperability:
  state/render surfaces rather than screenshot automation.

## Repository map

The instrument is the two HTML files. The rest is preserved context:

| Path | What it is |
|---|---|
| `docs/`, `PLAN.md`, `DECISIONS.md`, `STATUS.md`, `src/`, `tests/`, `spike/`, `examples/`, `tools/` | Historical design analysis and a DOM-free engine extracted during exploration. Not required to run the instrument. |
| `package.json`, `tsconfig.core.json` | Test/typecheck setup for the extracted core (`npm test`). |

## Preservation

This directory is a Git repository. The current state is tagged and also backed
up as a single-file bundle under `backups/` (ignored by Git), so it can be
restored or cloned without a remote:

```bash
git clone backups/bitwave-v2-2026-11-06.bundle bitwave-restore
```

For off-machine safety, add a remote and push the `main` branch and tags.
