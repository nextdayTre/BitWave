/**
 * Curated analytical & LFO modulation patch presets (D54).
 *
 * Pure, DOM-free and deterministic: each preset builds a fresh schema-5
 * `ProjectDoc` from the shared wavetable engine (`src/core/ops.ts`) so loading
 * a preset runs through the exact same `applyProject` path as opening a saved
 * `.bitwave` file — strip, canvas, sources, readouts, share link and agent
 * state stay in complete agreement.
 */

import { invert, tableValues, type TableName } from "./ops.ts";
import { PROJECT_APP, PROJECT_SCHEMA, type ProjectDoc, type ProjectLane } from "./project.ts";
import { nibblesToBits, toHex } from "./registers.ts";
import type { BinOp } from "./types.ts";

export interface PatchPreset {
  /** Stable kebab-case identifier. */
  readonly id: string;
  /** Short title shown in the Presets menu. */
  readonly name: string;
  /** Compact metadata line shown under the title (width · view · hook). */
  readonly summary: string;
  /** Tooltip / description explaining what the patch reveals under LFO. */
  readonly description: string;
  /** Recommended unary/LFO bit step (`1 | 2 | 4 | 8`). */
  readonly amount: 1 | 2 | 4 | 8;
  /** Arm transient Record logging so `log.<frame>` expressions advance cleanly. */
  readonly record: boolean;
  /** Start the LFO automatically on load (honouring `prefers-reduced-motion`). */
  readonly autoLfo: boolean;
  /** Optional session-only 3-D hinge orientation per lane (`"a-far"` | `"b-far"`). */
  readonly folds?: Readonly<Record<string, "a-far" | "b-far">>;
  /** Build a fresh, deterministic schema-5 project document for this patch. */
  readonly build: () => ProjectDoc;
}

const PRESET_SAVED_AT = "2026-11-24T00:00:00.000Z";

function zeroHex(N: number): string {
  return "0".repeat(N >> 2);
}

function tableHex(name: TableName, N: number): string {
  return toHex(nibblesToBits(tableValues(name, N), N), N);
}

function invertTableHex(name: TableName, N: number): string {
  return toHex(invert(nibblesToBits(tableValues(name, N), N), N), N);
}

interface LaneSpec {
  a: string;
  b: string;
  binop?: BinOp;
  showB?: boolean;
  edit?: "a" | "b";
  focus?: "a" | "b" | "z";
  lfoB?: string;
  expressions?: { a?: string; b?: string };
}

function laneDoc(spec: LaneSpec): ProjectLane {
  const doc: ProjectLane = {
    a: spec.a,
    b: spec.b,
    showB: spec.showB ?? true,
    binop: spec.binop ?? "xor",
    edit: spec.edit ?? "a",
    seededB: true,
    lfoB: spec.lfoB ?? "0",
    colA: -1,
    colB: -1,
  };
  if (spec.focus && spec.focus !== "a") doc.focus = spec.focus;
  if (spec.expressions && (spec.expressions.a || spec.expressions.b)) {
    doc.expressions = { ...spec.expressions };
  }
  return doc;
}

/* SWAR tent-map frequency doubler: doubles every 4-bit sample without carry bleed. */
const tentExpr = (ref: string): string =>
  `((${ref} & ((~0 / 15) * 7)) << 1) ^ (((${ref} & ((~0 / 15) * 8)) >> 3) * 15)`;

/* 64-bit SplitMix64 bijective finalizer (Strict Avalanche Criterion). */
const splitMixExpr = (ref: string): string =>
  `((${ref} ^ (${ref} >> 30)) * 0xBF58476D1CE4E5B9) ^ (((${ref} ^ (${ref} >> 30)) * 0xBF58476D1CE4E5B9) >> 27)`;

/** All built-in analytical and LFO modulation presets, in menu display order. */
export const PATCH_PRESETS: readonly PatchPreset[] = [
  {
    id: "xor-carrier-cancel",
    name: "XOR Carrier Cancel",
    summary: "256b · 3D split · sine ⊕ saw → ~saw",
    description:
      "Counter-rotating sine and saw scramble into a Walsh-modulated Z1 while Lane 2 strips the moving sine carrier with ~sine to recover ~saw cleanly (POP Z2 = 128).",
    amount: 8,
    record: false,
    autoLfo: true,
    folds: { "1": "b-far" },
    build: () => {
      const N = 256;
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "2",
          view3d: true,
          split3d: true,
          splitPair: ["1", "2"],
          activePane: 1,
          lfoMode: "rotcw",
          lfoRate: 8,
        },
        lanes: {
          "1": laneDoc({
            a: tableHex("sine", N),
            b: tableHex("sawUp", N),
            binop: "xor",
            lfoB: "opp",
          }),
          "2": laneDoc({
            a: zeroHex(N),
            b: invertTableHex("sine", N),
            binop: "xor",
            edit: "b",
            focus: "b",
            lfoB: "0",
          }),
        },
        routes: [{ from: "1.z", to: "2.a", mix: "set" }],
        parked: { "2.a": tableHex("cosine", N) },
      };
    },
  },
  {
    id: "carry-chain",
    name: "Full-Adder Carry Chain",
    summary: "256b · 3D split · ADD vs carry storm",
    description:
      "Splits Lane 1 arithmetic addition into half-adder sum (C = A ^ B) and exact carry vector (D = Z1 ^ (A ^ B)); Lane 2 recombines them so Z2 === Z1 on every tick.",
    amount: 8,
    record: false,
    autoLfo: true,
    build: () => {
      const N = 256;
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "2",
          view3d: true,
          split3d: true,
          splitPair: ["1", "2"],
          activePane: 1,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: tableHex("sine", N),
            b: tableHex("sawUp", N),
            binop: "add",
            lfoB: "opp",
          }),
          "2": laneDoc({
            a: zeroHex(N),
            b: zeroHex(N),
            binop: "xor",
            focus: "b",
            expressions: {
              a: "A ^ B",
              b: "Z1 ^ (A ^ B)",
            },
          }),
        },
        routes: [],
        parked: {},
      };
    },
  },
  {
    id: "swar-wavefolder",
    name: "SWAR Wavefolder vs. Bleed",
    summary: "256b · 3D split · mod-16 fold vs ADD",
    description:
      "Compares whole-word ADD (Lane 1) against carry-free per-nibble mod-16 wavefolding (D); Z2 isolates only the inter-nibble carry spillover.",
    amount: 8,
    record: false,
    autoLfo: true,
    build: () => {
      const N = 256;
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "2",
          view3d: true,
          split3d: true,
          splitPair: ["1", "2"],
          activePane: 1,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: tableHex("sine", N),
            b: tableHex("sawUp", N),
            binop: "add",
            lfoB: "opp",
          }),
          "2": laneDoc({
            a: zeroHex(N),
            b: zeroHex(N),
            binop: "xor",
            focus: "b",
            expressions: {
              b: "((A & ((~0 / 15) * 7)) + (B & ((~0 / 15) * 7))) ^ ((A ^ B) & ((~0 / 15) * 8))",
            },
          }),
        },
        routes: [{ from: "1.z", to: "2.a", mix: "set" }],
        parked: { "2.a": zeroHex(N) },
      };
    },
  },
  {
    id: "takagi-fractal",
    name: "Takagi / Blancmange Fractal",
    summary: "256b · 2D overlay · 3-octave tent sum",
    description:
      "Chains SWAR tent-map frequency doublers across Free Frames F1–F4 and sums F1/2 + F2/4 + F3/8 carry-free into a modulating dyadic Weierstrass / Blancmange curve.",
    amount: 4,
    record: false,
    autoLfo: true,
    build: () => {
      const N = 256;
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "1",
          activeFree: "4",
          view3d: false,
          split3d: false,
          splitPair: ["1", "1"],
          activePane: 0,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: tableHex("triangle", N),
            b: tableHex("triangle", N),
            binop: "xor",
            lfoB: "opp",
          }),
        },
        frames: {
          "1": {
            hex: tableHex("triangle", N),
            label: "1x tri",
            sourceNote: "Lane 1 A (counter-phase)",
          },
          "2": {
            hex: zeroHex(N),
            expression: tentExpr("B"),
            label: "2x tent",
            sourceNote: "SWAR tent(B)",
          },
          "3": {
            hex: zeroHex(N),
            expression: tentExpr("F2"),
            label: "4x tent",
            sourceNote: "SWAR tent(F2)",
          },
          "4": {
            hex: zeroHex(N),
            expression:
              "((F1 >> 1) & ((~0 / 15) * 7)) + ((F2 >> 2) & ((~0 / 15) * 3)) + ((F3 >> 3) & (~0 / 15))",
            label: "takagi",
            sourceNote: "F1/2 + F2/4 + F3/8 (carry-free)",
          },
        },
        routes: [{ from: "1.a", to: "F1", mix: "set" }],
        parked: { F1: tableHex("triangle", N) },
      };
    },
  },
  {
    id: "gray-code-diff",
    name: "Word vs. SWAR Gray Code",
    summary: "256b · 3D split · Gray encode & decode",
    description:
      "Lane 1 encodes sine into nibble-local SWAR Gray; Lane 2 contrasts Word Gray vs. SWAR Gray (Z2 = inter-nibble parity bleed); Lane 3 decodes SWAR Gray back to sine.",
    amount: 4,
    record: false,
    autoLfo: true,
    build: () => {
      const N = 256;
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "1",
          view3d: true,
          split3d: true,
          splitPair: ["1", "2"],
          activePane: 0,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: tableHex("sine", N),
            b: zeroHex(N),
            binop: "xor",
            expressions: {
              b: "A ^ ((A >> 1) & ((~0 / 15) * 7))",
            },
          }),
          "2": laneDoc({
            a: zeroHex(N),
            b: zeroHex(N),
            binop: "xor",
            expressions: {
              a: "A ^ (A >> 1)",
            },
          }),
          "3": laneDoc({
            a: zeroHex(N),
            b: zeroHex(N),
            binop: "xor",
            expressions: {
              b: "E ^ ((E >> 1) & ((~0 / 15) * 7)) ^ ((E >> 2) & ((~0 / 15) * 3)) ^ ((E >> 3) & (~0 / 15))",
            },
          }),
        },
        routes: [
          { from: "1.b", to: "2.b", mix: "set" },
          { from: "1.b", to: "3.a", mix: "set" },
        ],
        parked: {
          "2.b": zeroHex(N),
          "3.a": zeroHex(N),
        },
      };
    },
  },
  {
    id: "avalanche-meter",
    name: "SplitMix64 Avalanche Meter",
    summary: "64b · 3D split · 1-bit flip diffusion",
    description:
      "Walks a single flipped bit across 64-bit sine (Z1 = A ^ B) and XORs SplitMix64(A) against SplitMix64(Z1); watch POP Z2 hover near 32/64 (50% avalanche).",
    amount: 1,
    record: false,
    autoLfo: true,
    build: () => {
      const N = 64;
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "2",
          view3d: true,
          split3d: true,
          splitPair: ["1", "2"],
          activePane: 1,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: tableHex("sine", N),
            b: "0000000000000001",
            binop: "xor",
            lfoB: "opp",
          }),
          "2": laneDoc({
            a: zeroHex(N),
            b: zeroHex(N),
            binop: "xor",
            focus: "z",
            expressions: {
              a: splitMixExpr("A"),
              b: splitMixExpr("Z1"),
            },
          }),
        },
        routes: [],
        parked: {},
      };
    },
  },
  {
    id: "rc-slew-radar",
    name: "RC Slew & Edge Radar",
    summary: "64b · 3D split · IIR ghost + Dirac d/dt",
    description:
      "Uses Record + log.<frame> on a rotating square wave: Lane 1 detects rising/falling edges as Dirac impulses (A ^ log.A) while Lane 2 melts cliffs into an exponential SWAR IIR trail.",
    amount: 4,
    record: true,
    autoLfo: true,
    build: () => {
      const N = 64;
      const sq = tableHex("square", N);
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "2",
          view3d: true,
          split3d: true,
          splitPair: ["1", "2"],
          activePane: 1,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: sq,
            b: zeroHex(N),
            binop: "xor",
            expressions: {
              b: "A ^ log.A",
            },
          }),
          "2": laneDoc({
            a: sq,
            b: sq,
            binop: "xor",
            focus: "b",
            expressions: {
              b: "(C & log.D) + (((C ^ log.D) >> 1) & ((~0 / 15) * 7))",
            },
          }),
        },
        routes: [{ from: "1.a", to: "2.a", mix: "set" }],
        parked: { "2.a": sq },
      };
    },
  },
  {
    id: "rule-90-sierpinski",
    name: "Rule 90 · Sierpinski CA",
    summary: "64b · 3D · fractal cellular automaton",
    description:
      "Elementary Rule 90 seeded from one center bit using Record + log.A (A = generation t, B = t-1, Z1 = active flips); collapses back to 2 spikes on every power-of-2 tick.",
    amount: 1,
    record: true,
    autoLfo: true,
    build: () => {
      const N = 64;
      const seed = "0000000100000000";
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "1",
          view3d: true,
          split3d: false,
          splitPair: ["1", "1"],
          activePane: 0,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: seed,
            b: seed,
            binop: "xor",
            focus: "a",
            expressions: {
              a: "((log.A << 1) | (log.A >> (N - 1))) ^ ((log.A >> 1) | (log.A << (N - 1)))",
              b: "log.A",
            },
          }),
        },
        routes: [],
        parked: {},
      };
    },
  },
  {
    id: "rule-30-110-ca",
    name: "Rule 30 vs. Rule 110 CA",
    summary: "64b · 3D split · chaos vs. Turing gliders",
    description:
      "Runs Wolfram Rule 30 (chaotic PRNG, Lane 1) side-by-side with Rule 110 (Turing-complete gliders, Lane 2) from one center bit via Record + log.<frame>.",
    amount: 1,
    record: true,
    autoLfo: true,
    build: () => {
      const N = 64;
      const seed = "0000000100000000";
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "1",
          view3d: true,
          split3d: true,
          splitPair: ["1", "2"],
          activePane: 0,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: seed,
            b: seed,
            binop: "xor",
            focus: "a",
            expressions: {
              a: "((log.A >> 1) | (log.A << (N - 1))) ^ (log.A | ((log.A << 1) | (log.A >> (N - 1))))",
              b: "log.A",
            },
          }),
          "2": laneDoc({
            a: seed,
            b: seed,
            binop: "xor",
            focus: "a",
            expressions: {
              a: "(log.C ^ ((log.C << 1) | (log.C >> (N - 1)))) | (~((log.C >> 1) | (log.C << (N - 1))) & log.C)",
              b: "log.C",
            },
          }),
        },
        routes: [],
        parked: {},
      };
    },
  },
  {
    id: "bitcrush-tdm",
    name: "Bit-Crush & TDM Chopper",
    summary: "256b · 3D split · 2-bit quant + interleave",
    description:
      "Lane 2 splits rotating sine into 2-bit coarse staircase (C) + quantization error (D) with OR → sine; Lane 3 interleaves even/odd nibbles of counter-rotating sine and saw.",
    amount: 4,
    record: false,
    autoLfo: true,
    build: () => {
      const N = 256;
      return {
        schema: PROJECT_SCHEMA,
        app: PROJECT_APP,
        savedAt: PRESET_SAVED_AT,
        N,
        view: {
          lane: "2",
          view3d: true,
          split3d: true,
          splitPair: ["2", "3"],
          activePane: 0,
          lfoMode: "rotcw",
          lfoRate: 4,
        },
        lanes: {
          "1": laneDoc({
            a: tableHex("sine", N),
            b: tableHex("sawUp", N),
            binop: "xor",
            lfoB: "opp",
          }),
          "2": laneDoc({
            a: zeroHex(N),
            b: zeroHex(N),
            binop: "or",
            expressions: {
              a: "A & ((~0 / 15) * 12)",
              b: "A & ((~0 / 15) * 3)",
            },
          }),
          "3": laneDoc({
            a: zeroHex(N),
            b: zeroHex(N),
            binop: "xor",
            expressions: {
              a: "(A & ((~0 / 17) * 16)) | (B & (~0 / 17))",
              b: "(B & ((~0 / 17) * 16)) | (A & (~0 / 17))",
            },
          }),
        },
        routes: [],
        parked: {},
      };
    },
  },
];

/** Look up a built-in patch preset by stable id. */
export function findPatchPreset(id: string): PatchPreset | undefined {
  return PATCH_PRESETS.find((preset) => preset.id === id);
}
