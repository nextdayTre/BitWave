# BitWave — Design System

> **A register you can see.** Every nibble is a sample; the register *is* the waveform.

This document is the source of truth for anything visual or geometric in `index.html`.
It exists because iteration is planned — its job is to stop the second pass drifting off
the first. Every colour, size, and offset below is a real value in the file, not an
aspiration. If a value changes, it changes here first.

---

## 1. What this is

A single-file teaching instrument. A bit register is rendered as a wavetable: each 4-bit
nibble is one sample, drawn as a control point on a spline. Dragging a nibble up or down
rewrites the bits and reshapes the wave. Bitwise operations are DSP operations —
`ROL` is a phase shift, `XOR` is a wavefolder, `NOT` is polarity inversion, `BSWAP` is an
endianness swap.

Two operands feed a derived result in each lane — lane 1 frames A/B → Z1,
lane 2 C/D → Z2, lane 3 E/F → Z3 at the default — so binary logic is *watched* rather
than computed on paper. The default instrument boots with three lanes; the shipped build
scales the live set to eight (`A/B` … `O/P`, `Z1`–`Z8`, D43–D46). Frame names are global
and derive from the stable lane key: with three live lanes the six operand frames A–F are
the routing destinations and the nine frame outputs A–F + Z1–Z3 are the sources; with `L`
live lanes there are `2L` destinations and `3L` sources.

**Non-goals.** Not a game. Not a dashboard. Not a marketing surface. There is no
onboarding, no trophy, no confetti. The reward is watching the number and the shape be
the same object.

---

## 2. Design stance

1. **The instrument, not the diagram.** Nothing decorative may compete with the data.
   One accent hue, one signal hue, no gradients except the curve itself.
2. **Never draw a value the register cannot hold.** No spline overshoot, no smoothing
   that lies about the data. If the register says `F`, the curve must not go above `F`.
3. **The picture and the truth are one object.** The bit strip and the curve are two
   views of identical state and must stay column-aligned to **0 px**. This is the
   single most fragile property in the file — see §10.
4. **Warmth is reserved.** Amber means one thing only: *the point at infinity and the
   mid-register bits*. It is never used for emphasis, hover, or brand. Green is data;
   amber is structure.
5. **Motion exists to show causation.** Animation lets you watch a state change happen.
   It is never applied as polish. Nothing animates that you did not cause.
6. **Chrome is re-homed, not redesigned.** A layout change moves an existing control to
   the surface it belongs to and removes the row it left behind; it never invents a new
   style, size or hue. D47 is the reference case: the wave-view toggle moved to the top
   bar, the 3-D hinge and `copy to…` menu moved into each pane head, and the truth table
   became a disclosure in the readout row — every behaviour kept its old semantics.

---

## 3. Colour

All values live in `:root`. The canvas cannot resolve CSS variables itself, so at boot it
reads the few it needs via `getComputedStyle`, with inline fallbacks so a missing token
degrades rather than throwing. Those fallbacks are the only colour literals outside
`:root` — keep it that way.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#08090c` | Page background. Near-black, slightly blue. |
| `--stage-glow` | `#0b0e13` | Radial glow behind the wave. |
| `--panel` | `#0d1015` | Chrome bands: strip, meta, controls. |
| `--panel-hi` | `#12161d` | Raised controls: buttons, select. |
| `--panel-hover` | `#181d26` | Button hover background. |
| `--line` | `#1b212b` | Control borders, stronger dividers. |
| `--line-soft` | `#141920` | Band separators inside chrome. |
| `--line-hi` | `#2a3341` | Button hover border. |
| `--text` | `#e8edf5` | Primary text and the active curve end. |
| `--handle-hi` | `#eafaf3` | The held / hovered control point. |
| `--dim` | `#67728a` | Secondary text: hex, subtitle. |
| `--dimmer` | `#3f4859` | Tertiary: micro-labels, off bits, canvas ruler. |
| `--accent` | `#34d399` | **Data.** Curve, on-bits, badge, focus ring, thumb. |
| `--accent-hi` | `#5eead4` | Curve gradient top stop. |
| `--accent-low` | `#22c55e` | Curve gradient bottom stop. |
| `--inf` | `#f5b544` | **Structure.** ∞ marker, zero-crossing level, MRB marks. |

**Canvas-only translucencies** (derived from the two heroes, not separate hues):

| Use | Value |
|---|---|
| Curve glow pass | `rgba(52,211,153,0.14)` — accent @ 14% |
| Horizontal value guides | `rgba(255,255,255,0.04)` |
| Zero-crossing level line | `rgba(245,181,68,0.26)`, dash `[2,5]` |
| Vertical ∞ axis | `rgba(245,181,68,0.10)` |
| ∞ ring / core / label | `rgba(245,181,68,0.45)` / `0.95` / `0.85` |
| Nibble hover wash | `rgba(52,211,153,0.07)` |
| Focus rings | accent @ 25–35% |

**Rule:** no colour may be introduced ad hoc. A new colour is a `:root` token or it does
not ship. Amber and green are the only two hues permitted; a third means the concept
grew a new category, and that needs a decision, not a hex code.

---

## 4. Typography

Two families. Never crossed.

- `--mono` — **machine state.** Bits, hex, decimal, op labels, register size, readouts.
- `--sans` — **human prose.** Product name, subtitle, field labels, the drag hint.

> **Never set a number in the sans face. Never set prose in the mono face.**
> This is the whole typographic system; everything else follows from it.

Every uppercase micro-label carries `letter-spacing: 0.09em` (`0.05em` inside the badge)
and `text-transform: uppercase`. That tracking is what makes 10px text read as a label
rather than as shouting.

| Size | Face | Use |
|---|---|---|
| `16px` / 600 | sans | `h1` |
| `13px` | mono | Bit strip base (all strip sizes are `em` of this) |
| `12px` | mono | Register size readout |
| `12px` | sans | Subtitle (hidden ≤ 720px) |
| `11.5px` | mono | Meta readouts, op buttons, select |
| `10.5px` | sans | Uppercase labels, badge, drag hint |
| `10px` | mono | Canvas hex ruler |
| `10px` | sans | `kv` field labels, control group labels |
| `0.86em` | mono | Bit glyphs; compact hex cells |
| `0.76em` | mono | Hex cells under bits |

All numeric readouts use `font-variant-numeric: tabular-nums` — digits must not shift
width as values change.

---

## 5. Space and geometry

`--pad` is the **single authority** for horizontal gutter. It is `40px` desktop and
`16px` at or below 720px, and **JS writes it** from `fitCanvas()` so the canvas and the DOM
strip can never disagree. CSS declares it only as the pre-JS fallback.

| Constant | Value | Where |
|---|---|---|
| `--pad` | `40px` / `16px` | Every band, and the canvas plot inset |
| Canvas top inset | `34px` | Leaves room for the always-visible stage bar |
| Canvas bottom inset | `26px` | Keeps the last handle off the edge, and hosts the hint |
| Border radius | `3px` nib · `2px` bit · `5px` button/select · `99px` badge | |
| Band padding | `header 16/14` · `strip 12/10` · `meta 9` · `controls 11/14` | |
| Row gap | `24px` header · `22px` meta · `26px` controls | |

**Column geometry** — computed once per frame in `draw()` and pushed to the strip:

```
gap   = clamp((pw / n) * 0.16, 1.5, 12)      // px, applied as flex `gap`
w     = (pw - (n - 1) * gap) / n            // nibble content width
x(j)  = x0 + j * (w + gap) + w / 2          // control point == nibble centre
```

This formula is the contract. If either side changes, both change — or the curve and
the bits desync.

**Reflow and zoom.** The instrument is viewport-height at normal sizes, but it must never
clip itself to *fake* that. The page is allowed to scroll when chrome + controls exceed the
viewport (browser zoom, short viewports, large text):

```
body { min-height: 100dvh; height: auto; overflow: visible; }
grid-template-rows: auto minmax(clamp(220px, 44dvh, 620px), 1fr) auto auto auto;
```

At a normal viewport the `min-height` reproduces the current 100 d(v)h instrument exactly;
when `zoom × viewport` leaves less room, the stage keeps a `220–620px` floor and the page
scrolls instead of the bottom controls falling outside an `overflow:hidden` body. The zoom
budget is part of §11: at 1280×720 @ **200 %** (640×360 CSS px) and 1440×900 @ **400 %**
(360×225 CSS px) every control must remain reachable by scrolling, the stage must stay
≥ 220 px, and horizontal overflow must stay 0.

**Target size.** Every interactive target is ≥ **24×24 CSS px** (SC 2.5.8). Density makes a
per-bit target impossible (16 nibbles × 4 bits), so the semantic target is the whole nibble
(§8 nibble spinbutton) and the bit glyphs are that control's visual — never separate
targets. The `width` range thumb is ≥24 px.

---

## 6. The canvas contract

These are mathematical invariants, not styling. Breaking one breaks the concept.

### Frames and their names
The instrument holds a **live lane set** of one to eight lanes (the boot instrument ships
three). Lane identity is the stable **lane key** `"1"`…`"8"` — also the displayed lane
number — and frame names are **global**, derived from that key, never from array position
(author, 2026-11-06; dynamic lanes D43/D46):

| Lane | Operands | Derived |
|---|---|---|
| 1 | A, B | Z1 |
| 2 | C, D | Z2 |
| 3 | E, F | Z3 |
| … | … | … |
| 8 | O, P | Z8 |

The operand frames are the routing destinations (two per live lane: A–P at the eight-lane
cap); the outputs are the same operands plus every live lane's derived frame (A–P +
Z1–Z8 at the cap). Names never shift when a lane is added or deleted: deleting lane 3
leaves lanes 1/2/4 live and lane 4 remains G/H/Z4. Every surface that names a frame —
strip label, legend, frames view, stage bar, truth header, 3-D plate label — uses the
focused lane's global name, never a per-lane `A`/`B`/`Z`.

### Registers
The focused lane's three frames (lane 1 shown; a live lane's operands and derived frame
are its own letters plus `Z<key>`):

| | | |
|---|---|---|
| **A** | operand | editable |
| **B** | operand | editable, only exists in A·B mode |
| **Z1** | `A op B` | **derived, never editable** |

There is exactly one **edit target** (`S.edit`): the operand that drags, presets, and
unary ops act on. The bit strip shows the **focused frame** (`S.focus`): an operand is
editable and labelled; a derived frame is shown **read-only**. With two operands live,
grabbing picks whichever **curve is nearer the pointer** and focuses that operand — the
instrument must never make you hunt for a knob.

Every live lane's derived frame is recomputed on every change and eased like a real
register, so the result *moves* into place rather than snapping.

### Keyboard editing

Every **operand** nibble is a focusable `role="spinbutton"` control; derived frames are
read-only. The hex cell is that control's value display and the four bit glyphs are its
visual, not separate targets.

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | enter/leave the strip at the last-focused nibble (one tab stop, roving `tabindex`) |
| `←` / `→` | move focus to the previous/next nibble |
| `↑` / `↓` | value ±1, clamped `0…F` |
| `Home` / `End` | move focus to the first/last nibble |
| `0–9`, `a–f` | set the focused nibble to that hex digit |
| `Esc` | cancel an armed mode and return focus to the focused frame's label |

- `aria-valuenow` is the nibble value `0–15`; `aria-valuetext` names position, bits and
  weight using §6 addressing and §5 place-value maths — e.g. nibble index 5 of 16 in a
  64-bit register reads `"nibble 6 of 16, hex D, bits 40–43, weight 2^40"`.
- The roving `tabindex` lives on the last-focused nibble; a strip re-render must restore it
  (§10.33).
- A whole-word **hex entry** field accepts `1…nibbleCount` hex digits: `Enter` commits
  (right-aligned and zero-padded exactly like CSV, §10.16), `Esc` reverts, invalid input is
  refused with a status message. It is disabled for derived or driven frames.

### The truth table is data, not a reference card
The `n` column counts how many bit positions in A and B actually hold each input pair.
Two invariants follow and are asserted in §11:

- the four counts **sum to the register width**;
- `popcount(Z) === Σ n` over rows where the output is 1.

This is what connects the algebra to the register: with A = sine and B = all-ones, AND
reports `popcount = count(a=1,b=1) = weight(A)`.

### Bit addressing
```
bits[0]                 = LSB          (hardware convention)
display column c        = bit (N - 1 - c)   →  MSB on the left
nibble j (from left)    = bits [N-1-4j … N-4-4j]
```

### Positional weight
```
weight(j)       = 2^(4 · (nibbleCount - 1 - j))   // exponent of that nibble's LSB
contribution(j) = nibbleValue(j) × 2^weight(j)
```

Weight is a constant of the **position**, not of the data. Nibble 0 of a 256-bit register
is worth `2^252` per unit no matter what every other nibble holds — the leading `0001` is
`1 × 2^252`, and the 63 zeros elsewhere do not change that. Adjacent nibbles differ by
exactly `2^4` (one hex digit), so the weight ladder is a straight line in log space, which
is precisely why the MSB dominates the total.

The strip exposes both halves: `dec` is the nibble's own value (0–15), `wt` is its place
value. Hovering a nibble shows `value × 2^weight`, which at the LSB degenerates to
`n × 2^0` — i.e. just `n`.

### Vertical mapping
Unsigned linear across the full height. `0000` is the **bottom**, `1111` the **top**.
`0000` therefore sits *below* the zero-crossing level, never on it.
```
y(v) = y1 - (v / 15) * ph
```

### Horizontal spanning
Control points sit at nibble centres, not at `i/(n-1)`. The spline is drawn across the
full plot width and clamps beyond the first/last control point, producing the flat
shoulders. This is why a 2-nibble register looks like the reference drawing.

### The spline
Monotone cubic Hermite (Fritsch–Butland interior weights) with **zero end tangents**.

- With 2 points it degenerates to `smoothstep` — exactly the reference curves.
- It cannot overshoot `[0, 15]`, satisfying stance #2.
- Equal adjacent values force slope 0, so a 4-bit sine at 64 nibbles renders as an
  honest staircase rather than a smoothed lie. **This is a feature, not an artefact.**

### The point at infinity
```
∞ = ( (x0 + x1) / 2 , y(7.5) )
```
The intersection of the horizontal centre and the vertical middle. It is the register's
**growth anchor**: changing size injects zero-nibbles at `∞` and pins the outermost
nibbles on each side, so `F0` at 8 bits becomes `F0 00` at 16 — never `F0` + append.

### The MRB
An even bit count has no single middle bit. The crossing lives *between* two bits, which
is precisely why it is a point and not a bit. The two central bits (`N/2 - 1`, `N/2`)
carry a `0.55`-alpha amber underline. Never mark one bit as "the middle".

### Register sizes
`[8, 16, 32, 64, 128, 256]` bits. **Default 64** — at 256 the handles are ~21px apart and
the instrument stops being draggable by hand. 256 remains one click away and is the best
view for seeing quantisation.

---

## 7. Motion

| What | Value | Note |
|---|---|---|
| Nibble easing | `anim += (target - anim) * 0.24` per frame | Snap when `|diff| < 0.004` |
| Drag | 1:1, no easing | Dragging must feel direct, not damped |
| Button transitions | `90ms` (bit), `110ms` (button) `linear` | Colour only |
| Hint fade | `220ms ease` | Once, on first drag |
| Rendered properties | colour, opacity, box-shadow | No layout animation |

The easing constant is deliberately high (`0.24`) — fast enough to feel like the wave
*snaps* into the new shape while still showing you how it got there.

**Reduced motion.** Under `prefers-reduced-motion: reduce`:

- the LFO starts **off** and is not auto-started; if the user starts it, commits are
  instant (no easing) and the rate is capped at **4/s**;
- the 220 ms hint fade is removed (the hint appears/disappears immediately);
- 1:1 pointer drag is unchanged — drag is direct manipulation, not decoration.

---

## 8. Components

- **Op button** (`button.op`) — mono 11.5px, `--panel-hi`, 5px radius, 5/10 padding.
  `.accent` variant turns the label green with an accent border: used for the bitwise
  ops, so *data operations* read differently from *table presets*.
- **Badge** (`--badge`) — pill, mono, uppercase, accent text. `step-down` / `step-up` /
  `level`; `.flat` drops to `--dim` for `level`.
- **KV readout** (`--kv`) — sans micro-label + mono value. `.wide` takes remaining row
  width for the decimal.
- **Frame lens buttons** (`.kv > .lens-btn`) — the `A` / `B` / `Z1` labels in the A·B
  readout row are buttons, not text. Each focuses that frame through the existing lens
  (§10.24): an operand also becomes the edit target; `Z1` is a read-only focus. The strip,
  hint, edit target and whole-word hex entry follow, so manual entry never needs a waveform
  preset; the view mode, panels and values never change. `aria-pressed` follows the focused
  frame; names are `focus A` / `focus B` / `focus Z1 (read-only)`; keyboard path is Tab to
  the label and `Enter` or `Space` to choose it (no new shortcut); each target is at least
  24×24 px. Pressed state uses the accent only — no new hue.
- **Nib group** (`.nib`) — `flex: 1 1 0`, `min-width: 0`. Contains the bit cell (if mode
  allows) and the hex cell.
- **Bit cell** (`.bit`) — 1/4 of a capped-width grid. `--dimmer` off, `--accent` on.
  `.mid` adds the amber underline. A bit click toggles that bit, but the bit is **not**
  a separate target: the whole nibble is one semantic control (§8 nibble spinbutton), so
  the four glyphs are its visual and its `aria-valuetext`, not four focus stops.
- **Nibble spinbutton** (`.nib`) — the strip's semantic editor. One focusable
  `role="spinbutton"` per operand nibble (`aria-valuenow` 0–15, `aria-valuemin`/`max`,
  `aria-valuetext` per §6). Focus rings the **whole nibble** (`outline: 2px solid
  var(--accent)`), not one glyph, because the nibble is the target. Pointer: clicking a
  bit toggles it, clicking the nibble body focuses the spinbutton, drag is unchanged. In
  compact mode the hex cell remains the control; the bits are hidden visually only.
- **Hex entry** (`.hex-entry`) — mono, right-aligned text input beside `width`. Accepts a
  whole word (`1…nibbleCount` digits), `Enter` commits, `Esc` reverts, `aria-describedby`
  names the target frame. It edits the frame chosen by the readout lens buttons (or the
  frame chosen by the readout lens or the frames view), so manual entry never needs a waveform preset. Disabled with a visible
  reason when the focused frame is derived or driven.
- **Canvas accessibility** — the canvas is `role="img"` with a live text alternative
  (`aria-label` or `aria-describedby`) updated on commit: edit target, frame values and the
  Z popcount. It exposes **no** keyboard editing path — the strip is the editor (§10.32).
- **Live status** (`#liveStatus`, `role="status"`, `aria-live="polite"`, `aria-atomic="true"`) —
  one region in the controls band. Announces **committed** changes only, in one short
  sentence (`lane 2 · A = DEADBEEF · Z popcount 32`), debounced ≈150 ms. Quiet during
  pointer drag and per LFO tick; announced on pointerup, activation, LFO start/stop/mode
  change, CSV load/step and source change.
- **Canvas handles** — `r 2.5`, active `r 4.4` + accent ring. Hidden entirely when
  `n > 32` unless active, to avoid a dotted mess. Only ever drawn on the edit target.
- **Curve emphasis** — with three curves on screen, hierarchy is carried by **weight,
  not hue**: the edit target is `1.8px @ 0.82`, its mode-mate `1.3px @ 0.30`, and Z is
  `2.5px` + glow. B is distinguished by `dash [6,4]`, never by colour.
- **Legend** (`drawLegend`) — top-right of the plot, and it must mirror the *real* stroke
  weights above. A legend that lies about its strokes is worse than no legend.
- **LFO** (`lfo` group) — `LFO` toggle, motion (`rot ↻` / `rot ↺` / `slide ⇄` / `step ⏭`), rate
  (1–8 /s), and **B phase** (`sync` / `anti` / `+¼` / `+½`). Stepped, not smooth: every
  tick writes a real register state, so hex, strip, truth table and Z all stay truthful.
  A fractional-phase animation would draw states the hardware can never hold.
  `slide ⇄` is a triangle computed from the snapshot, so the wave slides out and slides
  back in instead of dead-ending at zero. `step ⏭` maps the LFO clock directly to the
  CSV example stepper, cycling through dataset rows at the chosen rate without losing
  the current slide position on stop.
  **Both operands move**, because the payoff is Z. Critically: a *static* offset does not
  produce interference — if A and B both rotate by the same amount, Z is just
  `ROL(Z₀, s)` and its shape never changes (verified). Only **`anti`** (counter-rotation)
  makes Z genuinely reshape, because the two operands drift relative to each other.
- **Input source table** (`.sources-panel`, `.src-table`, opened by `sources` in the
  data group) — **`2L` rows for `L` live lanes**, one per operand frame, grouped under a
  per-lane header row (`Lane 3 · E/F/Z3`) and scrollable in the panel body. DESTINATION
  shows the frame and its label carries the assignment (`A · Hex 1` for a data column,
  `A · Z3` for a frame), matching the column names the import dropdown shows. SOURCE is
  one native select: `—`, `data · <column>`, `frame · A…Z8`, or `expr · expression`; STATE
  reads `data`, `1:1`, `z⁻¹`, `expr` or `—`. Choosing `expr` reveals a one-line mono
  expression editor (validated on Enter/blur; Esc reverts; invalid input restores the
  previous valid text with an error in the panel status). It is a **transient panel, not a
  mode**: Esc or an outside click closes it, and the stage view is unchanged. A fresh
  import rebuilds the board across the live lane set (the shipped three lanes keep the
  historical assignment); driven inputs are locked and unplugging restores the parked base
  (D2).
- **Example stepper** (`data` group) — `import csv`, `demo`, `project…`, `◀ n/total ▶`,
  `sources`, and an **Observation Logger** (`log` and `export`).
  Stepping writes the row's cells into A (and B if mapped) for **undriven** inputs.
  Arrow keys step when focus is not in a control and not in the strip (the strip owns
  `←/→` for nibble focus); a file dropped anywhere loads. The
  observation logger records live waveform snapshots (example name, A hex, B hex, Op,
  Z hex, Pop-Z, truth table counts, timestamp) and downloads them directly as
  `bitwave_observations.csv`. To its right, **Record** (`#recordBtn`, `aria-pressed`) is a
  DAW-style take: starting clears the buffer, each settled evaluation appends one row of
  **`3L` frame registers** (three per live lane; nine at the boot three-lane set, no
  timestamps, in memory only), `export log` downloads `bitwave_recording.csv`, and the row
  count sits beside it. This is the daily-use path, so it is the first group in the
  controls row.
- **Demo dataset** (`demo`) — an embedded eight-row, four-column table (rotated sine,
  ramp, 16-bit mask). It goes through the same parser/typing/binding path as a CSV
  import, so it is data, not onboarding; the status line names it.
- **Project menu** (`project…`) — `role="menu"` with `save project`, `open project…` and
  `reset instrument`; focus moves in, Esc/outside closes and returns focus (same contract
  as the copy menu). Save downloads a `.bitwave` JSON document; open reads one and applies
  it through one transaction; reset clears autosave + share link and returns to the boot
  state. A newer schema is refused with a readable reason (read-only open is not built).
- **Dataset status line** (`#csvStatus`, `source` group) — one visible polite `role="status"`
  row: `loaded N rows · M columns from <name>`, `restored from autosave`,
  `restored from the shared link`, `reset to the boot state`, or a refusal
  (`could not read <name>: no numeric columns`, `newer than supported`). Error text uses the
  existing `--inf` warmth; no third hue. It complements — not replaces — the sr-only
  committed-change region.
- **Segmented control** (`.seg`) — a joined set of `button.op` (currently the stepper's
  `◀ ▶` and per-pane focus). The lane selector is a native `<select class="op
  lane-select">` per pane, not a segmented control (D46). **Mutually exclusive sets are
  `role="radiogroup"` with `role="radio"` + `aria-checked` and a roving `tabindex`**;
  true toggles keep `aria-pressed`. Visual `.on` may remain, but state is programmatic —
  a selected segment must never be colour-only (SC 1.4.1).
- **Truth table** (the body of `.truth-disclosure`) — mono 10.5px, 4 columns `a b → n`.
  D47 nests it in the readout-row disclosure described above; the header text moved from a
  static `.truth-h` line to the disclosure button. The `n` column is
  separated by a 1px rule: it is data *about* the register, not part of the algebra, and
  must not read as a fifth logic cell. It carries table semantics (`role="table"` with
  row/cell roles or a real `<table>`) so a screen reader hears `a 1, b 0, n 9` as rows,
  not as a run of spans.
- **Group and landmark semantics** — one `<main>` around stage + strip + meta + controls;
  every control group is a named `role="group"` (or `fieldset`/`legend`); the orphan
  `<label>` headers become real group names; glyph/symbol buttons (`◀ ▶ × split 0 F`) get
  accessible names instead of relying on `title`.
- **Strip label** (`strip::before`, `data-edit`) — a 9px frame name (`A`, `D`, `Z2`, …)
  in the left gutter naming the frame the strip is showing. Derived frames are
  read-only, and the label says which one. Without it, A·B mode has no way to tell.
- **Value rows** (`.dec`, `.wt`) — `.dec` is the nibble's own value `0–15` (its share of
  the vertical axis); `.wt` is the position's place value `2^k`. `.wt` is deliberately
  quieter than `.dec`: **weight is structure, value is data** (§3). In compact mode `.wt`
  thins to every 8th nibble plus the LSB, so the ladder still reads and consecutive marks
  are always exactly `2^32` apart.
- **Hover readout** — canvas text `value × 2^weight` above the hovered handle, clamped to
  stay inside the plot. Drawn, not DOM: no layout shift on hover.
- **Off bits are `--dimmer` on purpose.** Against near-black they visually recede, so at
  256-bit density the strip reads as *set bits* rather than as digits — which is why the
  `dec` row exists. Do not "fix" the dim zeros; they *are* the hierarchy.
- **3-D field** (`drawField3d`) — three planes in axonometric projection: **the first
  operand at frame 1 (far), the derived frame at 128 (middle), the second operand at
  256 (near)**, joined by four volume edges.
  **Outline only — never rectangle fills.** Translucent fills composite additively where
  planes overlap, so the intersections light up and the box reads as stacked panels rather
  than one volume. Appearance is a **monotonic function of depth**: alpha `0.30 → 0.85`
  and weight `1.1 → 2.0` from far to near, one hue throughout. B is distinguished by
  **dash**, never by brightness. The box width is aspect-clamped (`min(paneW, ph × 2.45)`)
  so ultra-wide displays do not flatten the axonometric angle, while preserving the exact
  `0.58 / 0.48 / 0.14 / 0.155` plane-to-offset proportions. Plate labels reflect the live
  operator and the focused lane's frame names (`128 · Z1 · A ⊕ B`, or `C ⊕ D → Z2` in
  lane 2) plus any routed CSV column names. The depth axis shows the
  *relationship between the inputs and the result*; it deliberately does **not** imply 256
  morphing frames.
- **3-D hinge** (`.pane-fold`, visible only in 3-D, one per pane head) — a per-lane
  presentation control that swaps which operand is at frame 1 (far) and frame 256 (near).
  Z stays the fixed middle plate, so the metaphor is a hinge with two foldable wings; the
  default `A far / B near` preserves the existing view. The swap never changes registers,
  bindings, the operator or the Z label (`128 · Z1 · A ⊕ B` remains the truth); line style
  follows the operand (A solid, B dashed), not the position. **D47 re-homes it from the old
  bottom VIEW row into each stage-bar pane head**, where it acts on that pane's lane: in
  split 3-D the two hinges are independent (toggling one never moves the other), and
  neither changes the focused lane. It is hidden in 2-D. This is **session-only
  presentation state** — it is not in `.bitwave` or the agent state; persisting
  `lanes.<n>.fold` belongs to the dynamic-lanes schema pass
  ([`docs/DYNAMIC-LANES.md`](docs/DYNAMIC-LANES.md)).
- **Top bar** (`header`) — brand and subtitle at the left, the shared register width
  slider (`width`) in the middle, then the **wave-view control** and the help `?` at the
  right. D47 moves the `3D` toggle here (`#depthBtn`, inside a named `view` group with a
  small uppercase `VIEW` label immediately left of `?`): it keeps its id, `aria-pressed`,
  title and keyboard path (Tab, `Enter`/`Space`), and it toggles the 2-D/3-D lens — it never
  writes a register or changes lane state. The bottom controls row therefore has **no view
  group** (five modules: source | register edit | operate | derive | motion), and the
  header holds the control without horizontal overflow at 360/720/1440 px (at the 720
  breakpoint the width slider wraps to its own row and VIEW stays beside `?`).
- **Truth disclosure** (`.truth-disclosure`, `.truth-toggle`) — D47: the truth table is a
  **collapsible disclosure in the readout/meta row and is present in every view** (A-only,
  A·B, 3-D and split), not only when operand B is shown. The header is a native button
  carrying the live algebra (`A ⊕ B → Z1`, `G ⊕ H → Z4`, or `G + H → Z4`), a chevron,
  `aria-expanded`, `aria-controls`, the 24×24 px floor and the keyboard path
  (Tab + `Enter`/`Space`); its accessible name is `truth table for lane <n> <algebra>`. The
  body expands/collapses in place, default **expanded**, and keeps the same live
  `role="table"` grid (`a b → n` with the four counts, or the ADD/SUB carry/borrow row) —
  the counts and semantics are unchanged. Open/closed is the transient session preference
  `S.truthOpen`, never persisted in `.bitwave`, the share link or the agent state. The
  block has a fixed inline size and is the **first readout after the badges**, so its
  position is identical in A-only and A·B modes (a wide `dec` readout cannot push it to
  the right); toggling it can never move the hex readouts horizontally. No new hue; no
  animation under reduced motion.
- **Stage bar** (`.stage-bar`) — **always visible**, and the single canonical home of the
  lane selector, the `frames` view toggle (and `Lanes` while the frames view is open),
  `split`, the per-pane 3-D hinge, the per-pane `copy to…` opener and the routing-aware
  lane expression (`LANE 1 · A ⊕ B → Z1`). The lane selector is one native
  `<select class="op lane-select">` **per pane** (D46): options are the live lanes,
  labelled `Lane 1`…`Lane 8` with the stable lane key as the value, so adding lanes
  cannot grow the bar sideways. In split 3-D there are two selects, two hinges and two
  copy openers; the second is named **"Lane (second pane)"**, and split stays exactly two
  panes. The native select is the declared keyboard path (Tab to it, then
  arrows/Home/End/type-ahead); `Alt+1…8` selects a live lane by its number as a shortcut
  (an absent/gapped key is a no-op). Every live
  lane shares register width `S.N` and each holds its own operand pair and derived frame
  (`A/B/Z1`, `C/D/Z2`, …, `O/P/Z8`), binary/arithmetic operator, B-phase and the source
  bindings. In 2-D `split` stays in place `aria-disabled` and the hinge is hidden; in 3-D
  it splits the stage into two side-by-side axonometric visualizers separated by a `1px`
  `--line` rule while the strip, truth table and controls stay bound to the focused lane.
  Per-pane focus dots, the second select, the second hinge and the second copy opener only
  exist in split 3-D. D47 adds the hinge and copy opener to every pane head; the head wraps
  (rather than scrolls sideways) at 360/720 px. Drawn exclusively from `--panel-hi`,
  `--line`, `--text`, `--dim`, `--dimmer` and `--accent`; the select uses the same tokens
  and is at least 24 px tall.
- **Frames view** (`.frames-view`) — the `frames` button swaps the **stage** to a card
  browser (`Lanes` in the stage bar returns; Esc also returns). The grid is one column per
  **live** lane, one **equal card per frame** (operand A, operand B, derived Z), each card
  a bordered box holding a mini spline of the settled register with the frame's global name
  at its left; a dim lane head carries the lane name, `unpair B` for the focused lane in
  2-D with B live, and compact **`dup` / `del`** lane-management controls (D46); each card
  carries a 24 px visibility eye (2-D visibility only; disabled in 3-D). Choosing a card
  focuses that frame **and returns to the lanes view** — the one deliberate exception to
  §10.24, because the view replaces the stage rather than floating over it. The `+` tile is
  the **live add-lane** control: it allocates the lowest free stable key, creates a blank
  lane (zero registers, XOR, focus A, all frames visible, no expressions or CSV columns) and
  focuses it; it is `aria-disabled` only at the eight-lane cap, where its accessible name
  and title explain that a lane must be deleted first. `dup` duplicates the lane's values,
  operator, lenses, visibility, expressions and CSV mapping **but not routes or parked
  bases**, then focuses the copy. `del` shows an **inline confirmation** naming how many
  routes/expressions reference the lane's frames, needs a second confirming click, cancels
  on Esc (without leaving the view) and reports the result in the footer note; the last
  remaining lane cannot be deleted. The canvas and hint are hidden (`visibility`) while the
  view is open; the strip, meta and controls stay live. The footer carries the legend and a
  horizontal scroll affordance (arrow buttons + track/thumb) for many lanes; the scroll
  region is one Tab stop and scrolls with `←/→`. Cards are buttons (Tab, `Enter`/`Space`);
  the view adds no hue and no motion beyond the scroll. Closing returns to the exact
  2-D/3-D view and focus; with the default three lanes the view keeps the same card
  geometry (only the lane-head controls and the `+` hint are new).
- **Copy menu** (`.copy-menu`) — each pane head owns a `copy to…` opener (D47). It opens an
  explicit `role="menu"` anchored under that opener with one `role="menuitem"` per **live
  lane except the pane's source lane** (built on every open; the menu's accessible name is
  `copy lane <source> to`); focus moves into the menu, `↑/↓`/`Home`/`End` move between
  items, `Enter` copies, `Escape` or an outside click closes and returns focus to that
  opener, and the live status says `copied lane 1 → lane 2`. In split 3-D the source lane is
  the pane's own lane, not necessarily the focused one. There is no invisible armed mode.
  `copyLane` clones the source lane's base registers; routes belong to the rack. Copying
  needs an existing destination lane, so the opener stays in place and becomes
  `aria-disabled` with a reason when only one lane is live; creating a lane is the frames
  view's `dup`/`+`.
- **Register edit module** (`.edit-target`, `.hex-entry`) — the read-only edit target
  (`edit · A`) plus the whole-word mono hex entry; the width slider itself stays in the
  header. The module is always present; the entry is disabled and explained when the
  focused frame is derived or driven.
- **Agent tab (help panel)** — the `?` panel gains a `keys | agent` tablist
  (`role="tablist"`/`tab`/`tabpanel`, ArrowLeft/Right/Home/End, Esc closes and returns
  focus; `keys` is the default tab). The `agent` tab is additive and only exists while the
  panel is open: bridge status (`[data-agent-status="bridge-active"]`), copy
  handoff-prompt/deeplink/state buttons (clipboard with a legacy fallback), the live
  `#bitwave-state` JSON, and the six read-only tools from `src/core/agent-tools.ts` with
  one call example each. Drawn only from `--panel`, `--panel-hi`, `--line`, `--text`,
  `--dim`, `--accent`; no new hue. The panel-closed instrument is pixel-identical.

---

## 9. Responsive

One breakpoint: **720px**.

- `--pad` → 16px; header wraps; subtitle hides; the size slider takes a full row.
- Control groups gain `flex-wrap`, so button rows reflow into two lines.
- **Compact strip** engages when `pw / n < 46` — the four bit glyphs stop being legible
  below ~46px per nibble, so the strip drops to hex-only. This is driven by *available
  width* in `draw()`, not by nibble count. At 16 nibbles a 420px phone engages compact;
  the same 16 nibbles on a 1440px desktop do not.

**Stable module order.** The controls row is `source | register edit | operate | derive |
motion | view` — one named `role="group"` per module, same order at every width; the row
wraps, it never reorders. `source` comes first because it is the daily-use path; `operate`
before `derive` follows the signal flow (edit → op → result); `motion` and `view` are display
settings and come last. The register width slider stays in the header.

**Zoom and reflow** (with §5): at 200 %/400 % browser zoom the viewport is small, so the
page scrolls and the stage keeps its `220–620px` floor. The responsive rules above still
apply at every zoom level; no control may be removed from the DOM to fit.

**Reserve space, never hide.** Controls that do not apply yet (binops before B, the CSV
stepper before a load, the LFO's B-phase before B) are rendered **disabled with a visible
reason** — `aria-disabled` and a title/status — instead of `hidden`. Tab order and module
height stay stable across mode changes (audit §4 "moving targets").

**Agent tab.** The help panel keeps `keys` as its default tab; `agent` is second. Its
content exists only while the panel is open, so the default instrument's pixels and tab
order are unchanged. `?` opens the panel and the tab row is one keyboard path; Esc closes
and returns focus.

**Targets.** Every interactive target is ≥24×24 CSS px; `.op.mini` gets `min-height: 24px`
and the `width` range thumb is ≥24 px. Dense glyphs are the visual of a larger semantic
target, never the target itself.

Body grid must stay `grid-template-columns: minmax(0, 1fr)` — see §10.

---

## 10. Do not break

Every item below is a real failure discovered during the build. Each one broke
something that looked fine until it was measured.

1. **Never use percentage padding on `.nib`.** Percentage padding resolves against the
   *container*, so `padding-right: 10%` gave every nibble 134px of unshrinkable padding
   and pushed 6 of 16 columns off-screen. Use the JS-computed flex `gap`.
2. **Body needs `grid-template-columns: minmax(0, 1fr)`.** Without it the implicit
   column sizes to a control group's *min-content*, the page grows to 467px inside a
   420px viewport, and the right edge clips.
3. **Never let `.bits` fill the whole nibble** (`width: min(100%, 5.2ch)`). Uncapped, a
   2-nibble register scatters its digits 166px apart and the binary stops reading as a word.
4. **`--pad` must be written by `fitCanvas()`, not just CSS.** If the canvas inset and the
   strip gutter disagree by even 2px, the curve stops sitting over its columns.
5. **`setPointerCapture` must stay wrapped in `try/catch`.** It throws on an inactive
   pointer (released early, or synthetic) and would abort the drag handler.
6. **Never reorder bits for display convenience.** `bits[0]` is the LSB; the strip
   reverses at render time only. Ops (`ROL`/`SHL`) depend on hardware order.
7. **Any new colour becomes a `:root` token,** and any canvas use of it must read the
   token via `getComputedStyle` (canvas cannot resolve CSS vars itself).
8. **A derived frame must never become editable.** No drag target, no preset target, no
   unary-op target, no bit click, no wheel — for Z1, Z2 and Z3 alike. Focusing one shows
   it read-only in the strip. The moment you can edit the result it stops being a result
   and the A·B model collapses.
9. **`recomputeZ()` must follow every mutation of A, B, or `binop`** — including mid-drag,
   where it runs on every `pointermove`. A stale Z1/Z2/Z3 shows the wrong answer with no
   error and no visual tell.
10. **`nibAt()` reads `S.N`.** Every register's nibbles must be read *before* `S.N` changes
    in `resizeRegister()`, or resize silently corrupts the value mapping.
11. **Flipping `S.compact` must re-render the strip**, not just toggle the class. The
    weight row *thins* with density, so a class swap alone would leave stale `2^k` labels
    under the wrong columns.
12. **The 3-D field is read-only.** It returns early before the handles, hover readout and
    ∞ marker. Projected planes make hit-testing ambiguous, so editing belongs in 2-D —
    the field is a lens, not an editor.
13. **3-D brings the second operand into existence.** The two operands are the ends of the
    wavetable, so the field is meaningless without both; entering it enables B/D/F if off.
14. **The planes must be smaller than the offsets between them** (`iw 0.58pw`,
    `ih 0.48ph`, `dx 0.14pw`, `dy 0.155ph`). At `0.78 / 0.72` three similar waveforms
    collapse into one illegible blob — measured, not guessed.
15. **Never highlight the middle plane.** Depth is read from a monotonic far→near ramp;
    a glow or hue change on frame 128 inverts the ordering and flattens the box back into
    2.5-D. This was shipped once and rejected on sight. If the derived frame needs to stand
    out, its central position and its frame label already do that.
16. **CSV values are right-aligned into the register**, zero-padded on the left, so a
    cell's *numeric* value is preserved (`0xDEAD` in 64 bits = `0x000000000000DEAD`).
    Overflow truncates the high bits.
17. **Column type is decided per column, never per cell.** `1011` is binary in a `flags`
    column and hex in an `id` column; the whole column is scanned (all-0/1 → binary,
    any higher hex digit → hex) exactly as nibsort does. Per-cell detection would give
    two different answers for the same string in one file.
18. **The LFO must snapshot on start and restore on stop.** It mutates the register (that
    is what makes the motion real), so the pre-LFO bits are held and put back when it is
    switched off — the register you hand it is the register you get back. Never let a
    modulator silently destroy the user's data.
19. **The LFO yields to any manual edit** (preset, op, CSV step) and to register resize.
    A modulator that keeps overwriting you is not a modulation source, it is a bug.
20. **The LFO tick loop is clamped**: `dt ≤ 120ms` and at most 6 catch-up ticks per frame,
    or a backgrounded tab fires hundreds of rotations the instant it is refocused.
21. **The default column is the WIDEST token column, not the first.** Real exports lead
    with `id` and `label`; picking column 0 would show a 4-bit id instead of the payload.
22. **In 3-D mode `toggleB` is hidden and `showB` stays pinned on.** Disabling B inside
    3-D stops easing `B` and `Z` while the 3-D volume continues rendering them.
23. **Split 3-D subdivides only the canvas plot, never `G.x0..G.x1` or `--pad`.** The bit
    strip must remain full-width and 0px column-aligned across view toggles.
24. **A frame focus is a lens, never a view switch — except in the frames view.** The
    readout lens and any in-view focus retarget the strip, readouts, truth header, stage
    bar and active card only; they never change the depth field or the surface you are on.
    The frames view is the one deliberate exception: choosing a card there focuses the
    frame **and returns to the lanes view** (D42), because that view replaces the stage.
25. **A focused derived frame is read-only.** Focusing Z1/Z2/Z3 shows its 64/128/256 bits
    in the strip with no handles, no bit click, no wheel and no canvas drag; operands stay
    the only edit targets. A write path that ignores focus is a bug.
26. **Frame names are global and derive from the stable lane key.** Operand frames are
    `A`–`P` (two per live lane) and derived frames `Z1`–`Z8` at the eight-lane cap; the
    boot instrument shows three (`A/B/Z1`, `C/D/Z2`, `E/F/Z3`). Every naming surface uses
    the focused lane's name; a bare `Z` or a per-lane `A/B/Z` triple is stale terminology.
    Visibility eyes are **per lane**, so hiding A does not hide C.
27. **Focus is per lane and survives lane switches and 3-D entry.** `enableBOnSlot()` may
    seed the second operand but must not steal focus; the frame you chose stays the frame
    the strip shows.
28. **The agent surface is read-only and versioned.** `window.BitWave` returns
    deep-frozen snapshots (`state()`, `bindings()`, `geometry()`, `frames()`) and
    exposes **no setters**; it must never become a second write path or change the
    visuals. Bump `BitWave.schema` when the shape changes. `geometry()` is the
    measured seam for the §11 control-point alignment check.
29. **One source per input, and labels carry it.** Each live operand frame reads
    exactly one of: a CSV column (`data`), a frame output (`1:1`/`z⁻¹`), or nothing.
    Choosing a data column clears the route and choosing a frame clears the column.
    A data-bound row reads `frame · column` (`A · Hex 1`); a frame-bound row reads
    `frame · source` (`A · Z3`). Z is never a destination.
30. **A driven input is locked.** Local writes — drag, bit click, wheel, preset, unary
    op, CSV step, LFO tick — must skip any input that a route drives. The strip is
    read-only and the hint names the driver. Unplugging restores the parked base
    byte-identically; resize remaps parked bases so unroute equals no-route resize.
31. **A fresh CSV import rebuilds the board.** Import clears routes and refills the
    six rows from the imported columns (widest column first), keeping per-column
    typing, right-alignment and truncation exactly as before.
32. **The strip is the semantic editor; the canvas is a lens.** Every operand nibble is
    a `role="spinbutton"` in the tab order; derived frames expose no edit path, keyboard
    or pointer. A keyboard-only user must be able to set any operand value.
33. **Focus survives a strip re-render.** LFO ticks and commits replace the strip's
    contents; the focused nibble (or the control that caused the commit) must be restored,
    never dropped to `<body>`. A click on a bit leaves focus in the strip, not on `<body>`.
34. **The live region announces committed changes only** — never per `pointermove` and
    never per LFO tick; one `role="status"` region, debounced, atomic.
35. **No control is removed from the DOM to change mode** (§9 reserve space). Inapplicable
    controls are disabled with a reason; module order and tab order never reflow.
36. **The instrument never clips to fake a viewport.** At zoom the page scrolls and the
    stage keeps its floor (§5); `overflow:hidden` on the body must not swallow controls.
37. **Reduced motion caps the instrument, it does not remove features.** LFO starts off,
    no easing, rate ≤4/s; drag stays 1:1.
38. **Accessibility work does not change the palette.** Tokens, alphas and the dim
    hierarchy are hands-off (D10 / Q8); accessibility is carried by roles, names, keys,
    targets, reflow and motion only.
39. **Persistence is versioned and derived-safe.** `.bitwave` schema 4 is additive over
    1–3: schema 1 is the closed three-lane object; schema 2 adds focus/frameVis, LFO
    mode/rate and the dataset cursor; schema 3 adds expression sources; **schema 4 makes
    `lanes` an open map keyed by the stable lane key** (`"1"`..`"13"`, gaps allowed, 1–8
    lanes, ascending numeric order). A/B hexes persist, **Z never** does; routes and parked
    bases persist so a saved patch board re-opens identically. **The live instrument loads
    the whole document lane set** (D46): a wider document widens the tree, a narrower one
    narrows it, and capture writes every live lane. Schema 1/2/3 documents load
    and upgrade on read; this build always saves schema 4; top-level unknown fields are
    preserved across load/save and canonical links. A newer schema is refused, never
    half-applied. Register widths outside `[8,16,32,64,128,256]` are refused at the app
    boundary even though the core accepts other multiples of 8.
40. **Autosave captures settled state only.** One debounced write per transaction burst;
    transient interaction state (copy menu, drag, hover, LFO snapshot) is never stored.
    `?fresh` opens an ephemeral session that neither reads nor writes autosave/share state.
41. **The share link is the fragment, not the page.** `#bw=` is the canonical **compact
    codec** (D45): unpadded base64url of a small JSON array (tag, width, view tuple, lane
    tuples with defaults omitted, route triples, parked bases, optional dataset and the
    unknown-field `x` slot), written with `replaceState` only. Legacy JSON links from
    earlier builds still load and upgrade. A shared link wins over autosave on boot and
    must stay ≤ ~2 KB at 256 bits: measured, an 8-lane 256-bit document is 1260 characters.
    The builder drops the dataset first, then expression sources, each with an explicit
    flag — never silently. No UI, view or lane-count behaviour changes with the codec. It
    works from `file://` (no network, no server).
42. **Distribution never changes the instrument.** The committed single file
    (`bitwave-v2.html`) keeps zero external references and carries no manifest or
    service-worker registration. The installable build is a separate second output
    (`dist/hosted/`): the same HTML plus a manifest, icons, a hash-versioned app-shell
    service worker and registration. The worker is same-origin `GET` only; no telemetry,
    fonts, CDNs or third-party requests. Hosted URLs are relative so a subpath deploy works.
43. **The agent layer is additive and core-derived.** The existing read-only
    `window.BitWave` (schema 1) is unchanged; `window.bitwave` sits beside it and every
    state/tool/deeplink it returns comes from `src/core/agent-*.ts`, never from the DOM.
    The help panel's `agent` tab is hidden with the panel, so the default rendered
    instrument stays pixel-identical to the pre-agent artifact — the later external-routing
    slice intentionally adds the Record control (D40), and parity is measured against the
    artifact that introduced that slice.
44. **Pure tools are read-only; writes are explicit bridge setters.** A tool call never
    mutates the UI, files or the network. Setters validate first, run the instrument's own
    commands in one transaction, never throw, and return `{ok,state}` or
    `{ok:false,error,state}`; an invalid setter leaves state unchanged.
45. **Agent events are state-change events.** Exactly one `bitwave:change` on install;
    none for a no-op setter; the hidden `#bitwave-state` always equals
    `JSON.stringify(getState())`; the debounced address-bar mirror refreshes that node
    silently. The LFO yields to a register setter like any other manual edit (§10.19).
46. **Canonical links omit `savedAt`.** A view state has exactly one `#bw=` link, equal
    state gives equal links, and the existing 2000-character budget/dataset-drop rule is
    unchanged. `getDeeplink()`, the address bar and `build_deeplink` agree.
47. **Expression sources are deterministic register functions.** An expression is text in
    `.bitwave` schema 3 (carried through schema 4), evaluated by the shared DOM-free
    evaluator on every clocked pass
    after routes and before Z. It sees the current frame words plus the *previous* recorded
    row as `log.<frame>`; exact rationals are internal (float authoring input is converted
    once at the boundary), the result must reduce to an integer, and it wraps modulo 2^N.
    Invalid text never alters registers; the source table reports it and the bridge rejects
    it with `E_INVALID_EXPRESSION`.
48. **Record is a transient take, not a catalog.** One row of **`3L` frames** (three per
    live lane) is appended per settled evaluation while armed (the pointer-drag stream is
    skipped; the row lands on release); the buffer is a bounded in-memory ring, cleared by
    starting a take and never stored in `.bitwave` or the share link. Expressions read the
    previous row, one update late, so a snapshot cannot include its own result. The export
    CSV header follows the live lane set (`step, A, B, Z1, …, O, P, Z8`).
49. **Schemas 3 and 4 are additive.** Schema 3 added expressions on
    `lanes.<n>.expressions`; schema 4 adds the dynamic lane map (D44). Schema-1/2/3
    documents load with their defaults (no expressions, closed three lanes), unknown fields
    survive, and the version refusal is `> 4`. `E_BAD_ENUM` rejects derived frames;
    `E_DRIVEN_INPUT` rejects writes to a routed or expression-driven operand.
50. **Float is a valid authoring format.** Float coefficients from audio/DSP tools and
    JSON numbers are converted once, at the expression/import boundary, with a declared
    precision/rounding contract; the internal exact-rational arithmetic is a reproducibility
    rule for the register bits, not a ban on float workflows (D40, `docs/EXTERNAL-ROUTING.md`
    §4.1).
51. **The hinge is presentation only.** A per-lane `fold` swaps which operand plate is far
    vs near in 3-D; it never swaps registers, counts, bindings or the operator, and the Z
    label keeps the real operand order. Line style follows the operand, not the position.
    Default `a-far` preserves the current view; the field stays read-only (§10.12) and the
    middle plane is never highlighted (§10.15). Fold is session state until the dynamic-lane
    schema ships.
52. **The trend badge owns a fixed slot.** `level`, `step-up` and `step-down` must not
    resize the wrapping meta readout; `#trend` uses a fixed inline size with centered text,
    so changing the word can never move the hex/decimal/ABZ values beside it.
53. **The readout labels are a focus lens, never an editor.** The `A`/`B`/`Z1` buttons call
    the same `setFocus` lens as the frames view (D16): they never write a register, never
    switch the view and never open or close a surface; `Z1` stays a read-only focus.
    `aria-pressed` follows the focused frame, and the strip, hint, edit target and
    whole-word hex entry follow the selection (D41).
54. **The frames view is a stage mode, not a panel.** While it is open the canvas and hint
    are hidden and the stage bar shrinks to `Lanes`; every live lane's frames get equal
    cards (three per lane, nine at boot); the `+` tile is the **live add-lane** control
    (disabled only at the eight-lane cap, with a reason) and each lane head carries compact
    `dup` / `del` controls (D46); closing returns to the exact 2-D/3-D view and focus
    untouched. The stage/strip/readout geometry of the default instrument (view closed) is
    unchanged; the D46 slice intentionally changes the stage-bar lane control and the
    frames-view lane-head/hint pixels, so parity is measured against the artifact that
    introduced this UI slice.
55. **A lane's identity is its stable key, and the live set is 1–8 lanes.** `S.lanes` is
    keyed by `"1"`…`"13"` (the grammar ceiling) and the app cap is eight; the live set may
    have gaps (`1`, `3`, `4`), is always iterated in ascending numeric key order, and is
    **never renumbered**. Adding allocates the lowest free key; deleting frees that key for
    reuse. The ordered live list is derived from the map, never from array position.
56. **Delete clears routes and restores surviving destinations.** Deleting a lane removes
    every route touching it: a route entering the deleted lane is dropped with its parked
    base; a route leaving it unplugs its surviving destination and restores the parked
    pre-patch base byte-identically, exactly as an explicit unplug would. The last lane can
    never be deleted; focus falls to the lowest remaining lane; `splitPair` is repaired and
    split exits below two lanes.
57. **Duplicate copies the lane, not its wiring.** A duplicated lane takes register
    bits/values, `showB`, operator, edit/focus lenses, seeded flag, B phase, frame
    visibility, expressions, fold and CSV columns — **never** route edges or parked bases
    (routing belongs to the rack), then the copy is focused.
58. **Share length is measured, never enforced in the UI.** The compact `#bw=` link is the
    only budget gate and it drops the dataset first, then expressions, with explicit flags;
    there is no budget meter, warning component or per-lane share control. A 16-route
    8-lane 256-bit document is the documented overflow case (link not written); this is
    reported, not prevented. An 8-lane 256-bit document measures 1252 characters through
    the live app path (1260 for the fully seeded fixture).
59. **The live lane set drives every derived surface.** Routing/evaluation, expression
    environments, LFO snapshots, CSV column mapping, resize remapping, Record rows, the
    observation/export-log columns and the agent `getState()` lane map all iterate the
    live lanes — adding or deleting a lane changes them together, in one transaction.
60. **The wave-view control lives in the top bar.** D47: the 2-D/3-D toggle (`#depthBtn`,
    `aria-pressed`, title, Tab + `Enter`/`Space`) sits in a named `view` group with a small
    `VIEW` label immediately left of the help `?`; the bottom controls row has five named
    modules (`source`, `register edit`, `operate`, `derive`, `motion`) and **no view
    group or empty band**. The header layout must hold at 360/720/1440 px without
    horizontal overflow or a clipped control. Re-homing the control changes no behaviour:
    it still only toggles the view lens and brings operand B into existence on entry.
61. **The hinge and the copy menu are per-pane controls.** D47: every pane head owns its
    own 3-D hinge (`A far`/`B far`, visible only in 3-D) and its own `copy to…` opener.
    The hinge toggles **that pane's lane** fold — in split 3-D the two panes are
    independent — and the copy menu's source is **that pane's lane**, so its items are the
    live lanes except that source. Neither control changes the focused lane, writes a
    register or alters Z. With a single live lane the copy opener stays in place,
    `aria-disabled`, with a reason (no other lane to copy into).
62. **The truth table is an always-present disclosure, never a view-gated block.** D47:
    the header button (`A ⊕ B → Z1` etc., `aria-expanded`/`aria-controls`, 24 px target,
    Tab + `Enter`/`Space`) is visible in A-only, A·B, 3-D and split; the body keeps the
    same live `role="table"` grid and counts, including the ADD/SUB carry/borrow variant.
    It defaults expanded, expands/collapses in place, and its fixed block width means the
    toggle can never move the hex readouts horizontally. `S.truthOpen` is transient
    session state: it is not in `.bitwave`, the share link or the agent state, and no
    toggle writes a register or changes the view.

---

## 11. How to verify a change

The visual contract is measurable, so measure it rather than eyeballing:

- Canvas control-point alignment: `BitWave.geometry().controlPoints[j]` vs.
  `dom.nibs[j].center` → **must be < 1.5px** (asserted by `npm run check:browser`).
- No horizontal overflow at 420px: `body.scrollWidth - body.clientWidth === 0`.
- `canvas.width === viewport width` at the mobile breakpoint.
- Zero `console.error` and zero uncaught exceptions during load + 2s of animation.
- Bit-exact op checks: `ROL 4` on `FEDCBA9876543210` → `EDCBA9876543210F`;
  `NOT` of the same → `0123456789ABCDEF`.
- `BSWAP` on `FEDCBA9876543210` → `1032547698BADCFE`; twice is the identity; it is a
  **no-op at 8 bits** (one byte has no byte order).
- A·B with A = `8ADEFEDA85210125`, B = `FFFFFFFF00000000`:
  XOR → `7521012585210125`, AND → `8ADEFEDA00000000`, OR → `FFFFFFFF85210125`.
- Truth counts for that pair = `23, 11, 9, 21`; `popcount(Z xor) = 20`, `popcount(Z and) = 21`.
- Editing B must not touch A (`NOT` on B leaves A byte-identical) and must re-derive Z.
- Frame focus: from the navigator, clicking A/B/Z1 in a 3-D view must leave the view and
  the panel in place, retarget the strip label, and keep Z1's strip read-only (a bit click
  must not change any operand).
- Readout lens: in A·B/3-D the `A`/`B`/`Z1` readout labels are buttons; pressing `B`
  retargets the strip, edit target and whole-word hex entry to B, pressing `Z1` makes the
  strip read-only and disables the hex entry, and the view mode and opened panels do not
  change; `aria-pressed` follows the focused frame and every target is ≥24×24 px (D41).
- Frames view: `frames` hides the canvas, shows three equal cards per live lane (nine at
  boot) plus the `+` tile and `Lanes`; choosing a card returns to the same 2-D/3-D view with
  that frame focused (a Z card lands on a read-only strip); eyes toggle per-lane visibility
  without leaving; the scroll arrows are disabled when the grid fits and scroll one column
  when it does not; Esc returns; every card is a button and axe stays clean in the open
  view (D42). The `+` tile is live: it adds a blank lane at the lowest free key, focuses it
  and disables only at eight lanes with an explanatory name; `dup` copies the lane's model
  state but no routes; `del` shows an inline confirmation that counts routes/expressions,
  requires a second click, cancels on Esc without leaving the view, and clears routes /
  restores surviving destinations (D46).
- **Live lane set:** the stage bar shows one native lane dropdown per pane (two in split,
  the second named "Lane (second pane)") with `Lane 1`…`Lane 8` options; changing it focuses
  that lane; `Alt+1…8` selects a live lane and does nothing for an absent key; adding
  through the frames view grows the set to eight, deleting removes exactly that key (no
  renumbering) and a freed key is reusable; the source table then shows `2L` rows grouped
  under a lane header; the Record export header lists `3L` frames; an 8-lane 256-bit
  document round-trips through a compact `#bw=` link within 2000 characters.
- 3-D hinge: in 3-D each visible pane head carries its own hinge; it reads `A far`; pressing
  it reads `B far`, moves that pane lane's dashed B plate from near to far (and A solid to
  near), and leaves A/B/Z values and the Z label unchanged; the control is hidden in 2-D
  and, in split, the two hinges are independent (toggling one never changes the other).
- Top bar: the `VIEW` label + `3D` toggle sit in the header immediately left of the help
  `?`; the bottom controls row has five named modules and no view group/empty band; the
  toggle round-trips through click and `Enter`, its `aria-pressed` and view state agree,
  and the header still holds at 360/720/1440 with zero horizontal overflow (D47).
- Truth disclosure: the header button (`A ⊕ B → Z1` for lane 1, `G ⊕ H → Z4` for lane 4,
  `G + H → Z4` for arithmetic) carries `aria-expanded`/`aria-controls`, is at least 24 px,
  and toggles with click and `Enter`; the body is the same live `role="table"` grid and
  the same counts (`23 11 9 21` for the §11 pair; the ADD/SUB carry/borrow row for
  arithmetic); it is present and open by default in A-only, A·B, 3-D and split; collapsing
  and reopening never move `#hex`/`#hexA`/`#hexZ` horizontally; the preference is not in
  the project/link/agent state (D47).
- Readout stability: with the trend badge forced through `level`, `step-up` and `step-down`
  in 2-D and 3-D, the badge width and the `#hex`/`#hexA`/`#hexZ` positions must not move;
  the badge word must not overflow its slot.
- Frame names: lane 1 reads A/Z1/B, lane 2 C/Z2/D, lane 3 E/Z3/F and lane 8 O/Z8/P in the
  strip, stage bar, truth header, frames view and A/B/Z readouts; hiding A in lane 1 leaves
  C visible; names follow a lane's stable key across add/delete (`1,3,4` keeps Z3/Z4).
- Source table: `2L` rows grouped by live lane; a data-bound row reads `A · <column>` and
  its STATE is `data`; a frame binding reads `1:1` (or `z⁻¹` for same-lane Z) and drives
  the register; unplug restores the parked base byte-identically; a driven input's strip is
  read-only and a bit click cannot change it; a fresh import fills the live board from the
  columns.
- **Keyboard-only task:** from boot, Tab reaches the strip; the focused nibble is set by
  `↑/↓`, `Home`/`End` and `0–F`; `←/→` moves between nibbles; a hex word commits; a preset,
  a unary op and a CSV step all work without a pointer; focus is never lost to `<body>`.
- **Roles, names, state:** the canvas has `role="img"` and a current text alternative;
  every `.seg` exclusive set is a `radiogroup`/`radio` with `aria-checked`; every symbol or
  glyph button has an accessible name; the truth table has table semantics; the live region
  announces commit results and stays quiet during drag and LFO ticks.
- **Zoom/reflow:** at 1280×720 @200 % (640×360 CSS px) and 1440×900 @400 % (360×225 CSS px)
  every control is reachable by scrolling, the stage is ≥220 px, and horizontal overflow is 0.
- **Reduced motion:** with `prefers-reduced-motion: reduce` emulated, the LFO is off after
  load; starting it caps at 4/s and commits without easing; the hint does not fade.
- **Targets:** `.op.mini` ≥24 px tall, `width` thumb ≥24 px, and the nibble semantic target
  covers the whole nibble.
- **Persistence:** `save project` downloads a schema-4 document (a lane map keyed by the
  stable lane key); `open project…` applies one (lanes, routes/parked bases,
  focus/frameVis, LFO mode/rate, dataset cursor, expressions) and a refresh shows the
  restored width/lane/view; opening an 8-lane document makes eight lanes live, and a
  document with gaps keeps exactly those keys. Schema 1/2/3 documents load and upgrade, and
  a document with a newer schema is refused with a readable error. Autosave survives a
  reload; a shared `#bw=` link restores the same state (and wins over autosave); an 8-lane
  256-bit link measures 1252 characters through the live path (1260 for the seeded fixture),
  within the 2000-character budget; `?fresh` writes neither. Non-token CSV files and empty
  files are refused with a status message and do not replace the current dataset.
- **Distribution:** `npm run check:pwa` serves `dist/hosted/` on `127.0.0.1` and asserts the
  manifest + every icon load, the worker registers/activates/controls the page, the app shell
  is in a `bitwave-<hash>` cache, a reload **with the origin server stopped** still boots
  from that cache with zero console errors, and the hosted build serves the agent manifest,
  an example envelope and `llms.txt`. It also asserts the committed single file has no
  manifest/icon/service-worker references, and that the hosted page's only external refs are
  the PWA shell.
- **Agent interface:** `npm test` includes the registry, state-builder and transport suites;
  `node agent/gen-agent-artifacts.mjs --check` is current; `node agent/selftest.mjs` passes;
  `node agent/verify-browser.mjs` asserts readiness, `#bitwave-state` === `getState()`,
  one change event on mount, no-op silence, setter truthfulness/errors, the legacy
  `window.BitWave` surface, deeplink reloads twice, the agent tab, no overflow at
  360/720/1440 and zero console errors. The default 2-D view is compared against the
  artifact that introduced the current UI slice (`browser-check --compare`); the
  external-routing slice intentionally adds the Record control, the dynamic-lanes slice
  intentionally changes the stage-bar lane control and the frames-view lane heads (D46), and
  the GUI-rearrangement slice re-homes the view toggle, the hinge/copy controls and the
  truth table into the readout disclosure (D47), so those states are expected to differ
  from the pre-slice artifacts. `--compare` is therefore not a valid parity gate across
  D47: parity for this slice is measured against the artifact that introduces it, and the
  re-homed regions are recorded in D47. Measured at review time: `--compare` against the
  toolset-1.4.0 HEAD artifact reports **6/6 states differing** (`2d-default`, `frames-open`,
  `3d`, `3d-focus-z1`, `csv-import`, `breakpoint-720`), with the canvas, strip, values and
  readout order otherwise identical — i.e. only the deliberately re-homed regions differ.
- **Agent lane surface (toolset 1.4.0):** the lane enum is the shipped 1–8 range and the
  frame vocabulary is `A`–`P`/`Z1`–`Z8`; the stage-bar dropdown is the documented lane
  selector (`ui.laneSelect`, active select carries `[data-agent-lane]`) and names the
  focused lane after `setLane`; `setLane`/`setFrame` for a lane the live tree does not
  carry return `E_OUT_OF_RANGE` with no state change and no event; an eight-lane schema-4
  document loads through its canonical compact `#bw=` link reporting eight stable lane
  keys, `setLane(8)` works, and the frames view renders 24 cards (`A`–`P`/`Z1`–`Z8`).
  `node agent/verify-browser.mjs` is **34/34** and the D46 rebuild stayed **6/6 states
  pixel-identical** to the D46 UI artifact (`browser-check --compare`); the D47 layout
  slice intentionally re-homes the view/hinge/copy/truth controls, so that parity note
  stops at the D47 artifact.
- **External routing (schema 3; schema 4 additive):** the source table offers `expr` rows; a valid expression
  changes the operand and Z on the next evaluation, an invalid one restores the previous
  text and leaves the registers alone (`E_INVALID_EXPRESSION` from the bridge); Record
  appends one row per settled update and `export log` downloads the CSV; `getLog()` and
  `getState().recording` agree; a project/link round-trip preserves expressions but not the
  transient log; the float policy is documented, not tested as a ban.
- **Automated a11y audit:** axe-core (dev-only, never in the artifact) reports **zero
  critical/serious** violations in the 2-D, A·B, 3-D, source-table, frames-view and
  eight-lane frames-view states.

- **Information architecture:** the stage bar is visible in 2-D and 3-D and is the only
  home of the lane selector (a native per-pane dropdown), the `frames` opener, `split`, the
  per-pane 3-D hinge and the per-pane `copy to…` opener (disabled in 2-D for split, hidden in
  2-D for the hinge); the controls row renders **five** named modules in order at every
  width (`source | register edit | operate | derive | motion`), with no view group; the
  top bar owns the `VIEW` label + `2D/3D` toggle left of `?`; inapplicable controls are
  present and `aria-disabled`, never absent; `copy to…` is a focus-in per-pane menu that
  Esc closes and whose copy is spoken (listing the live lanes except that pane's source
  lane, and aria-disabled at one lane); the hex entry right-aligns a word, refuses invalid
  input and reverts on Esc; `?` opens the keyboard map; the truth table exposes
  `role="table"` rows/cells inside the always-present readout disclosure.

A headless-Chrome CDP pass drives these in seconds: `npm run check:browser`
([`tools/browser-check.mjs`](tools/browser-check.mjs), zero dependencies) asserts
them on the shipped file over `file://`. Any change touching §5 or §6 must re-run
them.

---

## 12. Roadmap

### Shipped
- **Operand register B + truth table.** Resolved exactly as predicted: B reuses the accent
  at higher weight with a dashed stroke. No third hue was needed. Amber stayed structural.
- **`BSWAP`** — byte-order reversal, the horizontal counterpart to `NOT`'s vertical flip.
- **Positional weight display** — per-nibble decimal value plus place value `2^k`, with a
  hover readout of `value × 2^weight`. Makes the MSB's dominance visible rather than
  asserted.
- **Arithmetic operands** — `ADD` / `SUB` sit alongside `AND`/`OR`/`XOR`, so the carry and
  borrow terms are directly comparable against XOR on identical operands. Arithmetic gets
  a 2-column carry/borrow summary instead of a truth table, because the result depends on
  the whole word, not on the bit pair.
- **Depth (Z-axis) view** — three wavetable frames: A at 1, Z at 128, B at 256, in an
  axonometric box. The result sits *between* the operands, which is the whole point.
- **CSV example stepper** — load a CSV/TSV and step rows like slides; the source table
  binds each of the six inputs to an imported column. Register size auto-fits the
  chosen column; binary and hex columns both parse.
- **Multi-view lanes + parallel 3-D split** — three independent register/op/CSV lanes
  (`1`, `2`, `3`) with `copy →` cloning and side-by-side 3-D split mode, enabling 4+ CSV
  columns (or distinct operators like `XOR` vs `SUB`) to be compared in parallel across
  manual steps and LFO cycles.
- **Global frame names + focus lens** — lane 1 is A/B/Z1, lane 2 C/D/Z2, lane 3 E/F/Z3;
  the six operand frames A–F are the matrix's fixed rows and A–F + Z1–Z3 its sources.
  Clicking a frame in the navigator focuses it in place: the view does not change, the
  panel stays open, operands stay editable and derived frames are shown read-only. The
  strip, legend, stage bar, truth header and readouts all follow the focused lane's names.
- **Input source table + frame routing** — the six-row matrix is the housing for the
  existing source dropdowns: each input reads one CSV column or one frame output, with
  `data` / `1:1` / `z⁻¹` / `—` states. Labels carry the assignment (`A · Hex 1`). Driven
  inputs are locked against local edits, unplugging restores the parked base, and the
  panel is transient — no cable graphics, no routing mode.
- **F4 accessibility + information architecture** — keyboard-editable nibble spinbuttons,
  reflow/zoom with a stage floor, reduced motion, one committed-change live region, 24 px
  targets and an axe gate; the always-visible stage bar as the single home of lane, frames
  and split; the stable module order (source | register edit | operate | derive | motion |
  view); an explicit copy menu; `width` + whole-word hex entry; reserved-space disabled
  states; the `?` keyboard map and real table semantics for the truth table. Palette
  unchanged (D10).
- **F5 persistence & reach** — `.bitwave` schema 2 (additive focus/frameVis, LFO mode/rate,
  dataset cursor) with a DOM-free app bridge; explicit project menu (save/open/reset);
  debounced autosave with a boot restore; shareable state in the URL fragment
  (`replaceState`, ≤ ~2 KB at 256 bits); embedded 8-row demo dataset; a visible dataset
  status line that refuses empty/non-token files; `?fresh` ephemeral sessions; the stale
  `index.html.bak` removed from the distribution folder. Palette unchanged (D10).
- **F6 distribution** — a hosted, installable build while the single-file artifact stays
  untouched: manifest + maskable icons, a hash-versioned app-shell service worker
  (same-origin `GET` only, offline fallback), relative URLs for subpath hosting, a
  `check:pwa` harness that proves install/offline against the real built output, and
  [`docs/hosting.md`](docs/hosting.md) with deploy/install/privacy guidance. Tauri remains
  deferred (D37).
- **Agent interface (2026-11-08)** — one DOM-free source of truth for agents
  (`src/core/agent-tools.ts` six pure tools + one envelope + closed error set + manifest +
  patch validation; `agent-state.ts` UI state; `agent-share.ts` canonical links), the
  additive `window.bitwave` bridge beside the untouched read-only `window.BitWave`, a hidden
  `#bitwave-state` + readiness/change events, a `keys | agent` tab in the `?` help panel,
  zero-dependency CLI + MCP stdio server, generated `agent/manifest.json` + examples, and
  AGENTS/contract/screenshot/ecosystem docs. Default rendering pixel-identical; hosted
  build serves the agent files (8/8 PWA checks).
- **External routing (2026-11-08)** — deterministic expression sources in the six-row
  source table (one-line editor, validated, `expr` state), a DAW-style Record toggle +
  bounded transient frame log + `export log`, `.bitwave` schema 3 (expressions additive;
  schema 1/2 still load), and bridge/CLI-visible `setExpression`/`setSource`/`setRoute`/
  `record`/`getLog` with
  `recording` and per-lane `expressions` in the agent state. Float is accepted as an
  authoring boundary and converted once to exact values; the register engine stays exact.
  Toolset 1.1.0; the default control row intentionally gains the Record control (D40).
- **Dynamic lanes (2026-11-14)** — stable lane-key identity with names generated from the
  key (`0 → A/B/Z1`, …, `7 → O/P/Z8`), `.bitwave` schema 4 (open lane map, gaps allowed,
  1–8 lanes, migration from the closed three-lane documents), the compact `#bw=` codec with
  a measured budget, and this UI slice: the live tree holds the document's whole lane set;
  the stage bar replaces the `1 | 2 | 3` radiogroup with a native per-pane lane dropdown;
  the frames view's `+` becomes the live add-lane control and each lane head gains
  duplicate/delete with an inline reference-counted confirmation; the source table becomes
  `2L` grouped rows; Record rows and the copy menu follow the live set. Lane management is
  no-renumber, min 1 / max 8; delete clears routes and restores surviving parked bases;
  duplicate excludes route edges. Accessible names and 24 px targets cover the new
  controls; axe stays clean in single- and eight-lane frames views. The final slice
  widens the agent surface to the same live 1–8 range (toolset 1.4.0: frames
  `A`–`P`/`Z1`–`Z8`, the stage-bar dropdown as the documented lane selector, non-live
  lane setters refused, an eight-lane state verified and screenshotted).
- **GUI rearrangement (2026-11-14, D47)** — layout re-homing with unchanged behaviour:
  the `VIEW` + 2D/3D toggle moves to the top bar immediately left of `?` (the bottom VIEW
  row is removed and the controls row keeps five modules); each stage-bar pane head gains
  its own 3-D hinge (`A far`/`B far`, independent per pane in split) and its own `copy to…`
  menu (source = that pane's lane, destinations exclude it, disabled with a reason at one
  lane); the truth table becomes a collapsible disclosure in the readout row, present in
  A-only/A·B/3-D/split, default expanded, header always visible with `aria-expanded`/
  `aria-controls` and a 24 px target, body in place with unchanged `role="table"` content
  and counts, session-only open state (`S.truthOpen`), and no horizontal movement of the
  hex readouts when toggled. No new hue, no new style; the re-homed regions are the
  documented parity exception.

### Next

- **Arithmetic delta vs bitwise delta.** `a − b` and `a XOR b` differ by exactly the borrow
  term `2·(¬a ∧ b)`. Drawing both would let a student *watch* the two coincide when `b`'s
  set bits are a subset of `a`'s (`a AND b == b`) and diverge when they are not — the
  clearest possible answer to "is XOR the difference signal?", and it is one extra derived
  register on the machinery already built for Z.
- **Byte reversal has no affordance beyond its name.** It is the horizontal twin of `NOT`
  and deserves to be *shown* as such: a short mirror animation so students watch the byte
  blocks swap rather than seeing the number simply change. Cheapest high-value follow-up —
  one transition, and it teaches endianness by motion.
- **Two's-complement toggle.** Changes only the vertical mapping (§6), not the geometry.
  Must not touch the unsigned default; `0000` stays at the bottom in both modes.
- **Fold vs. truncate comparison.** Two curves from one register: refolded (wavefolder
  semantics) against truncated (real register overflow). The distinction is the most
  valuable single lesson in fixed-width arithmetic and deserves its own view.
- **Endpoint-trend badge is coarse.** `step-down` compares first and last nibble, so a
  full sine reports `step-down`. Fine for the saw/skew cases it was built for; wrong for
  closed waves. Fix by reporting *net displacement* or by recognising a closed cycle.
- **B is seeded silently** with a square wave on first enable, so AND/OR/XOR immediately
  read as masking. If that ever feels like a surprise, the alternative is a zeroed B whose
  flat line reads as "empty operand".

---

## 13. Change protocol

1. Colour, size, or offset change → edit this file first, then `:root`.
2. Geometry change → update §5 and §6, then satisfy §11 before calling it done.
3. New component → state its role under §8 and which existing token each value draws from.
4. New hue → justify it against §3. The answer is usually "no".
5. **Source change → `src/`, never the built file.** `bitwave-v2.html` is generated by
   `npm run build` from `src/`; prove a rebuild with
   `node tools/browser-check.mjs --compare <old-artifact>` (six states, pixel-identical) —
   unless a reviewed UI slice intentionally changes the rendered instrument, in which case
   compare against the artifact that introduced that slice and record the changed states
   (as D40 did for Record, D46 does for the lane dropdown and frames-view lane heads, and
   D47 does for the re-homed view control, hinge/copy controls and truth disclosure).
   `index.html` stays untouched as the reference build.
6. **Any new control must declare its keyboard path and accessible name in §8** and
   implement it before shipping. A control a keyboard-only user cannot reach is not done.
