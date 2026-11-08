/**
 * Bridge between the app's state tree and the core routing engine.
 *
 * `evaluate()` is the clocked pass DESIGN §10 describes: apply routes in
 * dependency order, apply expression operands (which see the previous record row
 * as `log.<frame>`), then derive every lane's Z. Call it on transaction
 * boundaries only (never per animation frame).
 */

import { evaluateAll, createRouting, isDriven } from "../core/routing.ts";
import { bigToReg, regToBig } from "../core/registers.ts";
import { evaluateExpression } from "../core/expression.ts";
import type { Lane, LaneKey, LaneMap, OperandKey } from "../core/types.ts";
import { FRAME_NAMES, S, SLOT_KEYS, syncTarget, type Slot } from "./instrument.ts";
import { lastLog } from "./record.ts";

const LANE_KEY: Record<(typeof SLOT_KEYS)[number], LaneKey> = { A: "1", B: "2", C: "3" };
const SLOT_BY_LANE: Record<LaneKey, (typeof SLOT_KEYS)[number]> = { "1": "A", "2": "B", "3": "C" };

/** Routes and parked bases for the instrument. Empty until the matrix lands. */
export const routing = createRouting();

function laneView(sl: Slot, key: LaneKey): Lane {
  return {
    key,
    A: sl.A,
    B: sl.B,
    Z: sl.Z,
    showB: sl.showB,
    binop: sl.binop,
    edit: sl.edit,
    seededB: sl.seededB,
    lfoB: sl.lfoB,
    colA: sl.colA,
    colB: sl.colB,
  };
}

/** Core lane map view over the app's slots: numeric keys, shared registers. */
export function coreLanes(): LaneMap {
  return {
    "1": laneView(S.slots.A, "1"),
    "2": laneView(S.slots.B, "2"),
    "3": laneView(S.slots.C, "3"),
  };
}

/** Every current frame as a name -> BigInt map (for expression environments). */
export function frameWords(lanes: LaneMap, N: number): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const laneKey of ["1", "2", "3"] as LaneKey[]) {
    const lane = lanes[laneKey];
    const names = FRAME_NAMES[SLOT_BY_LANE[laneKey]];
    out[names.a] = regToBig(lane.A.bits, N);
    out[names.b] = regToBig(lane.B.bits, N);
    out[names.z] = regToBig(lane.Z.bits, N);
  }
  return out;
}

/** Apply one expression source, if present. Invalid text leaves the base bits. */
function applyExpression(laneKey: LaneKey, frame: OperandKey, lanes: LaneMap, N: number): void {
  const sl = S.slots[SLOT_BY_LANE[laneKey]];
  const text = sl.expressions[frame];
  if (text.trim() === "") return;
  const reg = frame === "a" ? sl.A : sl.B;
  try {
    const value = evaluateExpression(text, {
      width: N,
      frames: frameWords(lanes, N),
      log: lastLog() ?? undefined,
    });
    bigToReg(value, reg.bits, N);
  } catch {
    /* Invalid expression: keep the base bits; the source table reports it. */
  }
}

/** The single evaluation entry point for the app. Writes state only. */
export function evaluate(instant = false): void {
  evaluateAll(routing, coreLanes(), S.N, { applyExpression });
  for (const key of SLOT_KEYS) {
    const sl = S.slots[key];
    const lane = LANE_KEY[key];
    /* A driven/expression operand's display target follows the computed truth,
       not the base bits the local writers last saw. */
    if (isDriven(routing, lane, "a") || sl.expressions.a.trim() !== "") syncTarget(sl.A, instant);
    if (isDriven(routing, lane, "b") || sl.expressions.b.trim() !== "") syncTarget(sl.B, instant);
    syncTarget(sl.Z, instant);
  }
}
