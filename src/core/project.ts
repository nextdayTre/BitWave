/**
 * The `.bitwave` project document — the carryable, versioned non-HTML file.
 *
 * Registers persist as hex strings (A and B only: Z is derived and must never
 * be stored — DESIGN §10.8). Routes and their parked pre-patch bases persist so
 * that a saved patch board behaves identically after a reload. Unknown fields
 * are preserved by callers that hold the raw document; a newer schema is
 * rejected with a distinct code so the UI can offer a read-only path.
 *
 * Schema history (D33 / D40 / D44 / D52):
 *   1  closed three-lane object: operands, operator, routes, parked bases
 *   2  additive: per-lane focus/frameVis, LFO mode/rate, dataset cursor
 *   3  additive: per-operand expression sources (`lanes.<key>.expressions`)
 *   4  dynamic lanes: `lanes` is keyed by the stable lane key string
 *      (`"1"`..`"13"`, D43), gaps allowed, 1..APP_LANE_CAP (8) lanes.
 *   5  **free frames** (D52): optional top-level `frames` map (`"1"`..`"16"`,
 *      canonical names `F1`..`F16`) for standalone single registers decoupled
 *      from A/B/Z lane housing, optional `view.activeFree`, and free-frame port
 *      endpoints (`"F1"`..`"F16"`) in `routes` and `parked`. Schema 1–4
 *      documents upgrade cleanly on read with no free frames.
 *
 * Fields added after schema 1 are validated leniently: an invalid or missing
 * value falls back to its default instead of rejecting the document. A document
 * saved without extras keeps the minimal shape (no focus/frameVis/expressions/
 * frames present), which is what makes a schema-1 document round-trip unchanged.
 *
 * This module is pure: serialization/deserialization never touches the DOM.
 */

import type {
  BinOp,
  DestinationPort,
  FrameKey,
  FreeFrameKey,
  FreeFrameMap,
  MixOp,
  OperandKey,
  Route,
  LaneKey,
  LaneMap,
  SourcePort,
} from "./types.ts";
import { LANE_KEYS, isFreePort } from "./types.ts";
import {
  APP_FREE_FRAME_CAP,
  APP_LANE_CAP,
  FREE_FRAME_LABEL_MAX,
  FREE_FRAME_NOTE_MAX,
  compareFreeFrameKeys,
  compareLaneKeys,
  freeFrameIndex,
  freeFrameKeyFromName,
  freeFrameName,
  laneIndex,
  sanitizeFreeFrameText,
} from "./lanedefs.ts";
import { fromHex, toHex } from "./registers.ts";
import { makeFreeFrame, makeLane } from "./lanes.ts";
import { evaluateAll, createRouting, portKeyOf, routeKey, type RoutingState } from "./routing.ts";
import { EXPRESSION_LIMITS } from "./expression.ts";
import type { Dataset } from "./csv.ts";

export const PROJECT_SCHEMA = 5;
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
  /** "3.z" or "F1" */
  from: string;
  /** "1.a" or "F2" */
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

/** Standalone free frame persisted in schema 5 (D52). */
export interface ProjectFreeFrame {
  hex: string;
  /** Dataset column index (-1 when omitted). */
  col?: number;
  /** 2-D overlay visibility (true when omitted). */
  visible?: boolean;
  /** Expression source (empty when omitted). */
  expression?: string;
  /** Optional short stage label (e.g. "hanning"). */
  label?: string;
  /** Optional external library/function provenance note (e.g. "numpy.hanning(16)"). */
  sourceNote?: string;
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
  /** Schema 5: focused free-frame key ("1".."16") when focus is on a free frame. */
  activeFree?: FreeFrameKey;
}

/**
 * The schema-2/3/5 additive fields the serializer cannot read from the lane map
 * alone. Everything is optional; a caller that omits `extras` writes the minimal
 * shape.
 */
export interface ProjectExtras {
  focus?: Partial<Record<LaneKey, FrameKey>>;
  frameVis?: Partial<Record<LaneKey, { a: boolean; b: boolean; z: boolean }>>;
  lfoMode?: string;
  lfoRate?: number;
  /** Schema 3: expression sources per lane/operand. */
  expressions?: Partial<Record<LaneKey, LaneExpressions>>;
  /** Schema 5: standalone free frames, keyed by stable numeric key ("1".."16"). */
  freeFrames?: FreeFrameMap;
  /** Schema 5: 2-D visibility toggles per free frame. */
  freeVis?: Partial<Record<FreeFrameKey, boolean>>;
  /** Schema 5: expression source per free frame. */
  freeExpressions?: Partial<Record<FreeFrameKey, string>>;
}

/**
 * The `.bitwave` document. `lanes` is keyed by the stable lane key string;
 * schema 5 optionally adds `frames` keyed by the stable free-frame key string.
 */
export interface ProjectDoc {
  schema: number;
  app: typeof PROJECT_APP;
  savedAt: string;
  N: number;
  view: ProjectViewState;
  lanes: Record<LaneKey, ProjectLane>;
  /** Schema 5: standalone free frames (omitted when empty). */
  frames?: Record<FreeFrameKey, ProjectFreeFrame>;
  routes: ProjectRoute[];
  /** Destination port string ("1.a" or "F1") -> pre-patch bits as hex. */
  parked: Record<string, string>;
  dataset?: Dataset;
}

/** The binary operators in canonical order; a compact share stores the index. */
export const PROJECT_BINOPS: readonly BinOp[] = ["and", "or", "xor", "add", "sub"];
/** The route mix operators in canonical order; a compact share stores the index. */
export const PROJECT_MIXES: readonly MixOp[] = ["set", "add", "xor"];

const BINOPS = PROJECT_BINOPS;
const MIXES = PROJECT_MIXES;

/** Schema-2 defaults, used whenever a document omits (or corrupts) a new field. */
const DEFAULT_FOCUS: FrameKey = "a";
const LFO_DEFAULT_MODE = "rotcw";
const LFO_DEFAULT_RATE = 4;
/** The modes the instrument's motion control offers; anything else is ignored. */
const LFO_MODES: readonly string[] = ["rotcw", "rotccw", "slide", "csvStep"];

function lenientFocus(value: unknown): FrameKey {
  return value === "a" || value === "b" || value === "z" ? value : DEFAULT_FOCUS;
}

function lenientFrameVis(value: unknown): FrameVisibility {
  const raw = typeof value === "object" && value !== null ? (value as Partial<FrameVisibility>) : {};
  return { a: raw.a !== false, b: raw.b !== false, z: raw.z !== false };
}

function lenientLfoMode(value: unknown): string {
  return typeof value === "string" && LFO_MODES.includes(value) ? value : LFO_DEFAULT_MODE;
}

function lenientLfoRate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : LFO_DEFAULT_RATE;
}

function lenientExpressionText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > EXPRESSION_LIMITS.source) return "";
  return trimmed;
}

/** Schema-3 expression sources: strings only, trimmed, bounded; invalid values drop. */
function lenientExpressions(value: unknown): LaneExpressions {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Partial<LaneExpressions>;
  const out: LaneExpressions = {};
  for (const frame of ["a", "b"] as const) {
    const trimmed = lenientExpressionText(raw[frame]);
    if (trimmed !== "") out[frame] = trimmed;
  }
  return out;
}

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

export const portStringOf = (port: SourcePort | DestinationPort): string =>
  isFreePort(port) ? freeFrameName(port.free) : portString(port.lane, port.frame);

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

function validateFreeFrameKeys(value: unknown): FreeFrameKey[] {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectError("malformed", "frames must be an object");
  }
  const keys = Object.keys(value).sort(compareFreeFrameKeys);
  for (const key of keys) {
    if (freeFrameIndex(key) < 0) {
      throw new ProjectError(
        "malformed",
        `invalid free frame key ${JSON.stringify(key)} (expected "1".."${APP_FREE_FRAME_CAP}")`,
      );
    }
  }
  if (keys.length > APP_FREE_FRAME_CAP) {
    throw new ProjectError(
      "malformed",
      `a document may hold at most ${APP_FREE_FRAME_CAP} free frames; got ${keys.length}`,
    );
  }
  return keys;
}

export function parsePort(text: string, allowZ: boolean): SourcePort {
  const freeKey = freeFrameKeyFromName(text);
  if (freeKey !== null) return { free: freeKey };
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

  let frameDocs: Record<FreeFrameKey, ProjectFreeFrame> | undefined;
  const freeFrames = extras.freeFrames;
  if (freeFrames) {
    const freeKeys = Object.keys(freeFrames).sort(compareFreeFrameKeys);
    if (freeKeys.length > APP_FREE_FRAME_CAP) {
      throw new ProjectError(
        "malformed",
        `a document may hold at most ${APP_FREE_FRAME_CAP} free frames; got ${freeKeys.length}`,
      );
    }
    if (freeKeys.length > 0) {
      frameDocs = {};
      for (const key of freeKeys) {
        if (freeFrameIndex(key) < 0) {
          throw new ProjectError(
            "malformed",
            `invalid free frame key ${JSON.stringify(key)} (expected "1".."${APP_FREE_FRAME_CAP}")`,
          );
        }
        const ff = freeFrames[key];
        const entry: ProjectFreeFrame = { hex: toHex(ff.reg.bits, N) };
        if (ff.col >= 0) entry.col = ff.col;
        if (extras.freeVis?.[key] === false) entry.visible = false;
        const expr = lenientExpressionText(extras.freeExpressions?.[key]);
        if (expr !== "") entry.expression = expr;
        const label = sanitizeFreeFrameText(ff.label, FREE_FRAME_LABEL_MAX);
        if (label !== "") entry.label = label;
        const sourceNote = sanitizeFreeFrameText(ff.sourceNote, FREE_FRAME_NOTE_MAX);
        if (sourceNote !== "") entry.sourceNote = sourceNote;
        frameDocs[key] = entry;
      }
    }
  }

  const parked: Record<string, string> = {};
  for (const [key, bits] of routing.parked) {
    if (key.includes(":")) {
      const [lane, frame] = key.split(":");
      parked[portString(lane as LaneKey, frame as FrameKey)] = toHex(bits, N);
    } else {
      parked[key] = toHex(bits, N);
    }
  }

  const viewDoc: ProjectViewState = {
    lane: view.lane,
    view3d: view.view3d,
    split3d: view.split3d,
    splitPair: view.splitPair,
    activePane: view.activePane,
  };
  const lfoMode = extras.lfoMode ?? view.lfoMode;
  const lfoRate = extras.lfoRate ?? view.lfoRate;
  if (lfoMode !== undefined) viewDoc.lfoMode = lfoMode;
  if (lfoRate !== undefined) viewDoc.lfoRate = lfoRate;
  if (view.activeFree && frameDocs && frameDocs[view.activeFree]) {
    viewDoc.activeFree = view.activeFree;
  }

  const doc: ProjectDoc = {
    schema: PROJECT_SCHEMA,
    app: PROJECT_APP,
    savedAt: now,
    N,
    view: viewDoc,
    lanes: laneDocs,
    routes: routing.routes.map((r) => ({
      from: portStringOf(r.from),
      to: portStringOf(r.to),
      mix: r.mix,
    })),
    parked,
  };
  if (frameDocs) doc.frames = frameDocs;
  if (dataset) doc.dataset = dataset;
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
 * lane and free frame the document carries. Throws ProjectError on invalid docs.
 */
export function deserializeProject(doc: unknown): {
  lanes: LaneMap;
  freeFrames: FreeFrameMap;
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
    freeVis: Record<FreeFrameKey, boolean>;
    freeExpressions: Record<FreeFrameKey, string>;
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

  const freeFrames: FreeFrameMap = {};
  const freeVis: Record<FreeFrameKey, boolean> = {};
  const freeExpressions: Record<FreeFrameKey, string> = {};
  const freeKeys = d.schema >= 5 ? validateFreeFrameKeys(d.frames) : [];
  for (const key of freeKeys) {
    const raw = (d.frames as Record<string, Partial<ProjectFreeFrame>>)[key];
    if (typeof raw !== "object" || raw === null) {
      throw new ProjectError("malformed", `frames.${key} must be an object`);
    }
    const label = sanitizeFreeFrameText(raw.label, FREE_FRAME_LABEL_MAX);
    const sourceNote = sanitizeFreeFrameText(raw.sourceNote, FREE_FRAME_NOTE_MAX);
    const ff = makeFreeFrame(key, N, {
      label: label || undefined,
      sourceNote: sourceNote || undefined,
    });
    ff.reg.bits = requireHex(raw.hex, N, `frames.${key}.hex`);
    ff.col =
      typeof raw.col === "number" && Number.isInteger(raw.col) && raw.col >= -1
        ? raw.col
        : -1;
    freeFrames[key] = ff;
    freeVis[key] = raw.visible !== false;
    freeExpressions[key] = lenientExpressionText(raw.expression);
  }

  const routing = createRouting();
  const rawRoutes = Array.isArray(d.routes) ? d.routes : [];
  for (const raw of rawRoutes) {
    const r = raw as Partial<ProjectRoute>;
    if (typeof r.from !== "string" || typeof r.to !== "string") {
      throw new ProjectError("malformed", "route must have from/to port strings");
    }
    const from = parsePort(r.from, true);
    const to = parsePort(r.to, false) as DestinationPort;
    if (isFreePort(from)) {
      if (!freeFrames[from.free]) {
        throw new ProjectError("malformed", `route source free frame F${from.free} is not in the document`);
      }
    } else if (!lanes[from.lane]) {
      throw new ProjectError("malformed", `route source lane ${from.lane} is not in the document`);
    }
    if (isFreePort(to)) {
      if (!freeFrames[to.free]) {
        throw new ProjectError("malformed", `route destination free frame F${to.free} is not in the document`);
      }
    } else if (!lanes[to.lane]) {
      throw new ProjectError("malformed", `route destination lane ${to.lane} is not in the document`);
    }
    const mix: MixOp = MIXES.includes(r.mix as MixOp) ? (r.mix as MixOp) : "set";
    const route: Route = {
      id: routeKey(from, to),
      from,
      to,
      delay: false,
      mix,
    };
    const destKey = portKeyOf(route.to);
    if (routing.routes.some((x) => portKeyOf(x.to) === destKey)) {
      throw new ProjectError("malformed", `two routes drive ${r.to}`);
    }
    routing.routes.push(route);
  }

  for (const [key, value] of Object.entries(d.parked ?? {})) {
    const port = parsePort(key, false) as DestinationPort;
    if (isFreePort(port)) {
      if (!freeFrames[port.free]) {
        throw new ProjectError("malformed", `parked base free frame F${port.free} is not in the document`);
      }
    } else if (!lanes[port.lane]) {
      throw new ProjectError("malformed", `parked base lane ${port.lane} is not in the document`);
    }
    const pKey = portKeyOf(port);
    if (!routing.routes.some((r) => portKeyOf(r.to) === pKey)) {
      throw new ProjectError("malformed", `parked base for an unpatched input: ${key}`);
    }
    routing.parked.set(pKey, requireHex(value, N, `parked.${key}`));
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
  if (typeof d.view?.activeFree === "string" && freeFrames[d.view.activeFree]) {
    view.activeFree = d.view.activeFree;
  }

  evaluateAll(routing, lanes, N, undefined, freeFrames);
  const dataset = lenientDataset(d.dataset);
  const lfoMode = lenientLfoMode(d.view?.lfoMode);
  const lfoRate = lenientLfoRate(d.view?.lfoRate);
  return {
    lanes,
    freeFrames,
    routing,
    N,
    view,
    dataset,
    extras: { focus, frameVis, lfoMode, lfoRate, expressions, freeVis, freeExpressions },
  };
}

/** Convenience: JSON text -> engine state. */
export const parseProject = (text: string) => deserializeProject(JSON.parse(text));

/** Convenience: engine state -> pretty JSON text. */
export const stringifyProject = (doc: ProjectDoc): string => JSON.stringify(doc, null, 2);
