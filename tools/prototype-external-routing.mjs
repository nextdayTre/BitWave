#!/usr/bin/env node
/**
 * Node-only prototype for the external-routing design note:
 * demo data -> lane 1 -> Z1 -> C -> D expression -> Z2 -> E -> F expression -> Z3,
 * recording one row of every frame per clocked update.
 *
 * No browser, no app wiring, no schema change. The point is to prove the clock
 * order, the register maths and the expression semantics on real core modules.
 *
 * Usage:
 *   node tools/prototype-external-routing.mjs [--width 64] [--json] [--check]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  cellToRegister,
  columnMode,
  parseDataset,
} from "../src/core/csv.ts";
import { regToBig } from "../src/core/registers.ts";
import { runExternalRouting, wordHex } from "../src/core/external-routing.ts";
import { DEMO_CSV } from "../src/state/demo-data.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const EXPRESSIONS = {
  d: "round(1.2599210498948732 * C)",
  f: "round(1.4422495703074083 * E)",
};

function parseArgs(argv) {
  const options = { width: 64, json: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--check") { options.check = true; continue; }
    if (arg === "--width") {
      const raw = argv[++i];
      if (raw === undefined || !/^\d+$/.test(raw)) throw new Error("--width expects an integer");
      options.width = Number(raw);
      continue;
    }
    if (arg.startsWith("--width=")) {
      const raw = arg.slice("--width=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--width expects an integer");
      options.width = Number(raw);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

/** Convert one demo cell into an N-bit word through the normal import rules. */
function cellWord(cell, columnIndex, rows, width) {
  const mode = columnMode(rows, columnIndex);
  const bits = cellToRegister(cell, mode, width);
  if (!bits) throw new Error(`demo cell ${JSON.stringify(cell)} is not a token`);
  return regToBig(bits, width);
}

export function buildDemoRows(width) {
  const dataset = parseDataset(DEMO_CSV);
  if (!dataset) throw new Error("demo dataset did not parse");
  const aIndex = dataset.cols.indexOf("sine");
  const bIndex = dataset.cols.indexOf("ramp");
  if (aIndex < 0 || bIndex < 0) throw new Error("demo dataset is missing its sine/ramp columns");
  return dataset.rows.map((row) => ({
    a: cellWord(row[aIndex], aIndex, dataset.rows, width),
    b: cellWord(row[bIndex], bIndex, dataset.rows, width),
  }));
}

export function demoRun(width = 64) {
  return runExternalRouting({
    width,
    binop: "xor",
    expressionD: EXPRESSIONS.d,
    expressionF: EXPRESSIONS.f,
    rows: buildDemoRows(width),
  });
}

function runToJson(run) {
  const step = (value) => ({
    step: value.step,
    A: wordHex(value.A, run.width),
    B: wordHex(value.B, run.width),
    Z1: wordHex(value.Z1, run.width),
    C: wordHex(value.C, run.width),
    D: wordHex(value.D, run.width),
    Z2: wordHex(value.Z2, run.width),
    E: wordHex(value.E, run.width),
    F: wordHex(value.F, run.width),
    Z3: wordHex(value.Z3, run.width),
    log: value.log
      ? Object.fromEntries(Object.entries(value.log).map(([key, word]) => [key, wordHex(word, run.width)]))
      : null,
  });
  return {
    width: run.width,
    binop: run.binop,
    expressions: { d: run.expressionD, f: run.expressionF },
    steps: run.steps.map(step),
    log: run.log ? Object.fromEntries(Object.entries(run.log).map(([key, word]) => [key, wordHex(word, run.width)])) : null,
  };
}

function check(run) {
  let checks = 0;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
    checks += 1;
  };

  assert(run.steps.length === 8, `expected 8 demo steps, got ${run.steps.length}`);
  for (const step of run.steps) {
    assert(step.C === step.Z1, `step ${step.step}: C must be the live Z1 route`);
    assert(step.E === step.Z2, `step ${step.step}: E must be the live Z2 route`);
    assert(step.log === null || step.log.A !== undefined, `step ${step.step}: log must be a frame snapshot`);
  }
  assert(run.log !== null && run.log.Z3 !== undefined, "final log must contain every frame");

  const second = demoRun(run.width);
  assert(JSON.stringify(runToJson(run)) === JSON.stringify(runToJson(second)), "run must be deterministic");

  return { checks, json: runToJson(run) };
}

function printRun(run) {
  console.log(`BitWave external-routing prototype — ${run.width}-bit, ${run.steps.length} demo updates, binop ${run.binop}`);
  console.log(`  D = ${run.expressionD}`);
  console.log(`  F = ${run.expressionF}`);
  console.log("");
  for (const step of run.steps) {
    const hex = (value) => wordHex(value, run.width);
    console.log(`step ${step.step}`);
    console.log(`  A ${hex(step.A)}  B ${hex(step.B)}  Z1 ${hex(step.Z1)}`);
    console.log(`  C ${hex(step.C)}  D ${hex(step.D)}  Z2 ${hex(step.Z2)}`);
    console.log(`  E ${hex(step.E)}  F ${hex(step.F)}  Z3 ${hex(step.Z3)}`);
  }
  if (run.log) {
    console.log("");
    console.log("final log row (= next update's log.<frame>):");
    console.log(`  ${Object.entries(run.log).map(([key, value]) => `${key}=${wordHex(value, run.width)}`).join("  ")}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("usage: node tools/prototype-external-routing.mjs [--width 64] [--json] [--check]");
    return 0;
  }
  const run = demoRun(options.width);
  if (options.check) {
    const result = check(run);
    console.log(`prototype check: ${result.checks} checks passed (${options.width}-bit, deterministic)`);
    return 0;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(runToJson(run), null, 2)}\n`);
    return 0;
  }
  printRun(run);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`prototype failed: ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}
