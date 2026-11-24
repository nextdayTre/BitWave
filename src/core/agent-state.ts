/**
 * UI-state builder shared by the browser bridge and the headless transports.
 *
 * Pure: takes a `.bitwave` schema 1-5 document plus the few transient UI values
 * and returns the exact object `window.bitwave.getState()` and `#bitwave-state`
 * expose. Derived values are recomputed from the shared core, never scraped
 * from the DOM.
 */

import {
  SCHEMA_VERSION,
  TOOLSET_VERSION,
  frameName,
  freeFrameKeyFromName,
  freeFrameName,
  type ViewMode,
} from "./agent-defaults.ts";
import { computeZ, popcountZ, truthCounts } from "./derive.ts";
import { fromHex, toHex } from "./registers.ts";
import type { ProjectDoc } from "./project.ts";
import type { BinOp, FrameKey, FreeFrameKey, LaneKey } from "./types.ts";

export interface UiSource {
  kind: "data" | "frame" | "none";
  column?: string;
  index?: number;
  /** "1:1" or "z⁻¹" for a routed frame source. */
  source?: string;
  lane?: number;
  free?: string;
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
  /** D53: per-operand expression failure, keyed by global frame name (`A`, `C`, …). */
  expressionErrors: Record<string, string | null>;
  derived: Record<string, { hex: string; popcount: number; truthCounts: number[] }>;
}

export interface UiFreeFrameState {
  key: string;
  frame: string;
  hex: string;
  popcount: number;
  visible: boolean;
  label: string | null;
  sourceNote: string | null;
  source: UiSource;
  driven: boolean;
  expression: string | null;
  /**
   * D53: why the last clocked pass could not evaluate `expression`, or null when
   * it evaluated (or there is none). A non-null value means `hex` is the last
   * settled value and is frozen — it is not a function of the current frames.
   */
  expressionError: string | null;
}

export interface UiState {
  schemaVersion: number;
  ready: boolean;
  width: number;
  lane: number;
  frame: string;
  activeFree: string | null;
  view: { mode: ViewMode; splitPair: [number, number]; activePane: number };
  lanes: Record<string, UiLaneState>;
  freeFrames: Record<string, UiFreeFrameState>;
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
  /** D53: clocked-pass expression failures, keyed by global frame name. */
  expressionErrors?: Readonly<Record<string, string>>;
}

type RouteSource =
  | { kind: "lane"; fromLane: LaneKey; fromFrame: FrameKey }
  | { kind: "free"; fromFree: FreeFrameKey };

function parseRouteSource(from: string): RouteSource | null {
  const freeKey = freeFrameKeyFromName(from);
  if (freeKey !== null) return { kind: "free", fromFree: freeKey };
  const [fromLane, fromFrame] = from.split(".");
  if (fromFrame === "a" || fromFrame === "b" || fromFrame === "z") {
    return { kind: "lane", fromLane: fromLane as LaneKey, fromFrame };
  }
  return null;
}

function routeIntoPort(doc: ProjectDoc, toPort: string): RouteSource | null {
  for (const route of doc.routes) {
    if (route.to !== toPort) continue;
    return parseRouteSource(route.from);
  }
  return null;
}

function sourceFromRoute(
  doc: ProjectDoc,
  column: number,
  route: RouteSource | null,
  destLane: LaneKey | null,
): UiSource {
  if (column >= 0 && doc.dataset && doc.dataset.cols[column] !== undefined) {
    return { kind: "data", column: doc.dataset.cols[column], index: column };
  }
  if (route) {
    if (route.kind === "free") {
      return {
        kind: "frame",
        source: "1:1",
        free: route.fromFree,
        frame: freeFrameName(route.fromFree),
      };
    }
    return {
      kind: "frame",
      source: destLane !== null && route.fromLane === destLane ? "z⁻¹" : "1:1",
      lane: Number(route.fromLane),
      frame: frameName(route.fromLane, route.fromFrame),
    };
  }
  return { kind: "none" };
}

export function buildUiState(doc: ProjectDoc, options: UiStateOptions = {}): UiState {
  const width = doc.N;
  /* D53: the clocked-pass errors, keyed by global frame name. Omitted by pure
     document consumers (CLI `state --project`), which never re-evaluate
     expressions and therefore report null everywhere. */
  const errors = options.expressionErrors ?? {};
  const errorOf = (name: string): string | null => errors[name] ?? null;
  const lanes: Record<string, UiLaneState> = {};

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

    const routeA = routeIntoPort(doc, `${lane}.a`);
    const routeB = routeIntoPort(doc, `${lane}.b`);
    const sources: Record<string, UiSource> = {
      [names.a]: sourceFromRoute(doc, laneDoc.colA, routeA, lane),
      [names.b]: sourceFromRoute(doc, laneDoc.colB, routeB, lane),
    };
    const driven: Record<string, boolean> = {
      [names.a]: routeA !== null,
      [names.b]: routeB !== null,
    };
    const expressions: Record<string, string | null> = {
      [names.a]: laneDoc.expressions?.a ?? null,
      [names.b]: laneDoc.expressions?.b ?? null,
    };
    /* D53: an expression that failed this pass leaves the operand at its last
       settled bits; the error is the only signal that the value is frozen. */
    const expressionErrors: Record<string, string | null> = {
      [names.a]: errorOf(names.a),
      [names.b]: errorOf(names.b),
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
      expressionErrors,
      derived: {
        [names.z]: {
          hex: toHex(zBits, width),
          popcount: popcountZ(zBits),
          truthCounts: truthCounts(aBits, bBits, width),
        },
      },
    };
  }

  const freeFrames: Record<string, UiFreeFrameState> = {};
  const freeKeys = doc.frames ? Object.keys(doc.frames).sort((a, b) => Number(a) - Number(b)) : [];
  for (const key of freeKeys) {
    const ffDoc = doc.frames![key];
    const name = freeFrameName(key);
    const bits = fromHex(ffDoc.hex, width);
    const route = routeIntoPort(doc, name);
    const col = typeof ffDoc.col === "number" ? ffDoc.col : -1;
    const expr = typeof ffDoc.expression === "string" && ffDoc.expression.trim() !== ""
      ? ffDoc.expression.trim()
      : null;
    freeFrames[name] = {
      key,
      frame: name,
      hex: toHex(bits, width),
      popcount: popcountZ(bits),
      visible: ffDoc.visible !== false,
      label: typeof ffDoc.label === "string" && ffDoc.label !== "" ? ffDoc.label : null,
      sourceNote: typeof ffDoc.sourceNote === "string" && ffDoc.sourceNote !== "" ? ffDoc.sourceNote : null,
      source: sourceFromRoute(doc, col, route, null),
      driven: route !== null,
      expression: expr,
      expressionError: errorOf(name),
    };
  }

  const focusedLane = doc.lanes[doc.view.lane] ? doc.view.lane : (laneKeys[0] ?? doc.view.lane);
  const focusedFrame: FrameKey = doc.lanes[focusedLane]?.focus ?? "a";
  const activeFreeKey =
    typeof doc.view.activeFree === "string" && doc.frames?.[doc.view.activeFree]
      ? doc.view.activeFree
      : null;
  const activeFree = activeFreeKey ? freeFrameName(activeFreeKey) : null;

  let enabled: boolean;
  let frameOut: string;
  if (activeFree && freeFrames[activeFree]) {
    frameOut = activeFree;
    const fs = freeFrames[activeFree];
    enabled = !fs.driven && fs.expression === null;
  } else {
    frameOut = frameName(focusedLane, focusedFrame);
    const focusedState = lanes[focusedLane];
    const focusedOperand: "a" | "b" | null = focusedFrame === "z" ? null : focusedFrame;
    const focusedName = focusedOperand !== null ? frameName(focusedLane, focusedOperand) : null;
    const focusedExpression = focusedName !== null
      ? focusedState.expressions[focusedName] !== null
      : false;
    enabled = focusedOperand !== null
      && focusedName !== null
      && !focusedState.driven[focusedName]
      && !focusedExpression;
  }

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
    frame: frameOut,
    activeFree,
    view: {
      mode,
      splitPair: [Number(doc.view.splitPair[0]), Number(doc.view.splitPair[1])],
      activePane: doc.view.activePane === 1 ? 1 : 0,
    },
    lanes,
    freeFrames,
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
