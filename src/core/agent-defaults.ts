/**
 * Agent-layer identity and shared vocabulary.
 *
 * DOM-free and deterministic: the browser bridge, CLI and MCP server import these
 * constants so the tool id, versions, enums and frame names cannot drift.
 */

import { SIZES, type RegisterSize } from "./registers.ts";
import type { BinOp, FrameKey, LaneKey } from "./types.ts";
import {
  APP_LANE_CAP,
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
export const TOOLSET_VERSION = "1.4.0";
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
 * The lane names this build ships: the default three-lane boot instrument from
 * `lanedefs.ts`. The *agent surface* accepts the whole shipped app cap
 * (`APP_LANE_CAP`, 8 lanes) since toolset 1.4.0; the boot/default document still
 * carries three.
 */
const BOOT_LANE_DEFS = laneDefs(DEFAULT_LANE_COUNT);
const SLOT_KEY_OF_LANE: readonly string[] = BOOT_LANE_DEFS.map((def) =>
  String.fromCharCode(65 + def.index),
);

/** The closed agent lane range: every key from 1 to `APP_LANE_CAP` (1–8). */
export const AGENT_LANE_KEYS: readonly LaneKey[] = laneDefs(APP_LANE_CAP).map(
  (def) => def.key as LaneKey,
);

/**
 * Global frame names for the whole shipped lane cap: lane 1 `A/B/Z1`, …
 * lane 8 `O/P/Z8`. A live document only reports its own lanes; this is the
 * closed name vocabulary the agent layer accepts.
 */
export const FRAME_NAMES: Record<LaneKey, Record<FrameKey, string>> = frameNamesFor(
  APP_LANE_CAP,
) as Record<LaneKey, Record<FrameKey, string>>;

/**
 * Legacy three-lane slot map (lanes 1–3 only). The app stopped using schema-1
 * A/B/C slots when lane keys became the identity (D43); kept for the historic
 * `FrameRef.slotKey` spelling on old A–F/Z1–Z3 refs.
 */
export const SLOT_OF_LANE: { readonly [lane: string]: "A" | "B" | "C" | undefined } =
  Object.fromEntries(
    BOOT_LANE_DEFS.map((lane, index) => [lane.key, SLOT_KEY_OF_LANE[index]]),
  ) as { readonly [lane: string]: "A" | "B" | "C" | undefined };
export const LANE_OF_SLOT: Record<"A" | "B" | "C", LaneKey> = Object.fromEntries(
  BOOT_LANE_DEFS.map((lane, index) => [SLOT_KEY_OF_LANE[index], lane.key]),
) as Record<"A" | "B" | "C", LaneKey>;

export interface FrameRef {
  lane: LaneKey;
  frame: FrameKey;
  /**
   * Legacy schema-1 slot key, present only for lanes 1–3 (frames `A`–`F`,
   * `Z1`–`Z3`). Lanes 4–8 have no historic slot letter, so the field is
   * omitted from their refs (D43/D46).
   */
  slotKey?: "A" | "B" | "C";
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

/**
 * Resolve a global frame name of the shipped agent range (`A`–`P`, `Z1`–`Z8`);
 * case-insensitive, and null for any name outside the 1–8 lane cap.
 */
export function frameRefFromName(value: unknown): FrameRef | null {
  const ref = lanedefsFrameRefFromName(value, APP_LANE_CAP);
  if (ref === null) return null;
  const lane = ref.lane as LaneKey;
  const slotKey = SLOT_OF_LANE[lane];
  const base = { lane, frame: ref.frame, name: ref.name };
  return slotKey === undefined ? base : { ...base, slotKey };
}

/** The shipped agent lane key ("1"–"8") for the numeric lane selector; null for any other value. */
export function laneKeyFromNumber(value: unknown): LaneKey | null {
  const key = lanedefsLaneKeyFromNumber(value);
  if (key === null || !(AGENT_LANE_KEYS as readonly string[]).includes(key)) return null;
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
