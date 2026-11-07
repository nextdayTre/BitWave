/**
 * The `.bitwave` project document — the carryable, versioned non-HTML file.
 *
 * Registers persist as hex strings (A and B only: Z is derived and must never
 * be stored — DESIGN §10.8). Routes and their parked pre-patch bases persist so
 * that a saved patch board behaves identically after a reload. Unknown fields
 * are preserved by callers that hold the raw document; a newer schema is
 * rejected with a distinct code so the UI can offer a read-only path.
 *
 * Schema 2 is additive: per-lane focus and frame visibility, LFO mode/rate and
 * a dataset cursor. Every new field is optional, so schema-1 documents still
 * load (with the v2 defaults) and a document saved without extras keeps the
 * schema-1 shape.
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
import { fromHex, toHex } from "./registers.ts";
import { makeBootLanes } from "./lanes.ts";
import { evaluateAll, markDelays, createRouting, type RoutingState } from "./routing.ts";
import type { Dataset } from "./csv.ts";

export const PROJECT_SCHEMA = 2;
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
 * Schema-2 fields the serializer cannot read from the engine state (focus,
 * visibility and LFO live in the app's view state, not in `LaneMap`/routing).
 * Everything is optional; a caller that omits `extras` writes schema 1.
 */
export interface ProjectExtras {
  focus?: Partial<Record<LaneKey, FrameKey>>;
  frameVis?: Partial<Record<LaneKey, { a: boolean; b: boolean; z: boolean }>>;
  lfoMode?: string;
  lfoRate?: number;
}

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

export function parsePort(text: string, allowZ: boolean): { lane: LaneKey; frame: FrameKey } {
  const m = /^([123])\.([abz])$/.exec(text);
  if (!m) throw new ProjectError("malformed", `bad port reference: ${JSON.stringify(text)}`);
  const lane = m[1] as LaneKey;
  const frame = m[2] as FrameKey;
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
  const laneDocs = {} as Record<LaneKey, ProjectLane>;
  for (const key of LANE_KEYS) {
    const lane = lanes[key];
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
    // Schema 2: write the new fields only when the caller supplied them, so a
    // save without extras keeps the schema-1 shape.
    const focus = extras.focus?.[key];
    if (focus !== undefined) laneDoc.focus = focus;
    const frameVis = extras.frameVis?.[key];
    if (frameVis !== undefined) laneDoc.frameVis = { ...frameVis };
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
 * Validate and materialize a document. Recomputes Z and delay flags, so the
 * returned engine state is immediately consistent. Throws ProjectError.
 *
 * `extras` is always fully populated: schema-1 documents (or corrupt additive
 * fields) load with the v2 defaults. The schema-1 fields keep their existing
 * strict validation.
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

  if (typeof d.lanes !== "object" || d.lanes === null) throw new ProjectError("malformed", "missing lanes");
  const lanes = makeBootLanes(N); // defaults for fields a document may omit
  const focus = {} as Record<LaneKey, FrameKey>;
  const frameVis = {} as Record<LaneKey, FrameVisibility>;
  for (const key of LANE_KEYS) {
    const s = (d.lanes as Record<string, Partial<ProjectLane>>)[key];
    if (!s) throw new ProjectError("malformed", `missing lane ${key}`);
    const lane = lanes[key];
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
    focus[key] = lenientFocus(s.focus);
    frameVis[key] = lenientFrameVis(s.frameVis);
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
    if (!routing.routes.some((r) => r.to.lane === port.lane && r.to.frame === port.frame)) {
      throw new ProjectError("malformed", `parked base for an unpatched input: ${key}`);
    }
    routing.parked.set(`${port.lane}:${port.frame}`, requireHex(value, N, `parked.${key}`));
  }

  const view: ProjectViewState = {
    lane: d.view && LANE_KEYS.includes(d.view.lane) ? d.view.lane : "1",
    view3d: d.view?.view3d === true,
    split3d: d.view?.split3d === true,
    splitPair: d.view?.splitPair && Array.isArray(d.view.splitPair) && d.view.splitPair.length === 2
      ? [d.view.splitPair[0], d.view.splitPair[1]]
      : ["1", "2"],
    activePane: d.view?.activePane === 1 ? 1 : 0,
  };

  markDelays(routing);
  evaluateAll(routing, lanes, N);
  const dataset = lenientDataset(d.dataset);
  /** Schema-2 view fields are additive; a v1 document simply has none. */
  const lfoMode = lenientLfoMode(d.view?.lfoMode);
  const lfoRate = lenientLfoRate(d.view?.lfoRate);
  return { lanes, routing, N, view, dataset, extras: { focus, frameVis, lfoMode, lfoRate } };
}

/** Convenience: JSON text -> engine state. */
export const parseProject = (text: string) => deserializeProject(JSON.parse(text));

/** Convenience: engine state -> pretty JSON text. */
export const stringifyProject = (doc: ProjectDoc): string => JSON.stringify(doc, null, 2);
