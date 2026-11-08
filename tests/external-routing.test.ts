/**
 * External-routing design prototype: expression semantics + the clocked
 * pipeline. Expected values are computed independently here with BigInt maths,
 * not by calling the evaluator for both sides.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPRESSION_LIMITS,
  ExpressionError,
  compileExpression,
  evaluateCompiled,
  evaluateExpression as rawEval,
} from "../src/core/expression.ts";
import { runExternalRouting, wordHex } from "../src/core/external-routing.ts";
import { cellToRegister, columnMode, parseDataset } from "../src/core/csv.ts";
import { regToBig } from "../src/core/registers.ts";
import { DEMO_CSV } from "../src/state/demo-data.ts";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ExpressionError) return error.code;
    throw error;
  }
  return undefined;
}

const env = (frames: Record<string, bigint>, width = 8, log?: Record<string, bigint>) => ({
  width,
  frames,
  log,
});

/** Small-value assertions read better as numbers; the API stays BigInt. */
const ev = (source: string, environment = env({})): number => Number(rawEval(source, environment));

test("expression evaluator: literals, precedence, names and functions", () => {
  assert.equal(ev("1 + 2 * 3", env({})), 7);
  assert.equal(ev("(1 + 2) * 3", env({})), 9);
  assert.equal(ev("0x10 + 1", env({})), 17);
  assert.equal(ev("N - 1", env({}, 8)), 7);
  assert.equal(ev("A & 0x0F", env({ A: 0x123n })), 3);
  assert.equal(ev("A | 1", env({ A: 0x10n })), 0x11);
  assert.equal(ev("A ^ 0xFF", env({ A: 0x0Fn })), 0xF0);
  assert.equal(ev("~0", env({})), 255);
  assert.equal(ev("1 << 3", env({})), 8);
  assert.equal(ev("128 >> 2", env({})), 32);
  assert.equal(ev("7 % 3", env({})), 1);
  assert.equal(ev("floor(1.9)", env({})), 1);
  assert.equal(ev("ceil(1.1)", env({})), 2);
  assert.equal(ev("round(1.5)", env({})), 2);
  assert.equal(ev("round(1.4)", env({})), 1);
  assert.equal(ev("abs(0 - 3)", env({})), 3);
  assert.equal(ev("min(3, 1, 2)", env({})), 1);
  assert.equal(ev("max(3, 1, 2)", env({})), 3);
});

test("expression evaluator: word wrap, modulo and rationals", () => {
  assert.equal(ev("A + 2", env({ A: 255n })), 1);
  assert.equal(ev("1 << 8", env({})), 0);
  assert.equal(ev("0 - round(1.5)", env({})), 254); // -2 mod 256
  assert.equal(ev("round(1 / 3 * 3)", env({})), 1);
  assert.equal(ev("round(2.5)", env({})), 3);
  assert.equal(ev("round(0 - 2.5)", env({})), 253); // -3 mod 256
  assert.equal(ev("round(1.2599210498948732 * C)", env({ C: 100n })), 126);
});

test("expression evaluator: log access", () => {
  assert.equal(ev("log.C + 1", env({ C: 5n }, 8, { C: 9n })), 10);
  assert.equal(codeOf(() => ev("log.C", env({}, 8))), "E_EXPR_UNKNOWN_NAME");
});

test("expression evaluator: typed errors", () => {
  assert.equal(codeOf(() => ev("1 / 3", env({}))), "E_EXPR_TYPE");
  assert.equal(codeOf(() => ev("1 / 0", env({}))), "E_EXPR_DIV_ZERO");
  assert.equal(codeOf(() => ev("Q", env({}))), "E_EXPR_UNKNOWN_NAME");
  assert.equal(codeOf(() => ev("1 +", env({}))), "E_EXPR_SYNTAX");
  assert.equal(codeOf(() => ev("foo(1)", env({}))), "E_EXPR_UNKNOWN_NAME");
  assert.equal(codeOf(() => ev("1.2 & 1", env({}))), "E_EXPR_TYPE");
  assert.equal(codeOf(() => ev("1 << -1", env({}))), "E_EXPR_DOMAIN");
  assert.equal(codeOf(() => ev("A", env({}))), "E_EXPR_UNKNOWN_NAME");
  assert.equal(codeOf(() => ev("", env({}))), "E_EXPR_SYNTAX");
  assert.equal(codeOf(() => ev("x".repeat(EXPRESSION_LIMITS.source + 1), env({}))), "E_EXPR_TOO_LARGE");
});

test("compile once, evaluate many", () => {
  const compiled = compileExpression("round(1.5 * C)");
  assert.equal(Number(evaluateCompiled(compiled, env({ C: 4n }))), 6);
  assert.equal(Number(evaluateCompiled(compiled, env({ C: 5n }))), 8);
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const WIDTH = 256;
const MASK = (1n << 256n) - 1n;

function parseDemoRows(width: number): { a: bigint; b: bigint }[] {
  const dataset = parseDataset(DEMO_CSV);
  assert.ok(dataset);
  const aIndex = dataset.cols.indexOf("sine");
  const bIndex = dataset.cols.indexOf("ramp");
  assert.ok(aIndex >= 0 && bIndex >= 0);
  const cell = (row: string[], index: number): bigint => {
    const bits = cellToRegister(row[index], columnMode(dataset.rows, index), width);
    assert.ok(bits);
    return regToBig(bits, width);
  };
  return dataset.rows.map((row) => ({ a: cell(row, aIndex), b: cell(row, bIndex) }));
}

function roundAway(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  const abs = n < 0n ? -n : n;
  const q = abs / d;
  const r = abs % d;
  return sign * (r * 2n >= d ? q + 1n : q);
}

const K2 = { n: 12599210498948732n, d: 10000000000000000n };
const K3 = { n: 14422495703074083n, d: 10000000000000000n };

const EXPR_D = "round(1.2599210498948732 * C)";
const EXPR_F = "round(1.4422495703074083 * E)";

test("pipeline: demo -> Z1 -> C -> D -> Z2 -> E -> F -> Z3 (256-bit)", () => {
  const rows = parseDemoRows(WIDTH);
  const run = runExternalRouting({
    width: WIDTH,
    binop: "xor",
    expressionD: EXPR_D,
    expressionF: EXPR_F,
    rows,
  });

  assert.equal(run.steps.length, 8);
  assert.equal(wordHex(run.steps[0].A, WIDTH), "000000000000000000000000000000000000000000000000000000008ADEFEDA");

  for (let i = 0; i < run.steps.length; i += 1) {
    const step = run.steps[i];
    const A = rows[i].a;
    const B = rows[i].b;
    const Z1 = (A ^ B) & MASK;
    const C = Z1;
    const D = roundAway(C * K2.n, K2.d) & MASK;
    const Z2 = (C ^ D) & MASK;
    const E = Z2;
    const F = roundAway(E * K3.n, K3.d) & MASK;
    const Z3 = (E ^ F) & MASK;

    assert.equal(step.A, A, `step ${i + 1} A`);
    assert.equal(step.B, B, `step ${i + 1} B`);
    assert.equal(step.Z1, Z1, `step ${i + 1} Z1`);
    assert.equal(step.C, C, `step ${i + 1} C`);
    assert.equal(step.D, D, `step ${i + 1} D`);
    assert.equal(step.Z2, Z2, `step ${i + 1} Z2`);
    assert.equal(step.E, E, `step ${i + 1} E`);
    assert.equal(step.F, F, `step ${i + 1} F`);
    assert.equal(step.Z3, Z3, `step ${i + 1} Z3`);
  }

  assert.ok(run.log);
  const last = run.steps[run.steps.length - 1];
  assert.deepEqual(run.log, {
    A: last.A, B: last.B, Z1: last.Z1, C: last.C, D: last.D,
    Z2: last.Z2, E: last.E, F: last.F, Z3: last.Z3,
  });
});

test("pipeline: the log is the previous update, one step late", () => {
  const run = runExternalRouting({
    width: 8,
    binop: "xor",
    expressionD: "C + log.C",
    expressionF: "E",
    initialLog: { C: 1n },
    rows: [
      { a: 1n, b: 0n },
      { a: 2n, b: 0n },
    ],
  });
  assert.equal(run.steps[0].D, 2n); // C=1 + previous C=1
  assert.equal(run.steps[1].D, 3n); // C=2 + previous C=1
  assert.equal(run.steps[1].log?.C, 1n);

  assert.throws(
    () =>
      runExternalRouting({
        width: 8,
        expressionD: "C + log.C",
        expressionF: "E",
        rows: [{ a: 1n, b: 0n }],
      }),
    (error: unknown) => error instanceof ExpressionError && error.code === "E_EXPR_UNKNOWN_NAME",
  );
});

test("pipeline: deterministic hex output", () => {
  const rows = parseDemoRows(64);
  const one = runExternalRouting({ width: 64, expressionD: EXPR_D, expressionF: EXPR_F, rows });
  const two = runExternalRouting({ width: 64, expressionD: EXPR_D, expressionF: EXPR_F, rows });
  const encode = (run: ReturnType<typeof runExternalRouting>) =>
    JSON.stringify(run.steps.map((step) => ({
      step: step.step,
      A: wordHex(step.A, run.width), B: wordHex(step.B, run.width),
      Z1: wordHex(step.Z1, run.width), C: wordHex(step.C, run.width),
      D: wordHex(step.D, run.width), Z2: wordHex(step.Z2, run.width),
      E: wordHex(step.E, run.width), F: wordHex(step.F, run.width),
      Z3: wordHex(step.Z3, run.width),
    })));
  assert.equal(encode(one), encode(two));
});

