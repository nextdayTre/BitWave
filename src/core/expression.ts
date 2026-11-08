/**
 * Expression evaluator for external routing / Lane Logic (prototype, not yet wired
 * into the app or the `.bitwave` schema).
 *
 * The rule that matters: this is a **deterministic register expression**, not a
 * scripting engine. Values are exact rationals internally, frame operands are
 * unsigned N-bit words, bitwise operators coerce to those words, and the final
 * value must be an integer before it wraps modulo 2^N. No floats, no `eval`, no
 * ambient state — the same text and environment always produce the same bits in
 * the browser, the CLI and plain Node.
 *
 * Grammar (prototype):
 *
 *   expression := or
 *   or         := xor ( '|' xor )*
 *   xor        := and ( '^' and )*
 *   and        := shift ( '&' shift )*
 *   shift      := sum ( ('<<' | '>>') sum )*
 *   sum        := product ( ('+' | '-') product )*
 *   product    := unary ( ('*' | '/' | '%') unary )*
 *   unary      := ('+' | '-' | '~') unary | primary
 *   primary    := number | name | name '(' args ')' | '(' expression ')'
 *
 * `number` is decimal, decimal-fraction or `0x` hex. `name` is a global frame
 * name (`A`–`F`, `Z1`–`Z3`), the register width `N`, or `log.<frame>` for the
 * previous recorded snapshot. Functions: `floor`, `ceil`, `round`, `abs`, `min`,
 * `max` (round is half away from zero).
 *
 * Errors are typed (`ExpressionError.code`) and never leak stacks. Limits bound
 * the source, AST depth, numeric size and shift counts so a bad patch cannot hang
 * the instrument.
 */

export const EXPRESSION_LIMITS = {
  /** Maximum source characters. */
  source: 4096,
  /** Maximum parser/AST nesting. */
  depth: 64,
  /** Maximum decimal digits in one literal. */
  digits: 128,
  /** Maximum total bits of a rational numerator + denominator. */
  bits: 4096,
  /** Maximum shift count. */
  shift: 4096,
  /** Maximum width accepted by the evaluator. */
  width: 4096,
} as const;

export type ExpressionErrorCode =
  | "E_EXPR_SYNTAX"
  | "E_EXPR_UNKNOWN_NAME"
  | "E_EXPR_TYPE"
  | "E_EXPR_DIV_ZERO"
  | "E_EXPR_DOMAIN"
  | "E_EXPR_RANGE"
  | "E_EXPR_TOO_LARGE";

export class ExpressionError extends Error {
  readonly code: ExpressionErrorCode;
  readonly hint?: string;
  readonly position?: number;

  constructor(code: ExpressionErrorCode, message: string, hint?: string, position?: number) {
    super(message);
    this.name = "ExpressionError";
    this.code = code;
    this.hint = hint;
    this.position = position;
  }
}

export interface ExpressionEnv {
  /** Register width in bits; operands and the result live in [0, 2^width). */
  width: number;
  /** Current frame words, keyed by global name (`A`…`F`, `Z1`…`Z3`). */
  frames: Readonly<Record<string, bigint>>;
  /** Previous recorded snapshot, if any. Access as `log.<frame>`. */
  log?: Readonly<Record<string, bigint>>;
}

export interface CompiledExpression {
  readonly source: string;
  readonly ast: ExprNode;
}

// ---------------------------------------------------------------------------
// Exact rationals
// ---------------------------------------------------------------------------

interface Rational {
  /** Numerator; sign lives here. */
  n: bigint;
  /** Positive denominator. */
  d: bigint;
}

type ExprNode =
  | { kind: "number"; value: Rational }
  | { kind: "name"; name: string }
  | { kind: "unary"; op: string; operand: ExprNode }
  | { kind: "binary"; op: string; left: ExprNode; right: ExprNode }
  | { kind: "call"; name: string; args: ExprNode[] };

const ZERO: Rational = { n: 0n, d: 1n };
const ONE: Rational = { n: 1n, d: 1n };

function absBig(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function bitLength(value: bigint): number {
  return value === 0n ? 0 : absBig(value).toString(2).length;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = absBig(a);
  let y = absBig(b);
  while (y !== 0n) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

function fail(code: ExpressionErrorCode, message: string, hint?: string, position?: number): never {
  throw new ExpressionError(code, message, hint, position);
}

function rational(n: bigint, d: bigint): Rational {
  if (d === 0n) fail("E_EXPR_DIV_ZERO", "division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return ZERO;
  const g = gcd(n, d);
  const out = { n: n / g, d: d / g };
  if (bitLength(out.n) + bitLength(out.d) > EXPRESSION_LIMITS.bits) {
    fail("E_EXPR_TOO_LARGE", "expression value grew beyond the supported size");
  }
  return out;
}

function ratAdd(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

function ratSub(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}

function ratMul(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}

function ratDiv(a: Rational, b: Rational): Rational {
  if (b.n === 0n) fail("E_EXPR_DIV_ZERO", "division by zero");
  return rational(a.n * b.d, a.d * b.n);
}

function ratNeg(a: Rational): Rational {
  return { n: -a.n, d: a.d };
}

function ratCmp(a: Rational, b: Rational): number {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

function intOf(value: Rational, what: string): bigint {
  if (value.d !== 1n) {
    fail("E_EXPR_TYPE", `${what} requires an integer, got a fraction`, "wrap the value in round(), floor() or ceil()");
  }
  return value.n;
}

function floorOf(value: Rational): bigint {
  const q = value.n / value.d;
  const r = value.n % value.d;
  return r !== 0n && value.n < 0n ? q - 1n : q;
}

function ceilOf(value: Rational): bigint {
  const q = value.n / value.d;
  const r = value.n % value.d;
  return r !== 0n && value.n > 0n ? q + 1n : q;
}

/** Round half away from zero (the usual "round()" in maths, not banker's). */
function roundOf(value: Rational): bigint {
  const sign = value.n < 0n ? -1n : 1n;
  const n = absBig(value.n);
  const q = n / value.d;
  const r = n % value.d;
  return sign * (r * 2n >= value.d ? q + 1n : q);
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { kind: "number"; value: Rational; text: string; pos: number }
  | { kind: "name"; value: string; pos: number }
  | { kind: "op"; value: string; pos: number }
  | { kind: "lparen" | "rparen" | "comma"; pos: number };

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function skipWhitespace(source: string, at: number): number {
  let i = at;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    i = skipWhitespace(source, i);
    if (i >= source.length) break;
    const ch = source[i];

    if (ch === "(") {
      tokens.push({ kind: "lparen", pos: i });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", pos: i });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", pos: i });
      i += 1;
      continue;
    }

    if (ch === "0" && (source[i + 1] === "x" || source[i + 1] === "X")) {
      const start = i;
      i += 2;
      const digitsStart = i;
      while (i < source.length && /[0-9a-fA-F]/.test(source[i])) i += 1;
      if (i === digitsStart) fail("E_EXPR_SYNTAX", "hex literal has no digits", undefined, start);
      tokens.push({ kind: "number", value: rational(BigInt("0x" + source.slice(digitsStart, i)), 1n), text: source.slice(start, i), pos: start });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < source.length && /[0-9]/.test(source[i])) i += 1;
      if (source[i] === ".") {
        i += 1;
        const fracStart = i;
        while (i < source.length && /[0-9]/.test(source[i])) i += 1;
        if (i === fracStart) fail("E_EXPR_SYNTAX", "decimal literal has no fraction digits", undefined, start);
      }
      const text = source.slice(start, i);
      const dot = text.indexOf(".");
      if (dot === -1) {
        tokens.push({ kind: "number", value: rational(BigInt(text), 1n), text, pos: start });
      } else {
        const frac = text.slice(dot + 1);
        if (frac.length > EXPRESSION_LIMITS.digits) {
          fail("E_EXPR_TOO_LARGE", "decimal literal has too many digits", undefined, start);
        }
        const digits = text.slice(0, dot) + frac;
        tokens.push({ kind: "number", value: rational(BigInt(digits), 10n ** BigInt(frac.length)), text, pos: start });
      }
      continue;
    }

    if (IDENT_START.test(ch)) {
      const start = i;
      while (i < source.length && IDENT_PART.test(source[i])) i += 1;
      // One optional dotted suffix: log.A (not a general object path).
      if (source[i] === "." && i + 1 < source.length && IDENT_START.test(source[i + 1])) {
        i += 1;
        while (i < source.length && IDENT_PART.test(source[i])) i += 1;
      }
      tokens.push({ kind: "name", value: source.slice(start, i), pos: start });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (two === "<<" || two === ">>") {
      tokens.push({ kind: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if ("+-*/%&|^~".includes(ch)) {
      tokens.push({ kind: "op", value: ch, pos: i });
      i += 1;
      continue;
    }

    fail("E_EXPR_SYNTAX", `unexpected character ${JSON.stringify(ch)}`, undefined, i);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.tokens[this.index] ?? null;
  }

  private next(): Token | null {
    return this.tokens[this.index++] ?? null;
  }

  private expect(kind: "rparen"): Token {
    const token = this.next();
    if (!token || token.kind !== kind) fail("E_EXPR_SYNTAX", "expected ')'", undefined, token ? token.pos : undefined);
    return token;
  }

  parse(): ExprNode {
    if (this.tokens.length === 0) fail("E_EXPR_SYNTAX", "expression is empty");
    const node = this.parseOr(0);
    if (this.index !== this.tokens.length) {
      const token = this.tokens[this.index];
      fail("E_EXPR_SYNTAX", "unexpected input after expression", undefined, token.pos);
    }
    return node;
  }

  private depthCheck(depth: number): void {
    if (depth > EXPRESSION_LIMITS.depth) {
      fail("E_EXPR_TOO_LARGE", "expression is nested too deeply");
    }
  }

  private parseOr(depth: number): ExprNode {
    this.depthCheck(depth);
    let left = this.parseXor(depth + 1);
    while (this.peek()?.kind === "op" && (this.peek() as { value: string }).value === "|") {
      this.next();
      left = { kind: "binary", op: "|", left, right: this.parseXor(depth + 1) };
    }
    return left;
  }

  private parseXor(depth: number): ExprNode {
    let left = this.parseAnd(depth + 1);
    while (this.peek()?.kind === "op" && (this.peek() as { value: string }).value === "^") {
      this.next();
      left = { kind: "binary", op: "^", left, right: this.parseAnd(depth + 1) };
    }
    return left;
  }

  private parseAnd(depth: number): ExprNode {
    let left = this.parseShift(depth + 1);
    while (this.peek()?.kind === "op" && (this.peek() as { value: string }).value === "&") {
      this.next();
      left = { kind: "binary", op: "&", left, right: this.parseShift(depth + 1) };
    }
    return left;
  }

  private parseShift(depth: number): ExprNode {
    let left = this.parseSum(depth + 1);
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "<<" && token.value !== ">>")) break;
      this.next();
      left = { kind: "binary", op: token.value, left, right: this.parseSum(depth + 1) };
    }
    return left;
  }

  private parseSum(depth: number): ExprNode {
    let left = this.parseProduct(depth + 1);
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "+" && token.value !== "-")) break;
      this.next();
      left = { kind: "binary", op: token.value, left, right: this.parseProduct(depth + 1) };
    }
    return left;
  }

  private parseProduct(depth: number): ExprNode {
    let left = this.parseUnary(depth + 1);
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "*" && token.value !== "/" && token.value !== "%")) break;
      this.next();
      left = { kind: "binary", op: token.value, left, right: this.parseUnary(depth + 1) };
    }
    return left;
  }

  private parseUnary(depth: number): ExprNode {
    this.depthCheck(depth);
    const token = this.peek();
    if (token?.kind === "op" && (token.value === "+" || token.value === "-" || token.value === "~")) {
      this.next();
      return { kind: "unary", op: token.value, operand: this.parseUnary(depth + 1) };
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): ExprNode {
    this.depthCheck(depth);
    const token = this.next();
    if (!token) fail("E_EXPR_SYNTAX", "unexpected end of expression");

    if (token.kind === "number") return { kind: "number", value: token.value };

    if (token.kind === "lparen") {
      const inner = this.parseOr(depth + 1);
      this.expect("rparen");
      return inner;
    }

    if (token.kind === "name") {
      const after = this.peek();
      if (after?.kind === "lparen") {
        this.next();
        const args: ExprNode[] = [];
        if (this.peek()?.kind !== "rparen") {
          for (;;) {
            args.push(this.parseOr(depth + 1));
            const sep = this.peek();
            if (sep?.kind === "comma") {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expect("rparen");
        return { kind: "call", name: token.value, args };
      }
      return { kind: "name", name: token.value };
    }

    fail("E_EXPR_SYNTAX", "expected a number, name or '('", undefined, token.pos);
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const FUNCTIONS = new Set(["floor", "ceil", "round", "abs", "min", "max"]);
const NAMES = new Set(["A", "B", "C", "D", "E", "F", "Z1", "Z2", "Z3", "N"]);

function lookupName(name: string, env: ExpressionEnv): Rational {
  if (name === "N") return rational(BigInt(env.width), 1n);
  if (name.startsWith("log.")) {
    const frame = name.slice(4);
    if (!env.log || !(frame in env.log)) {
      fail("E_EXPR_UNKNOWN_NAME", `log.${frame} is not available`, "the log is empty until the first recorded update");
    }
    return rational(env.log[frame], 1n);
  }
  if (!NAMES.has(name)) {
    fail("E_EXPR_UNKNOWN_NAME", `unknown name: ${name}`, "frame names are A–F, Z1–Z3; the width is N; log frames are log.<name>");
  }
  if (!(name in env.frames)) {
    fail("E_EXPR_UNKNOWN_NAME", `${name} is not in this expression's frame environment`);
  }
  return rational(env.frames[name], 1n);
}

function wordOf(value: Rational, env: ExpressionEnv, what: string): bigint {
  const integer = intOf(value, what);
  const modulus = 1n << BigInt(env.width);
  return ((integer % modulus) + modulus) % modulus;
}

function shiftCount(value: Rational): bigint {
  const count = intOf(value, "a shift count");
  if (count < 0n) fail("E_EXPR_DOMAIN", "shift count must be non-negative");
  if (count > BigInt(EXPRESSION_LIMITS.shift)) {
    fail("E_EXPR_TOO_LARGE", `shift count exceeds ${EXPRESSION_LIMITS.shift}`);
  }
  return count;
}

function callFunction(name: string, args: Rational[], env: ExpressionEnv): Rational {
  if (!FUNCTIONS.has(name)) {
    fail("E_EXPR_UNKNOWN_NAME", `unknown function: ${name}`, "supported: floor, ceil, round, abs, min, max");
  }
  if (name === "floor" || name === "ceil" || name === "round" || name === "abs") {
    if (args.length !== 1) fail("E_EXPR_SYNTAX", `${name}() takes exactly one argument`);
    if (name === "floor") return rational(floorOf(args[0]), 1n);
    if (name === "ceil") return rational(ceilOf(args[0]), 1n);
    if (name === "round") return rational(roundOf(args[0]), 1n);
    return args[0].n < 0n ? ratNeg(args[0]) : args[0];
  }
  if (args.length < 1) fail("E_EXPR_SYNTAX", `${name}() takes at least one argument`);
  let best = args[0];
  for (const arg of args.slice(1)) {
    const cmp = ratCmp(arg, best);
    if (name === "min" ? cmp < 0 : cmp > 0) best = arg;
  }
  return best;
}

function evalNode(node: ExprNode, env: ExpressionEnv): Rational {
  switch (node.kind) {
    case "number":
      return node.value;
    case "name":
      return lookupName(node.name, env);
    case "unary": {
      const operand = evalNode(node.operand, env);
      if (node.op === "+") return operand;
      if (node.op === "-") return ratNeg(operand);
      return rational(wordOf(operand, env, "~") ^ ((1n << BigInt(env.width)) - 1n), 1n);
    }
    case "binary": {
      const left = evalNode(node.left, env);
      const right = evalNode(node.right, env);
      switch (node.op) {
        case "+": return ratAdd(left, right);
        case "-": return ratSub(left, right);
        case "*": return ratMul(left, right);
        case "/": return ratDiv(left, right);
        case "%": {
          const divisor = intOf(right, "%");
          if (divisor === 0n) fail("E_EXPR_DIV_ZERO", "modulo by zero");
          return rational(intOf(left, "%") % divisor, 1n);
        }
        case "&":
          return rational(wordOf(left, env, "&") & wordOf(right, env, "&"), 1n);
        case "|":
          return rational(wordOf(left, env, "|") | wordOf(right, env, "|"), 1n);
        case "^":
          return rational(wordOf(left, env, "^") ^ wordOf(right, env, "^"), 1n);
        case "<<": {
          const count = shiftCount(right);
          const mask = (1n << BigInt(env.width)) - 1n;
          return rational((wordOf(left, env, "<<") << count) & mask, 1n);
        }
        case ">>":
          return rational(wordOf(left, env, ">>") >> shiftCount(right), 1n);
        default:
          fail("E_EXPR_SYNTAX", `unknown operator: ${node.op}`);
      }
      break;
    }
    case "call": {
      const args = node.args.map((arg) => evalNode(arg, env));
      return callFunction(node.name, args, env);
    }
    default:
      fail("E_EXPR_SYNTAX", "invalid expression node");
  }
}

function normalizeEnv(env: ExpressionEnv): ExpressionEnv {
  if (!Number.isInteger(env.width) || env.width < 1 || env.width > EXPRESSION_LIMITS.width) {
    fail("E_EXPR_RANGE", `width must be an integer in [1, ${EXPRESSION_LIMITS.width}]`);
  }
  return env;
}

/** Parse once; throws ExpressionError on invalid text. */
export function compileExpression(source: string): CompiledExpression {
  if (typeof source !== "string") fail("E_EXPR_SYNTAX", "expression must be a string");
  if (source.trim() === "") fail("E_EXPR_SYNTAX", "expression is empty");
  if (source.length > EXPRESSION_LIMITS.source) {
    fail("E_EXPR_TOO_LARGE", `expression exceeds ${EXPRESSION_LIMITS.source} characters`);
  }
  const tokens = tokenize(source);
  const ast = new Parser(tokens).parse();
  return { source, ast };
}

/** Evaluate a compiled expression to an unsigned N-bit word. */
export function evaluateCompiled(compiled: CompiledExpression, env: ExpressionEnv): bigint {
  normalizeEnv(env);
  const value = evalNode(compiled.ast, env);
  if (value.d !== 1n) {
    fail(
      "E_EXPR_TYPE",
      "expression must return an integer",
      "wrap the result in round(), floor() or ceil()",
    );
  }
  const modulus = 1n << BigInt(env.width);
  return ((value.n % modulus) + modulus) % modulus;
}

/** Compile and evaluate in one call (the convenience path used by tests/tools). */
export function evaluateExpression(source: string, env: ExpressionEnv): bigint {
  return evaluateCompiled(compileExpression(source), env);
}
