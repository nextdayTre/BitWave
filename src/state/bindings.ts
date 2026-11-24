/**
 * Input bindings — the live operand inputs and standalone free frames (D52).
 *
 * One row per lane operand (A–P) plus one row per live free frame (F1–F16). A
 * row's source is an imported CSV column (`data`), a frame output (`1:1` /
 * `z⁻¹`, from any lane frame OR free frame), an expression (`expr`), or nothing
 * (`none`). Choosing a data column or expression clears any incoming route and
 * restores the parked pre-patch base; choosing a frame clears the column and
 * expression and parks the base (DESIGN §10.8, D2).
 */

import {
  addRoute,
  clearRoutes,
  driverOf,
  freeDriverOf,
  portKey,
  remapParked,
  removeRoute,
} from "../core/routing.ts";
import {
  isFreePort,
  type DestinationPort,
  type FrameKey,
  type FreeFrameKey,
  type LaneKey,
  type SourcePort,
} from "../core/types.ts";
import { DEMO } from "./dataset.ts";
import {
  S,
  curFreeFrame,
  curLane,
  focusKey,
  frameName,
  freeFrameName,
  liveFreeFrameKeys,
  liveLaneKeys,
  type FreeFrameState,
  type LaneState,
} from "./instrument.ts";
import { coreFreeFrames, coreLanes, routing } from "./routing.ts";

export type Operand = "a" | "b";

export interface DataSource {
  kind: "data";
  index: number;
  column: string;
}
export interface FrameSource {
  kind: "frame";
  lane?: LaneKey;
  frame?: FrameKey;
  free?: FreeFrameKey;
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
  source: BindingSource;
  /** `data` · `1:1` · `z⁻¹` · `expr` · `—`. */
  state: "data" | "1:1" | "z⁻¹" | "expr" | "—";
  driven: boolean;
}

export interface FreeInputBinding {
  /** Stable free-frame key ("1".."16"). */
  free: FreeFrameKey;
  /** Global frame name ("F1".."F16"). */
  frame: string;
  label: string;
  sourceNote: string;
  source: BindingSource;
  state: "data" | "1:1" | "z⁻¹" | "expr" | "—";
  driven: boolean;
}

export interface SourceChoice {
  lane?: LaneKey;
  frame?: FrameKey;
  free?: FreeFrameKey;
  port: SourcePort;
  name: string;
  label?: string;
  disabled: boolean;
}

function sourcePortName(port: SourcePort): string {
  return isFreePort(port) ? freeFrameName(port.free) : frameName(port.lane, port.frame);
}

function frameSourceOf(port: SourcePort): FrameSource {
  if (isFreePort(port)) {
    return { kind: "frame", free: port.free, name: freeFrameName(port.free) };
  }
  return {
    kind: "frame",
    lane: port.lane,
    frame: port.frame,
    name: frameName(port.lane, port.frame),
  };
}

export const columnIndexOf = (sl: LaneState, operand: Operand): number =>
  operand === "a" ? sl.colA : sl.colB;

export const expressionOf = (sl: LaneState, operand: Operand): string =>
  operand === "a" ? sl.expressions.a : sl.expressions.b;

export const hasExpression = (sl: LaneState, operand: Operand): boolean =>
  expressionOf(sl, operand).trim() !== "";

export const hasFreeExpression = (ff: FreeFrameState): boolean =>
  ff.expression.trim() !== "";

export const destinationOf = (sl: LaneState, operand: Operand): DestinationPort => ({
  lane: sl.key,
  frame: operand,
});

export const freeDestinationOf = (ff: FreeFrameState): DestinationPort => ({
  free: ff.key,
});

export const routeFor = (sl: LaneState, operand: Operand) =>
  driverOf(routing, sl.key, operand);

export const freeRouteFor = (ff: FreeFrameState) => freeDriverOf(routing, ff.key);

/** The global name of the frame driving this lane input, or null when local. */
export function driverName(sl: LaneState, operand: Operand): string | null {
  const route = routeFor(sl, operand);
  if (route) return sourcePortName(route.from);
  return hasExpression(sl, operand) ? "an expression" : null;
}

/** The global name of the frame driving this free frame, or null when local. */
export function freeDriverName(ff: FreeFrameState): string | null {
  const route = freeRouteFor(ff);
  if (route) return sourcePortName(route.from);
  return hasFreeExpression(ff) ? "an expression" : null;
}

export function describeInput(sl: LaneState, operand: Operand): InputBinding {
  const route = routeFor(sl, operand);
  const column = columnIndexOf(sl, operand);
  const expression = expressionOf(sl, operand).trim();
  let source: BindingSource = { kind: "none" };
  let state: InputBinding["state"] = "—";

  if (route) {
    source = frameSourceOf(route.from);
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

export function describeFreeInput(ff: FreeFrameState): FreeInputBinding {
  const route = freeRouteFor(ff);
  const expression = ff.expression.trim();
  let source: BindingSource = { kind: "none" };
  let state: FreeInputBinding["state"] = "—";

  if (route) {
    source = frameSourceOf(route.from);
    state = route.delay ? "z⁻¹" : "1:1";
  } else if (expression !== "") {
    source = { kind: "expr", text: expression };
    state = "expr";
  } else if (ff.col >= 0 && DEMO.cols[ff.col]) {
    source = { kind: "data", index: ff.col, column: DEMO.cols[ff.col] };
    state = "data";
  }

  return {
    free: ff.key,
    frame: freeFrameName(ff.key),
    label: ff.label,
    sourceNote: ff.sourceNote,
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

export function listFreeInputs(): FreeInputBinding[] {
  return liveFreeFrameKeys().map((key) => describeFreeInput(S.freeFrames[key]));
}

/** Is the focused frame (lane frame or free frame) driven by a route or expression? */
export function isFocusDriven(sl: LaneState = curLane()): boolean {
  const ff = curFreeFrame();
  if (ff && sl === curLane()) return isFreeInputDriven(ff);
  const key = focusKey(sl);
  return key !== "z" && (Boolean(routeFor(sl, key)) || hasExpression(sl, key));
}

export function isInputDriven(sl: LaneState, operand: Operand): boolean {
  return Boolean(routeFor(sl, operand)) || hasExpression(sl, operand);
}

export function isFreeInputDriven(ff: FreeFrameState): boolean {
  return Boolean(freeRouteFor(ff)) || hasFreeExpression(ff);
}

export function activeDriverName(): string | null {
  const ff = curFreeFrame();
  if (ff) return freeDriverName(ff);
  const sl = curLane();
  const fk = focusKey(sl);
  return fk === "z" ? null : driverName(sl, fk);
}

export function inputLabel(binding: InputBinding | FreeInputBinding): string {
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

/** All frame outputs (lane frames + free frames) a given destination may read. */
export function availableSourcesForPort(dest: DestinationPort): SourceChoice[] {
  const out: SourceChoice[] = [];
  for (const lane of liveLaneKeys()) {
    for (const frame of ["a", "b", "z"] as const) {
      out.push({
        lane,
        frame,
        port: { lane, frame },
        name: frameName(lane, frame),
        disabled: !isFreePort(dest) && dest.lane === lane && dest.frame === frame,
      });
    }
  }
  for (const free of liveFreeFrameKeys()) {
    const ff = S.freeFrames[free];
    out.push({
      free,
      port: { free },
      name: freeFrameName(free),
      label: ff.label || undefined,
      disabled: isFreePort(dest) && dest.free === free,
    });
  }
  return out;
}

/** All frame outputs a lane input may read, excluding its own frame. */
export function availableSources(sl: LaneState, operand: Operand): SourceChoice[] {
  return availableSourcesForPort({ lane: sl.key, frame: operand });
}

/** All frame outputs a free frame may read, excluding itself. */
export function availableSourcesForFree(ff: FreeFrameState): SourceChoice[] {
  return availableSourcesForPort({ free: ff.key });
}

function setColumn(sl: LaneState, operand: Operand, column: number): void {
  if (operand === "a") sl.colA = column;
  else sl.colB = column;
}

function dropRoute(sl: LaneState, operand: Operand): void {
  const route = routeFor(sl, operand);
  if (route) removeRoute(routing, coreLanes(), route.id, coreFreeFrames());
}

function dropFreeRoute(ff: FreeFrameState): void {
  const route = freeRouteFor(ff);
  if (route) removeRoute(routing, coreLanes(), route.id, coreFreeFrames());
}

/** Bind a lane input to an imported column, restoring any parked base first. */
export function bindData(sl: LaneState, operand: Operand, column: number): void {
  dropRoute(sl, operand);
  sl.expressions[operand] = "";
  setColumn(sl, operand, column >= 0 && DEMO.cols[column] ? column : -1);
}

/** Bind a lane input to a frame output (lane or free frame); clears column & expr. */
export function bindFrame(sl: LaneState, operand: Operand, from: SourcePort): void {
  sl.expressions[operand] = "";
  setColumn(sl, operand, -1);
  addRoute(routing, coreLanes(), from, destinationOf(sl, operand), "set", coreFreeFrames());
}

/** Unbind a lane input (no source); a parked base is restored. */
export function bindNone(sl: LaneState, operand: Operand): void {
  dropRoute(sl, operand);
  sl.expressions[operand] = "";
  setColumn(sl, operand, -1);
}

/** Bind a lane input to an expression source. */
export function bindExpression(sl: LaneState, operand: Operand, text: string): void {
  dropRoute(sl, operand);
  setColumn(sl, operand, -1);
  sl.expressions[operand] = String(text ?? "").trim();
}

/** Bind a free frame to an imported column, restoring any parked base first. */
export function bindFreeData(ff: FreeFrameState, column: number): void {
  dropFreeRoute(ff);
  ff.expression = "";
  ff.col = column >= 0 && DEMO.cols[column] ? column : -1;
}

/** Bind a free frame to another frame output (lane or free frame). */
export function bindFreeFrame(ff: FreeFrameState, from: SourcePort): void {
  ff.expression = "";
  ff.col = -1;
  addRoute(routing, coreLanes(), from, freeDestinationOf(ff), "set", coreFreeFrames());
}

/** Unbind a free frame (no source); restores any parked base. */
export function bindFreeNone(ff: FreeFrameState): void {
  dropFreeRoute(ff);
  ff.expression = "";
  ff.col = -1;
}

/** Bind a free frame to an expression source. */
export function bindFreeExpression(ff: FreeFrameState, text: string): void {
  dropFreeRoute(ff);
  ff.col = -1;
  ff.expression = String(text ?? "").trim();
}

/** Clear every route, column and expression binding (used by a fresh CSV import). */
export function resetBindings(): void {
  clearRoutes(routing, coreLanes(), coreFreeFrames());
  for (const key of liveLaneKeys()) {
    S.lanes[key].colA = -1;
    S.lanes[key].colB = -1;
    S.lanes[key].expressions = { a: "", b: "" };
  }
  for (const key of liveFreeFrameKeys()) {
    S.freeFrames[key].col = -1;
    S.freeFrames[key].expression = "";
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
