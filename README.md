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
  frame navigator, per-frame visibility eyes, the frame focus lens (A/B/Z1, C/D/Z2,
  E/F/Z3), wheel-to-adjust hex, copy-to-lane, CSV stepper, observation CSV export,
  LFO, split 3-D.
- **`index.html`** — untouched original reference build.
- `index.html.bak` — an older snapshot, kept only as history.

## Verify

```bash
npm test               # DOM-free core: 38 tests, zero dependencies
npm run check:browser  # 20 artifact checks in headless Chromium (21 with capture)
npm run capture        # state screenshots → .tmp-captures/
```

`check:browser` auto-detects Chromium (Playwright's browser cache, a Chrome/Edge
install, or `BITWAVE_CHROME=…`). It opens the artifact over `file://` — the way a
user opens it — and asserts console cleanliness, layout at 360/420/720/1440, the
DESIGN §5 strip geometry, the frame navigator and focus lens, the 3-D truth table,
CSV import, and the §11 operation vectors.

## Design and intent

- [`DESIGN.md`](DESIGN.md) — the visual/geometric source of truth.
- [`AGENTS.md`](AGENTS.md) — stated intent for AI-agent interoperability:
  state/render surfaces rather than screenshot automation.

## Repository map

The instrument is the two HTML files. The rest is preserved context:

| Path | What it is |
|---|---|
| `docs/`, `PLAN.md`, `DECISIONS.md`, `STATUS.md`, `src/`, `tests/`, `spike/`, `examples/` | Historical design analysis and a DOM-free engine extracted during exploration. Not required to run the instrument. |
| `tools/` | `browser-check.mjs` (zero-dependency verification harness) and the example generator. |
| `package.json`, `tsconfig.core.json` | Test/typecheck setup for the extracted core (`npm test`). |

## Preservation

This directory is a Git repository. Each checkpoint is tagged and also backed up
as a single-file bundle under `backups/` (ignored by Git), so it can be restored
or cloned without a remote:

```bash
git clone backups/bitwave-v2-2026-11-06-focus.bundle bitwave-restore
```

Tags: `v2-checkpoint-2026-11-06` (frame navigator, eyes, wheel-step) and
`v2-focus-2026-11-06` (global frame names, focus lens, browser harness).

For off-machine safety, add a remote and push the `main` branch and tags.
