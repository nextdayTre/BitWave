/**
 * Lanes, canonical boot state, and centre-pinned resize.
 *
 * A lane is one three-frame device: operand A, derived Z, operand B. Three
 * lanes share one width N (DESIGN §6, §10.10). This module also owns the exact
 * boot state the instrument has always shown, so the golden vectors and later
 * tests compare against the same source of truth.
 *
 * Rename note (2026-11-06): lanes were A/B/C; they are now 1/2/3 so that letters
 * refer only to frames/operands. D43 keys every lane by its stable lane key from
 * `lanedefs.ts` ("1".."13"), so a map is never indexed by array position.
 */

import type { BinOp, Lane, LaneKey, LaneMap } from "./types.ts";
import { LANE_KEYS } from "./types.ts";
import {
  DEFAULT_N,
  bitsToNibbles,
  nibblesToBits,
  nibCount,
  remapNibbles,
  syncTarget,
} from "./registers.ts";
import { tableValues, type TableName } from "./ops.ts";
import { computeZ } from "./derive.ts";

export function makeLane(key: LaneKey, N: number, binop: BinOp = "xor"): Lane {
  const empty = () => ({
    bits: new Uint8Array(N),
    anim: new Array<number>(nibCount(N)).fill(0),
    target: new Array<number>(nibCount(N)).fill(0),
  });
  return {
    key,
    A: empty(),
    B: empty(),
    Z: empty(),
    showB: false,
    binop,
    edit: "a",
    seededB: false,
    lfoB: "0",
    colA: -1,
    colB: -1,
  };
}

function seed(lane: Lane, N: number, a: number[], b: number[]): void {
  lane.A.bits = nibblesToBits(a, N);
  lane.B.bits = nibblesToBits(b, N);
  syncTarget(lane.A, N);
  syncTarget(lane.B, N);
  lane.Z.bits = computeZ(lane.A.bits, lane.B.bits, N, lane.binop);
  syncTarget(lane.Z, N);
}

/** Boot wavetables per shipped lane, in lane order (DESIGN §2 / index.html). */
const BOOT_SEEDS: readonly {
  a: TableName;
  b: TableName;
  binop: BinOp;
  seededB: boolean;
}[] = [
  { a: "sine", b: "square", binop: "xor", seededB: false },
  { a: "cosine", b: "triangle", binop: "xor", seededB: true },
  { a: "sawUp", b: "sine", binop: "and", seededB: true },
];

/**
 * Boot values, matching index.html: Lane 1 sine + square, Lane 2 cosine +
 * triangle, Lane 3 saw-up + sine (AND). Pinned by the golden vectors. Keys come
 * from `LANE_KEYS` (the default three from `lanedefs.ts`), not a literal map.
 */
export function makeBootLanes(N: number = DEFAULT_N): LaneMap {
  const lanes: LaneMap = {};
  LANE_KEYS.forEach((key, index) => {
    const boot = BOOT_SEEDS[index];
    const lane = makeLane(key, N, boot.binop);
    seed(lane, N, tableValues(boot.a, N), tableValues(boot.b, N));
    lane.seededB = boot.seededB;
    lanes[key] = lane;
  });
  return lanes;
}

/**
 * Centre-pinned resize of every register in every lane, mirroring
 * `resizeRegister` in index.html: remap A/B nibbles, install new bit arrays,
 * then derive Z for the new width. Callers must remap parked route bases with
 * `remapParked` (routing.ts) around this call.
 */
export function resizeLanes(lanes: LaneMap, oldN: number, newN: number): void {
  if (oldN === newN) return;
  const mapped = {} as Record<LaneKey, { a: number[]; b: number[] }>;

  for (const key of LANE_KEYS) {
    const lane = lanes[key];
    mapped[key] = {
      a: remapNibbles(bitsToNibbles(lane.A.bits, oldN), oldN, newN),
      b: remapNibbles(bitsToNibbles(lane.B.bits, oldN), oldN, newN),
    };
  }

  for (const key of LANE_KEYS) {
    const lane = lanes[key];
    for (const [reg, values] of [
      [lane.A, mapped[key].a],
      [lane.B, mapped[key].b],
    ] as const) {
      reg.bits = nibblesToBits(values, newN);
      reg.target = values.slice();
      reg.anim = values.slice();
    }
    lane.Z.bits = computeZ(lane.A.bits, lane.B.bits, newN, lane.binop);
    lane.Z.target = new Array<number>(nibCount(newN)).fill(0);
    lane.Z.anim = new Array<number>(nibCount(newN)).fill(0);
    syncTarget(lane.Z, newN);
  }
}
