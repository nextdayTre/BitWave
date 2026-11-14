/**
 * Agent-layer identity and shared vocabulary.
 *
 * DOM-free and deterministic: the browser bridge, CLI and MCP server import these
 * constants so the tool id, versions, enums and frame names cannot drift.
 */

import { SIZES, type RegisterSize } from "./registers.ts";
import type { BinOp, FrameKey, LaneKey } from "./types.ts";
import {
  DEFAULT_LANE_COUNT,
  laneDef,
  laneDefs,
  frameNamesFor,
  frameRefFromName as lanedefsFrameRefFromName,
  laneIndex,
  laneKeyFromNumber as lanedefsLaneKeyFromNumber,
} from "./lanedefs.ts";
import { makeBootLanes } from "./lanes.ts";
import { createRouting } from "./routing.ts";
import { serializeProject, type ProjectDoc, type ProjectViewState } from "./project.ts";

export const TOOL_ID = "bitwave";
export const TOOL_TITLE = "BitWave";
export const TOOLSET_VERSION = "1.2.0";
export const SCHEMA_VERSION = 1;
export const DEFAULT_WIDTH: RegisterSize = 64;

/** Fixed timestamp for canonical share documents (links never carry `savedAt`). */
export const CANONICAL_SAVED_AT = "1970-01-01T00:00:00.000Z";

export const WIDTHS: readonly RegisterSize[] = SIZES;
export const BINOPS: readonly BinOp[] = ["and", "or", "xor", "add", "sub"];
export const VIEW_MODES = ["2d", "3d", "split"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export const LFO_MODES = ["rotcw", "rotccw", "slide", "csvStep"] as const;
export const LFO_RATES = [1, 2, 4, 8] as const;

/**
 * The lane names this build ships: the default three-lane table from
 * `lanedefs.ts`. Later dynamic-lane slices widen this; the agent surface stays a
 * closed enum until that reviewed slice bumps the toolset.
 */
const SHIPPED_LANE_DEFS = laneDefs(DEFAULT_LANE_COUNT);
const SHIPPED_LANES: readonly LaneKey[] = SHIPPED_LANE_DEFS.map((def) => def.key as LaneKey);
const SLOT_KEY_OF_LANE: readonly string[] = SHIPPED_LANE_DEFS.map((def) =>
  String.fromCharCode(65 + def.index),
);

/** Global frame names: lane 1 A/B/Z1, lane 2 C/D/Z2, lane 3 E/F/Z3. */
export const FRAME_NAMES: Record<LaneKey, Record<FrameKey, string>> = frameNamesFor(
  DEFAULT_LANE_COUNT,
) as Record<LaneKey, Record<FrameKey, string>>;

export const SLOT_OF_LANE: Record<LaneKey, "A" | "B" | "C"> = Object.fromEntries(
  SHIPPED_LANES.map((lane, index) => [lane, SLOT_KEY_OF_LANE[index]]),
) as Record<LaneKey, "A" | "B" | "C">;
export const LANE_OF_SLOT: Record<"A" | "B" | "C", LaneKey> = Object.fromEntries(
  SHIPPED_LANES.map((lane, index) => [SLOT_KEY_OF_LANE[index], lane]),
) as Record<"A" | "B" | "C", LaneKey>;

export interface FrameRef {
  lane: LaneKey;
  frame: FrameKey;
  slotKey: "A" | "B" | "C";
  /** Canonical uppercase display name, e.g. "Z1". */
  name: string;
}

export function frameName(lane: LaneKey, frame: FrameKey): string {
  const names = FRAME_NAMES[lane];
  if (names) return names[frame];
  /* A schema-4 document may carry lanes past the shipped closed enum; the
     display names still derive from the stable lane key (D43). */
  const index = laneIndex(lane);
  if (index >= 0) return laneDef(index)[frame];
  return frame.toUpperCase();
}

/** Resolve a global frame name of the shipped three lanes (`A`–`F`, `Z1`–`Z3`); case-insensitive. */
export function frameRefFromName(value: unknown): FrameRef | null {
  const ref = lanedefsFrameRefFromName(value, DEFAULT_LANE_COUNT);
  if (ref === null) return null;
  const lane = ref.lane as LaneKey;
  return { lane, frame: ref.frame, slotKey: SLOT_OF_LANE[lane], name: ref.name };
}

/** The shipped lane key ("1"–"3") for the numeric lane selector; null for any other value. */
export function laneKeyFromNumber(value: unknown): LaneKey | null {
  const key = lanedefsLaneKeyFromNumber(value);
  if (key === null || !(SHIPPED_LANES as readonly string[]).includes(key)) return null;
  return key as LaneKey;
}

function baseProjectDoc(N: RegisterSize): ProjectDoc {
  const lanes = makeBootLanes(N);
  const routing = createRouting();
  const view: ProjectViewState = {
    lane: "1",
    view3d: false,
    split3d: false,
    splitPair: ["1", "2"],
    activePane: 0,
  };
  const focus: Record<LaneKey, FrameKey> = { "1": "a", "2": "a", "3": "a" };
  const frameVis: Record<LaneKey, { a: boolean; b: boolean; z: boolean }> = {
    "1": { a: true, b: true, z: true },
    "2": { a: true, b: true, z: true },
    "3": { a: true, b: true, z: true },
  };
  return serializeProject(lanes, routing, N, view, null, CANONICAL_SAVED_AT, {
    focus,
    frameVis,
    lfoMode: "rotcw",
    lfoRate: 4,
  });
}

/**
 * The boot instrument as a schema-4 document (headless transports default).
 * It carries the shipped three lanes, keyed by their stable lane keys, exactly
 * as the app captures them.
 */
export function bootProjectDoc(): ProjectDoc {
  return baseProjectDoc(DEFAULT_WIDTH);
}

/** A compact 8-bit schema-4 document used by tool examples. */
export function exampleProjectDoc(): ProjectDoc {
  return baseProjectDoc(8);
}
