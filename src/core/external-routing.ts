/**
 * External-routing pipeline prototype (design-stage; not wired into the app).
 *
 * The mental model this encodes:
 *
 *   A, B  -> Z1                 (lane 1 evaluates normally)
 *   Z1    -> C                  (live 1:1 route into lane 2's own register)
 *   C     -> D                  (expression operand; the "Lane Logic" seat)
 *   C, D  -> Z2                 (lane 2 evaluates after D is written)
 *   Z2    -> E                  (live 1:1 route into lane 3)
 *   E     -> F                  (expression operand)
 *   E, F  -> Z3
 *
 * Exactly one record row is appended per clocked update, after the whole pipeline
 * has settled. Expressions see the current operands plus the **previous** log row
 * (`log.<frame>`); the one-update delay is what prevents a frame from reading a
 * snapshot that includes its own result.
 *
 * Everything is integer BigInt modulo 2^width; the expression evaluator owns the
 * rational/rounding semantics. No DOM, no timestamps, no ambient state.
 */

import type { BinOp } from "./types.ts";
import { bigToReg, regToBig } from "./registers.ts";
import { computeZ } from "./derive.ts";
import { evaluateExpression } from "./expression.ts";

export interface ExternalRoutingInput {
  /** Operand A word (0 … 2^width-1). Values outside the range wrap. */
  a: bigint;
  /** Operand B word. */
  b: bigint;
}

export interface ExternalRoutingConfig {
  /** Register width in bits (8…256, multiple of 8, matching the instrument). */
  width: number;
  /** Lane operator used for Z1, Z2 and Z3. Default "xor". */
  binop?: BinOp;
  /** Expression that writes lane 2's D operand, e.g. "round(1.2599210498948732 * C)". */
  expressionD: string;
  /** Expression that writes lane 3's F operand. */
  expressionF: string;
  /** One input row per clocked update. */
  rows: readonly ExternalRoutingInput[];
  /** Seed for `log.<frame>` on the first update; omit to make the log absent. */
  initialLog?: Readonly<Record<string, bigint>> | null;
}

export interface ExternalRoutingStep {
  /** 1-based clocked update. */
  step: number;
  A: bigint;
  B: bigint;
  Z1: bigint;
  C: bigint;
  D: bigint;
  Z2: bigint;
  E: bigint;
  F: bigint;
  Z3: bigint;
  /** The snapshot available while this step was computed (previous update). */
  log: Readonly<Record<string, bigint>> | null;
}

export interface ExternalRoutingRun {
  width: number;
  binop: BinOp;
  expressionD: string;
  expressionF: string;
  steps: ExternalRoutingStep[];
  /** The row appended by the last update (null for an empty run). */
  log: Readonly<Record<string, bigint>> | null;
}

const BINOPS: readonly BinOp[] = ["and", "or", "xor", "add", "sub"];

function validateWidth(width: number): void {
  if (!Number.isInteger(width) || width < 8 || width > 256 || width % 8 !== 0) {
    throw new TypeError(`width must be one of 8, 16, 32, 64, 128, 256; got ${String(width)}`);
  }
}

function maskOf(width: number): bigint {
  return (1n << BigInt(width)) - 1n;
}

function word(value: bigint, mask: bigint): bigint {
  return ((value % mask) + mask) % mask;
}

function wordToBits(value: bigint, width: number): Uint8Array {
  const bits = new Uint8Array(width);
  bigToReg(value, bits, width);
  return bits;
}

/** One lane derivation through the real core engine (not a parallel formula). */
export function deriveWord(
  a: bigint,
  b: bigint,
  width: number,
  binop: BinOp,
): bigint {
  const mask = maskOf(width);
  const z = computeZ(wordToBits(word(a, mask), width), wordToBits(word(b, mask), width), width, binop);
  return regToBig(z, width);
}

/**
 * Run the clocked pipeline. Each update:
 *   1. lane 1: A, B -> Z1
 *   2. route  Z1 -> C
 *   3. evaluate D from the expression environment (C, current frames, previous log)
 *   4. lane 2: C, D -> Z2
 *   5. route  Z2 -> E
 *   6. evaluate F from (E, current frames, previous log)
 *   7. lane 3: E, F -> Z3
 *   8. append one snapshot of every frame to the log
 */
export function runExternalRouting(config: ExternalRoutingConfig): ExternalRoutingRun {
  validateWidth(config.width);
  const binop = config.binop ?? "xor";
  if (!BINOPS.includes(binop)) throw new TypeError(`unsupported binop: ${String(binop)}`);
  const width = config.width;
  const mask = maskOf(width);

  let log: Readonly<Record<string, bigint>> | null = config.initialLog ?? null;
  const steps: ExternalRoutingStep[] = [];

  for (let index = 0; index < config.rows.length; index += 1) {
    const A = word(config.rows[index].a, mask);
    const B = word(config.rows[index].b, mask);
    const Z1 = deriveWord(A, B, width, binop);

    /* A live 1:1 route: lane 2's C is its own register, assigned from Z1. */
    const C = Z1;

    const D = evaluateExpression(config.expressionD, {
      width,
      frames: { A, B, Z1, C },
      log: log ?? undefined,
    });

    const Z2 = deriveWord(C, D, width, binop);

    /* A live 1:1 route: lane 3's E is its own register, assigned from Z2. */
    const E = Z2;

    const F = evaluateExpression(config.expressionF, {
      width,
      frames: { A, B, Z1, C, D, Z2, E },
      log: log ?? undefined,
    });

    const Z3 = deriveWord(E, F, width, binop);

    steps.push({ step: index + 1, A, B, Z1, C, D, Z2, E, F, Z3, log });
    log = { A, B, Z1, C, D, Z2, E, F, Z3 };
  }

  return {
    width,
    binop,
    expressionD: config.expressionD,
    expressionF: config.expressionF,
    steps,
    log,
  };
}

/** Hex form of a word at a width (for display/tests; no formatting state). */
export function wordHex(value: bigint, width: number): string {
  const bits = wordToBits(value, width);
  let out = "";
  const HEX = "0123456789ABCDEF";
  const nibbles = width >> 2;
  for (let j = 0; j < nibbles; j += 1) {
    let nibble = 0;
    for (let k = 0; k < 4; k += 1) {
      nibble = (nibble << 1) | bits[width - 1 - (j * 4 + k)];
    }
    out += HEX[nibble];
  }
  return out;
}
