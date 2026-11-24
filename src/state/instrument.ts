/**
 * Instrument state — the single mutable tree every renderer reads.
 *
 * DOM-free by construction: shapes, factories and selection helpers only.
 * The app module (`src/main.js`) imports this tree; the later F2 slices move
 * rendering and input out of that module and put every write behind the store
 * transaction in `store.ts`.
 *
 * D43: lane identity is the stable lane key from `src/core/lanedefs.ts`
 * ("1".."13"), never an A/B/C slot letter or an array position. A lane key is
 * also the displayed lane number, so `S.laneKey` is "1" and frame names derive
 * from it (lane "1" is A/B/Z1). The defaults are the first
 * `DEFAULT_LANE_COUNT` (three) lane definitions, generated rather than written
 * out, so the dynamic-lanes pass can widen the tree without touching consumers.
 *
 * Registers hold `bits` (truth), `target` (settled nibbles) and `anim` (eased
 * nibbles) — the last two are presentation, the first is data. `N` is stored
 * once on the tree (DESIGN §10.10) and every helper here reads it.
 */

import { OPSYM, computeZInto, isArith as isArithOp } from "../core/derive.ts";
import {
  SIZES as CORE_SIZES,
  type RegisterSize,
  bigToReg as coreBigToReg,
  nibAt as coreNibAt,
  nibWeightPow as coreNibWeightPow,
  regToBig as coreRegToBig,
  setNibAt as coreSetNibAt,
  syncTarget as coreSyncTarget,
} from "../core/registers.ts";
import type { BinOp, FreeFrameKey, LaneKey } from "../core/types.ts";
import { LANE_KEYS } from "../core/types.ts";
import {
  APP_FREE_FRAME_CAP,
  APP_LANE_CAP,
  DEFAULT_LANE_COUNT,
  FREE_FRAME_LABEL_MAX,
  FREE_FRAME_NOTE_MAX,
  NAME_CEILING,
  compareFreeFrameKeys,
  compareLaneKeys,
  frameNamesFor,
  freeFrameKey,
  freeFrameKeyFromName,
  freeFrameName,
  laneDef,
  laneIndex,
  sanitizeFreeFrameText,
} from "../core/lanedefs.ts";

export type FrameKey = "a" | "b" | "z";
export type EditKey = "a" | "b";
/** 3-D presentation only: which operand plate is far (frame 1) vs near (frame 256). */
export type Fold = "a-far" | "b-far";

/** The shipped lane keys in display order ("1", "2", "3"), from `lanedefs.ts`. */
export { LANE_KEYS };

/** The shipped app cap: at most eight live lanes (D43/D46). */
export { APP_LANE_CAP, APP_FREE_FRAME_CAP, freeFrameName, freeFrameKeyFromName };

/** One register size domain for the whole instrument (DESIGN §10.10). */
export const SIZES: readonly RegisterSize[] = CORE_SIZES;

/* Global frame names (author, 2026-11-06): operands A/B, C/D, E/F and derived
   Z1/Z2/Z3, keyed by stable lane key. D46 generates the table for the whole
   app cap (eight lanes: operands A–P, derived Z1–Z8) while the boot instrument
   still ships the default three; a live lane beyond the cap falls back to the
   derived name (`frameName`). */
export const FRAME_NAMES: Record<LaneKey, Record<FrameKey, string>> = frameNamesFor(
  APP_LANE_CAP,
) as Record<LaneKey, Record<FrameKey, string>>;

/**
 * The global display name of a lane/frame pair. Names derive from the lane key,
 * so lane "4" names its frames G/H/Z4; unknown keys fall back to the bare frame
 * letter.
 */
export const frameName = (laneKey: LaneKey, frame: FrameKey): string => {
  const names = FRAME_NAMES[laneKey];
  if (names) return names[frame];
  const index = laneIndex(laneKey);
  if (index >= 0) return laneDef(index)[frame];
  return frame.toUpperCase();
};

/** The live lane keys in canonical ascending numeric order (never array position). */
export const liveLaneKeys = (): LaneKey[] => Object.keys(S.lanes).sort(compareLaneKeys);

/**
 * The lowest free stable lane key ("1".."13") not currently live. `null` only
 * when all thirteen name indices are taken (unreachable under the eight-lane
 * app cap, but the grammar ceiling is the real allocator bound).
 */
export const nextFreeLaneKey = (): LaneKey | null => {
  for (let index = 0; index < NAME_CEILING; index += 1) {
    const key = laneDef(index).key;
    if (!S.lanes[key]) return key;
  }
  return null;
};

/** Live free-frame keys in canonical ascending numeric order ("1".."16"). */
export const liveFreeFrameKeys = (): FreeFrameKey[] =>
  Object.keys(S.freeFrames).sort(compareFreeFrameKeys);

/** Lowest unused free-frame key ("1".."16"), or null at the cap. */
export const nextFreeFrameKey = (): FreeFrameKey | null => {
  for (let index = 0; index < APP_FREE_FRAME_CAP; index += 1) {
    const key = freeFrameKey(index, APP_FREE_FRAME_CAP);
    if (!S.freeFrames[key]) return key;
  }
  return null;
};

export interface Reg {
  /** bits[0] is the LSB (hardware convention); length === N. */
  bits: Uint8Array;
  /** Rendered nibble values (eased floats, MSB-first). Presentation only. */
  anim: number[];
  /** Settled nibble values (integers, MSB-first). Lead truth for the strip. */
  target: number[];
}

/** One lane's mutable state, keyed in `S.lanes` by its stable lane key. */
export interface LaneState {
  key: LaneKey;
  A: Reg;
  B: Reg;
  Z: Reg;
  showB: boolean;
  binop: BinOp;
  /** Which operand drags/presets/unary ops act on. */
  edit: EditKey;
  /** Which frame the strip/readouts show; Z is read-only. */
  focus: FrameKey;
  /** Per-lane 2-D frame visibility (eye toggles). */
  frameVis: Record<FrameKey, boolean>;
  seededB: boolean;
  lfoB: string;
  /** 3-D hinge orientation; presentation only, not stored in the project yet. */
  fold: Fold;
  /** Expression sources per operand ("" = not an expression source). */
  expressions: { a: string; b: string };
  colA: number;
  colB: number;
}

export interface FreeFrameState {
  key: FreeFrameKey;
  reg: Reg;
  /** Dataset column index (-1 = local). */
  col: number;
  /** 2-D overlay visibility (eye toggle). */
  visible: boolean;
  /** Expression source ("" = none). */
  expression: string;
  /** Optional short display label, e.g. "hanning". */
  label: string;
  /** Optional external library/function provenance note, e.g. "numpy.hanning(16)". */
  sourceNote: string;
}

/** One recorded update: every global frame name -> N-bit word as uppercase hex. */
export interface RecordRow {
  /** 1-based update number. */
  step: number;
  frames: Record<string, string>;
}

export interface RecordState {
  on: boolean;
  rows: RecordRow[];
  /** Next step number; monotonic across a session and cap eviction. */
  nextStep: number;
}

export interface LfoState {
  on: boolean;
  mode: string;
  rate: number;
  t: number;
  base: (Record<string, { a: number[]; b: number[] }> & { free?: Record<string, number[]> }) | null;
}

export interface Instrument {
  N: number;
  /** Lane map keyed by the stable lane key ("1".."13"), never by position. */
  lanes: Record<LaneKey, LaneState>;
  /** The ordered live lane keys (ascending numeric), derived from `lanes`. */
  readonly laneKeys: LaneKey[];
  /** Standalone free frames keyed by stable numeric key ("1".."16", D52). */
  freeFrames: Record<FreeFrameKey, FreeFrameState>;
  /** The ordered live free-frame keys (ascending numeric). */
  readonly freeFrameKeys: FreeFrameKey[];
  /** Focused free-frame key when focus is on a free frame; null when on a lane. */
  activeFree: FreeFrameKey | null;
  /** The focused lane key; also its displayed lane number. */
  laneKey: LaneKey;
  split3d: boolean;
  splitPair: [LaneKey, LaneKey];
  activePane: number;
  copyArmed: boolean;
  compact: boolean;
  view3d: boolean;
  /** Frames view: the stage is showing the lane/frame card browser (D42). */
  framesView: boolean;
  /**
   * D47: the truth disclosure's expanded state. Transient session preference
   * only — never persisted in `.bitwave`, the share link or the agent state.
   */
  truthOpen: boolean;
  lfo: LfoState;
  lfoAcc: number;
  record: RecordState;
  /**
   * D53: evaluation errors per global frame name (`"F3"`, `"A"`, …), rebuilt by
   * every clocked pass. A frame with an entry keeps its last settled bits, so
   * this map is the only way to tell a live register from a frozen one. It is
   * transient session state: never persisted in `.bitwave`, the share link or
   * the Record log, but reported through `getState()`.
   */
  expressionErrors: Record<string, string>;
  drag: number;
  hoverReg: EditKey | null;
  hoverJ: number;
  readonly A: Reg;
  readonly B: Reg;
  readonly Z: Reg;
  showB: boolean;
  binop: BinOp;
  edit: EditKey;
  seededB: boolean;
}

export const makeReg = (N: number): Reg => ({
  bits: new Uint8Array(N),
  anim: new Array<number>(N >> 2).fill(0),
  target: new Array<number>(N >> 2).fill(0),
});

export const makeLaneState = (key: LaneKey, N: number, binop: BinOp = "xor"): LaneState => ({
  key,
  A: makeReg(N),
  B: makeReg(N),
  Z: makeReg(N),
  showB: false,
  binop,
  edit: "a",
  focus: "a",
  frameVis: { a: true, b: true, z: true },
  seededB: false,
  lfoB: "0",
  fold: "a-far",
  expressions: { a: "", b: "" },
  colA: -1,
  colB: -1,
});

export const makeFreeFrameState = (
  key: FreeFrameKey,
  N: number,
  opts: { label?: string; sourceNote?: string } = {},
): FreeFrameState => ({
  key,
  reg: makeReg(N),
  col: -1,
  visible: true,
  expression: "",
  label: sanitizeFreeFrameText(opts.label, FREE_FRAME_LABEL_MAX),
  sourceNote: sanitizeFreeFrameText(opts.sourceNote, FREE_FRAME_NOTE_MAX),
});

/* Boot defaults per shipped lane, in lane-key order (lane 3 starts on AND). */
const BOOT_BINOPS: readonly BinOp[] = ["xor", "xor", "and"];
const initialLanes = {} as Record<LaneKey, LaneState>;
LANE_KEYS.forEach((key, index) => {
  initialLanes[key] = makeLaneState(key, 64, BOOT_BINOPS[index] ?? "xor");
});

export const S: Instrument = {
  N: 64,
  lanes: initialLanes,
  get laneKeys(): LaneKey[] { return Object.keys(this.lanes).sort(compareLaneKeys); },
  freeFrames: {},
  get freeFrameKeys(): FreeFrameKey[] { return Object.keys(this.freeFrames).sort(compareFreeFrameKeys); },
  activeFree: null,
  laneKey: LANE_KEYS[0],
  split3d: false,
  splitPair: [LANE_KEYS[0], LANE_KEYS[1]],
  activePane: 0,
  copyArmed: false,
  compact: false,
  view3d: false,
  framesView: false,
  truthOpen: true,
  lfo: { on: false, mode: "rotcw", rate: 4, t: 0, base: null },
  lfoAcc: 0,
  record: { on: false, rows: [], nextStep: 1 },
  expressionErrors: {},
  drag: -1,
  hoverReg: null,
  hoverJ: -1,
  get A(): Reg { return this.lanes[this.laneKey].A; },
  get B(): Reg { return this.lanes[this.laneKey].B; },
  get Z(): Reg { return this.lanes[this.laneKey].Z; },
  get showB(): boolean { return this.lanes[this.laneKey].showB; },
  set showB(value: boolean) { this.lanes[this.laneKey].showB = value; },
  get binop(): BinOp { return this.lanes[this.laneKey].binop; },
  set binop(value: BinOp) { this.lanes[this.laneKey].binop = value; },
  get edit(): EditKey { return this.lanes[this.laneKey].edit; },
  set edit(value: EditKey) { this.lanes[this.laneKey].edit = value; },
  get seededB(): boolean { return this.lanes[this.laneKey].seededB; },
  set seededB(value: boolean) { this.lanes[this.laneKey].seededB = value; },
};

/** The focused lane's state, keyed by `S.laneKey`. */
export const curLane = (): LaneState => S.lanes[S.laneKey];

/** The focused free frame, or null when focus is on a lane. */
export const curFreeFrame = (): FreeFrameState | null =>
  S.activeFree ? (S.freeFrames[S.activeFree] ?? null) : null;

/** True when the active focus target is a standalone free frame. */
export const isFreeFocused = (): boolean => curFreeFrame() !== null;

/** The register currently shown/edited by the strip, readouts and dock. */
export const activeReg = (): Reg => {
  const ff = curFreeFrame();
  return ff ? ff.reg : focusReg();
};

/** Whether the active focus target accepts local edits (true for free frames and lane operands). */
export const activeEditable = (): boolean => (isFreeFocused() ? true : focusEditable());

/** Global frame name of the active focus target ("F1", "A", "Z1", etc.). */
export const activeFrameLabel = (): string => {
  const ff = curFreeFrame();
  return ff ? freeFrameName(ff.key) : frameLabel();
};

export const nibCount = (): number => S.N >> 2;

/** Place value of nibble j (0 = MSB): exponent of two its LSB is worth. */
export const nibWeightPow = (j: number): number => coreNibWeightPow(S.N, j);

export const regOf = (k: FrameKey, sl: LaneState = curLane()): Reg =>
  k === "b" ? sl.B : k === "z" ? sl.Z : sl.A;

export const editKey = (sl: LaneState = curLane()): EditKey =>
  sl.showB && sl.edit === "b" ? "b" : "a";

export const editReg = (sl: LaneState = curLane()): Reg => regOf(editKey(sl), sl);

/** Focus is what the strip and readouts show; edit is what a write targets.
 *  Z can be focused but never edited (DESIGN §10.8), so its strip is read-only. */
export const focusKey = (sl: LaneState = curLane()): FrameKey => {
  if (sl.focus === "z") return "z";
  return sl.showB && sl.focus === "b" ? "b" : "a";
};

export const focusReg = (sl: LaneState = curLane()): Reg => regOf(focusKey(sl), sl);
export const focusEditable = (sl: LaneState = curLane()): boolean => focusKey(sl) !== "z";
export const frameLabel = (sl: LaneState = curLane(), frame: FrameKey = focusKey(sl)): string =>
  frameName(sl.key, frame);

export const nibAt = (bits: Uint8Array, j: number): number => coreNibAt(bits, S.N, j);
export const setNibAt = (bits: Uint8Array, j: number, v: number): void =>
  coreSetNibAt(bits, S.N, j, v);

export const nibValue = (r: Reg, j: number): number => nibAt(r.bits, j);
export const setNibValue = (r: Reg, j: number, v: number): void => setNibAt(r.bits, j, v);

/** Copies truth into `target`, and (on an instantaneous commit) into `anim`. */
export function syncTarget(r: Reg, instant = false): void {
  coreSyncTarget(r, S.N);
  if (instant) r.anim = r.target.slice();
}

export const isArith = (sl: LaneState = curLane()): boolean => isArithOp(sl.binop);

export const regToBig = (r: Reg): bigint => coreRegToBig(r.bits, S.N);
export const bigToReg = (v: bigint, r: Reg): void => coreBigToReg(v, r.bits, S.N);

/** Z is always A <op> B; delegates to the core derivation (mod 2^N wrap). */
export function recomputeZ(instant = false, sl: LaneState = curLane()): void {
  computeZInto(sl.Z, sl.A.bits, sl.B.bits, S.N, sl.binop);
  syncTarget(sl.Z, instant);
}

export { OPSYM };
