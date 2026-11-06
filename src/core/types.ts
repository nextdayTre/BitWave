/**
 * BitWave core types.
 *
 * This directory is intentionally DOM-free: nothing under src/core may import
 * `document`, `window`, `localStorage`, `requestAnimationFrame` or any browser
 * type. The engine must run in the browser, in a desktop shell and in plain
 * Node tests. Enforced by tsconfig.core.json (`lib: ["ES2022"]`, `types: []`)
 * and by the review rule in PLAN.md §6.2.
 */

export type SlotKey = "A" | "B" | "C";

/** Display order of the views. Internal/persisted keys stay A/B/C. */
export const SLOT_KEYS: readonly SlotKey[] = ["A", "B", "C"];

export type OperandKey = "a" | "b";
export type FrameKey = OperandKey | "z";
export type BinOp = "and" | "or" | "xor" | "add" | "sub";

/** How several cables into one input combine (v1.1; v1 enforces one cable). */
export type MixOp = "set" | "add" | "xor";

export interface Register {
  /** bits[0] is the LSB (hardware convention). Length === N. */
  bits: Uint8Array;
  /** Rendered nibble values (eased floats), MSB-first. Presentation only. */
  anim: number[];
  /** Settled nibble values (integers), MSB-first. */
  target: number[];
}

export interface Slot {
  key: SlotKey;
  A: Register;
  B: Register;
  Z: Register;
  showB: boolean;
  binop: BinOp;
  /** "a" | "b" — which operand drags/presets/unary ops act on. */
  edit: OperandKey;
  seededB: boolean;
  /** B phase relative to A: "0" | "opp" | "q" | "h". */
  lfoB: string;
  colA: number;
  colB: number;
}

export type SlotMap = Record<SlotKey, Slot>;

export interface SourcePort {
  slot: SlotKey;
  frame: FrameKey;
}

export interface DestinationPort {
  slot: SlotKey;
  frame: OperandKey;
}

export interface Route {
  id: string;
  from: SourcePort;
  to: DestinationPort;
  /** True when this edge closes a cycle; its source is sampled before evaluation. */
  delay: boolean;
  mix: MixOp;
}
