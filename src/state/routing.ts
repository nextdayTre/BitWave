/**
 * Bridge between the app's state tree and the core routing engine.
 *
 * `evaluate()` is the clocked pass DESIGN §10 describes: apply routes in
 * dependency order, apply expression operands (which see the previous record row
 * as `log.<frame>`), then derive every lane's Z. Call it on transaction
 * boundaries only (never per animation frame).
 *
 * D43: the core lane map is keyed by stable lane key ("1".."13"); the app tree
 * is keyed the same way, so no A/B/C slot lookup is needed anywhere.
 */

import { evaluateAll, createRouting, isDriven } from "../core/routing.ts";
import { bigToReg, regToBig } from "../core/registers.ts";
import { evaluateExpression } from "../core/expression.ts";
import type { Lane, LaneKey, LaneMap, OperandKey } from "../core/types.ts";
import { FRAME_NAMES, LANE_KEYS, S, syncTarget, type LaneState } from "./instrument.ts";
import { lastLog } from "./record.ts";

/** Routes and parked bases for the instrument. Empty until the matrix lands. */
export const routing = createRouting();

function laneView(sl: LaneState, key: LaneKey): Lane {
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

/** Core lane map view over the app tree: stable lane keys, shared registers. */
export function coreLanes(): LaneMap {
  const lanes = {} as LaneMap;
  for (const key of LANE_KEYS) lanes[key] = laneView(S.lanes[key], key);
  return lanes;
}

/** Every current frame as a name -> BigInt map (for expression environments). */
export function frameWords(lanes: LaneMap, N: number): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const laneKey of LANE_KEYS) {
    const lane = lanes[laneKey];
    const names = FRAME_NAMES[laneKey];
    out[names.a] = regToBig(lane.A.bits, N);
    out[names.b] = regToBig(lane.B.bits, N);
    out[names.z] = regToBig(lane.Z.bits, N);
  }
  return out;
}

/** Apply one expression source, if present. Invalid text leaves the base bits. */
function applyExpression(laneKey: LaneKey, frame: OperandKey, lanes: LaneMap, N: number): void {
  const sl = S.lanes[laneKey];
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
  for (const key of LANE_KEYS) {
    const sl = S.lanes[key];
    /* A driven/expression operand's display target follows the computed truth,
       not the base bits the local writers last saw. */
    if (isDriven(routing, key, "a") || sl.expressions.a.trim() !== "") syncTarget(sl.A, instant);
    if (isDriven(routing, key, "b") || sl.expressions.b.trim() !== "") syncTarget(sl.B, instant);
    syncTarget(sl.Z, instant);
  }
}
