/**
 * Input bindings — the six operand inputs and what drives them.
 *
 * One fixed row per input (lane 1/2/3 × operand a/b). A row's source is either
 * an imported CSV column (`data`), a frame output (`1:1` / `z⁻¹`), or nothing.
 * This is the routing engine's UI model: choosing a data column clears any
 * incoming route, choosing a frame clears the column, and the core parks and
 * restores the pre-patch base (DESIGN §10.8, D2).
 *
 * Names follow D15: the six operand frames are A–F; source frames are A–F plus
 * Z1–Z3. The assignment is the label: a data-bound row reads `A · sine`.
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
import { S, SLOT_KEYS, curSlot, focusKey, frameName, type Slot, type SlotKey } from "./instrument.ts";
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
export interface NoSource {
  kind: "none";
}
export type BindingSource = DataSource | FrameSource | NoSource;

export interface InputBinding {
  lane: SlotKey;
  laneNumber: number;
  operand: Operand;
  /** Global frame name of the destination operand (A–F). */
  frame: string;
  /** What the input reads, named the way the CSV dropdown names it. */
  source: BindingSource;
  /** `data` · `1:1` · `z⁻¹` · `—`. */
  state: "data" | "1:1" | "z⁻¹" | "—";
  driven: boolean;
}

const LANE_KEY: Record<SlotKey, LaneKey> = { A: "1", B: "2", C: "3" };
const LANE_BY_KEY: Record<LaneKey, SlotKey> = { "1": "A", "2": "B", "3": "C" };

export const laneKeyOf = (slotKey: SlotKey): LaneKey => LANE_KEY[slotKey];
export const slotKeyOf = (lane: LaneKey): SlotKey => LANE_BY_KEY[lane];

export const columnIndexOf = (sl: Slot, operand: Operand): number =>
  operand === "a" ? sl.colA : sl.colB;

export const destinationOf = (sl: Slot, operand: Operand): DestinationPort => ({
  lane: laneKeyOf(sl.key),
  frame: operand,
});

export const routeFor = (sl: Slot, operand: Operand) =>
  driverOf(routing, laneKeyOf(sl.key), operand);

/** The global name of the frame driving this input, or null when local. */
export function driverName(sl: Slot, operand: Operand): string | null {
  const route = routeFor(sl, operand);
  return route ? frameName(slotKeyOf(route.from.lane), route.from.frame) : null;
}

export function describeInput(sl: Slot, operand: Operand): InputBinding {
  const route = routeFor(sl, operand);
  const column = columnIndexOf(sl, operand);
  let source: BindingSource = { kind: "none" };
  let state: InputBinding["state"] = "—";

  if (route) {
    source = {
      kind: "frame",
      lane: route.from.lane,
      frame: route.from.frame,
      name: frameName(slotKeyOf(route.from.lane), route.from.frame),
    };
    state = route.delay ? "z⁻¹" : "1:1";
  } else if (column >= 0 && DEMO.cols[column]) {
    source = { kind: "data", index: column, column: DEMO.cols[column] };
    state = "data";
  }

  return {
    lane: sl.key,
    laneNumber: Number(sl.key === "A" ? 1 : sl.key === "B" ? 2 : 3),
    operand,
    frame: frameName(sl.key, operand),
    source,
    state,
    driven: Boolean(route),
  };
}

export function listInputs(): InputBinding[] {
  const out: InputBinding[] = [];
  for (const key of SLOT_KEYS) {
    for (const operand of ["a", "b"] as const) out.push(describeInput(S.slots[key], operand));
  }
  return out;
}

/** Is the focused frame an input that a route drives? (editing is locked) */
export function isFocusDriven(sl: Slot = curSlot()): boolean {
  const key = focusKey(sl);
  return key !== "z" && Boolean(routeFor(sl, key));
}

export function isInputDriven(sl: Slot, operand: Operand): boolean {
  return Boolean(routeFor(sl, operand));
}

export function inputLabel(binding: InputBinding): string {
  const suffix =
    binding.source.kind === "data"
      ? ` · ${binding.source.column}`
      : binding.source.kind === "frame"
        ? ` · ${binding.source.name}`
        : "";
  return `${binding.frame}${suffix}`;
}

/** All frame outputs a given input may read, excluding its own frame. */
export function availableSources(sl: Slot, operand: Operand): Array<{
  lane: LaneKey;
  frame: FrameKey;
  name: string;
  disabled: boolean;
}> {
  const destLane = laneKeyOf(sl.key);
  const out = [];
  for (const lane of ["1", "2", "3"] as const) {
    for (const frame of ["a", "b", "z"] as const) {
      out.push({
        lane,
        frame,
        name: frameName(slotKeyOf(lane), frame),
        disabled: lane === destLane && frame === operand,
      });
    }
  }
  return out;
}

function setColumn(sl: Slot, operand: Operand, column: number): void {
  if (operand === "a") sl.colA = column;
  else sl.colB = column;
}

function dropRoute(sl: Slot, operand: Operand): void {
  const route = routeFor(sl, operand);
  if (route) removeRoute(routing, coreLanes(), route.id);
}

/** Bind an input to an imported column, restoring any parked base first. */
export function bindData(sl: Slot, operand: Operand, column: number): void {
  dropRoute(sl, operand);
  setColumn(sl, operand, column >= 0 && DEMO.cols[column] ? column : -1);
}

/** Bind an input to a frame output; its data column mapping is cleared. */
export function bindFrame(sl: Slot, operand: Operand, from: SourcePort): void {
  setColumn(sl, operand, -1);
  addRoute(routing, coreLanes(), from, destinationOf(sl, operand));
}

/** Unbind an input (no source); a parked base is restored. */
export function bindNone(sl: Slot, operand: Operand): void {
  dropRoute(sl, operand);
  setColumn(sl, operand, -1);
}

/** Clear every route and column binding (used by a fresh CSV import). */
export function resetBindings(): void {
  clearRoutes(routing, coreLanes());
  for (const key of SLOT_KEYS) {
    S.slots[key].colA = -1;
    S.slots[key].colB = -1;
  }
}

/** Re-map parked bases around a width change so unroute equals no-route resize. */
export function remapParkedBases(oldN: number, newN: number): void {
  remapParked(routing, oldN, newN);
}

/** Keep a driven input's parked base in step when its local base is copied. */
export function updateParkedBase(sl: Slot, operand: Operand, bits: Uint8Array): void {
  routing.parked.set(portKey(laneKeyOf(sl.key), operand), bits.slice());
}
