/**
 * Instrument state — the single mutable tree every renderer reads.
 *
 * DOM-free by construction: shapes, factories and selection helpers only.
 * The app module (`src/main.js`) imports this tree; the later F2 slices move
 * rendering and input out of that module and put every write behind the store
 * transaction in `store.ts`.
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
import type { BinOp } from "../core/types.ts";

export type FrameKey = "a" | "b" | "z";
export type EditKey = "a" | "b";

export const SLOT_KEYS = ["A", "B", "C"] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

/** One register size domain for the whole instrument (DESIGN §10.10). */
export const SIZES: readonly RegisterSize[] = CORE_SIZES;

/* Internal slot keys stay A/B/C for the existing settings and shortcuts;
   on screen lanes are numbered. Letters therefore mean frames/operands only. */
export const LANE_LABEL: Record<SlotKey, string> = { A: "1", B: "2", C: "3" };
export const laneLabel = (key: string): string => LANE_LABEL[key as SlotKey] ?? key;

/* Global frame names (author, 2026-11-06): operands A/B, C/D, E/F and derived
   Z1/Z2/Z3. Frames are unique across lanes, so the source matrix can list six
   operand rows (A–F) and nine frame outputs. */
export const FRAME_NAMES: Record<SlotKey, Record<FrameKey, string>> = {
  A: { a: "A", b: "B", z: "Z1" },
  B: { a: "C", b: "D", z: "Z2" },
  C: { a: "E", b: "F", z: "Z3" },
};

export const frameName = (laneKey: string, frame: FrameKey): string =>
  (FRAME_NAMES[laneKey as SlotKey] ?? FRAME_NAMES.A)[frame] ?? frame.toUpperCase();

export interface Reg {
  /** bits[0] is the LSB (hardware convention); length === N. */
  bits: Uint8Array;
  /** Rendered nibble values (eased floats, MSB-first). Presentation only. */
  anim: number[];
  /** Settled nibble values (integers, MSB-first). Lead truth for the strip. */
  target: number[];
}

export interface Slot {
  key: SlotKey;
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
  colA: number;
  colB: number;
}

export interface LfoState {
  on: boolean;
  mode: string;
  rate: number;
  t: number;
  base: Record<string, { a: number[]; b: number[] }> | null;
}

export interface Instrument {
  N: number;
  slots: Record<SlotKey, Slot>;
  slot: SlotKey;
  split3d: boolean;
  splitPair: [SlotKey, SlotKey];
  activePane: number;
  copyArmed: boolean;
  compact: boolean;
  view3d: boolean;
  lfo: LfoState;
  lfoAcc: number;
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

export const makeSlot = (key: SlotKey, N: number, binop: BinOp = "xor"): Slot => ({
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
  colA: -1,
  colB: -1,
});

export const S: Instrument = {
  N: 64,
  slots: {
    A: makeSlot("A", 64, "xor"),
    B: makeSlot("B", 64, "xor"),
    C: makeSlot("C", 64, "and"),
  },
  slot: "A",
  split3d: false,
  splitPair: ["A", "B"],
  activePane: 0,
  copyArmed: false,
  compact: false,
  view3d: false,
  lfo: { on: false, mode: "rotcw", rate: 4, t: 0, base: null },
  lfoAcc: 0,
  drag: -1,
  hoverReg: null,
  hoverJ: -1,
  get A(): Reg { return this.slots[this.slot].A; },
  get B(): Reg { return this.slots[this.slot].B; },
  get Z(): Reg { return this.slots[this.slot].Z; },
  get showB(): boolean { return this.slots[this.slot].showB; },
  set showB(value: boolean) { this.slots[this.slot].showB = value; },
  get binop(): BinOp { return this.slots[this.slot].binop; },
  set binop(value: BinOp) { this.slots[this.slot].binop = value; },
  get edit(): EditKey { return this.slots[this.slot].edit; },
  set edit(value: EditKey) { this.slots[this.slot].edit = value; },
  get seededB(): boolean { return this.slots[this.slot].seededB; },
  set seededB(value: boolean) { this.slots[this.slot].seededB = value; },
};

export const curSlot = (): Slot => S.slots[S.slot];

export const nibCount = (): number => S.N >> 2;

/** Place value of nibble j (0 = MSB): exponent of two its LSB is worth. */
export const nibWeightPow = (j: number): number => coreNibWeightPow(S.N, j);

export const regOf = (k: FrameKey, sl: Slot = curSlot()): Reg =>
  k === "b" ? sl.B : k === "z" ? sl.Z : sl.A;

export const editKey = (sl: Slot = curSlot()): EditKey =>
  sl.showB && sl.edit === "b" ? "b" : "a";

export const editReg = (sl: Slot = curSlot()): Reg => regOf(editKey(sl), sl);

/** Focus is what the strip and readouts show; edit is what a write targets.
 *  Z can be focused but never edited (DESIGN §10.8), so its strip is read-only. */
export const focusKey = (sl: Slot = curSlot()): FrameKey => {
  if (sl.focus === "z") return "z";
  return sl.showB && sl.focus === "b" ? "b" : "a";
};

export const focusReg = (sl: Slot = curSlot()): Reg => regOf(focusKey(sl), sl);
export const focusEditable = (sl: Slot = curSlot()): boolean => focusKey(sl) !== "z";
export const frameLabel = (sl: Slot = curSlot(), frame: FrameKey = focusKey(sl)): string =>
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

export const isArith = (sl: Slot = curSlot()): boolean => isArithOp(sl.binop);

export const regToBig = (r: Reg): bigint => coreRegToBig(r.bits, S.N);
export const bigToReg = (v: bigint, r: Reg): void => coreBigToReg(v, r.bits, S.N);

/** Z is always A <op> B; delegates to the core derivation (mod 2^N wrap). */
export function recomputeZ(instant = false, sl: Slot = curSlot()): void {
  computeZInto(sl.Z, sl.A.bits, sl.B.bits, S.N, sl.binop);
  syncTarget(sl.Z, instant);
}

export { OPSYM };
