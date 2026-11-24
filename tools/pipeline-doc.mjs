#!/usr/bin/env node
/**
 * pipeline-doc — turn an external tool's stage table into a schema-5 BitWave
 * document, and report what BitWave can and cannot show *before* anyone runs
 * the computation.
 *
 * The contract is docs/PIPELINE-HANDOFF.md. One implementation rule: this
 * script imports src/core for CSV parsing, register widths, free frames,
 * routing and the .bitwave/share codecs — it never re-implements any of it.
 *
 * Usage:
 *   node tools/pipeline-doc.mjs --pipeline examples/btc-p2pkh.pipeline.json \
 *     --out examples/btc-p2pkh.bitwave.json --base "file:///C:/…/bitwave-v2.html" --json
 *   node tools/pipeline-doc.mjs --pipeline … --out … --check   # freshness gate
 *
 * Exit codes: 0 ok, 1 invalid pipeline / stale output, 2 usage.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { APP_FREE_FRAME_CAP, APP_LANE_CAP, freeFrameKeyFromName, freeFrameName } from "../src/core/lanedefs.ts";
import { makeBootLanes, makeFreeFrame } from "../src/core/lanes.ts";
import { SIZES, fromHex, toHex } from "../src/core/registers.ts";
import { addRoute, createRouting } from "../src/core/routing.ts";
import { parseDataset } from "../src/core/csv.ts";
import { serializeProject, stringifyProject } from "../src/core/project.ts";
import { buildShareLink } from "../src/core/agent-share.ts";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= argv.length) fail(`missing value for ${name}`, 2);
  return argv[index + 1];
};
const has = (name) => argv.includes(name);

function fail(message, code = 1) {
  console.error(`pipeline-doc: ${message}`);
  process.exit(code);
}

const pipelinePath = flag("--pipeline", null);
if (!pipelinePath) fail("--pipeline <file> is required (see docs/PIPELINE-HANDOFF.md)", 2);
const outPath = flag("--out", null);
const base = flag("--base", null);
const asJson = has("--json");
const check = has("--check");

let spec;
try {
  spec = JSON.parse(readFileSync(pipelinePath, "utf8"));
} catch (error) {
  fail(`cannot read ${pipelinePath}: ${error.message}`);
}
if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail("pipeline must be a JSON object");

const warnings = [];
const N = spec.width ?? 256;
if (!SIZES.includes(N)) {
  fail(`width ${N} is not representable; this build offers ${SIZES.join(", ")}`);
}

const specDir = dirname(resolve(pipelinePath));
const stages = Array.isArray(spec.stages) ? spec.stages : [];
if (stages.length === 0) fail("pipeline.stages must list at least one stage");
if (stages.length > APP_FREE_FRAME_CAP) {
  fail(`pipeline has ${stages.length} stages; a document holds at most ${APP_FREE_FRAME_CAP} free frames`);
}

/* ── dataset (optional) ───────────────────────────────────────────────────── */
let dataset = null;
let columns = new Map();
if (typeof spec.dataset === "string" && spec.dataset !== "") {
  const datasetPath = isAbsolute(spec.dataset) ? spec.dataset : resolve(specDir, spec.dataset);
  let text;
  try {
    text = readFileSync(datasetPath, "utf8");
  } catch (error) {
    fail(`cannot read dataset ${datasetPath}: ${error.message}`);
  }
  dataset = parseDataset(text);
  if (!dataset) fail(`dataset ${datasetPath} has no data rows`);
  dataset.index = 0;
  columns = new Map(dataset.cols.map((name, index) => [name, index]));
}

/* ── stages ───────────────────────────────────────────────────────────────── */
const freeFrames = {};
const report = [];
const seen = new Set();

stages.forEach((stage, index) => {
  const key = freeFrameKeyFromName(stage.frame ?? `F${index + 1}`);
  if (key === null) fail(`stage ${index + 1}: ${JSON.stringify(stage.frame)} is not F1–F16`);
  const name = freeFrameName(key);
  if (seen.has(name)) fail(`duplicate stage frame ${name}`);
  seen.add(name);

  let value = stage.hex;
  let col = -1;
  if (typeof stage.column === "string" && stage.column !== "") {
    if (!dataset) fail(`${name}: column ${JSON.stringify(stage.column)} needs a dataset`);
    if (!columns.has(stage.column)) {
      fail(`${name}: dataset has no column ${JSON.stringify(stage.column)}; it has ${[...columns.keys()].join(", ")}`);
    }
    col = columns.get(stage.column);
    value = dataset.rows[0][col];
  }
  if (typeof value !== "string" || value.trim() === "") fail(`${name}: needs "hex" or a dataset "column"`);

  const clean = value.trim().replace(/^0[xX]/, "");
  if (!/^[0-9a-fA-F]+$/.test(clean)) fail(`${name}: ${JSON.stringify(value)} is not hexadecimal`);
  const significant = clean.replace(/^0+/, "");
  const bits = significant.length * 4;
  if (bits > N) fail(`${name}: ${bits} bits do not fit the ${N}-bit document (truncation is not silent here)`);

  const ff = makeFreeFrame(key, N, { label: stage.label, sourceNote: stage.sourceNote });
  ff.reg.bits = fromHex(clean, N);
  ff.col = col;
  freeFrames[key] = ff;

  report.push({
    frame: name,
    label: stage.label ?? null,
    source: col >= 0 ? `column:${stage.column}` : "hex",
    bits,
    padBits: N - bits,
    hex: toHex(ff.reg.bits, N),
  });
});

const bound = report.filter((stage) => stage.source.startsWith("column:")).map((stage) => stage.frame);
if (dataset && dataset.rows.length > 1 && bound.length > 0) {
  warnings.push(
    `${bound.length} stages are bound to ${dataset.rows.length} dataset rows (${bound.join(", ")}) — step rows to cycle projects`,
  );
}

/* ── lanes ────────────────────────────────────────────────────────────────── */
const lanes = makeBootLanes(N);
const routing = createRouting();
const laneSpecs = Array.isArray(spec.lanes) ? spec.lanes : [];
if (laneSpecs.length > APP_LANE_CAP) {
  fail(`pipeline has ${laneSpecs.length} lanes; a document holds at most ${APP_LANE_CAP}`);
}
const laneReport = [];
for (const laneSpec of laneSpecs) {
  const laneKey = String(laneSpec.lane ?? "");
  if (!lanes[laneKey]) {
    fail(`lane ${JSON.stringify(laneSpec.lane)} is outside this scaffolder's boot lanes (${Object.keys(lanes).join(", ")}); add it in the app`);
  }
  if (!["and", "or", "xor", "add", "sub"].includes(laneSpec.binop)) {
    fail(`lane ${laneKey}: binop must be one of and, or, xor, add, sub`);
  }
  lanes[laneKey].binop = laneSpec.binop;
  for (const frame of ["a", "b"]) {
    const source = laneSpec[frame];
    if (typeof source !== "string") fail(`lane ${laneKey}: needs "a" and "b" source frames`);
    if (!/^F\d+$/i.test(source)) fail(`lane ${laneKey}.${frame}: ${JSON.stringify(source)} must be a free-frame name (F1…F16)`);
    const sourceKey = freeFrameKeyFromName(source);
    if (sourceKey === null) fail(`lane ${laneKey}.${frame}: ${JSON.stringify(source)} is not F1–F16`);
    const sourceName = freeFrameName(sourceKey);
    if (!seen.has(sourceName)) fail(`lane ${laneKey}.${frame}: ${sourceName} is not a declared stage`);
    addRoute(routing, lanes, { free: sourceKey }, { lane: laneKey, frame }, "set", freeFrames);
  }
  laneReport.push({ lane: laneKey, a: laneSpec.a, b: laneSpec.b, binop: laneSpec.binop, note: laneSpec.note ?? null });
}

/* ── assemble ─────────────────────────────────────────────────────────────── */
const focusKey = spec.view?.activeFree ? freeFrameKeyFromName(String(spec.view.activeFree)) : null;
if (spec.view?.activeFree && focusKey === null) fail(`view.activeFree ${JSON.stringify(spec.view.activeFree)} is not F1–F16`);
const focus = focusKey === null ? null : freeFrameName(focusKey);
if (focus && !seen.has(focus)) fail(`view.activeFree ${focus} is not a declared stage`);

const doc = serializeProject(
  lanes,
  routing,
  N,
  {
    lane: "1",
    ...(focus ? { activeFree: focus.slice(1) } : {}),
    view3d: false,
    split3d: false,
    activePane: 0,
    lfoMode: "rotcw",
    lfoRate: 4,
  },
  dataset,
  spec.savedAt ?? "2026-01-01T00:00:00.000Z",
  {
    freeFrames,
    freeVis: Object.fromEntries(Object.keys(freeFrames).map((key) => [key, true])),
    freeExpressions: {},
  },
);

const link = buildShareLink(doc);
if (!link.withinBudget) warnings.push(`canonical link is ${link.payloadChars} chars, over the 2000 budget`);
if (link.datasetDropped) warnings.push("a canonical link would drop the dataset");
const url = base ? `${base}${link.fragment}` : link.fragment;
const text = stringifyProject(doc);

if (check) {
  if (!outPath) fail("--check needs --out", 2);
  let current = null;
  try {
    current = readFileSync(outPath, "utf8");
  } catch {
    fail(`${outPath} does not exist; run without --check to generate it`);
  }
  if (current !== text) fail(`${outPath} is stale; re-run without --check`);
}

if (outPath && !check) {
  try {
    writeFileSync(outPath, text);
  } catch (error) {
    fail(`cannot write ${outPath}: ${error.message}`);
  }
}

const summary = {
  ok: true,
  document: outPath ?? null,
  title: spec.title ?? null,
  width: N,
  stages: report,
  lanes: laneReport,
  dataset: dataset ? { columns: dataset.cols, rows: dataset.rows.length } : null,
  deeplink: url,
  payloadChars: link.payloadChars,
  withinBudget: link.withinBudget,
  warnings,
};

if (asJson) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} else {
  console.log(`${spec.title ?? "pipeline"} — ${N}-bit, ${report.length} stages, ${laneReport.length} lanes`);
  for (const stage of report) {
    const pad = stage.padBits > 0 ? `, ${stage.padBits} leading zero bits` : "";
    console.log(`  ${stage.frame.padEnd(3)} ${(stage.label ?? "").padEnd(10)} ${stage.source.padEnd(16)} ${stage.bits} bits${pad}`);
  }
  for (const lane of laneReport) console.log(`  lane ${lane.lane}: ${lane.a} ${lane.binop} ${lane.b}${lane.note ? `  — ${lane.note}` : ""}`);
  if (dataset) console.log(`  dataset: ${dataset.rows.length} rows × ${dataset.cols.length} columns (step rows to cycle)`);
  console.log(`  link: ${link.payloadChars} chars${link.withinBudget ? "" : " (OVER BUDGET)"}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  if (!outPath) console.log("  (no --out; document not written)");
}
