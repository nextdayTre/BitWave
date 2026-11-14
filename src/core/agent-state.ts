/**
 * UI-state builder shared by the browser bridge and the headless transports.
 *
 * Pure: takes a `.bitwave` schema 1-4 document plus the few transient UI values
 * and returns the exact object `window.bitwave.getState()` and `#bitwave-state`
 * expose. A schema 1/2/3 document (the shipped three lanes) is the common case;
 * a schema-4 document may carry a wider lane map, whose lanes are reported by
 * their stable key with names derived from `lanedefs.ts`. Derived values are
 * recomputed from the shared core, never scraped from the DOM.
 */

import { SCHEMA_VERSION, TOOLSET_VERSION, frameName, type ViewMode } from "./agent-defaults.ts";
import { computeZ, popcountZ, truthCounts } from "./derive.ts";
import { fromHex, toHex } from "./registers.ts";
import type { ProjectDoc } from "./project.ts";
import type { BinOp, FrameKey, LaneKey } from "./types.ts";
import { LANE_KEYS } from "./types.ts";

export interface UiSource {
  kind: "data" | "frame" | "none";
  column?: string;
  index?: number;
  /** "1:1" or "z⁻¹" for a routed frame source. */
  source?: string;
  lane?: number;
  frame?: string;
}

export interface UiLaneState {
  lane: number;
  frames: Record<string, string>;
  binop: BinOp;
  focus: string;
  edit: string;
  lfoB: string;
  showB: boolean;
  seededB: boolean;
  visibility: Record<string, boolean>;
  sources: Record<string, UiSource>;
  driven: Record<string, boolean>;
  expressions: Record<string, string | null>;
  derived: Record<string, { hex: string; popcount: number; truthCounts: number[] }>;
}

export interface UiState {
  schemaVersion: number;
  ready: boolean;
  width: number;
  lane: number;
  frame: string;
  view: { mode: ViewMode; splitPair: [number, number]; activePane: number };
  lanes: Record<string, UiLaneState>;
  lfo: { on: boolean; mode: string; rate: number };
  dataset: { columns: string[]; rows: number; index: number; row: string[] } | null;
  editing: { copyArmed: boolean; enabled: boolean };
  recording: { on: boolean; rows: number };
  deeplink: string;
  bridge: { schemaVersion: number; version: string };
}

export interface UiStateOptions {
  deeplink?: string;
  lfoOn?: boolean;
  copyArmed?: boolean;
  ready?: boolean;
  recording?: { on: boolean; rows: number };
}

interface RouteSource {
  fromLane: LaneKey;
  fromFrame: FrameKey;
}

function routeInto(doc: ProjectDoc, lane: LaneKey, frame: "a" | "b"): RouteSource | null {
  const to = `${lane}.${frame}`;
  for (const route of doc.routes) {
    if (route.to !== to) continue;
    const [fromLane, fromFrame] = route.from.split(".");
    if (fromFrame === "a" || fromFrame === "b" || fromFrame === "z") {
      return { fromLane: fromLane as LaneKey, fromFrame };
    }
  }
  return null;
}

function sourceFor(doc: ProjectDoc, lane: LaneKey, frame: "a" | "b", route: RouteSource | null): UiSource {
  const laneDoc = doc.lanes[lane];
  const column = frame === "a" ? laneDoc.colA : laneDoc.colB;
  if (column >= 0 && doc.dataset && doc.dataset.cols[column] !== undefined) {
    return { kind: "data", column: doc.dataset.cols[column], index: column };
  }
  if (route) {
    return {
      kind: "frame",
      source: route.fromLane === lane ? "z⁻¹" : "1:1",
      lane: Number(route.fromLane),
      frame: frameName(route.fromLane, route.fromFrame),
    };
  }
  return { kind: "none" };
}

export function buildUiState(doc: ProjectDoc, options: UiStateOptions = {}): UiState {
  const width = doc.N;
  const lanes: Record<string, UiLaneState> = {};

  /* A schema 1-3 document is the shipped three lanes; schema 4 may carry a
     wider/gapped lane map. Report exactly the lanes the document holds, in
     ascending lane-key order, with names derived from the stable key. */
  const laneKeys = Object.keys(doc.lanes).sort((a, b) => Number(a) - Number(b));
  for (const lane of laneKeys) {
    const laneDoc = doc.lanes[lane];
    const names = { a: frameName(lane, "a"), b: frameName(lane, "b"), z: frameName(lane, "z") };
    const aBits = fromHex(laneDoc.a, width);
    const bBits = fromHex(laneDoc.b, width);
    const zBits = computeZ(aBits, bBits, width, laneDoc.binop);

    const frameVis = laneDoc.frameVis ?? { a: true, b: true, z: true };
    const visibility: Record<string, boolean> = {
      [names.a]: frameVis.a,
      [names.b]: frameVis.b,
      [names.z]: frameVis.z,
    };

    const routeA = routeInto(doc, lane, "a");
    const routeB = routeInto(doc, lane, "b");
    const sources: Record<string, UiSource> = {
      [names.a]: sourceFor(doc, lane, "a", routeA),
      [names.b]: sourceFor(doc, lane, "b", routeB),
    };
    const driven: Record<string, boolean> = {
      [names.a]: routeA !== null,
      [names.b]: routeB !== null,
    };
    const expressions: Record<string, string | null> = {
      [names.a]: laneDoc.expressions?.a ?? null,
      [names.b]: laneDoc.expressions?.b ?? null,
    };

    lanes[lane] = {
      lane: Number(lane),
      frames: {
        [names.a]: laneDoc.a,
        [names.b]: laneDoc.b,
        [names.z]: toHex(zBits, width),
      },
      binop: laneDoc.binop,
      focus: frameName(lane, laneDoc.focus ?? "a"),
      edit: frameName(lane, laneDoc.edit ?? "a"),
      lfoB: laneDoc.lfoB,
      showB: laneDoc.showB,
      seededB: laneDoc.seededB,
      visibility,
      sources,
      driven,
      expressions,
      derived: {
        [names.z]: {
          hex: toHex(zBits, width),
          popcount: popcountZ(zBits),
          truthCounts: truthCounts(aBits, bBits, width),
        },
      },
    };
  }

  const focusedLane = doc.lanes[doc.view.lane] ? doc.view.lane : (laneKeys[0] ?? doc.view.lane);
  const focusedFrame: FrameKey = doc.lanes[focusedLane]?.focus ?? "a";
  const focusedState = lanes[focusedLane];
  const focusedOperand: "a" | "b" | null = focusedFrame === "z" ? null : focusedFrame;
  const focusedName = focusedOperand !== null ? frameName(focusedLane, focusedOperand) : null;
  const focusedExpression = focusedName !== null
    ? focusedState.expressions[focusedName] !== null
    : false;
  const enabled = focusedOperand !== null
    && focusedName !== null
    && !focusedState.driven[focusedName]
    && !focusedExpression;

  const mode: ViewMode = doc.view.split3d ? "split" : doc.view.view3d ? "3d" : "2d";

  let dataset: UiState["dataset"] = null;
  if (doc.dataset && doc.dataset.rows.length > 0) {
    const index = Number.isInteger(doc.dataset.index)
      ? Math.max(0, Math.min(doc.dataset.rows.length - 1, doc.dataset.index as number))
      : 0;
    dataset = {
      columns: doc.dataset.cols.slice(),
      rows: doc.dataset.rows.length,
      index,
      row: doc.dataset.rows[index].slice(),
    };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    ready: options.ready !== false,
    width,
    lane: Number(focusedLane),
    frame: frameName(focusedLane, focusedFrame),
    view: {
      mode,
      splitPair: [Number(doc.view.splitPair[0]), Number(doc.view.splitPair[1])],
      activePane: doc.view.activePane === 1 ? 1 : 0,
    },
    lanes,
    lfo: {
      on: options.lfoOn === true,
      mode: doc.view.lfoMode ?? "rotcw",
      rate: doc.view.lfoRate ?? 4,
    },
    dataset,
    editing: {
      copyArmed: options.copyArmed === true,
      enabled,
    },
    recording: {
      on: options.recording?.on === true,
      rows: options.recording?.rows ?? 0,
    },
    deeplink: options.deeplink ?? "",
    bridge: { schemaVersion: SCHEMA_VERSION, version: TOOLSET_VERSION },
  };
}
