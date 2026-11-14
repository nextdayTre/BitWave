/**
 * The `.bitwave` project document — the carryable, versioned non-HTML file.
 *
 * Registers persist as hex strings (A and B only: Z is derived and must never
 * be stored — DESIGN §10.8). Routes and their parked pre-patch bases persist so
 * that a saved patch board behaves identically after a reload. Unknown fields
 * are preserved by callers that hold the raw document; a newer schema is
 * rejected with a distinct code so the UI can offer a read-only path.
 *
 * Schema history (D33 / D40 / D44):
 *   1  closed three-lane object: operands, operator, routes, parked bases
 *   2  additive: per-lane focus/frameVis, LFO mode/rate, dataset cursor
 *   3  additive: per-operand expression sources (`lanes.<key>.expressions`)
 *   4  **dynamic lanes**: `lanes` is keyed by the stable lane key string
 *      (`"1"`..`"13"`, D43), gaps allowed, 1..APP_LANE_CAP (8) lanes. A schema
 *      1/2/3 document is the closed three-lane object and upgrades on read; a
 *      schema-4 document is saved in ascending lane-key order.
 *
 * Fields added after schema 1 are validated leniently: an invalid or missing
 * value falls back to its default instead of rejecting the document. A document
 * saved without extras keeps the minimal shape (no focus/frameVis/expressions
 * present), which is what makes a schema-1 document round-trip unchanged.
 *
 * This module is pure: serialization/deserialization never touches the DOM.
 */

import type {
  BinOp,
  DestinationPort,
  FrameKey,
  MixOp,
  OperandKey,
  Route,
  LaneKey,
  LaneMap,
  SourcePort,
} from "./types.ts";
import { LANE_KEYS } from "./types.ts";
import { APP_LANE_CAP, compareLaneKeys, laneIndex } from "./lanedefs.ts";
import { fromHex, toHex } from "./registers.ts";
import { makeLane } from "./lanes.ts";
import { evaluateAll, createRouting, type RoutingState } from "./routing.ts";
import { EXPRESSION_LIMITS } from "./expression.ts";
import type { Dataset } from "./csv.ts";

export const PROJECT_SCHEMA = 4;
export const PROJECT_APP = "bitwave";

export class ProjectError extends Error {
  readonly code: "malformed" | "newer-schema" | "unsupported-app";
  constructor(code: ProjectError["code"], message: string) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
  }
}

export interface ProjectRoute {
  /** "C.z" */
  from: string;
  /** "A.a" */
  to: string;
  mix: MixOp;
}

/** Per-lane 2-D frame visibility (schema 2). */
type FrameVisibility = { a: boolean; b: boolean; z: boolean };

/** Per-operand expression sources (schema 3). Empty/absent = not an expression. */
interface LaneExpressions {
  a?: string;
  b?: string;
}

export interface ProjectLane {
  a: string;
  b: string;
  showB: boolean;
  binop: BinOp;
  edit: OperandKey;
  seededB: boolean;
  lfoB: string;
  colA: number;
  colB: number;
  /** Schema 2: the frame this lane's strip/readouts show (the focus lens). */
  focus?: FrameKey;
  /** Schema 2: per-lane 2-D frame visibility (eye toggles). */
  frameVis?: FrameVisibility;
  /** Schema 3: expression source per operand (`A`/`B` of this lane). */
  expressions?: LaneExpressions;
}

export interface ProjectViewState {
  lane: LaneKey;
  view3d: boolean;
  split3d: boolean;
  splitPair: [LaneKey, LaneKey];
  activePane: 0 | 1;
  /** Schema 2: LFO motion mode ("rotcw", "rotccw", "slide", "csvStep"). */
  lfoMode?: string;
  /** Schema 2: LFO rate in steps per second. */
  lfoRate?: number;
}

/**
 * The schema-2/3 additive fields the serializer cannot read from the engine
 * state (focus, visibility and LFO live in the app's view state, not in
 * `LaneMap`/routing). Everything is optional; a caller that omits `extras`
 * writes the minimal per-lane shape.
 */
export interface ProjectExtras {
  focus?: Partial<Record<LaneKey, FrameKey>>;
  frameVis?: Partial<Record<LaneKey, { a: boolean; b: boolean; z: boolean }>>;
  lfoMode?: string;
  lfoRate?: number;
  /** Schema 3: expression sources per lane/operand. */
  expressions?: Partial<Record<LaneKey, LaneExpressions>>;
}

/**
 * The `.bitwave` document. `lanes` is keyed by the stable lane key string:
 * schema 1-3 carries exactly the shipped three (`"1"`,`"2"`,`"3"`); schema 4
 * may carry any subset of `"1"`..`"13"` (gaps allowed) up to `APP_LANE_CAP`.
 */
export interface ProjectDoc {
  schema: number;
  app: typeof PROJECT_APP;
  savedAt: string;
  N: number;
  view: ProjectViewState;
  lanes: Record<LaneKey, ProjectLane>;
  routes: ProjectRoute[];
  /** Destination port key ("1:a") -> pre-patch bits as hex. */
  parked: Record<string, string>;
  dataset?: Dataset;
}

const BINOPS: readonly BinOp[] = ["and", "or", "xor", "add", "sub"];
const MIXES: readonly MixOp[] = ["set", "add", "xor"];

/** Schema-2 defaults, used whenever a document omits (or corrupts) a new field. */
const DEFAULT_FOCUS: FrameKey = "a";
const LFO_DEFAULT_MODE = "rotcw";
const LFO_DEFAULT_RATE = 4;
/** The modes the instrument's motion control offers; anything else is ignored. */
const LFO_MODES: readonly string[] = ["rotcw", "rotccw", "slide", "csvStep"];

/*
 * Schema-2 fields are validated leniently: an invalid or missing value falls
 * back to its default instead of rejecting the document. Same spirit as `edit`
 * and `lfoB` above — a new field must never make a loadable project unloadable.
 */
function lenientFocus(value: unknown): FrameKey {
  return value === "a" || value === "b" || value === "z" ? value : DEFAULT_FOCUS;
}

function lenientFrameVis(value: unknown): FrameVisibility {
  const raw = typeof value === "object" && value !== null ? (value as Partial<FrameVisibility>) : {};
  // Only an explicit `false` hides a frame; a missing or odd value keeps it visible.
  return { a: raw.a !== false, b: raw.b !== false, z: raw.z !== false };
}

function lenientLfoMode(value: unknown): string {
  return typeof value === "string" && LFO_MODES.includes(value) ? value : LFO_DEFAULT_MODE;
}

function lenientLfoRate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : LFO_DEFAULT_RATE;
}

/** Schema-3 expression sources: strings only, trimmed, bounded; invalid values drop. */
function lenientExpressions(value: unknown): LaneExpressions {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Partial<LaneExpressions>;
  const out: LaneExpressions = {};
  for (const frame of ["a", "b"] as const) {
    const text = raw[frame];
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed === "" || trimmed.length > EXPRESSION_LIMITS.source) continue;
    out[frame] = trimmed;
  }
  return out;
}

/**
 * The `dataset` field. Schema 2 adds `index` (the CSV cursor). A valid
 * non-negative integer is kept; a missing/malformed one is OMITTED rather than
 * zeroed, so a schema-1 document round-trips unchanged and callers can keep
 * treating "no index" as cursor 0.
 */
function lenientDataset(value: unknown): Dataset | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<Dataset>;
  if (!Array.isArray(raw.cols) || !Array.isArray(raw.rows)) return null;
  const dataset: Dataset = { cols: raw.cols, rows: raw.rows };
  if (typeof raw.index === "number" && Number.isInteger(raw.index) && raw.index >= 0) {
    dataset.index = raw.index;
  }
  return dataset;
}

export const portString = (lane: LaneKey, frame: FrameKey): string => `${lane}.${frame}`;

/**
 * The stable lane keys a document may carry, in canonical (ascending numeric)
 * order. A lane map may have gaps but never duplicates (object keys) and never
 * more than `APP_LANE_CAP` lanes; keys outside `"1"`..`"13"` are malformed.
 */
function requireLaneKeys(value: unknown): LaneKey[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectError("malformed", "missing lanes");
  }
  const keys = Object.keys(value).sort(compareLaneKeys);
  if (keys.length === 0) throw new ProjectError("malformed", "a document must hold at least one lane");
  for (const key of keys) {
    if (laneIndex(key) < 0) {
      throw new ProjectError("malformed", `invalid lane key ${JSON.stringify(key)} (expected "1".."13")`);
    }
  }
  if (keys.length > APP_LANE_CAP) {
    throw new ProjectError(
      "malformed",
      `a document may hold at most ${APP_LANE_CAP} lanes; got ${keys.length}`,
    );
  }
  return keys;
}

export function parsePort(text: string, allowZ: boolean): { lane: LaneKey; frame: FrameKey } {
  const m = /^(?:[1-9]|1[0-3])\.([abz])$/.exec(text);
  if (!m) throw new ProjectError("malformed", `bad port reference: ${JSON.stringify(text)}`);
  const lane = text.slice(0, text.indexOf(".")) as LaneKey;
  const frame = m[1] as FrameKey;
  if (!allowZ && frame === "z") {
    throw new ProjectError("malformed", `Z cannot be a destination: ${text}`);
  }
  return { lane, frame };
}

export function serializeProject(
  lanes: LaneMap,
  routing: RoutingState,
  N: number,
  view: ProjectViewState,
  dataset: Dataset | null = null,
  now: string = new Date().toISOString(),
  extras: ProjectExtras = {},
): ProjectDoc {
  const laneKeys = Object.keys(lanes).sort(compareLaneKeys);
  if (laneKeys.length === 0) throw new ProjectError("malformed", "a document must hold at least one lane");
  if (laneKeys.length > APP_LANE_CAP) {
    throw new ProjectError(
      "malformed",
      `a document may hold at most ${APP_LANE_CAP} lanes; got ${laneKeys.length}`,
    );
  }
  const laneDocs = {} as Record<LaneKey, ProjectLane>;
  for (const key of laneKeys) {
    if (laneIndex(key) < 0) {
      throw new ProjectError("malformed", `invalid lane key ${JSON.stringify(key)} (expected "1".."13")`);
    }
    const lane = lanes[key];
    if (!lane) throw new ProjectError("malformed", `missing lane ${key}`);
    const laneDoc: ProjectLane = {
      a: toHex(lane.A.bits, N),
      b: toHex(lane.B.bits, N),
      showB: lane.showB,
      binop: lane.binop,
      edit: lane.edit,
      seededB: lane.seededB,
      lfoB: lane.lfoB,
      colA: lane.colA,
      colB: lane.colB,
    };
    // Schema 2/3 fields are written only when the caller supplied them, so a
    // save without extras keeps the minimal shape.
    const focus = extras.focus?.[key];
    if (focus !== undefined) laneDoc.focus = focus;
    const frameVis = extras.frameVis?.[key];
    if (frameVis !== undefined) laneDoc.frameVis = { ...frameVis };
    const expressions = extras.expressions?.[key];
    if (expressions !== undefined) {
      const clean: LaneExpressions = {};
      if (typeof expressions.a === "string" && expressions.a.trim() !== "") clean.a = expressions.a;
      if (typeof expressions.b === "string" && expressions.b.trim() !== "") clean.b = expressions.b;
      if (Object.keys(clean).length > 0) laneDoc.expressions = clean;
    }
    laneDocs[key] = laneDoc;
  }

  const parked: Record<string, string> = {};
  for (const [key, bits] of routing.parked) {
    const [lane, frame] = key.split(":");
    parked[portString(lane as LaneKey, frame as FrameKey)] = toHex(bits, N);
  }

  const viewDoc: ProjectViewState = {
    lane: view.lane,
    view3d: view.view3d,
    split3d: view.split3d,
    splitPair: view.splitPair,
    activePane: view.activePane,
  };
  // LFO settings ride on the view in schema 2. Extras win over a view that
  // already carries them (e.g. a loaded document echoed back).
  const lfoMode = extras.lfoMode ?? view.lfoMode;
  const lfoRate = extras.lfoRate ?? view.lfoRate;
  if (lfoMode !== undefined) viewDoc.lfoMode = lfoMode;
  if (lfoRate !== undefined) viewDoc.lfoRate = lfoRate;

  const doc: ProjectDoc = {
    schema: PROJECT_SCHEMA,
    app: PROJECT_APP,
    savedAt: now,
    N,
    view: viewDoc,
    lanes: laneDocs,
    routes: routing.routes.map((r) => ({
      from: portString(r.from.lane, r.from.frame),
      to: portString(r.to.lane, r.to.frame),
      mix: r.mix,
    })),
    parked,
  };
  if (dataset) doc.dataset = dataset; // exactly as given: a valid `index` rides along
  return doc;
}

function requireHex(value: unknown, N: number, where: string): Uint8Array {
  if (typeof value !== "string") throw new ProjectError("malformed", `${where} must be a hex string`);
  try {
    return fromHex(value, N);
  } catch {
    throw new ProjectError("malformed", `${where} is not hexadecimal: ${JSON.stringify(value)}`);
  }
}

function requireBool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") throw new ProjectError("malformed", `${where} must be a boolean`);
  return value;
}

function requireIndex(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ProjectError("malformed", `${where} must be an integer`);
  }
  return value;
}

/**
 * Validate and materialize a document. Recomputes Z and delay flags for every
 * lane the document carries, so the returned engine state is immediately
 * consistent. Throws ProjectError.
 *
 * A schema 1/2/3 document is the closed three-lane object and upgrades on read;
 * schema 4 is a lane map keyed by the stable lane key (`"1"`..`"13"`, gaps
 * allowed, at most `APP_LANE_CAP` lanes). `extras` is always fully populated for
 * the lanes present: older documents (or corrupt additive fields) load with the
 * additive defaults, and the schema-1 fields keep their existing strict
 * validation.
 */
export function deserializeProject(doc: unknown): {
  lanes: LaneMap;
  routing: RoutingState;
  N: number;
  view: ProjectViewState;
  dataset: Dataset | null;
  extras: {
    focus: Record<LaneKey, FrameKey>;
    frameVis: Record<LaneKey, FrameVisibility>;
    lfoMode: string;
    lfoRate: number;
    expressions: Record<LaneKey, LaneExpressions>;
  };
} {
  if (typeof doc !== "object" || doc === null) {
    throw new ProjectError("malformed", "project must be an object");
  }
  const d = doc as Partial<ProjectDoc>;
  if (d.app !== PROJECT_APP) throw new ProjectError("unsupported-app", `not a BitWave project`);
  if (typeof d.schema !== "number") throw new ProjectError("malformed", "missing schema version");
  if (d.schema > PROJECT_SCHEMA) {
    throw new ProjectError(
      "newer-schema",
      `project schema ${d.schema} is newer than supported ${PROJECT_SCHEMA}; open it read-only`,
    );
  }

  const N = requireIndex(d.N, "N");
  if (!(N >= 8 && N <= 256 && N % 8 === 0)) throw new ProjectError("malformed", `unsupported width: ${N}`);

  const laneKeys = requireLaneKeys(d.lanes);
  /* Schema 1-3 is the closed three-lane object; schema 4 may hold any subset. */
  if (d.schema < 4) {
    const closed = laneKeys.length === LANE_KEYS.length && LANE_KEYS.every((key, i) => laneKeys[i] === key);
    if (!closed) {
      throw new ProjectError("malformed", `schema ${d.schema} document must carry lanes ${LANE_KEYS.join(", ")}`);
    }
  }
  const lanes = {} as LaneMap;
  const focus = {} as Record<LaneKey, FrameKey>;
  const frameVis = {} as Record<LaneKey, FrameVisibility>;
  const expressions = {} as Record<LaneKey, LaneExpressions>;
  for (const key of laneKeys) {
    const s = (d.lanes as Record<string, Partial<ProjectLane>>)[key];
    if (typeof s !== "object" || s === null) throw new ProjectError("malformed", `lane ${key} must be an object`);
    const lane = makeLane(key, N);
    lane.A.bits = requireHex(s.a, N, `lanes.${key}.a`);
    lane.B.bits = requireHex(s.b, N, `lanes.${key}.b`);
    lane.showB = requireBool(s.showB, `lanes.${key}.showB`);
    if (!BINOPS.includes(s.binop as BinOp)) throw new ProjectError("malformed", `lanes.${key}.binop`);
    lane.binop = s.binop as BinOp;
    lane.edit = s.edit === "b" ? "b" : "a";
    lane.seededB = s.seededB === true;
    lane.lfoB = typeof s.lfoB === "string" ? s.lfoB : "0";
    lane.colA = requireIndex(s.colA, `lanes.${key}.colA`);
    lane.colB = requireIndex(s.colB, `lanes.${key}.colB`);
    lanes[key] = lane;
    focus[key] = lenientFocus(s.focus);
    frameVis[key] = lenientFrameVis(s.frameVis);
    expressions[key] = lenientExpressions(s.expressions);
  }

  const routing = createRouting();
  const rawRoutes = Array.isArray(d.routes) ? d.routes : [];
  for (const raw of rawRoutes) {
    const r = raw as Partial<ProjectRoute>;
    if (typeof r.from !== "string" || typeof r.to !== "string") {
      throw new ProjectError("malformed", "route must have from/to port strings");
    }
    const from = parsePort(r.from, true);
    const to = parsePort(r.to, false);
    if (!lanes[from.lane]) throw new ProjectError("malformed", `route source lane ${from.lane} is not in the document`);
    if (!lanes[to.lane]) throw new ProjectError("malformed", `route destination lane ${to.lane} is not in the document`);
    const mix: MixOp = MIXES.includes(r.mix as MixOp) ? (r.mix as MixOp) : "set";
    const route: Route = {
      id: `${from.lane}.${from.frame}>${to.lane}.${to.frame}`,
      from: { lane: from.lane, frame: from.frame } as SourcePort,
      to: { lane: to.lane, frame: to.frame } as DestinationPort,
      delay: false,
      mix,
    };
    if (routing.routes.some((x) => x.to.lane === route.to.lane && x.to.frame === route.to.frame)) {
      throw new ProjectError("malformed", `two routes drive ${r.to}`);
    }
    routing.routes.push(route);
  }

  for (const [key, value] of Object.entries(d.parked ?? {})) {
    const port = parsePort(key, false);
    if (!lanes[port.lane]) throw new ProjectError("malformed", `parked base lane ${port.lane} is not in the document`);
    if (!routing.routes.some((r) => r.to.lane === port.lane && r.to.frame === port.frame)) {
      throw new ProjectError("malformed", `parked base for an unpatched input: ${key}`);
    }
    routing.parked.set(`${port.lane}:${port.frame}`, requireHex(value, N, `parked.${key}`));
  }

  const firstLane = laneKeys[0];
  const secondLane = laneKeys[1] ?? firstLane;
  const pairEntries = d.view?.splitPair;
  const splitPair: [LaneKey, LaneKey] =
    Array.isArray(pairEntries) &&
    pairEntries.length === 2 &&
    laneKeys.includes(pairEntries[0]) &&
    laneKeys.includes(pairEntries[1])
      ? [pairEntries[0], pairEntries[1]]
      : [firstLane, secondLane];
  const view: ProjectViewState = {
    lane: d.view && laneKeys.includes(d.view.lane) ? d.view.lane : firstLane,
    view3d: d.view?.view3d === true,
    split3d: d.view?.split3d === true,
    splitPair,
    activePane: d.view?.activePane === 1 ? 1 : 0,
  };

  evaluateAll(routing, lanes, N);
  const dataset = lenientDataset(d.dataset);
  /** Schema-2/3 view fields are additive; an older document simply has none. */
  const lfoMode = lenientLfoMode(d.view?.lfoMode);
  const lfoRate = lenientLfoRate(d.view?.lfoRate);
  return { lanes, routing, N, view, dataset, extras: { focus, frameVis, lfoMode, lfoRate, expressions } };
}

/** Convenience: JSON text -> engine state. */
export const parseProject = (text: string) => deserializeProject(JSON.parse(text));

/** Convenience: engine state -> pretty JSON text. */
export const stringifyProject = (doc: ProjectDoc): string => JSON.stringify(doc, null, 2);
