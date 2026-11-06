/**
 * BitWave core types.
 *
 * This directory is intentionally DOM-free: nothing under src/core may import
 * `document`, `window`, `localStorage`, `requestAnimationFrame` or any browser
 * type. The engine must run in the browser, in a desktop shell and in plain
 * Node tests. Enforced by tsconfig.core.json (`lib: ["ES2022"]`, `types: []`)
 * and by the review rule in PLAN.md §6.2.
 *
 * TERMINOLOGY (author decision, 2026-11-06)
 *   lane 1 / 2 / 3   the three parallel instruments (formerly slots A/B/C)
 *   frame A / Z / B  within a lane: operand A, derived Z, operand B
 * The old collision — lanes A/B/C vs operand frames A/B — is gone: lanes are
 * numbers, letters belong only to frames and operands.
 */

export type LaneKey = "1" | "2" | "3";

/** Display order of the lanes. */
export const LANE_KEYS: readonly LaneKey[] = ["1", "2", "3"];

export type OperandKey = "a" | "b";
export type FrameKey = OperandKey | "z";
export type BinOp = "and" | "or" | "xor" | "add" | "sub";

/** How several routes into one input combine (v1.1; v1 enforces one route). */
export type MixOp = "set" | "add" | "xor";

export interface Register {
  /** bits[0] is the LSB (hardware convention). Length === N. */
  bits: Uint8Array;
  /** Rendered nibble values (eased floats), MSB-first. Presentation only. */
  anim: number[];
  /** Settled nibble values (integers), MSB-first. */
  target: number[];
}

export interface Lane {
  key: LaneKey;
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

export type LaneMap = Record<LaneKey, Lane>;

export interface SourcePort {
  lane: LaneKey;
  frame: FrameKey;
}

export interface DestinationPort {
  lane: LaneKey;
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
