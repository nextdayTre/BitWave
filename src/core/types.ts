/**
 * BitWave core types.
 *
 * This directory is intentionally DOM-free: nothing under src/core may import
 * `document`, `window`, `localStorage`, `requestAnimationFrame` or any browser
 * type. The engine must run in the browser, in a desktop shell and in plain
 * Node tests. Enforced by tsconfig.core.json (`lib: ["ES2022"]`, `types: []`)
 * and by the review rule in PLAN.md §6.2.
 *
 * TERMINOLOGY (author decision, 2026-11-06; keyed by lane in D43)
 *   lane 1 / 2 / 3   the three parallel instruments (formerly slots A/B/C)
 *   frame A / Z / B  within a lane: operand A, derived Z, operand B
 * The old collision — lanes A/B/C vs operand frames A/B — is gone: lanes are
 * numbers, letters belong only to frames and operands. A lane's identity is its
 * stable lane key ("1".."13" from `lanedefs.ts`), never its array position.
 */

import { DEFAULT_LANE_COUNT, laneDefs } from "./lanedefs.ts";

/** Stable lane identity: the name index as a string ("1".."13"). */
export type LaneKey = string;

/** Stable free-frame identity: the 1-based numeric key as a string ("1".."16", D52). */
export type FreeFrameKey = string;

/** Display order of the shipped lanes: the default three from `lanedefs.ts`. */
export const LANE_KEYS: readonly LaneKey[] = laneDefs(DEFAULT_LANE_COUNT).map((def) => def.key);

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
  /** Settled nibble values (integers, MSB-first). */
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

/** Lane map keyed by the stable lane key (never by array position). */
export type LaneMap = Record<LaneKey, Lane>;

/** One standalone free frame (single register decoupled from A/B/Z lane housing, D52). */
export interface FreeFrame {
  key: FreeFrameKey;
  reg: Register;
  /** Dataset column index (-1 = local). */
  col: number;
  /** Optional short stage label, e.g. "hanning". */
  label?: string;
  /** Optional external library/function provenance note, e.g. "numpy.hanning(16)". */
  sourceNote?: string;
}

/** Free-frame map keyed by stable numeric key ("1".."16"). */
export type FreeFrameMap = Record<FreeFrameKey, FreeFrame>;

export interface LaneSourcePort {
  lane: LaneKey;
  frame: FrameKey;
}

export interface FreeSourcePort {
  free: FreeFrameKey;
}

export type SourcePort = LaneSourcePort | FreeSourcePort;

export interface LaneDestinationPort {
  lane: LaneKey;
  frame: OperandKey;
}

export interface FreeDestinationPort {
  free: FreeFrameKey;
}

export type DestinationPort = LaneDestinationPort | FreeDestinationPort;

export function isFreePort(port: SourcePort | DestinationPort): port is FreeSourcePort {
  return "free" in port && typeof port.free === "string";
}

export interface Route {
  id: string;
  from: SourcePort;
  to: DestinationPort;
  /** True when this edge closes a cycle; its source is sampled before evaluation. */
  delay: boolean;
  mix: MixOp;
}
