/**
 * App <-> `.bitwave` bridge (F5).
 *
 * The core owns the document schema (`src/core/project.ts`); this module maps
 * the app's live tree (`S`, the routing singleton, `DEMO`) to and from a
 * `ProjectDoc`. It is DOM-free so the round trip is testable in Node and the
 * desktop shell can reuse it.
 *
 * Unknown top-level fields from a loaded document are remembered and merged
 * back on the next capture, so a file written by a newer build survives a
 * load/save cycle in this one.
 */

import {
  ProjectError,
  deserializeProject,
  serializeProject,
  type ProjectDoc,
  type ProjectExtras,
  type ProjectViewState,
} from "../core/project.ts";
import type { FrameKey, LaneKey } from "../core/types.ts";
import { DEMO } from "./dataset.ts";
import { makeReg, S, SIZES, SLOT_KEYS, syncTarget, type SlotKey } from "./instrument.ts";
import { coreLanes, evaluate, routing } from "./routing.ts";

const SLOT_OF: Record<LaneKey, SlotKey> = { "1": "A", "2": "B", "3": "C" };
const LANE_OF: Record<SlotKey, LaneKey> = { A: "1", B: "2", C: "3" };

const KNOWN_TOP_LEVEL = new Set([
  "schema", "app", "savedAt", "N", "view", "lanes", "routes", "parked", "dataset",
]);

let unknownFields: Record<string, unknown> = {};

/** Keep top-level fields this build does not understand, for the next save. */
export function rememberUnknownFields(raw: unknown): void {
  unknownFields = {};
  if (typeof raw !== "object" || raw === null) return;
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_TOP_LEVEL.has(key)) unknownFields[key] = value;
  }
}

/** Snapshot the live instrument as a versioned project document. */
export function captureProject(now = new Date().toISOString()): ProjectDoc {
  const view: ProjectViewState = {
    lane: LANE_OF[S.slot],
    view3d: S.view3d,
    split3d: S.split3d,
    splitPair: [LANE_OF[S.splitPair[0]], LANE_OF[S.splitPair[1]]],
    activePane: S.activePane === 1 ? 1 : 0,
  };

  const focus: NonNullable<ProjectExtras["focus"]> = {};
  const frameVis: NonNullable<ProjectExtras["frameVis"]> = {};
  const expressions: NonNullable<ProjectExtras["expressions"]> = {};
  for (const key of SLOT_KEYS) {
    const lane = LANE_OF[key];
    const sl = S.slots[key];
    focus[lane] = sl.focus;
    frameVis[lane] = { ...sl.frameVis };
    const expr: { a?: string; b?: string } = {};
    if (sl.expressions.a.trim() !== "") expr.a = sl.expressions.a;
    if (sl.expressions.b.trim() !== "") expr.b = sl.expressions.b;
    if (Object.keys(expr).length > 0) expressions[lane] = expr;
  }

  const dataset = DEMO.rows.length
    ? {
        cols: DEMO.cols.slice(),
        rows: DEMO.rows.map((row) => row.slice()),
        index: DEMO.i,
      }
    : null;

  const doc = serializeProject(coreLanes(), routing, S.N, view, dataset, now, {
    focus,
    frameVis,
    lfoMode: S.lfo.mode,
    lfoRate: S.lfo.rate,
    expressions,
  });
  return { ...unknownFields, ...doc } as ProjectDoc;
}

export interface ApplyResult {
  ok: boolean;
  /** Present when `ok` is false. */
  code?: ProjectError["code"];
  message?: string;
  /** True when the document carried a dataset. */
  dataset: boolean;
}

function clampIndex(value: unknown, length: number): number {
  if (length === 0) return 0;
  const n = typeof value === "number" && Number.isInteger(value) ? value : 0;
  return Math.max(0, Math.min(length - 1, n));
}

/**
 * Materialize a project document into the live tree. Mutates only state (no
 * DOM); the caller re-renders and runs one transaction notification.
 */
export function applyProject(raw: unknown): ApplyResult {
  /* The core accepts any multiple of 8; the instrument's width slider only
     offers SIZES. Reject a document the UI could not represent. */
  const rawN = typeof raw === "object" && raw !== null ? (raw as { N?: unknown }).N : undefined;
  if (typeof rawN === "number" && !(SIZES as readonly number[]).includes(rawN)) {
    return {
      ok: false,
      code: "malformed",
      message: `unsupported register width ${rawN}; this build offers ${SIZES.join("/")} bits`,
      dataset: false,
    };
  }

  let loaded: ReturnType<typeof deserializeProject>;
  try {
    loaded = deserializeProject(raw);
  } catch (error) {
    if (error instanceof ProjectError) {
      return { ok: false, code: error.code, message: error.message, dataset: false };
    }
    return { ok: false, code: "malformed", message: String(error), dataset: false };
  }

  const { lanes, routing: loadedRouting, N, view, dataset, extras } = loaded;
  S.N = N;

  for (const laneKey of ["1", "2", "3"] as LaneKey[]) {
    const sl = S.slots[SLOT_OF[laneKey]];
    const src = lanes[laneKey];
    sl.A = makeReg(N);
    sl.B = makeReg(N);
    sl.Z = makeReg(N);
    sl.A.bits.set(src.A.bits);
    sl.B.bits.set(src.B.bits);
    sl.showB = src.showB;
    sl.binop = src.binop;
    sl.edit = src.edit;
    sl.seededB = src.seededB;
    sl.lfoB = src.lfoB;
    sl.colA = src.colA;
    sl.colB = src.colB;
    sl.focus = (extras.focus[laneKey] ?? "a") as FrameKey;
    sl.frameVis = { ...extras.frameVis[laneKey] };
    sl.expressions = {
      a: extras.expressions[laneKey]?.a ?? "",
      b: extras.expressions[laneKey]?.b ?? "",
    };
    syncTarget(sl.A, true);
    syncTarget(sl.B, true);
  }

  routing.routes = loadedRouting.routes;
  routing.parked = loadedRouting.parked;

  S.slot = SLOT_OF[view.lane];
  S.view3d = view.view3d;
  S.split3d = view.split3d;
  S.splitPair = [SLOT_OF[view.splitPair[0]], SLOT_OF[view.splitPair[1]]];
  S.activePane = view.activePane === 1 ? 1 : 0;

  /* Transient interaction state never comes from a document. */
  S.copyArmed = false;
  S.drag = -1;
  S.hoverReg = null;
  S.hoverJ = -1;
  S.lfo = { on: false, mode: extras.lfoMode, rate: extras.lfoRate, t: 0, base: null };
  S.lfoAcc = 0;
  S.record = { on: false, rows: [], nextStep: 1 };

  if (dataset) {
    DEMO.cols = dataset.cols.slice();
    DEMO.rows = dataset.rows.map((row) => row.slice());
    DEMO.i = clampIndex(dataset.index, DEMO.rows.length);
  } else {
    DEMO.cols = [];
    DEMO.rows = [];
    DEMO.i = 0;
  }

  evaluate(true);
  return { ok: true, dataset: Boolean(dataset) };
}
