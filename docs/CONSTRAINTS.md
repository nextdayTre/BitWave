# Constraints — what is law, what is product, what is provisional

**Status: discipline note, 2026-11-19 (author request; D50). No code, schema or contract
change.** Companion to `DESIGN.md` §13 (change protocol). This note does not weaken any
constraint; it classifies them, because the repo has been writing three different kinds of
statement in one absolute voice.

## Why this exists

A measurement of the current build — "the link budget is 2000 characters", "handles are
~21px apart at 256 bits", "operations are `and or xor add sub`" — reads like a law of the
instrument. It is not. It is true *of this build*, and it stops being true the moment the
encoding, the viewport or the lane model changes.

The cost of the confusion is concrete: an idea gets rejected for failing a number, when the
number was a consequence of an earlier choice. The share budget is the clearest case — it is
a property of one codec, not of BitWave, and it can be changed by changing the codec.

The absolute tone is not the problem. **The missing classification is.**

## The three tiers

| tier | test | to change it | examples |
|---|---|---|---|
| **Invariants** | would be true of any BitWave built this way | it is a different instrument; stop | one implementation (transport and panel never re-implement the core); deterministic output; state is the source of truth, never inferred from pixels; DOM-free core; fixed envelope and closed error set; older schemas keep loading |
| **Product commitments** | what BitWave *is*; changes the human experience | a reviewed decision (D-number) that names the cost | a nibble is a sample; `Z = A <op> B`, derived and never stored; one shared width `N`; a lane is an `A/B/Z` housing with global frame names; one focused lane/frame; the human instrument stays primary and the agent layer stays additive |
| **Provisional** | true of the current build only | re-derive the number, record it where it lives | the numbers and enums and views in the table below |

## Provisional facts, and what invalidates them

| fact | lives in | true while | re-derive when |
|---|---|---|---|
| link budget 2000 chars | `SHARE_MAX_CHARS` (`share.ts`) | the compact payload base64urls a JSON body whose words are already base64url — a 16/9 tax on the word payload | payload size is the question → change the codec (single encoding, varint/delta words), not the idea |
| widths `8…256` | `SIZES` (`registers.ts`) + four validators | every word is hand-draggable at 256 and the enum is closed | 512 or wide frames are on the table |
| binops `and or xor add sub` | op tables, tool enums | `Z` is one register of width `N` | a result wider than its operands, or carry as data |
| ~21px handles at 256 | `DESIGN.md` §6 | canvas width, one strip per pane | density or view changes |
| lanes 1–8 | `APP_LANE_CAP` (`lanedefs.ts`); `NAME_CEILING` 13 is grammar, not a cap | the live tree *is* the lane map | lane housing changes (`docs/ROUTING-IO-MODEL.md`) |
| `.bitwave` schema 4 | `project.ts`, `share.ts` | no document field is needed | any new field (bump to 5) |
| toolset 1.5.0, closed error set | `agent-defaults.ts` | no tool, op or width is added | any new tool surface |
| the 3-D lanes presentation | `src/render/*` | it is the chosen projection | a value has no seat in it — see rule 1 |

## Rule 1 — model before view

A proposal is evaluated in this order, and only in this order:

1. **What does the frame graph need?** A new frame *kind*? A frame *wider* than `N`? A port
   that is not a frame at all?
2. **What does the document carry, and which way does compatibility run?** New fields mean a
   schema bump. A document that older builds *refuse* is a different promise from one they
   can ignore — say which one you are making.
3. **Which view presents it?** Last, and plural. A value with no seat in the current
   projection is evidence *about the projection*.

**The lanes / 3-D presentation is a renderer.** It is not the structure, not the ontology,
and not the acceptance test. "It doesn't fit the lanes view" is a rendering backlog line,
not a rejection. Keeping the view is not in question; ranking it as the premise for every
idea is. `docs/ROUTING-IO-MODEL.md` §0 already separates *lanes as computation* from *lanes
as housing* — this rule generalises that separation to every proposal.

## Rule 2 — provisional constraints are owned, not absolute

A proposal may invalidate a provisional fact. It must then say **which** one and how it is
re-derived. It may not be rejected merely for exceeding the current number, and it may not
silently ignore it either.

- Write: "this exceeds `SHARE_MAX_CHARS`; fitting it needs codec change X."
- Not: "the budget forbids 512-bit documents."

## Rule 3 — only a tier-2 change costs a version

- Touching **tier 1**: stop, that is a different instrument.
- Touching **tier 2**: a decision entry, with its migration and its cost.
- Touching **tier 3**: an edit to a number, an enum or a view — record it where it lives, no
  version ceremony.

## Applying it to the two live questions

**512-bit display** is a tier-2 question (it relaxes *one shared width*) plus tier-3 facts
(the enum, the budget). The honest framing is "widen the model, then re-derive the link
budget" — not "the budget says no".

**Routable carry** is tier-2 in a sharper way: a carry is the value at position `N`, one bit
outside the word, and a frame is exactly `N` bits. Whether carry becomes a 1-bit frame, an
`N+1`-bit wide frame, or a *port* on the operator graph is the decision. None of those
questions involves the lanes view; whichever is chosen, the presentation question is
separate and may be answered by something that is not the lanes view at all.

## How to use this note

- **Writing** a design note: tag each constraint you lean on with its tier.
- **Reviewing** one: when a doc says "must", check whether it quotes tier 1 or restates tier 3.
- **Deciding**: if a proposal needs a tier-2 change, write the decision; if it needs tier-3
  numbers re-derived, write the new numbers.

## Deferred (not done here)

Tier-3 statements in `DESIGN.md` that still read as law, for a later tone pass: §6 register
sizes (px density as a ceiling), §10 "do not 'fix' the dim zeros" (taste, not invariant),
§10.19 link budget (a codec consequence). Left untouched deliberately, so this note can land
without editing the design language in the same change.
