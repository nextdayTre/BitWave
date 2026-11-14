#!/usr/bin/env node
/**
 * Share-budget proof for the compact `#bw=` codec (D43/D45).
 *
 * Builds deterministic fixtures that exercise the documented table — 3 lanes at
 * 64 and 256 bits, 8 lanes at 256 bits, with and without a dataset and with and
 * without expression sources — plus the budget-policy cases (dataset drop first,
 * then expressions, never silently). Prints the measured characters so the
 * numbers in `docs/DYNAMIC-LANES.md` §4 / `DECISIONS.md` D45 can be reproduced.
 *
 * Reads nothing, writes nothing, needs no browser: one shared core, one table.
 *
 * Usage: node tools/share-budget.mjs [--json]
 */

import { fileURLToPath } from "node:url";

import {
  addRoute,
  createRouting,
  evaluateAll,
  fromHex,
  makeBootLanes,
  makeLane,
  serializeProject,
} from "../src/core/index.ts";
import { laneDef } from "../src/core/lanedefs.ts";
import { buildShareLink, canonicalShareDocument } from "../src/core/agent-share.ts";
import { SHARE_MAX_CHARS, encodeCompactShare } from "../src/core/share.ts";

const MASK64 = (1n << 64n) - 1n;
const CANONICAL_NOW = "1970-01-01T00:00:00.000Z";

/** A realistic imported CSV: three columns and three token rows (like examples/demo.bitwave.json). */
export function demoDataset() {
  return {
    cols: ["id", "sine", "square"],
    rows: [
      ["1", "8ADEFEDA85210125", "FFFFFFFF00000000"],
      ["2", "852101258ADEFEDA", "FFFF0000FFFF0000"],
      ["3", "FEDA852101257ADE", "0F0F0F0F0F0F0F0F"],
    ],
    index: 1,
  };
}

/** A bigger imported CSV (8 columns × 8 rows) used to prove the dataset-drop path. */
export function wideDataset() {
  const cols = Array.from({ length: 8 }, (_, c) => `ch${c + 1}`);
  const rows = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) {
      const value = (BigInt(r * 8 + c + 1) * 0x9e3779b97f4a7c15n) & MASK64;
      row.push(value.toString(16).toUpperCase().padStart(16, "0"));
    }
    rows.push(row);
  }
  return { cols, rows, index: 0 };
}

const DATASETS = { none: null, demo: demoDataset, wide: wideDataset };

/**
 * A deterministic document for the budget table.
 *
 * @param {object} options
 * @param {number} [options.lanes]  lane count (3 or 8)
 * @param {number} [options.N]      register width
 * @param {"none"|"demo"|"wide"} [options.dataset]
 * @param {boolean} [options.expressions]  one realistic expression per operand
 * @param {number} [options.routes]  number of cross-lane routes to attach
 */
export function buildShareBudgetDoc({ lanes = 3, N = 64, dataset = "none", expressions = false, routes = 0 } = {}) {
  const laneMap = makeBootLanes(N);
  for (let key = 4; key <= lanes; key++) {
    const lane = makeLane(String(key), N);
    const half = N / 8; // bytes per word, as two hex digits
    lane.A.bits = fromHex("FEDCBA9876543210".repeat(4).slice(0, half * 2), N);
    lane.B.bits = fromHex("0F0F0F0F0F0F0F0F".repeat(4).slice(0, half * 2), N);
    laneMap[String(key)] = lane;
  }

  const routing = createRouting();
  // One route per destination, deterministic and always between distinct lanes.
  for (let i = 0; i < routes; i++) {
    const fromLane = String(((i + 2) % lanes) + 1);
    const toLane = String((i % lanes) + 1);
    const frame = i < lanes ? "a" : "b";
    const sourceFrame = i % 2 === 0 ? "z" : "a";
    addRoute(routing, laneMap, { lane: fromLane, frame: sourceFrame }, { lane: toLane, frame });
  }
  evaluateAll(routing, laneMap, N);

  const focus = {};
  const frameVis = {};
  const expressionsByLane = {};
  for (let index = 0; index < lanes; index++) {
    const key = String(index + 1);
    focus[key] = key === "3" ? "b" : "a";
    frameVis[key] = { a: true, b: key === "2" ? false : true, z: true };
    if (expressions) {
      const def = laneDef(index);
      expressionsByLane[key] = {
        a: `round(1.2599210498948732 * ${def.a})`,
        b: `round(1.2599210498948732 * ${def.b})`,
      };
    }
  }

  const view = {
    lane: String(Math.min(lanes, 2)),
    view3d: false,
    split3d: false,
    splitPair: ["1", String(Math.min(lanes, 2))],
    activePane: 0,
  };
  const makeDataset = DATASETS[dataset];
  return serializeProject(laneMap, routing, N, view, makeDataset ? makeDataset() : null, CANONICAL_NOW, {
    focus,
    frameVis,
    lfoMode: "rotcw",
    lfoRate: 4,
    expressions: expressionsByLane,
  });
}

/** Payload of the canonical document without applying the drop policy. */
export function compactPayloadChars(doc) {
  return encodeCompactShare(canonicalShareDocument(doc)).length;
}

/** One measured row: raw compact size and the policy outcome. */
function measure(label, options) {
  const doc = buildShareBudgetDoc(options);
  const link = buildShareLink(doc);
  return {
    label,
    lanes: options?.lanes ?? 3,
    N: options?.N ?? 64,
    dataset: options?.dataset ?? "none",
    expressions: Boolean(options?.expressions),
    routes: options?.routes ?? 0,
    payloadChars: compactPayloadChars(doc),
    linkPayloadChars: link.payloadChars,
    withinBudget: link.withinBudget,
    datasetDropped: link.datasetDropped,
    expressionsDropped: link.expressionsDropped,
  };
}

/** The documented table plus the budget-policy cases. */
export function measureShareBudget() {
  const rows = [];
  for (const [lanes, N] of [
    [3, 64],
    [3, 256],
    [8, 256],
  ]) {
    for (const dataset of ["none", "demo"]) {
      for (const expressions of [false, true]) {
        const label = `${lanes} lanes · ${N}-bit · ${dataset === "none" ? "no dataset" : "3×3 dataset"} · ${expressions ? "expressions" : "no expressions"}`;
        rows.push(measure(label, { lanes, N, dataset, expressions }));
      }
    }
  }
  rows.push(measure("8 lanes · 256-bit · 8×8 dataset · no expressions", { lanes: 8, N: 256, dataset: "wide" }));
  rows.push(measure("8 lanes · 256-bit · no dataset · 8 routes · expressions", { lanes: 8, N: 256, routes: 8, expressions: true }));
  rows.push(measure("8 lanes · 256-bit · 3×3 dataset · 8 routes · expressions", { lanes: 8, N: 256, dataset: "demo", routes: 8, expressions: true }));
  rows.push(measure("8 lanes · 256-bit · no dataset · 16 routes · no expressions", { lanes: 8, N: 256, routes: 16 }));
  return rows;
}

function printTable(rows) {
  console.log(`# Share budget (payload characters after 'bw='; SHARE_MAX_CHARS = ${SHARE_MAX_CHARS})\n`);
  console.log("| fixture | raw compact | after drop policy | within budget | datasetDropped | expressionsDropped |");
  console.log("|---|---:|---:|:---:|:---:|:---:|");
  for (const row of rows) {
    console.log(
      `| ${row.label} | ${row.payloadChars} | ${row.linkPayloadChars} | ${row.withinBudget ? "yes" : "NO"} | ${row.datasetDropped ? "yes" : "no"} | ${row.expressionsDropped ? "yes" : "no"} |`,
    );
  }
  const clean = rows.find((row) => row.label === "8 lanes · 256-bit · no dataset · no expressions");
  if (clean) {
    console.log(`\n8-lane 256-bit no-dataset payload: ${clean.payloadChars} chars (headroom ${SHARE_MAX_CHARS - clean.payloadChars}).`);
  }
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  return process.platform === "win32"
    ? self.toLowerCase() === entry.toLowerCase()
    : self === entry;
})();

if (isMain) {
  const rows = measureShareBudget();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ budgetChars: SHARE_MAX_CHARS, rows }, null, 2));
  } else {
    printTable(rows);
  }
}
