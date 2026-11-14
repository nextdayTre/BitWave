/**
 * Commands — the only places the app mutates the state tree.
 *
 * Each command is a pure state transition: no DOM, no rendering, no
 * transactions of its own. Callers run one or more commands inside
 * `store.patch(...)`, then the renderers read the settled tree. Unary ops and
 * presets delegate to `src/core` so the live instrument runs the tested engine.
 */

import {
  TABLES,
  type TableName,
  byteSwap,
  clampNib,
  fold,
  invert,
  rotateLeft,
  rotateRight,
  shiftLeft,
  shiftRight,
} from "../core/ops.ts";
import { nibblesToBits, setNibAt } from "../core/registers.ts";
import type { BinOp, LaneKey } from "../core/types.ts";
import { removeRoute, portKey } from "../core/routing.ts";
import {
  APP_LANE_CAP,
  S,
  liveLaneKeys,
  makeLaneState,
  nextFreeLaneKey,
  nibValue,
  type FrameKey,
  type LaneState,
  type Reg,
} from "./instrument.ts";
import { coreLanes, routing } from "./routing.ts";

export type UnaryOp = "rol" | "ror" | "shl" | "shr" | "not" | "fold" | "bswap";

const UNARY: Record<UnaryOp, (bits: Uint8Array, n: number, amount: number) => Uint8Array> = {
  rol: rotateLeft,
  ror: rotateRight,
  shl: shiftLeft,
  shr: shiftRight,
  not: (bits, n) => invert(bits, n),
  fold: (bits, n) => fold(bits, n),
  bswap: (bits, n) => byteSwap(bits, n),
};

/** Applies a unary op to a register's truth bits (target resync is the caller's). */
export function applyUnary(reg: Reg, op: UnaryOp, amount = 0): void {
  reg.bits = UNARY[op](reg.bits, S.N, amount);
}

/** Loads a wavetable preset into a register's truth bits. */
export function applyPreset(reg: Reg, name: TableName): void {
  const n = S.N >> 2;
  const values = new Array<number>(n);
  for (let j = 0; j < n; j++) values[j] = TABLES[name](n, j);
  reg.bits = nibblesToBits(values, S.N);
}

export function setBinop(sl: LaneState, op: BinOp): void {
  sl.binop = op;
}

/** Focus and edit travel together for operands; a derived frame is a lens. */
export function setFocus(sl: LaneState, frame: FrameKey): void {
  sl.focus = frame;
  if (frame !== "z") sl.edit = frame;
}

export function setShowB(sl: LaneState, show: boolean): void {
  sl.showB = show;
  if (!show && sl.focus === "z") sl.focus = "a";
}

export function toggleFrameVisibility(sl: LaneState, frame: FrameKey): boolean {
  sl.frameVis[frame] = !sl.frameVis[frame];
  return sl.frameVis[frame];
}

/** Focus a lane by its stable lane key (the lane's identity, not its position). */
export function selectLane(lane: LaneKey): void {
  S.laneKey = lane;
}

/** Flips one bit and returns its nibble index (for the strip's fast patch). */
export function toggleBit(reg: Reg, bitIndex: number): number {
  reg.bits[bitIndex] ^= 1;
  const j = Math.floor((S.N - 1 - bitIndex) / 4);
  reg.target[j] = nibValue(reg, j);
  return j;
}

/** Writes a nibble into truth and target; returns the clamped value. */
export function setNibble(reg: Reg, j: number, value: number): number {
  const v = clampNib(value);
  setNibAt(reg.bits, S.N, j, v);
  reg.target[j] = v;
  return v;
}

/** 1:1 drag write: truth, target and the eared value update together. */
export function setLiveNibble(reg: Reg, j: number, value: number): number {
  const v = setNibble(reg, j, value);
  reg.anim[j] = v;
  return v;
}

/** Writes a whole hex word, right-aligned into the register (the CSV rule). */
export function setHexWord(reg: Reg, hex: string): void {
  const n = S.N >> 2;
  const digits = hex.replace(/[^0-9a-f]/gi, "").toUpperCase().slice(-n).padStart(n, "0");
  for (let j = 0; j < n; j++) {
    const v = parseInt(digits[j], 16);
    setNibAt(reg.bits, S.N, j, v);
    reg.target[j] = v;
  }
}

/** Copies a lane's model state (not its parked route bases). */
export function copyLane(src: LaneState, dst: LaneState): void {
  dst.A.bits = src.A.bits.slice();
  dst.B.bits = src.B.bits.slice();
  dst.Z.bits = src.Z.bits.slice();
  dst.showB = src.showB;
  dst.seededB = src.seededB;
  dst.binop = src.binop;
  dst.edit = src.edit;
  dst.focus = src.focus;
  dst.frameVis = { ...src.frameVis };
  dst.lfoB = src.lfoB;
  dst.fold = src.fold;
  dst.expressions = { ...src.expressions };
  dst.colA = src.colA;
  dst.colB = src.colB;
}

/** Removes the second operand from a lane (the old unpair-B action). */
export function unpair(sl: LaneState): void {
  sl.showB = false;
  sl.edit = "a";
  sl.focus = "a";
}

/* ── lane management (D46) ─────────────────────────────────────────────── */

/**
 * Add a blank lane at the lowest free stable key, focusing nothing.
 *
 * A new lane is truly blank: zeroed registers, XOR, focus on A, every frame
 * visible, no expression sources and no CSV columns. It never renumbers an
 * existing lane, and the app cap (8) is the only refusal — the grammar ceiling
 * (13) merely bounds the allocator. Returns the new lane key, or `null` at the
 * cap. The caller focuses the lane (the add is a user action, not a state
 * migration).
 */
export function addLane(): LaneKey | null {
  if (liveLaneKeys().length >= APP_LANE_CAP) return null;
  const key = nextFreeLaneKey();
  if (key === null) return null;
  S.lanes[key] = makeLaneState(key, S.N);
  return key;
}

/**
 * Duplicate a lane as a new lane at the lowest free stable key. The copy takes
 * the source lane's model state — register bits/targets, `showB`, operator,
 * edit/focus lenses, B phase, seeded flag, frame visibility, expressions, fold
 * and CSV column mapping — but **not** its route edges or parked bases: routing
 * belongs to the rack, not the lane (D43). Returns the new lane key, or `null`
 * when the source is unknown or the app cap is reached.
 */
export function duplicateLane(srcKey: LaneKey): LaneKey | null {
  const src = S.lanes[srcKey];
  if (!src) return null;
  if (liveLaneKeys().length >= APP_LANE_CAP) return null;
  const key = nextFreeLaneKey();
  if (key === null) return null;
  const dst = makeLaneState(key, S.N);
  copyLane(src, dst);
  S.lanes[key] = dst;
  return key;
}

export interface DeleteLaneResult {
  ok: boolean;
  /** Present when `ok` is false: the lane is unknown or it is the last lane. */
  reason?: "unknown" | "last";
}

/**
 * Delete a live lane. Never deletes the last lane; never renumbers the rest.
 *
 * Every route touching the lane is removed. A route *leaving* the deleted lane
 * unplugs its surviving destination, restoring the parked pre-patch base
 * byte-identically exactly as an explicit unplug would; a route *entering* the
 * deleted lane has no surviving destination, so it is dropped with its parked
 * base. The freed key becomes reusable. If the deleted lane was focused, focus
 * falls to the lowest remaining lane; `splitPair` is repaired (and split exits
 * when fewer than two lanes remain).
 */
export function deleteLane(key: LaneKey): DeleteLaneResult {
  if (!S.lanes[key]) return { ok: false, reason: "unknown" };
  const remaining = liveLaneKeys().filter((candidate) => candidate !== key);
  if (remaining.length === 0) return { ok: false, reason: "last" };

  const lanes = coreLanes();
  for (const route of [...routing.routes]) {
    if (route.from.lane !== key && route.to.lane !== key) continue;
    if (route.to.lane === key) {
      /* The destination disappears with the lane: drop the edge and its base. */
      routing.routes = routing.routes.filter((candidate) => candidate.id !== route.id);
      routing.parked.delete(portKey(key, route.to.frame));
    } else {
      /* The destination survives: unplug restores its parked base. */
      removeRoute(routing, lanes, route.id);
    }
  }
  for (const frame of ["a", "b"] as const) routing.parked.delete(portKey(key, frame));

  delete S.lanes[key];
  if (S.lfo.base) delete S.lfo.base[key];

  if (S.laneKey === key) S.laneKey = remaining[0];

  const repair = (current: LaneKey): LaneKey =>
    remaining.includes(current) ? current : remaining[0];
  S.splitPair = [repair(S.splitPair[0]), repair(S.splitPair[1])];
  if (S.splitPair[0] === S.splitPair[1]) {
    S.splitPair = [
      S.splitPair[0],
      remaining.find((candidate) => candidate !== S.splitPair[0]) ?? S.splitPair[0],
    ];
  }
  if (S.split3d && remaining.length < 2) {
    S.split3d = false;
    S.activePane = 0;
  }
  return { ok: true };
}
