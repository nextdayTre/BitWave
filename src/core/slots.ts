/**
 * Slots, canonical boot state, and centre-pinned resize.
 *
 * A slot is one three-frame device: operand A, derived Z, operand B. Three
 * slots share one width N (DESIGN §6, §10.10). This module also owns the exact
 * boot state the instrument has always shown, so the golden vectors and later
 * tests compare against the same source of truth.
 */

import type { BinOp, Slot, SlotKey, SlotMap } from "./types.ts";
import { SLOT_KEYS } from "./types.ts";
import {
  DEFAULT_N,
  bitsToNibbles,
  nibblesToBits,
  nibCount,
  remapNibbles,
  syncTarget,
} from "./registers.ts";
import { tableValues } from "./ops.ts";
import { computeZ } from "./derive.ts";

export function makeSlot(key: SlotKey, N: number, binop: BinOp = "xor"): Slot {
  return {
    key,
    A: {
      bits: new Uint8Array(N),
      anim: new Array<number>(nibCount(N)).fill(0),
      target: new Array<number>(nibCount(N)).fill(0),
    },
    B: {
      bits: new Uint8Array(N),
      anim: new Array<number>(nibCount(N)).fill(0),
      target: new Array<number>(nibCount(N)).fill(0),
    },
    Z: {
      bits: new Uint8Array(N),
      anim: new Array<number>(nibCount(N)).fill(0),
      target: new Array<number>(nibCount(N)).fill(0),
    },
    showB: false,
    binop,
    edit: "a",
    seededB: false,
    lfoB: "0",
    colA: -1,
    colB: -1,
  };
}

function seed(slot: Slot, N: number, a: number[], b: number[]): void {
  slot.A.bits = nibblesToBits(a, N);
  slot.B.bits = nibblesToBits(b, N);
  syncTarget(slot.A, N);
  syncTarget(slot.B, N);
  slot.Z.bits = computeZ(slot.A.bits, slot.B.bits, N, slot.binop);
  syncTarget(slot.Z, N);
}

/**
 * Boot values, matching index.html: View A sine + square, View B cosine +
 * triangle, View C saw-up + sine (AND). Pinned by the golden vectors.
 */
export function makeBootSlots(N: number = DEFAULT_N): SlotMap {
  const A = makeSlot("A", N, "xor");
  seed(A, N, tableValues("sine", N), tableValues("square", N));

  const B = makeSlot("B", N, "xor");
  seed(B, N, tableValues("cosine", N), tableValues("triangle", N));
  B.seededB = true;

  const C = makeSlot("C", N, "and");
  seed(C, N, tableValues("sawUp", N), tableValues("sine", N));
  C.seededB = true;

  return { A, B, C };
}

/**
 * Centre-pinned resize of every register in every view, mirroring
 * `resizeRegister` in index.html: remap A/B nibbles, install new bit arrays,
 * then derive Z for the new width. Callers must remap parked route bases with
 * `remapParked` (routing.ts) around this call.
 */
export function resizeSlots(slots: SlotMap, oldN: number, newN: number): void {
  if (oldN === newN) return;
  const mapped: Record<SlotKey, { a: number[]; b: number[] }> = {
    A: { a: [], b: [] },
    B: { a: [], b: [] },
    C: { a: [], b: [] },
  };

  for (const key of SLOT_KEYS) {
    const slot = slots[key];
    mapped[key].a = remapNibbles(bitsToNibbles(slot.A.bits, oldN), oldN, newN);
    mapped[key].b = remapNibbles(bitsToNibbles(slot.B.bits, oldN), oldN, newN);
  }

  for (const key of SLOT_KEYS) {
    const slot = slots[key];
    for (const [reg, values] of [
      [slot.A, mapped[key].a],
      [slot.B, mapped[key].b],
    ] as const) {
      reg.bits = nibblesToBits(values, newN);
      reg.target = values.slice();
      reg.anim = values.slice();
    }
    slot.Z.bits = computeZ(slot.A.bits, slot.B.bits, newN, slot.binop);
    slot.Z.target = new Array<number>(nibCount(newN)).fill(0);
    slot.Z.anim = new Array<number>(nibCount(newN)).fill(0);
    syncTarget(slot.Z, newN);
  }
}
