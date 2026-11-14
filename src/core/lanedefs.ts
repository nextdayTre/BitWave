/**
 * Lane and frame naming primitives (D43, slice 1 of the dynamic-lanes pass).
 *
 * A lane's identity is its **name index**: the key "1" … "13". The index is
 * stable — existing lanes are never renumbered — so a lane map may have gaps
 * (1, 3, 4 are all valid) and names always derive from the index: index 3 is
 * G/H/Z4 no matter where it sits in a list. Two operand letters per lane consume
 * A–Z, so the grammar ceiling is 13 lanes; the derived frame is `Z<key>`.
 *
 * DOM-free and deterministic by construction: this module imports nothing, and
 * the browser, CLI and MCP server can all share it. The shipped app cap is
 * APP_LANE_CAP (8); NAME_CEILING (13) is the grammar's hard limit.
 */

/** Lanes in the shipped default instrument. */
export const DEFAULT_LANE_COUNT = 3;
/** Most lanes the app will offer once the dynamic-lanes UI lands. */
export const APP_LANE_CAP = 8;
/** Hard ceiling of the single-letter operand grammar (`A`–`Z`, two per lane). */
export const NAME_CEILING = 13;

export interface LaneDef {
  /** Stable lane identity: the 1-based name index as a string ("1".."13"). */
  key: string;
  /** 0-based name index (`Number(key) - 1`). */
  index: number;
  /** Operand A display name, e.g. "A" (index 0) or "G" (index 3). */
  a: string;
  /** Operand B display name, e.g. "B" or "H". */
  b: string;
  /** Derived frame display name, e.g. "Z1" or "Z4". */
  z: string;
}

export type LaneFrameName = "a" | "b" | "z";

export interface LaneFrameRef {
  /** Lane key, e.g. "1". */
  lane: string;
  frame: LaneFrameName;
  /** Canonical uppercase display name, e.g. "Z1". */
  name: string;
}

function checkIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= NAME_CEILING) {
    throw new RangeError(`lane index must be an integer in [0, ${NAME_CEILING - 1}]; got ${String(index)}`);
  }
}

function checkCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > NAME_CEILING) {
    throw new RangeError(`lane count must be an integer in [1, ${NAME_CEILING}]; got ${String(count)}`);
  }
}

/** One lane's names, derived from its 0-based name index. Gaps are fine: `laneDef(3)` is G/H/Z4. */
export function laneDef(index: number): LaneDef {
  checkIndex(index);
  return {
    key: String(index + 1),
    index,
    a: String.fromCharCode(65 + 2 * index),
    b: String.fromCharCode(66 + 2 * index),
    z: `Z${index + 1}`,
  };
}

/** The first `count` lanes, in name order (names derive from the index, not array position). */
export function laneDefs(count: number = DEFAULT_LANE_COUNT): LaneDef[] {
  checkCount(count);
  const out: LaneDef[] = [];
  for (let index = 0; index < count; index += 1) out.push(laneDef(index));
  return out;
}

/** The stable lane key for a 0-based name index: `laneKey(3)` is "4". */
export function laneKey(index: number): string {
  checkIndex(index);
  return String(index + 1);
}

/** The 0-based name index for a lane key ("1".."13"); -1 when the key is not a valid name index. */
export function laneIndex(value: unknown): number {
  if (typeof value !== "string" || !/^(?:[1-9]|1[0-3])$/.test(value)) return -1;
  return Number(value) - 1;
}

/** A lane key ("1".."13") from the numeric 1-based name index; null otherwise. */
export function laneKeyFromNumber(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > NAME_CEILING) {
    return null;
  }
  return String(value);
}

/** Frame name table keyed by lane key, in lane order: `{ "1": {a:"A", b:"B", z:"Z1"}, … }`. */
export function frameNamesFor(
  count: number = DEFAULT_LANE_COUNT,
): Record<string, { a: string; b: string; z: string }> {
  const out: Record<string, { a: string; b: string; z: string }> = {};
  for (const def of laneDefs(count)) out[def.key] = { a: def.a, b: def.b, z: def.z };
  return out;
}

/** Operand names A..(2N) in lane order (two per lane). */
export function operandNames(count: number = DEFAULT_LANE_COUNT): string[] {
  const out: string[] = [];
  for (const def of laneDefs(count)) out.push(def.a, def.b);
  return out;
}

/** Derived frame names Z1..ZN in lane order. */
export function derivedNames(count: number = DEFAULT_LANE_COUNT): string[] {
  return laneDefs(count).map((def) => def.z);
}

/**
 * Resolve a global frame name (`A`–`Z`, `Z1`–`Z13`) to its lane/frame pair;
 * case-insensitive, and null for names outside the supplied lane count. The
 * returned `name` is the canonical uppercase form.
 */
export function frameRefFromName(
  value: unknown,
  count: number = DEFAULT_LANE_COUNT,
): LaneFrameRef | null {
  if (typeof value !== "string" || value === "") return null;
  const upper = value.toUpperCase();
  for (const def of laneDefs(count)) {
    if (upper === def.a) return { lane: def.key, frame: "a", name: def.a };
    if (upper === def.b) return { lane: def.key, frame: "b", name: def.b };
    if (upper === def.z) return { lane: def.key, frame: "z", name: def.z };
  }
  return null;
}
