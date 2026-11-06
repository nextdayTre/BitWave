/**
 * The `.bitwave` project document — the carryable, versioned non-HTML file.
 *
 * Registers persist as hex strings (A and B only: Z is derived and must never
 * be stored — DESIGN §10.8). Routes and their parked pre-patch bases persist so
 * that a saved patch board behaves identically after a reload. Unknown fields
 * are preserved by callers that hold the raw document; a newer schema is
 * rejected with a distinct code so the UI can offer a read-only path.
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
  SlotKey,
  SlotMap,
  SourcePort,
} from "./types.ts";
import { SLOT_KEYS } from "./types.ts";
import { fromHex, toHex } from "./registers.ts";
import { makeBootSlots } from "./slots.ts";
import { evaluateAll, markDelays, createRouting, type RoutingState } from "./routing.ts";
import type { Dataset } from "./csv.ts";

export const PROJECT_SCHEMA = 1;
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

export interface ProjectSlot {
  a: string;
  b: string;
  showB: boolean;
  binop: BinOp;
  edit: OperandKey;
  seededB: boolean;
  lfoB: string;
  colA: number;
  colB: number;
}

export interface ProjectViewState {
  slot: SlotKey;
  view3d: boolean;
  split3d: boolean;
  splitPair: [SlotKey, SlotKey];
  activePane: 0 | 1;
}

export interface ProjectDoc {
  schema: number;
  app: typeof PROJECT_APP;
  savedAt: string;
  N: number;
  view: ProjectViewState;
  slots: Record<SlotKey, ProjectSlot>;
  routes: ProjectRoute[];
  /** Destination port key ("A:a") -> pre-patch bits as hex. */
  parked: Record<string, string>;
  dataset?: Dataset;
}

const BINOPS: readonly BinOp[] = ["and", "or", "xor", "add", "sub"];
const MIXES: readonly MixOp[] = ["set", "add", "xor"];

export const portString = (slot: SlotKey, frame: FrameKey): string => `${slot}.${frame}`;

export function parsePort(text: string, allowZ: boolean): { slot: SlotKey; frame: FrameKey } {
  const m = /^([ABC])\.([abz])$/.exec(text);
  if (!m) throw new ProjectError("malformed", `bad port reference: ${JSON.stringify(text)}`);
  const slot = m[1] as SlotKey;
  const frame = m[2] as FrameKey;
  if (!allowZ && frame === "z") {
    throw new ProjectError("malformed", `Z cannot be a destination: ${text}`);
  }
  return { slot, frame };
}

export function serializeProject(
  slots: SlotMap,
  routing: RoutingState,
  N: number,
  view: ProjectViewState,
  dataset: Dataset | null = null,
  now: string = new Date().toISOString(),
): ProjectDoc {
  const slotDocs = {} as Record<SlotKey, ProjectSlot>;
  for (const key of SLOT_KEYS) {
    const slot = slots[key];
    slotDocs[key] = {
      a: toHex(slot.A.bits, N),
      b: toHex(slot.B.bits, N),
      showB: slot.showB,
      binop: slot.binop,
      edit: slot.edit,
      seededB: slot.seededB,
      lfoB: slot.lfoB,
      colA: slot.colA,
      colB: slot.colB,
    };
  }

  const parked: Record<string, string> = {};
  for (const [key, bits] of routing.parked) {
    const [slot, frame] = key.split(":");
    parked[portString(slot as SlotKey, frame as FrameKey)] = toHex(bits, N);
  }

  const doc: ProjectDoc = {
    schema: PROJECT_SCHEMA,
    app: PROJECT_APP,
    savedAt: now,
    N,
    view,
    slots: slotDocs,
    routes: routing.routes.map((r) => ({
      from: portString(r.from.slot, r.from.frame),
      to: portString(r.to.slot, r.to.frame),
      mix: r.mix,
    })),
    parked,
  };
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
 * Validate and materialize a document. Recomputes Z and delay flags, so the
 * returned engine state is immediately consistent. Throws ProjectError.
 */
export function deserializeProject(doc: unknown): {
  slots: SlotMap;
  routing: RoutingState;
  N: number;
  view: ProjectViewState;
  dataset: Dataset | null;
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

  if (typeof d.slots !== "object" || d.slots === null) throw new ProjectError("malformed", "missing slots");
  const slots = makeBootSlots(N); // defaults for fields a document may omit
  for (const key of SLOT_KEYS) {
    const s = (d.slots as Record<string, Partial<ProjectSlot>>)[key];
    if (!s) throw new ProjectError("malformed", `missing slot ${key}`);
    const slot = slots[key];
    slot.A.bits = requireHex(s.a, N, `slots.${key}.a`);
    slot.B.bits = requireHex(s.b, N, `slots.${key}.b`);
    slot.showB = requireBool(s.showB, `slots.${key}.showB`);
    if (!BINOPS.includes(s.binop as BinOp)) throw new ProjectError("malformed", `slots.${key}.binop`);
    slot.binop = s.binop as BinOp;
    slot.edit = s.edit === "b" ? "b" : "a";
    slot.seededB = s.seededB === true;
    slot.lfoB = typeof s.lfoB === "string" ? s.lfoB : "0";
    slot.colA = requireIndex(s.colA, `slots.${key}.colA`);
    slot.colB = requireIndex(s.colB, `slots.${key}.colB`);
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
      id: `${from.slot}.${from.frame}>${to.slot}.${to.frame}`,
      from: { slot: from.slot, frame: from.frame } as SourcePort,
      to: { slot: to.slot, frame: to.frame } as DestinationPort,
      delay: false,
      mix,
    };
    if (routing.routes.some((x) => x.to.slot === route.to.slot && x.to.frame === route.to.frame)) {
      throw new ProjectError("malformed", `two cables drive ${r.to}`);
    }
    routing.routes.push(route);
  }

  for (const [key, value] of Object.entries(d.parked ?? {})) {
    const port = parsePort(key, false);
    if (!routing.routes.some((r) => r.to.slot === port.slot && r.to.frame === port.frame)) {
      throw new ProjectError("malformed", `parked base for an unpatched input: ${key}`);
    }
    routing.parked.set(`${port.slot}:${port.frame}`, requireHex(value, N, `parked.${key}`));
  }

  const view: ProjectViewState = {
    slot: d.view && SLOT_KEYS.includes(d.view.slot) ? d.view.slot : "A",
    view3d: d.view?.view3d === true,
    split3d: d.view?.split3d === true,
    splitPair: d.view?.splitPair && Array.isArray(d.view.splitPair) && d.view.splitPair.length === 2
      ? [d.view.splitPair[0], d.view.splitPair[1]]
      : ["A", "B"],
    activePane: d.view?.activePane === 1 ? 1 : 0,
  };

  markDelays(routing);
  evaluateAll(routing, slots, N);
  const dataset = d.dataset && Array.isArray(d.dataset.cols) && Array.isArray(d.dataset.rows) ? d.dataset : null;
  return { slots, routing, N, view, dataset };
}

/** Convenience: JSON text -> engine state. */
export const parseProject = (text: string) => deserializeProject(JSON.parse(text));

/** Convenience: engine state -> pretty JSON text. */
export const stringifyProject = (doc: ProjectDoc): string => JSON.stringify(doc, null, 2);
