# External routing — record/log and expression operands

**Status: shipped slice (2026-11-08) — toolset 1.1.0, `.bitwave` schema 3.** The
expression evaluator, expression-aware clocked pass, schema-3 project mapping, source-table
`expr` editor, DAW-style Record toggle/log/export, and bridge `setExpression`/`record`/
`getLog` are implemented. This note remains the design record; the Node prototype below is
kept as a reproducible reference model. The document format advanced to schema 4 in D44
(toolset 1.2.0), which is additive over the expression fields described here.

This note records the next seam after the agent interface: a simple, DAW-style
**Record** control and a deterministic **expression operand** for the six input frames.
The goal is not a new visual language — it is to let formulas from external libraries
(SymPy, Python, a user's own agent) drive the existing register/route graph while every
number on screen remains a real register state.

Prototype:

```powershell
node tools/prototype-external-routing.mjs --width 64        # human table
node tools/prototype-external-routing.mjs --width 256 --json
node tools/prototype-external-routing.mjs --width 64 --check # deterministic self-check
node --test tests/external-routing.test.ts
```

Code: [`src/core/expression.ts`](../src/core/expression.ts) (evaluator),
[`src/core/external-routing.ts`](../src/core/external-routing.ts) (clocked pipeline),
[`tools/prototype-external-routing.mjs`](../tools/prototype-external-routing.mjs).

## 1. Physical model (non-negotiable)

- A frame **is** an N-bit register; the width slider sets N. The wave is the
  MSB→LSB nibble word drawn over the X-axis. Nothing is generated for appearance.
- A route is a **per-evaluation assignment** into a distinct register. `Z1 → C` means
  lane 2's own C register receives Z1's bits on every evaluation (or the delayed `z⁻¹`
  value for a back-edge). C is not an alias or a shared object; unplugging restores the
  parked base, and a driven input is locked against local edits.
- A live `1:1` route therefore makes C equal Z1 **in the same evaluation**. If a frame
  must hold a prior value while its source moves on, that is the **log/capture** path,
  not a live route.
- Expressions map words to words: integer/rational arithmetic, explicit rounding, then
  wrap modulo 2^N. Every result is stored in a real frame register; Z is still derived by
  the lane operator.

## 2. The clocked pipeline

One update = one evaluation boundary (CSV step, LFO tick, or a settled manual update).

```
1. Lane 1:  A, B  -> Z1
2. Route:   Z1 -> C              (live 1:1; C is lane 2's own register)
3. Expression D:  D = f(C, frames-so-far, previous log)
4. Lane 2:  C, D  -> Z2
5. Route:   Z2 -> E              (live 1:1; E is lane 3's own register)
6. Expression F:  F = g(E, frames-so-far, previous log)
7. Lane 3:  E, F  -> Z3
8. Record:  append one snapshot row of A B Z1 | C D Z2 | E F Z3
```

Expressions read the **previous** recorded row (`log.<frame>`), never the row being
written. This is deliberate: a snapshot that includes the current result would make D
depend on Z2, which depends on D. One-update delay gives a well-defined, deterministic
feedback loop, matching the instrument's existing `z⁻¹` discipline.

The prototype follows this exact order; `C === Z1` and `E === Z2` every step, and the
final log row equals the last step's frames.

## 3. Record — DAW-simple

- **One toggle** in the source group, `aria-pressed`, accent-on state (no new hue, no
  red). Rows are appended while armed; stop freezes.
- **What is recorded:** all nine frame registers per update (`A B Z1 | C D Z2 | E F Z3`)
  plus a 1-based step index. No wall-clock timestamps.
- **Cadence:** settled evaluation updates — CSV step, LFO tick, explicit commits. The
  active pointer-drag stream is skipped (record the clock, not every pointermove), so a
  drag produces one row on release.
- **Storage:** in-memory ring buffer (design cap 2048 rows), cleared on reload. **Not**
  persisted in `.bitwave` or the share link — history is a session artifact; the shared
  object stays small and reproducible.
- **Export:** extend the existing observation CSV path (or a dedicated `export log`);
  the current `log`/`export` behavior is unchanged.
- **Read access:** expressions use `log.<frame>` (last recorded row); the agent layer can
  read the same rows through a future `getLog`/`record` bridge surface.

## 4. Expression operand

New source kind for the six operand frames: `expr`. Text is part of the project document
(schema 3), so a link reproduces the same computation. Evaluation lives in `src/core`, so
browser, CLI and MCP produce identical bits.

### Grammar (prototype, implemented)

```
expression := or
or         := xor ( '|' xor )*
xor        := and ( '^' and )*
and        := shift ( '&' shift )*
shift      := sum ( ('<<' | '>>') sum )*
sum        := product ( ('+' | '-') product )*
product    := unary ( ('*' | '/' | '%') unary )*
unary      := ('+' | '-' | '~') unary | primary
primary    := number | name | name '(' args ')' | '(' expression ')'
```

- `number`: decimal integer, decimal fraction, or `0x` hex.
- `name`: global frames `A`–`F`, `Z1`–`Z3`; width `N`; previous log `log.<frame>`.
- functions: `floor`, `ceil`, `round` (half away from zero), `abs`, `min`, `max`.
- operators: arithmetic, `%` (BigInt remainder), bitwise `& | ^ ~`, shifts `<< >>`.
- no variables, assignments, conditionals, loops or function definitions; no `eval`.

### Value semantics

1. Values are **exact rationals** internally (`n/d` BigInt, normalized). Floats are a valid authoring format; exact rationals are a reproducibility rule, not a ban (see §4.1).
2. Arithmetic is exact; `+ - * /` and decimal literals stay rational.
3. Bitwise/shift operators coerce operands to unsigned N-bit **words** (mod 2^N);
   shifts require a non-negative integer count.
4. The expression must reduce to an integer. If it has a non-zero denominator, the tool
   refuses it with a hint to wrap in `round`/`floor`/`ceil`.
5. The integer result wraps modulo 2^N — the same rule as every register write.
6. Constants such as ∛2, ∛3, φ, π are **literals or rational approximations supplied by
   the expression**; the core does not pretend to know π. A user's agent can generate a
   high-precision rational, and the same text always gives the same bits.

### 4.1 Float policy — not anti-float

Float is a first-class **authoring and transport** format in this design, not a forbidden
one. Audio tools, DSP libraries, JavaScript/JSON, and many agents speak `f32`/`f64`;
those workflows are welcome.

The only rule is about **where conversion happens**: a float that enters a register
expression is converted **once, at the boundary**, into an exact rational (or a declared
fixed-point value) with an explicit precision/rounding contract. That makes the resulting
bits reproducible across browser, CLI and MCP and keeps the wave a function of state.
Exact rational arithmetic is a property of the *register expression engine*, not a claim
that float workflows are inferior.

If a future feature wants a float-valued expression mode, it gets its own declared
precision and rounding semantics and its own tests — it is not excluded by this design.
Agents may accept JSON numbers and convert with a documented decimal representation;
the recommendation is to pass decimal/hex **strings** when exactness matters, because
JSON numbers are already float64 before the expression engine sees them.

### Errors and limits

Typed `ExpressionError.code` (never a stack): `E_EXPR_SYNTAX`, `E_EXPR_UNKNOWN_NAME`,
`E_EXPR_TYPE`, `E_EXPR_DIV_ZERO`, `E_EXPR_DOMAIN`, `E_EXPR_RANGE`, `E_EXPR_TOO_LARGE`.
Limits: 4096 source chars, depth 64, 128 literal digits, 4096 bits per rational,
shift count ≤ 4096, width ≤ 4096.

### Example expressions

```
D = round(1.2599210498948732 * C)                    // ∛2 · C
F = round(1.4422495703074083 * E)                    // ∛3 · E
D = (C << 1) ^ (C >> 3)                              // bit algebra
D = round((C + log.C) / 2)                           // previous snapshot
D = min(round(1.6180339887498948 * C), 0xFFFFFFFFFFFFFFFF)
```

## 5. Schema 3 (implemented)

Additive over `.bitwave` schema 2; schema 2 still loads with none of these fields.

```jsonc
// lanes."2"
"expressions": { "d": "round(1.2599210498948732 * C)" },   // expression source per operand
"sourceKinds": { "a": "frame", "b": "expr" },               // derived from existing routes + expr
// view
"record": { "enabled": false }                              // armed state is UI preference,
                                                            // not history; log rows are transient
```

Bridge/CLI/MCP additions (same registry pattern as the agent layer):
`setSource`/`setRoute`, `setExpression(frame, text)`, `record({on})`, `getLog()`,
and pure tools `evaluate_expression` / `log_state`. CLI: `node agent/cli.mjs
evaluate_expression --expr "…" --frame C --hex … --json`. None of this ships until the
design is approved.

## 6. UI deltas (implemented)

- Source table: the six operation rows gain an `expr` option and a one-line text field
  (mono, right-padded); the result is still shown as the driven register. No symbol
  palette, no formula parser UI.
- Source group: a `record` toggle and a row count beside the existing observation
  counter; active state uses the accent only.
- Everything else stays as shipped: module order, palette, stage, strip, 3-D split.
- DESIGN §13 applies: new control declares keyboard path/accessible name before coding;
  default pixels unchanged (Record off, no expr sources).

## 7. Prototype verification

`node tools/prototype-external-routing.mjs --width 64 --check` → **27 checks passed**;
the same at 256. `tests/external-routing.test.ts` → **8/8** covering precedence,
rationals, rounding, wrap, bitwise, log delay, typed errors, and the full 8-step demo
pipeline with independently computed BigInt expectations.

Deterministic first/last rows at 64-bit (`xor`, the two ∛ expressions above):

| step | A | B | Z1/C | D | Z2/E | F | Z3 |
|---|---|---|---|---|---|---|---|
| 1 | `000000008ADEFEDA` | `0000000001234567` | `000000008BFDBBBD` | `00000000B060B6F2` | `000000003B9D0D4F` | `0000000055FA3EE4` | `000000006E6733AB` |
| 8 | `00000000A8ADEFED` | `00000000789ABCDE` | `00000000D0375333` | `000000010655FB2F` | `00000001D662A81C` | `00000002A669C17F` | `00000003700B6963` |

## 8. Decisions after implementation

Resolved in the shipped slice:

1. **Record cadence:** settled evaluation updates (CSV step, LFO tick, commit-on-release);
   the pointer-drag stream is skipped and the row lands on release.
2. **Log access:** expressions and the agent only (`log.<frame>` / `getLog()`); the log is
   not a routeable source row in v1.
3. **Schema fields:** expressions are per-lane/per-operand (`lanes.<n>.expressions.a|b`);
   the recording flag and rows stay transient (not in the project or link).
4. **Editor surface:** a one-line mono editor inside the source table's `expr` option;
   Enter/blur commits, Esc reverts, invalid text is rejected and restored.
5. **Evaluator:** the prototype's `src/core/expression.ts` is the shipped evaluator,
   with the same grammar/limits/rounding.
6. **Agent setters:** `setExpression`, `setSource`/`setRoute`, `record`, `getLog` are live,
   so an agent can build and clock the whole pipeline headlessly; routes are no longer a
   manual-only step.

Still open: a future float-valued expression mode (declared precision/rounding contract),
and optional expression-only dependency ordering (v1 documents the route-topo-order
limitation).

**Non-goals:** arbitrary code execution in the page, a full scripting language, automated
background logging/catalogs, changing the visual language, or replacing the source matrix.
