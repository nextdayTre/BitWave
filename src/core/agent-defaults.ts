/**
 * Agent-layer identity and shared vocabulary.
 *
 * DOM-free and deterministic: the browser bridge, CLI and MCP server import these
 * constants so the tool id, versions, enums and frame names cannot drift.
 */

import { SIZES, type RegisterSize } from "./registers.ts";
import type { BinOp, FrameKey, LaneKey } from "./types.ts";
import { makeBootLanes } from "./lanes.ts";
import { createRouting } from "./routing.ts";
import { serializeProject, type ProjectDoc, type ProjectViewState } from "./project.ts";

export const TOOL_ID = "bitwave";
export const TOOL_TITLE = "BitWave";
export const TOOLSET_VERSION = "1.0.0";
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

/** Global frame names: lane 1 A/B/Z1, lane 2 C/D/Z2, lane 3 E/F/Z3. */
export const FRAME_NAMES: Record<LaneKey, Record<FrameKey, string>> = {
  "1": { a: "A", b: "B", z: "Z1" },
  "2": { a: "C", b: "D", z: "Z2" },
  "3": { a: "E", b: "F", z: "Z3" },
};

export const SLOT_OF_LANE: Record<LaneKey, "A" | "B" | "C"> = { "1": "A", "2": "B", "3": "C" };
export const LANE_OF_SLOT: Record<"A" | "B" | "C", LaneKey> = { A: "1", B: "2", C: "3" };

export interface FrameRef {
  lane: LaneKey;
  frame: FrameKey;
  slotKey: "A" | "B" | "C";
  /** Canonical uppercase display name, e.g. "Z1". */
  name: string;
}

const FRAME_BY_NAME: Record<string, FrameRef> = (() => {
  const out: Record<string, FrameRef> = {};
  for (const lane of ["1", "2", "3"] as LaneKey[]) {
    for (const frame of ["a", "b", "z"] as FrameKey[]) {
      const name = FRAME_NAMES[lane][frame];
      out[name] = { lane, frame, slotKey: SLOT_OF_LANE[lane], name };
    }
  }
  return out;
})();

export function frameName(lane: LaneKey, frame: FrameKey): string {
  return FRAME_NAMES[lane][frame];
}

/** Resolve a global frame name (`A`–`F`, `Z1`–`Z3`); case-insensitive. */
export function frameRefFromName(value: unknown): FrameRef | null {
  if (typeof value !== "string") return null;
  return FRAME_BY_NAME[value.toUpperCase()] ?? null;
}

export function laneKeyFromNumber(value: unknown): LaneKey | null {
  return value === 1 ? "1" : value === 2 ? "2" : value === 3 ? "3" : null;
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

/** The boot instrument as a schema-2 document (headless transports default). */
export function bootProjectDoc(): ProjectDoc {
  return baseProjectDoc(DEFAULT_WIDTH);
}

/** A compact 8-bit document used by tool examples. */
export function exampleProjectDoc(): ProjectDoc {
  return baseProjectDoc(8);
}
