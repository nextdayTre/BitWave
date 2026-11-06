/**
 * Bridge between the app's state tree and the core routing engine.
 *
 * The core speaks `LaneMap` with numeric keys (`"1"`/`"2"`/`"3"`); the app's
 * slots keep their historical `A`/`B`/`C` keys plus presentation fields. The
 * view objects below share the register objects, so an evaluation that writes
 * `lane.Z.bits` or `operand.bits` mutates the live tree.
 *
 * `evaluate()` is the clocked pass DESIGN §10 describes: apply routes in
 * dependency order, then derive every lane's Z. Call it on transaction
 * boundaries only (never per animation frame).
 */

import { createRouting, evaluateAll } from "../core/routing.ts";
import type { Lane, LaneKey, LaneMap } from "../core/types.ts";
import { S, SLOT_KEYS, syncTarget, type Slot } from "./instrument.ts";

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

/** The single evaluation entry point for the app. Writes state only. */
export function evaluate(instant = false): void {
  evaluateAll(routing, coreLanes(), S.N);
  for (const key of SLOT_KEYS) syncTarget(S.slots[key].Z, instant);
}
