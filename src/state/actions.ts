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
import type { BinOp } from "../core/types.ts";
import { S, nibValue, type FrameKey, type Reg, type Slot, type SlotKey } from "./instrument.ts";

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

export function setBinop(sl: Slot, op: BinOp): void {
  sl.binop = op;
}

/** Focus and edit travel together for operands; a derived frame is a lens. */
export function setFocus(sl: Slot, frame: FrameKey): void {
  sl.focus = frame;
  if (frame !== "z") sl.edit = frame;
}

export function setShowB(sl: Slot, show: boolean): void {
  sl.showB = show;
  if (!show && sl.focus === "z") sl.focus = "a";
}

export function toggleFrameVisibility(sl: Slot, frame: FrameKey): boolean {
  sl.frameVis[frame] = !sl.frameVis[frame];
  return sl.frameVis[frame];
}

export function selectLane(lane: SlotKey): void {
  S.slot = lane;
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
export function copyLane(src: Slot, dst: Slot): void {
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
  dst.expressions = { ...src.expressions };
  dst.colA = src.colA;
  dst.colB = src.colB;
}

/** Removes the second operand from a lane (the old unpair-B action). */
export function unpair(sl: Slot): void {
  sl.showB = false;
  sl.edit = "a";
  sl.focus = "a";
}
