/**
 * Bridge between the app's state tree and the core routing engine.
 *
 * `evaluate()` is the clocked pass DESIGN §10 describes: apply routes in
 * dependency order across lanes and free frames (D52), apply expression sources
 * (which see the previous record row as `log.<frame>`), then derive every lane's
 * Z. Call it on transaction boundaries only (never per animation frame).
 */

import { evaluateAll, createRouting, isDriven, isFreeDriven } from "../core/routing.ts";
import { bigToReg, regToBig } from "../core/registers.ts";
import { evaluateExpression } from "../core/expression.ts";
import type {
  FreeFrame,
  FreeFrameKey,
  FreeFrameMap,
  Lane,
  LaneKey,
  LaneMap,
  OperandKey,
} from "../core/types.ts";
import {
  FRAME_NAMES,
  S,
  freeFrameName,
  liveFreeFrameKeys,
  liveLaneKeys,
  syncTarget,
  type FreeFrameState,
  type LaneState,
} from "./instrument.ts";
import { lastLog } from "./record.ts";

/** Routes and parked bases for the instrument. */
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

function freeFrameView(ff: FreeFrameState, key: FreeFrameKey): FreeFrame {
  return {
    key,
    reg: ff.reg,
    col: ff.col,
    label: ff.label || undefined,
    sourceNote: ff.sourceNote || undefined,
  };
}

/** Core lane map view over the app tree: stable lane keys, shared registers. */
export function coreLanes(): LaneMap {
  const lanes = {} as LaneMap;
  for (const key of liveLaneKeys()) lanes[key] = laneView(S.lanes[key], key);
  return lanes;
}

/** Core free-frame map view over the app tree: stable free keys, shared registers. */
export function coreFreeFrames(): FreeFrameMap {
  const frames: FreeFrameMap = {};
  for (const key of liveFreeFrameKeys()) frames[key] = freeFrameView(S.freeFrames[key], key);
  return frames;
}

/** Every current frame (lanes + free frames) as a name -> BigInt map. */
export function frameWords(
  lanes: LaneMap,
  N: number,
  freeFrames: FreeFrameMap = coreFreeFrames(),
): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const laneKey of Object.keys(lanes).sort((a, b) => Number(a) - Number(b))) {
    const lane = lanes[laneKey];
    const names = FRAME_NAMES[laneKey];
    if (!names) continue;
    out[names.a] = regToBig(lane.A.bits, N);
    out[names.b] = regToBig(lane.B.bits, N);
    out[names.z] = regToBig(lane.Z.bits, N);
  }
  for (const freeKey of Object.keys(freeFrames).sort((a, b) => Number(a) - Number(b))) {
    out[freeFrameName(freeKey)] = regToBig(freeFrames[freeKey].reg.bits, N);
  }
  return out;
}

/**
 * D53: keep the frame's last settled bits on a failed expression, but record why,
 * so the UI badge and `getState().expressionError` cannot report a frozen register
 * as a live one. Cleared by every clocked pass.
 */
function recordExpressionError(name: string, error: unknown): void {
  S.expressionErrors[name] = error instanceof Error ? error.message : "invalid expression";
}

/** Apply one lane operand expression source, if present. */
function applyExpression(laneKey: LaneKey, frame: OperandKey, lanes: LaneMap, N: number): void {
  const sl = S.lanes[laneKey];
  const text = sl.expressions[frame];
  if (text.trim() === "") return;
  const reg = frame === "a" ? sl.A : sl.B;
  const name = FRAME_NAMES[laneKey]?.[frame] ?? frame.toUpperCase();
  try {
    const value = evaluateExpression(text, {
      width: N,
      frames: frameWords(lanes, N),
      log: lastLog() ?? undefined,
    });
    bigToReg(value, reg.bits, N);
  } catch (error) {
    recordExpressionError(name, error);
  }
}

/** Apply one free-frame expression source, if present. */
function applyFreeExpression(
  freeKey: FreeFrameKey,
  lanes: LaneMap,
  freeFrames: FreeFrameMap,
  N: number,
): void {
  const ff = S.freeFrames[freeKey];
  if (!ff) return;
  const text = ff.expression;
  if (text.trim() === "") return;
  try {
    const value = evaluateExpression(text, {
      width: N,
      frames: frameWords(lanes, N, freeFrames),
      log: lastLog() ?? undefined,
    });
    bigToReg(value, ff.reg.bits, N);
  } catch (error) {
    recordExpressionError(freeFrameName(freeKey), error);
  }
}

/** The single evaluation entry point for the app. Writes state only. */
export function evaluate(instant = false): void {
  S.expressionErrors = {};
  const lanes = coreLanes();
  const freeFrames = coreFreeFrames();
  evaluateAll(routing, lanes, S.N, { applyExpression, applyFreeExpression }, freeFrames);
  for (const key of liveLaneKeys()) {
    const sl = S.lanes[key];
    if (isDriven(routing, key, "a") || sl.expressions.a.trim() !== "") syncTarget(sl.A, instant);
    if (isDriven(routing, key, "b") || sl.expressions.b.trim() !== "") syncTarget(sl.B, instant);
    syncTarget(sl.Z, instant);
  }
  for (const key of liveFreeFrameKeys()) {
    const ff = S.freeFrames[key];
    if (isFreeDriven(routing, key) || ff.expression.trim() !== "") syncTarget(ff.reg, instant);
  }
}
