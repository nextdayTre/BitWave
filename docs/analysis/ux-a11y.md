> **Updated 2026-11-06 (author decision):** lanes are now **1/2/3** (letters belong only to frames A/Z/B). **Contrast/dimming is hands-off** — keep the §2.5 measurements as reference, but do not action the token changes: colour/intensity is a future mapping axis. Q8 is closed.
# BitWave — UX, accessibility and reach audit

`index.html` (2 832 lines) and `DESIGN.md` (495) read in full; line numbers are read-tool numbers. "Accessible" covers (a) WCAG 2.2 / product accessibility and (b) reach — getting to the tool, keeping work, sharing state, working offline. Contrast is computed with the WCAG 2.x sRGB formula; sizes derive from the CSS (13px mono, `ch` ≈ 0.6em). Browser instrumentation was blocked in this session, so reflow figures are computed estimates. Severity: **Critical** blocks a task for a whole user group; **Serious** for common AT; **Moderate** degrades; **Minor** polish.

## 1. Interaction inventory

| Location | Controls | Effect | Keyboard / mouse |
|---|---|---|---|
| Header (568–578) | `#size` range + `#sizeOut` (575–576) | Resize every slot's A/B/Z around ∞ (`resizeRegister`, 861–911) | Native arrows; output not announced |
| `data` (605–621) | `import csv` (607) + hidden file input (608), `◀ ▶` (610–611), counts, column selects (614–615), `log`/`export` (617–618) | CSV load, stepping, column routing, observation logging; all but `import csv` hidden until loaded | Buttons/selects reachable; no keyboard drop |
| `table` (623–633) | 8 presets incl. `0`, `F` | Overwrite edit target (`applyTable`, 1900–1906) | Yes; names weak |
| `logic` (635–647) | `toggleB` (637), `editSeg` A/B (638–641), `AND OR XOR ADD SUB` (642–646) | Create operand B, choose edit target, choose binop; Z recomputed (841–856) | Yes; controls appear/disappear |
| `view` (649–662) | `viewSeg` 2D/3D (651–653), `slotSeg` A/B/C (655–659), `split` (660), `copy →` (661) | Mode, slot focus, parallel 3-D, clone | Yes; `copy` is an armed mode with no cancel |
| `lfo` (664–685) | `LFO` (666), motion (667), rate (673), B phase (679) | Stepped modulation, snapshot/restore (1767–1804) | Mostly; B phase hidden in 2-D without B |
| `op` (687–702) | `amount` (689), 7 unary ops (695–701) | Unary ops on edit target | Yes |
| Canvas (581) | Drag nibbles, hover readout, split-pane click | Primary editor (2-D only); read-only 3-D | **No keyboard path**; no `tabindex` |
| Strip (586–588) | Click `.bit` to flip (1713–1725), hover `.nib` | Toggle single bits; bits vanish in compact mode (346) | **No keyboard path**; `<i>` not focusable |
| Stage bar (583, built 2070–2129) | Per-pane slot segment, `split`, pane focus | 3-D slot/pane switching; hidden in 2-D | Yes, 3-D only |
| Global keys (2719–2730) | `Alt+1/2/3`, `Alt+S`, `←/→` steps when focus not in `INPUT/SELECT/TEXTAREA` | Slot, split, stepping | Only shortcuts; no Escape, no help |

## 2. Accessibility audit

### 2.1 Semantics, roles, names

**Critical — clickable bits have no semantics.** `renderStrip` emits `<i class="bit" data-b="…">0|1</i>` (1448–1459), styled `cursor:pointer` (307), handled by delegated click (1713). No role, `tabindex`, name or state: a screen reader sees static 0/1 text, and the only interactivity cue is the mouse cursor.

**Serious — `.seg` exposes no state and is not radio semantics.** `viewSeg` (651), `slotSeg` (655), `editSeg` (638) are mutually exclusive, but `syncViewUi` (2293–2299), `syncEditUi` (2008–2010) and the binop loop (2003–2006) only toggle `.on`. The `[aria-pressed="true"]` selectors for `.seg .op` (497, 510) are dead code. `role="group"` appears once (655); `viewSeg`/`editSeg` have no group, name or state. Screen readers get plain buttons with no 2-D vs 3-D, slot, or edit-target indication.

**Serious — the canvas is unlabelled.** `<canvas id="wave">` (581) has no role, label, `tabindex` or fallback. Curve, rulers (1186–1196), legend (1047–1075), ∞ (1396–1414) and hover readout (1381–1394) are pixels only; the `meta` numbers survive, the shape and A/B/Z hierarchy do not.

**Serious — names are glyphs or tooltips.** `◀`/`▶` (610–611), `split` (660), `copy →` (661) and stage-bar buttons (2084–2117) are named by `title` or glyph. `title` is a tooltip — not shown on focus in every UA, absent on touch, fails SC 1.4.13. Presets `0`/`F` (625–626) have no name beyond the character. `editSeg`, `toggleB` and `slotSeg` alone put two `A` and two `B` buttons in one group, and the stage bar repeats the A/B/C set (§4).

**Moderate — no landmarks or group names.** No `<main>`; the six group headers are orphan `<label>`s (606, 624, 636, 650, 665, 688) with no `for`; the four `<section>`s are unnamed. The truth table (`renderTruth`, 1523–1558) is `<span>` soup with no table semantics.

**Minor — `<output>`.** `#sizeOut` (576) has implicit HTML-AAM `status` but no explicit `aria-live`/`aria-atomic` and no `aria-describedby`; the rest of `.meta` is inert `<code>`.

### 2.2 Keyboard

**Critical — no keyboard editing path.** Tab reaches the range, presets, unary ops, `toggleB`/binops, view/slot/split/copy, LFO and selects — never the strip or canvas. No text field exists for a hex value. A keyboard-only user can apply presets and unary ops but **cannot set a specific value, edit a bit, or select a nibble**: the core teaching loop is unavailable.

**Serious — thin, undiscoverable shortcuts.** Only `Alt+1/2/3` and `Alt+S` (2720–2725); they collide with OS menus/some AT, live in `title` tooltips only, lack `aria-keyshortcuts`, and no in-page map exists. `Escape` is unhandled, so armed modes have no keyboard cancel.

**Serious — arrow stepping dies where focus lives.** 2727 returns early for `INPUT|SELECT|TEXTAREA`; the controls hold a range and five selects, so while tabbing through the stepper's group `←/→` do nothing.

**Serious — hidden controls create dead ends.** 3-D hides `toggleB` (2001) and forces B on (§10.22), so B can't be turned off there; binops/`editSeg` hide until B (2002–2006); CSV controls hide until a load (2543); the stage bar hides in 2-D (2142).

### 2.3 Focus

Rings exist for buttons/selects/range (492, 538, 126–127), but the button ring is **2.17:1** against the `--panel` band (needs 3:1) and the range drops its outline for a 25% thumb ring at **1.63:1**. `renderStrip` replaces `nibsEl.innerHTML` (1469) on every commit, up to 8×/s under LFO (1863); no strip descendant is focusable, so focus survives — but a click on a `.bit` or the canvas leaves focus on `<body>` and the next Tab restarts at the header. Real loss: `Alt+S` while `toggleB` is focused enters 3-D and sets `toggleB.hidden = true` (2001). `copySlotBtn` also changes its name (`copy →` → `→ A/B/C`, 2306) and `aria-pressed` (2304) silently.

### 2.4 Live regions

**Serious — every change is silent.** No `aria-live` in the file. `#hex`, `#dec`, `#hexA/B/Z`, `#pop`, `#truth`, `#trend`, `#slotBadge`, `#exCount`, `#obsCount` mutate unannounced, so presets, ops, CSV steps, enabling B and 3-D give no feedback. A naive fix floods: drag calls `updateReadouts(false)` per `pointermove` (1663), LFO ticks 1–8×/s (1864). Use one `role="status"` + `aria-live="polite"` + `aria-atomic="true"` region driven only by committed changes (pointerup, activation, LFO start/stop/mode, CSV load), debounced ≈150ms, announcing register/nibble/value/Z-popcount, quiet during drag and per tick.

### 2.5 Colour and contrast

All text is 9–16px; the 16px/600 `h1` is below the 18.66px bold large-text threshold, so **every text pair needs 4.5:1**; graphics need 3:1 (SC 1.4.11).

| Pair (fg / bg) | Where | Ratio | Req. | Result |
|---|---|---|---|---|
| `--text` / `--panel` | values, truth counts | 16.21 | 4.5 | pass |
| `--dim` / `--panel` | `.hex` 9.9px, `.excount`, `.badge.flat` | 3.95 | 4.5 | **fail** |
| `--dim` / `--bg` | subtitle, `.stage-expr` | 4.12 | 4.5 | **fail** |
| `--dim` / `--panel-hi` | `.truth-h` 9.5px, truth `z` | 3.76 | 4.5 | **fail** |
| `--dimmer` / `--panel` | off bits 11.2px, `.dec` 8.8px, strip label 9px, `.kv` 10px | 2.07 | 4.5 | **fail** |
| `--dimmer` / `--bg` | `.hint` 10.5px, `register` label, canvas ruler 10px | 2.16 | 4.5 | **fail** |
| `--dimmer` / `--panel-hi` | truth heads 9px | 1.97 | 4.5 | **fail** |
| `--accent` / `--panel`, `--bg`, active fill `#152929` | on-bits, badge, `.op.on` label | 9.91 / 10.36 / 7.91 | 4.5 | pass |
| `--inf` / `--panel`; gradient stops on `--bg` | carry "yes"; curve | 10.50; 13.46 / 8.74 | 4.5 / 3.0 | pass |
| focus ring 35% (`#1b5443` over `--panel`) | buttons, selects | 2.17 | 3.0 | **fail** |
| range ring 25% (`#133c2f`) / `--bg` | slider | 1.63 | 3.0 | **fail** |
| B mate stroke @30% (`#154636`) / `--bg` | 1.3px operand | 1.86 | 3.0 | **fail** |
| amber guides @26% (`#46361b`) / `--bg` | zero-crossing | 1.71 | 3.0 | **fail** |
| ∞ ring @45% (`#735625`) / `--bg` | structure marker | 2.93 | 3.0 | **fail** |
| `--line` / `--panel` | boundaries carrying state (`.seg` joins, targets) | 1.18 | 3.0 | **fail** |
| `.wt` dimmer@75% (`#333a48`) / `--panel` | place values | 1.67 | 4.5 | **fail** |
| `--panel-hi` face / `--panel` | button fill identity | 1.05 | 3.0 | **fail** |
| mid-bit amber @55% / `--panel` | MRB underline | 3.88 | 3.0 | pass |

The dim/dimmer hierarchy does what DESIGN §3/§8 assign it, but both tokens fail 4.5:1 everywhere and eight other pairs miss their threshold. Keep the hierarchy, change the vehicle, no third hue: `--dim: #7e879c` (5.29 / 5.04 / 5.53 on panel / panel-hi / bg), `--dimmer: #768096` (4.81 / 4.57 / 5.02). The luminance gap falls 1.9× → 1.1×, so hierarchy moves to size/case/tracking/weight: labels 11px, values 12–13px `--text`, place values 11px `--dim`, off bits `--dim` (DESIGN §8's "do not fix the dim zeros" must be amended; accent chroma plus the compact switch keeps set bits dominant). Non-text: B mate 0.30→0.55 (**3.69:1**), zero-crossing 0.26→0.55 (**3.88:1**), ∞ ring 0.45→0.55, focus ring 0.35→0.55 (**3.66:1**), `--line` → ≈`#5f646b` (**3.20:1**); the 14% glow (1.24:1) is decorative. Offer `prefers-contrast: more` on top, but the default must pass.

### 2.6 Colour-only encoding and target size

Bits and truth states are not literally colour-only — glyphs are `0`/`1` (1456, 1553) — but the change is carried by colour, and at 2.07:1 the off state is effectively invisible. The genuinely colour-only state is the **selected `.seg` button** (accent text + border + 10% fill, 496–501) with no programmatic state: SC 1.4.1 failure for every slot/view/edit/binop selection; `.pane-head.focused` (217–220, 245) likewise.

| Target | Computed size | Verdict |
|---|---|---|
| `.bit` — `.bits` is `min(100%, 5.2ch)` = 40.56px, /4 | **10.1 × 17.3px**, neighbours 10.1px apart | **fail** — 24px circles intersect |
| `.nib` 73.8 × 63.4px, but only `.bit` is clickable (1714) | size passes, handler doesn't | fail by absence |
| `.op` standard | ≈28.9 × 25.8px | pass |
| `.op.mini` stage bar (10.5px, 2px/7px, 222–226) | ≈22.3 × 20.2px | **fail** both axes |
| `#size` thumb 12×12 in a 22px input | borderline spacing exception | weak |
| any bit at 128/256 bits | `.bits` is `display:none` once `pw/n < 46` (346, 1244) | **fail by absence** |

A 24px bit target would need 96px per nibble, impossible at 16 columns. Fix semantically: one focusable `role="spinbutton"` per **nibble** (0–15 is exactly a spinbutton) with `aria-valuenow`/`aria-valuetext` ("nibble 5, hex D, bits 20–23, weight 2^20"), arrows/Home/End/0–F, and the whole nibble as pointer target; the four glyphs stay its visual. Raise `.op.mini` to 24px min-height and the thumb to ≥24px.

### 2.7 Zoom and reflow

**Critical.** `body` is `height:100dvh; overflow:hidden` with five fixed grid rows (`auto minmax(0,1fr) auto auto auto`, 35–46) and the canvas absolutely positioned inside the only flexible row (139–153). At 200% zoom on 1280×720 the CSS viewport is 640×360: the 720px breakpoint engages, groups wrap to ~3 rows, auto rows total ≈365px against 360px — the `minmax(0,1fr)` stage resolves to **0px**, the instrument disappears, and `overflow:hidden` leaves no scrollbar; the controls' bottom clips. At 400% (320×180) auto rows total ≈500px, so roughly two-thirds of the UI is clipped and unreachable. Fails SC 1.4.4 and 1.4.10; height-dependent (on 1080p at 200% the stage survives at ≈236px), but 720p laptops are common, and fixed px ignores text-size preferences. Fix: `body { min-height:100dvh; height:auto; overflow:visible }`, stage floor `min-height: clamp(220px, 44dvh, 620px)`, page scroll when chrome + controls exceed the viewport, optional `@media (max-height:600px)` dock. Verify at 1280×720 @200% and 320×180 @400% (DESIGN §11).

### 2.8 Motion

No `prefers-reduced-motion` rule. Sources: nibble easing 0.24/frame (2747–2756), LFO 1–8 ticks/s mutating real registers (1822–1865), hint fade 220ms (170), button colour transitions (487). LFO is user-initiated so 2.2.2 does not strictly apply, but at 8/s a 256-bit strip can flicker over most of the strip with no opt-out. Under `reduce`: LFO defaults off; if started, no easing (instant commits) and rate capped at 4/s; drop the hint transition; keep 1:1 drag (DESIGN §7 "drag must feel direct" is unaffected). Amend §7 first.

### 2.9 CSV import robustness

**Serious.** `loadCSV` (2611–2685) has two silent returns (`rows.length < 1`, `!body.length`) and no error surface: a malformed file leaves the old state silently. Worse, an all-non-token file "loads": `columnWidth` returns 0, `applyExample` leaves the boot sine untouched (2520–2521) while the UI shows `1 / 1` — stale data indistinguishable from success. `exportObservationsCSV` returns silently with none (2595). Drop-anywhere (2733–2741) has no zone, focus, announcement or keyboard equivalent (only a `title`). The hidden input (608) *is* keyboard-operable through the button's programmatic `click()` (2687). Add a persistent `role="status"` line ("loaded 120 rows, 4 columns from foo.csv" / "could not read: no data rows"), column validation, and a file name.

## 3. Reach and distribution

- **No persistence.** No `localStorage`/`sessionStorage`/IndexedDB, `location` or `history` usage (grep-verified). Reload loses every register, slot, binop, dataset and observation; the LFO snapshot (1775) and `observations` (2380) are memory-only.
- **No shareable state.** DESIGN §12 lists it as next; unimplemented — a teacher hands over a screenshot or verbal instructions, not a state.
- **No project file.** Only `bitwave_observations_*.csv` (2594–2606) out, only a local CSV in; registers cannot be saved or loaded.
- **Offline works; distribution is manual.** No external `src`/`href`, no fetch, no modules, no fonts: it runs from `file://` with no network or CORS exposure. But reaching it means receiving a 93 KB HTML file; no manifest/service worker (adding them would break the single-file contract, so don't). A download/verify note belongs outside the file.
- **Packaging hazard.** `index.html.bak` (71 KB, older) sits beside `index.html`; a teacher can open the stale build. Remove it.
- **No demo dataset.** `DEMO` starts empty (724); `step ⏭` silently no-ops without data (1769) and CSV controls are invisible until a load, so a first-time user with no CSV cannot discover the stepper at all.

Recommendations, weighed against DESIGN §1: (1) URL-fragment state — `N`, focused slot, A/B hex, binop, view via `history.replaceState`, parsed on boot; ≈150 chars, no server, works from `file://`, already roadmapped. (2) Debounced `localStorage` autosave/restore + explicit reset (no modal, no tour). (3) Export/import `.bitwave.json` (Blob + FileReader; stays single-file). (4) An embedded 8-row demo CSV behind a `demo` button — data, not onboarding, and the cheapest way to make the stepper and 3-D split discoverable without a tour, confetti or trophy.

## 4. GUI cohesion and information architecture

1. **Naming collapse.** Slots `A/B/C` (722, 655–659), registers `A/B/Z` (DESIGN §6), edit target `a|b` (742), strip label `A`/`B` (258–268). In A·B mode one group holds `toggleB` "B", `editSeg` "A|B" and slot "A/B/C"; routing will worsen it. Rename slots **1/2/3 (lanes)**, leaving A/B/Z to registers.
2. **Hidden controls = moving targets.** `toggleB` (2001), `editSeg`+binops (2002–2006), `lfoB` (2013), CSV group (2543), stage bar (2142), hint (2311), slot badge (1566): each reflows the row and changes tab order, and several hide the only route to a state.
3. **Duplicates, one state.** `split` is in the controls row (660) *and* the stage bar (2105–2117); `slotSeg` in the controls row (655–659) *and* the stage bar (2081–2099); both mutate `S.slot`/`S.split3d` at different sizes (10.5px vs 11.5px) with different state exposure.
4. **Armed mode, no exit.** `copy →` (661) sets `S.copyArmed` (2333–2336); exits are clicking a slot (2251/2238), `copy` again, changing view (2317) or entering split (2270). No `Escape`, no status, no focus move; the label silently becomes `→ A/B/C` (2306).
5. **Group order mismatches the mental model.** `data | table | logic | view | lfo | op` (605–702) against the flow data → edit register → apply op → derive Z → view. The `op` group's `amount` also drives the LFO (1833). `.seg` serves three semantics — exclusive set (655), momentary `◀ ▶` (609), `log`/`export` (616) — and `aria-pressed` is used for true toggles but never for the radio-like sets. `register` (574) means width.
6. **View chrome is the smallest type.** `.op.mini`/`.seg.mini` at 10.5px/20px tall (222–232): the hardest controls to read and hit sit where the most state is on screen.

Proposal, keeping every feature and the stance (one accent, one signal, no new hue, no onboarding): **stable order** `source | width · edit | operate | derive | motion | view`; **reserve space** — render binops/CSV/slots as disabled (`aria-disabled`) rather than absent, fixed min-widths, dock scrolls at narrow widths and the page scrolls at zoom; **one canonical home** — slot select and `split` only in an always-visible stage bar (2-D shows `VIEW 1 · A ⊕ B → Z`), controls keep 2D/3D + `copy`; **explicit modes** — `copy to…` opens a 1/2/3 menu, focus moves in, `Escape` cancels, live status, `aria-expanded`/`aria-haspopup`; **names** — slots 1/2/3, `width`, `operand B`, strip `EDIT A`; **semantics** — slot/view/edit as `role="radiogroup"`/`role="radio"` with `aria-checked` and roving `tabindex`, true toggles keep `aria-pressed`, nibbles become spinbuttons; **one keyboard map** declared with `aria-keyshortcuts` and an optional `?` help panel (utility, not onboarding).

| Module | Before | After |
|---|---|---|
| Source | 6 of 9 controls appear only after import; no demo, no errors | fixed: import / demo / ◀ n/N ▶ / columns / log / export; disabled placeholders; status line |
| Register | header slider labelled "register" | header `width`; A\|B edit target as radio |
| Operate | `op` last; `amount` also drives LFO | `operate`: amount + 7 unary ops |
| Derive | `logic` third; binops hidden; truth table in meta | `derive`: operand B, binop radios, truth/carry attached |
| Motion | `lfo` | `motion`: LFO, mode, rate, B phase |
| View | duplicated slot/split; stage bar hidden in 2-D | `view`: 2D/3D + copy; slot/split only in always-visible stage bar |
| Strip | 4 click-only glyphs; vanishes in compact | one focusable nibble spinbutton; bits as value text |
| Modes | armed invisibly | explicit `copy to…`, Escape, live status |

## 5. Prioritised recommendations

| Pri | Change | Effort | Amend DESIGN first |
|---|---|---|---|
| P0 | Keyboard editing: nibble spinbuttons, hex entry, arrows/Home/End/0–F, focus model | L | §6 + §8 |
| P0 | Roles/names/state: bit cells, `.seg` radiogroups, canvas role+label, fieldset/legend, symbol-button names | M | §8 |
| P0 | Contrast: token bumps, off bits, canvas stroke alphas, focus rings, borders | M | §3 (then §8) |
| P0 | `prefers-reduced-motion`: LFO off, no easing, rate cap | S | §7 |
| P0 | Zoom/reflow: `min-height` + scroll, stage floor, dock at 200%/400% | M | §5 + §9 |
| P0 | Live status for committed changes; quiet during drag/LFO | S | §8 |
| P0 | Target sizes: `.op.mini` ≥24, whole-nibble target, 24px thumb | S | §5 + §8 |
| P0 | `Escape` cancel, scoped shortcuts, `aria-keyshortcuts`, in-page map | S | §8 |
| P1 | `localStorage` autosave/restore + reset | M | §12 |
| P1 | URL-fragment shareable state | M | §12 |
| P1 | Project export/import `.bitwave.json` | M | §12 |
| P1 | Embedded demo dataset + empty-state messaging | S/M | §8 + §12 |
| P1 | IA: module order, reserve space, de-duplicate, one stage bar, slots→1/2/3, `width` | L | §8 + §9 |
| P1 | CSV error/status UI, file name, keyboard drop path | S/M | §8 |
| P1 | 256-bit strip: hex cells 5.15px wide vs 11.2px glyphs at 420px overlap | S | §9 |
| P1 | Canvas text alternative: `role="img"` + edit-target/curve/Z description on commit | M | §8 |
| P2 | `forced-colors`/`prefers-contrast`, `color-scheme: dark` | S | §3 |
| P2 | LFO announcements, pause semantics, undo for 3-D's silent B seed | S | §8 |
| P2 | Packaging: remove stale `index.html.bak`, short README | S | — |
| P2 | Focus-visible polish (`.pane-head`, stage bar), `aria-current` on active slot | S | §8 |

**What must not change:** the 0px strip↔curve alignment contract and `--pad` authority (§5, §10.4) — keyboard work must re-render through the existing `x(j)` geometry; the two-hue rule (§3) — no new colour for focus, selection, errors or high contrast; the no-onboarding/no-trophy stance (§1) — a keyboard map, demo dataset and reset are utilities, not a tour; `Z` never editable and 3-D read-only (§10.8, §10.12); hardware bit order and MSB-left display (§10.6); single-file, zero-dependency delivery, which the whole reach story depends on.
