/**
 * Input bindings — the live operand inputs and what drives them.
 *
 * One fixed row per input (lane 1/2/3 × operand a/b). A row's source is either
 * an imported CSV column (`data`), a frame output (`1:1` / `z⁻¹`), or nothing.
 * This is the routing engine's UI model: choosing a data column clears any
 * incoming route, choosing a frame clears the column, and the core parks and
 * restores the pre-patch base (DESIGN §10.8, D2).
 *
 * Names follow D15/D46: the live operand frames are A–P; source frames add
 * Z1–Z8. The assignment is the label: a data-bound row reads `A · sine`. D43:
 * a row is identified by its lane key, and names derive from that key.
 */

import {
  addRoute,
  clearRoutes,
  driverOf,
  portKey,
  remapParked,
  removeRoute,
} from "../core/routing.ts";
import type { DestinationPort, FrameKey, LaneKey, SourcePort } from "../core/types.ts";
import { DEMO } from "./dataset.ts";
import {
  S,
  curLane,
  focusKey,
  frameName,
  liveLaneKeys,
  type LaneState,
} from "./instrument.ts";
import { coreLanes, routing } from "./routing.ts";

export type Operand = "a" | "b";

export interface DataSource {
  kind: "data";
  index: number;
  column: string;
}
export interface FrameSource {
  kind: "frame";
  lane: LaneKey;
  frame: FrameKey;
  name: string;
}
export interface ExpressionSource {
  kind: "expr";
  text: string;
}
export interface NoSource {
  kind: "none";
}
export type BindingSource = DataSource | FrameSource | ExpressionSource | NoSource;

export interface InputBinding {
  /** Stable lane key of the destination lane ("1".."13"). */
  lane: LaneKey;
  laneNumber: number;
  operand: Operand;
  /** Global frame name of the destination operand (A–P). */
  frame: string;
  /** What the input reads, named the way the CSV dropdown names it. */
  source: BindingSource;
  /** `data` · `1:1` · `z⁻¹` · `expr` · `—`. */
  state: "data" | "1:1" | "z⁻¹" | "expr" | "—";
  driven: boolean;
}

export const columnIndexOf = (sl: LaneState, operand: Operand): number =>
  operand === "a" ? sl.colA : sl.colB;

export const expressionOf = (sl: LaneState, operand: Operand): string =>
  operand === "a" ? sl.expressions.a : sl.expressions.b;

export const hasExpression = (sl: LaneState, operand: Operand): boolean =>
  expressionOf(sl, operand).trim() !== "";

export const destinationOf = (sl: LaneState, operand: Operand): DestinationPort => ({
  lane: sl.key,
  frame: operand,
});

export const routeFor = (sl: LaneState, operand: Operand) =>
  driverOf(routing, sl.key, operand);

/** The global name of the frame driving this input, or null when local. */
export function driverName(sl: LaneState, operand: Operand): string | null {
  const route = routeFor(sl, operand);
  if (route) return frameName(route.from.lane, route.from.frame);
  return hasExpression(sl, operand) ? "an expression" : null;
}

export function describeInput(sl: LaneState, operand: Operand): InputBinding {
  const route = routeFor(sl, operand);
  const column = columnIndexOf(sl, operand);
  const expression = expressionOf(sl, operand).trim();
  let source: BindingSource = { kind: "none" };
  let state: InputBinding["state"] = "—";

  if (route) {
    source = {
      kind: "frame",
      lane: route.from.lane,
      frame: route.from.frame,
      name: frameName(route.from.lane, route.from.frame),
    };
    state = route.delay ? "z⁻¹" : "1:1";
  } else if (expression !== "") {
    source = { kind: "expr", text: expression };
    state = "expr";
  } else if (column >= 0 && DEMO.cols[column]) {
    source = { kind: "data", index: column, column: DEMO.cols[column] };
    state = "data";
  }

  return {
    lane: sl.key,
    laneNumber: Number(sl.key),
    operand,
    frame: frameName(sl.key, operand),
    source,
    state,
    driven: Boolean(route) || expression !== "",
  };
}

export function listInputs(): InputBinding[] {
  const out: InputBinding[] = [];
  for (const key of liveLaneKeys()) {
    for (const operand of ["a", "b"] as const) out.push(describeInput(S.lanes[key], operand));
  }
  return out;
}

/** Is the focused frame an input that a route or expression drives? (editing is locked) */
export function isFocusDriven(sl: LaneState = curLane()): boolean {
  const key = focusKey(sl);
  return key !== "z" && (Boolean(routeFor(sl, key)) || hasExpression(sl, key));
}

export function isInputDriven(sl: LaneState, operand: Operand): boolean {
  return Boolean(routeFor(sl, operand)) || hasExpression(sl, operand);
}

export function inputLabel(binding: InputBinding): string {
  const suffix =
    binding.source.kind === "data"
      ? ` · ${binding.source.column}`
      : binding.source.kind === "frame"
        ? ` · ${binding.source.name}`
        : binding.source.kind === "expr"
          ? " · expr"
          : "";
  return `${binding.frame}${suffix}`;
}

/** All frame outputs a given input may read, excluding its own frame. */
export function availableSources(sl: LaneState, operand: Operand): Array<{
  lane: LaneKey;
  frame: FrameKey;
  name: string;
  disabled: boolean;
}> {
  const destLane = sl.key;
  const out = [];
  for (const lane of liveLaneKeys()) {
    for (const frame of ["a", "b", "z"] as const) {
      out.push({
        lane,
        frame,
        name: frameName(lane, frame),
        disabled: lane === destLane && frame === operand,
      });
    }
  }
  return out;
}

function setColumn(sl: LaneState, operand: Operand, column: number): void {
  if (operand === "a") sl.colA = column;
  else sl.colB = column;
}

function dropRoute(sl: LaneState, operand: Operand): void {
  const route = routeFor(sl, operand);
  if (route) removeRoute(routing, coreLanes(), route.id);
}

/** Bind an input to an imported column, restoring any parked base first. */
export function bindData(sl: LaneState, operand: Operand, column: number): void {
  dropRoute(sl, operand);
  sl.expressions[operand] = "";
  setColumn(sl, operand, column >= 0 && DEMO.cols[column] ? column : -1);
}

/** Bind an input to a frame output; its data column mapping is cleared. */
export function bindFrame(sl: LaneState, operand: Operand, from: SourcePort): void {
  sl.expressions[operand] = "";
  setColumn(sl, operand, -1);
  addRoute(routing, coreLanes(), from, destinationOf(sl, operand));
}

/** Unbind an input (no source); a parked base is restored. */
export function bindNone(sl: LaneState, operand: Operand): void {
  dropRoute(sl, operand);
  sl.expressions[operand] = "";
  setColumn(sl, operand, -1);
}

/**
 * Bind an input to an expression source. The expression is evaluated on every
 * clocked evaluation (see `state/routing.ts`); an empty string clears it.
 */
export function bindExpression(sl: LaneState, operand: Operand, text: string): void {
  dropRoute(sl, operand);
  setColumn(sl, operand, -1);
  sl.expressions[operand] = String(text ?? "").trim();
}

/** Clear every route and column binding (used by a fresh CSV import). */
export function resetBindings(): void {
  clearRoutes(routing, coreLanes());
  for (const key of liveLaneKeys()) {
    S.lanes[key].colA = -1;
    S.lanes[key].colB = -1;
    S.lanes[key].expressions = { a: "", b: "" };
  }
}

/** Re-map parked bases around a width change so unroute equals no-route resize. */
export function remapParkedBases(oldN: number, newN: number): void {
  remapParked(routing, oldN, newN);
}

/** Keep a driven input's parked base in step when its local base is copied. */
export function updateParkedBase(sl: LaneState, operand: Operand, bits: Uint8Array): void {
  routing.parked.set(portKey(sl.key, operand), bits.slice());
}
