/**
 * Agent tool registry — the single source of truth for every transport.
 *
 * DOM-free and deterministic. The browser bridge, CLI and MCP server import
 * `TOOLS`, `callTool`, `buildDeeplink`, `getManifest` and `normalizeAgentPatch`
 * from this module; none of them re-implements register maths.
 */

import {
  BINOPS,
  DEFAULT_WIDTH,
  LFO_MODES,
  LFO_RATES,
  SCHEMA_VERSION,
  TOOL_ID,
  TOOL_TITLE,
  TOOLSET_VERSION,
  VIEW_MODES,
  WIDTHS,
  exampleProjectDoc,
  frameRefFromName,
  laneKeyFromNumber,
  type ViewMode,
} from "./agent-defaults.ts";
import { buildShareLink, type ShareLink } from "./agent-share.ts";
import { columnMode, columnWidth, parseDataset } from "./csv.ts";
import { carryOrBorrow, computeZ, popcountZ, truthCounts } from "./derive.ts";
import { EXPRESSION_LIMITS, ExpressionError, compileExpression } from "./expression.ts";
import { ProjectError, type ProjectDoc } from "./project.ts";
import { fromHex, nibAt, nibCount, popcount, regToBig, toHex, type RegisterSize } from "./registers.ts";
import { SHARE_MAX_CHARS } from "./share.ts";
import type { BinOp } from "./types.ts";

export { SCHEMA_VERSION, TOOLSET_VERSION } from "./agent-defaults.ts";

export const ERROR_CODES = [
  "E_BAD_ARGS",
  "E_UNKNOWN_TOOL",
  "E_EMPTY_INPUT",
  "E_INVALID_HEX",
  "E_INVALID_PROJECT",
  "E_BAD_ENUM",
  "E_OUT_OF_RANGE",
  "E_INPUT_TOO_LARGE",
  "E_DRIVEN_INPUT",
  "E_BAD_STATE",
  "E_INVALID_EXPRESSION",
  "E_INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AgentToolError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
    this.hint = hint;
  }
}

export interface Example {
  args: Record<string, unknown>;
  note: string;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: "pure";
  inputSchema: Record<string, unknown>;
  examples: Example[];
  run: (args: unknown) => unknown;
}

export interface SuccessEnvelope {
  ok: true;
  schemaVersion: number;
  tool: string;
  data: unknown;
  deeplink: string | null;
  warnings: string[];
}

export interface FailureEnvelope {
  ok: false;
  schemaVersion: number;
  tool: string;
  error: { code: ErrorCode; message: string; hint?: string };
  warnings: string[];
}

export type Envelope = SuccessEnvelope | FailureEnvelope;

export interface ToolSummary {
  name: string;
  title: string;
  description: string;
  scope: "pure";
  inputSchema: Record<string, unknown>;
  examples: Example[];
}

export interface Manifest {
  id: string;
  title: string;
  version: string;
  schemaVersion: number;
  description: string;
  urls: Record<string, string>;
  deeplink: { template: string; prefix: string; budgetChars: number; defaults: Record<string, unknown> };
  ui: Record<string, string>;
  tools: ToolSummary[];
  errorCodes: string[];
  invariants: string[];
  relatedTools: never[];
}

// ---------------------------------------------------------------------------
// Validation helpers (throw AgentToolError; callTool converts to envelopes)
// ---------------------------------------------------------------------------

const MAX_TEXT_CHARS = 262144;
const MAX_COLUMNS = 64;
const MAX_DATASET_ROWS = 512;
const HEX_RE = /^[0-9a-fA-F]+$/;

function bad(code: ErrorCode, message: string, hint?: string): never {
  throw new AgentToolError(code, message, hint);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function argsObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) bad("E_BAD_ARGS", "arguments must be a JSON object");
  return value;
}

function objectValue(value: unknown, where: string): Record<string, unknown> {
  if (!isObject(value)) bad("E_BAD_ARGS", `${where} must be a JSON object`);
  return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) bad("E_BAD_ARGS", `${where} has an unknown key: ${key}`);
  }
}

function hexText(value: unknown, where: string): string {
  if (typeof value !== "string") bad("E_BAD_ARGS", `${where} must be a string`);
  const text = value.trim().replace(/^0[xX]/, "");
  if (text === "") bad("E_EMPTY_INPUT", `${where} is empty`);
  if (!HEX_RE.test(text)) bad("E_INVALID_HEX", `${where} is not hexadecimal: ${JSON.stringify(value)}`);
  return text;
}

function widthOf(value: unknown): RegisterSize {
  if (value === undefined) return DEFAULT_WIDTH;
  if (typeof value === "number" && (WIDTHS as readonly number[]).includes(value)) return value as RegisterSize;
  bad("E_BAD_ENUM", `width must be one of: ${WIDTHS.join(", ")}`);
}

function binopOf(value: unknown, fallback: BinOp = "xor"): BinOp {
  if (value === undefined) return fallback;
  if (typeof value === "string" && (BINOPS as readonly string[]).includes(value)) return value as BinOp;
  bad("E_BAD_ENUM", `op must be one of: ${BINOPS.join(", ")}`);
}

function integerValue(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) bad("E_BAD_ARGS", `${where} must be an integer`);
  return value;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function analyzeRegisterData(args: unknown): unknown {
  const input = argsObject(args);
  onlyKeys(input, ["hex", "width"], "args");
  const width = widthOf(input.width);
  const bits = fromHex(hexText(input.hex, "hex"), width);
  const nibbles: number[] = [];
  for (let j = 0; j < nibCount(width); j++) nibbles.push(nibAt(bits, width, j));
  const value = regToBig(bits, width);
  return {
    width,
    hex: toHex(bits, width),
    decimal: value.toString(),
    nibbles,
    popcount: popcount(bits),
    bitLength: value === 0n ? 0 : value.toString(2).length,
  };
}

function evaluateLaneData(args: unknown): unknown {
  const input = argsObject(args);
  onlyKeys(input, ["a", "b", "op", "width"], "args");
  const width = widthOf(input.width);
  const op = binopOf(input.op);
  const aText = hexText(input.a, "a");
  const bText = input.b === undefined ? "0" : hexText(input.b, "b");
  const aBits = fromHex(aText, width);
  const bBits = fromHex(bText, width);
  const zBits = computeZ(aBits, bBits, width, op);
  return {
    width,
    op,
    a: { hex: toHex(aBits, width), popcount: popcount(aBits) },
    b: { hex: toHex(bBits, width), popcount: popcount(bBits) },
    z: { hex: toHex(zBits, width), popcount: popcountZ(zBits) },
    truthCounts: truthCounts(aBits, bBits, width),
    carry: op === "add" ? carryOrBorrow(aBits, bBits, width, "add") : null,
    borrow: op === "sub" ? carryOrBorrow(aBits, bBits, width, "sub") : null,
  };
}

function compareOperandsData(args: unknown): unknown {
  const input = argsObject(args);
  onlyKeys(input, ["a", "b", "width"], "args");
  const width = widthOf(input.width);
  const aBits = fromHex(hexText(input.a, "a"), width);
  const bBits = fromHex(hexText(input.b, "b"), width);
  const results = BINOPS.map((op) => {
    const zBits = computeZ(aBits, bBits, width, op);
    return {
      op,
      z: toHex(zBits, width),
      popcount: popcountZ(zBits),
      carry: op === "add" ? carryOrBorrow(aBits, bBits, width, "add") : null,
      borrow: op === "sub" ? carryOrBorrow(aBits, bBits, width, "sub") : null,
    };
  });
  return {
    width,
    a: { hex: toHex(aBits, width), popcount: popcount(aBits) },
    b: { hex: toHex(bBits, width), popcount: popcount(bBits) },
    truthCounts: truthCounts(aBits, bBits, width),
    results,
  };
}

function parseDatasetData(args: unknown): unknown {
  const input = argsObject(args);
  onlyKeys(input, ["text", "maxRows"], "args");
  if (typeof input.text !== "string") bad("E_BAD_ARGS", "text must be a string");
  if (input.text.trim() === "") bad("E_EMPTY_INPUT", "text is empty");
  if (input.text.length > MAX_TEXT_CHARS) {
    bad("E_INPUT_TOO_LARGE", `text is ${input.text.length} characters (cap ${MAX_TEXT_CHARS})`);
  }
  let maxRows = 64;
  if (input.maxRows !== undefined) {
    maxRows = integerValue(input.maxRows, "maxRows");
    if (maxRows < 1 || maxRows > MAX_DATASET_ROWS) {
      bad("E_OUT_OF_RANGE", `maxRows must be in [1, ${MAX_DATASET_ROWS}]`);
    }
  }
  const dataset = parseDataset(input.text);
  if (!dataset) bad("E_EMPTY_INPUT", "no data rows");
  if (dataset.cols.length > MAX_COLUMNS) {
    bad("E_INPUT_TOO_LARGE", `${dataset.cols.length} columns (cap ${MAX_COLUMNS})`);
  }
  return {
    columns: dataset.cols.map((name, ci) => ({
      name,
      mode: columnMode(dataset.rows, ci),
      widthBits: columnWidth(dataset.rows, ci),
    })),
    totalRows: dataset.rows.length,
    truncated: dataset.rows.length > maxRows,
    rows: dataset.rows.slice(0, maxRows).map((row) => row.slice()),
  };
}

function buildDeeplinkData(args: unknown): unknown {
  const input = argsObject(args);
  onlyKeys(input, ["project", "base"], "args");
  if (input.project === undefined) bad("E_BAD_ARGS", "project is required");

  let link: ShareLink;
  try {
    link = buildShareLink(input.project as ProjectDoc);
  } catch (error) {
    if (error instanceof ProjectError) bad("E_INVALID_PROJECT", error.message);
    throw error;
  }
  if (!link.withinBudget) {
    bad(
      "E_INPUT_TOO_LARGE",
      `share payload is ${link.payloadChars} characters (budget ${SHARE_MAX_CHARS})`,
      "remove the dataset or expression sources, or use a smaller register width",
    );
  }

  let url: string | null = null;
  if (input.base !== undefined) {
    if (typeof input.base !== "string" || input.base === "" || input.base.includes("#")) {
      bad("E_BAD_ARGS", "base must be an absolute URL without a fragment");
    }
    url = input.base + link.fragment;
  }

  return {
    fragment: link.fragment,
    payloadChars: link.payloadChars,
    withinBudget: link.withinBudget,
    datasetDropped: link.datasetDropped,
    expressionsDropped: link.expressionsDropped,
    url,
  };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export const TOOLS: ToolDef[] = [
  {
    name: "manifest",
    title: "Tool manifest",
    description:
      "Return BitWave's capability manifest: tool definitions, argument schemas, deeplink template, UI selectors, error codes, invariants and related tools. Call this first to discover the other tools.",
    scope: "pure",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    examples: [{ args: {}, note: "Discover the full toolset." }],
    run: () => getManifest(),
  },
  {
    name: "analyze_register",
    title: "Analyze a register word",
    description:
      "Normalize a hex word at a register width and return the same nibble, decimal, popcount and bit-length values the instrument shows. Overflow truncates high bits; optional 0x prefix accepted.",
    scope: "pure",
    inputSchema: {
      type: "object",
      properties: {
        hex: { type: "string", description: "Hexadecimal word; 0x prefix optional." },
        width: { type: "integer", enum: WIDTHS, description: "Register width in bits (default 64)." },
      },
      required: ["hex"],
      additionalProperties: false,
    },
    examples: [{ args: { hex: "8ADEFEDA85210125", width: 64 }, note: "A default 64-bit operand." }],
    run: (args) => analyzeRegisterData(args),
  },
  {
    name: "evaluate_lane",
    title: "Evaluate one lane",
    description:
      "Compute Z = A <op> B for one lane with the instrument's own bitwise/arithmetic engine. Returns A, B, Z, truth-table counts (00,01,10,11) and carry/borrow for ADD/SUB.",
    scope: "pure",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "Operand A hex." },
        b: { type: "string", description: "Operand B hex (default 0)." },
        op: { type: "string", enum: BINOPS, description: "Binary operator (default xor)." },
        width: { type: "integer", enum: WIDTHS, description: "Register width in bits (default 64)." },
      },
      required: ["a"],
      additionalProperties: false,
    },
    examples: [
      { args: { a: "8ADEFEDA85210125", b: "FFFFFFFF00000000", op: "xor" }, note: "The DESIGN §11 A·B vector." },
    ],
    run: (args) => evaluateLaneData(args),
  },
  {
    name: "compare_operands",
    title: "Compare all operators",
    description:
      "Evaluate the same A/B pair under all five operators (and, or, xor, add, sub) in canonical order, with Z, popcounts, truth counts and carry/borrow. Use for teaching or choosing an operator.",
    scope: "pure",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "Operand A hex." },
        b: { type: "string", description: "Operand B hex." },
        width: { type: "integer", enum: WIDTHS, description: "Register width in bits (default 64)." },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
    examples: [
      { args: { a: "8ADEFEDA85210125", b: "FFFFFFFF00000000" }, note: "All five operators on the §11 pair." },
    ],
    run: (args) => compareOperandsData(args),
  },
  {
    name: "parse_dataset",
    title: "Parse a CSV/TSV dataset",
    description:
      "Parse delimited text with the instrument's import rules: delimiter sniffed from the header, header detected when the first row is not token-shaped, per-column bin/hex typing and token width. Returns columns, total rows and the first maxRows rows.",
    scope: "pure",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "CSV or TSV text." },
        maxRows: { type: "integer", minimum: 1, maximum: MAX_DATASET_ROWS, description: "Rows to return (default 64)." },
      },
      required: ["text"],
      additionalProperties: false,
    },
    examples: [
      { args: { text: "Hex 1,Hex 2\n00000001,00000002", maxRows: 2 }, note: "Header plus two token rows." },
    ],
    run: (args) => parseDatasetData(args),
  },
  {
    name: "build_deeplink",
    title: "Build a canonical deeplink",
    description:
      "Validate a .bitwave document (schema 1–4; older schemas are upgraded) and build its canonical schema-4 compact share fragment (#bw=). Canonical links omit savedAt, so equal state gives equal links; the dataset is dropped first and expression sources second if the payload would exceed the 2000-character budget, each reported by its own flag.",
    scope: "pure",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "object", description: "A .bitwave document (schema 1–4)." },
        base: { type: "string", description: "Absolute URL without a fragment; omit to return only the fragment." },
      },
      required: ["project"],
      additionalProperties: false,
    },
    examples: [
      {
        args: { project: exampleProjectDoc(), base: "http://localhost:8000/" },
        note: "8-bit boot document (schema 4).",
      },
    ],
    run: (args) => buildDeeplinkData(args),
  },
];

const TOOL_SUMMARIES: ToolSummary[] = TOOLS.map(({ name, title, description, scope, inputSchema, examples }) => ({
  name,
  title,
  description,
  scope,
  inputSchema,
  examples,
}));

// ---------------------------------------------------------------------------
// Envelopes + dispatch
// ---------------------------------------------------------------------------

function success(tool: string, data: unknown, deeplink: string | null): SuccessEnvelope {
  return { ok: true, schemaVersion: SCHEMA_VERSION, tool, data, deeplink, warnings: [] };
}

function failure(tool: string, error: unknown): FailureEnvelope {
  const known = error instanceof AgentToolError;
  const payload: { code: ErrorCode; message: string; hint?: string } = {
    code: known ? error.code : "E_INTERNAL",
    message: known ? error.message : "internal error",
  };
  if (known && error.hint !== undefined) payload.hint = error.hint;
  return { ok: false, schemaVersion: SCHEMA_VERSION, tool, error: payload, warnings: [] };
}

export function callTool(name: unknown, args: unknown = undefined): Envelope {
  const toolName = typeof name === "string" ? name : "";
  const tool = TOOLS.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return failure(toolName, new AgentToolError("E_UNKNOWN_TOOL", `unknown tool: ${JSON.stringify(name)}`, "call manifest to list tools"));
  }
  if (args !== undefined && args !== null && !isObject(args)) {
    return failure(tool.name, new AgentToolError("E_BAD_ARGS", "arguments must be a JSON object"));
  }
  try {
    const data = tool.run(args);
    let deeplink: string | null = null;
    if (tool.name === "build_deeplink" && isObject(data)) {
      deeplink = typeof data.url === "string" ? data.url : typeof data.fragment === "string" ? data.fragment : null;
    }
    return success(tool.name, data, deeplink);
  } catch (error) {
    return failure(tool.name, error);
  }
}

/** Build the canonical share link; throws AgentToolError or ProjectError. */
export function buildDeeplink(args: unknown): unknown {
  return buildDeeplinkData(args);
}

export function getManifest(): Manifest {
  return {
    id: TOOL_ID,
    title: TOOL_TITLE,
    version: TOOLSET_VERSION,
    schemaVersion: SCHEMA_VERSION,
    description:
      "BitWave renders a bit register as a wavetable: compute Z = A op B for any lane (the shipped range is 1–8; the default instrument boots with 3), compare operators, parse CSV/TSV datasets and build canonical #bw= deeplinks from one shared, deterministic core.",
    urls: {
      app: "bitwave-v2.html",
      manifest: "agent/manifest.json",
      agents: "AGENTS.md",
      interface: "docs/AGENT-INTERFACE.md",
    },
    deeplink: {
      template: "bitwave-v2.html#bw={payload}",
      prefix: "#bw=",
      budgetChars: SHARE_MAX_CHARS,
      defaults: { lane: 1, view: "2d", width: DEFAULT_WIDTH },
    },
    ui: {
      bridge: "window.bitwave",
      ready: "body[data-agent-ready='true']",
      stateSelector: "#bitwave-state",
      panelSelector: "[data-agent-panel]",
      tabSelector: "[data-agent-tab]",
      /** The active stage-bar lane dropdown (a native `<select>`), valued by lane key. */
      laneSelect: "#stageBar .lane-select",
      laneSelector: "[data-agent-lane]",
      frameSelector: "[data-agent-frame]",
    },
    tools: TOOL_SUMMARIES.map((tool) => ({
      ...tool,
      examples: tool.examples.map((example) => ({ args: example.args, note: example.note })),
    })),
    errorCodes: [...ERROR_CODES],
    invariants: [
      "src/core is the only implementation of the maths/data",
      "tool output is deterministic; no timestamps or randomness",
      "pure tools never mutate the UI",
      "the URL is the UI state and reload reproduces the view",
      "default rendered instrument is unchanged by the agent layer",
    ],
    relatedTools: [],
  };
}

// ---------------------------------------------------------------------------
// Bridge patch validation
// ---------------------------------------------------------------------------

export interface NormalizedPatch {
  lane?: number;
  frame?: string;
  view?: ViewMode;
  width?: RegisterSize;
  register?: { frame: string; hex: string };
  binop?: BinOp;
  lfo?: { on?: boolean; mode?: string; rate?: number };
  dataset?: { csv?: string; index?: number };
  expression?: { frame: string; text: string };
  source?: SourcePatch;
  record?: boolean;
  reset?: true;
}

export type SourcePatch =
  | { frame: string; kind: "none" }
  | { frame: string; kind: "data"; column: number }
  | { frame: string; kind: "frame"; from: string };

export interface PatchError {
  code: ErrorCode;
  message: string;
  hint?: string;
}

export type PatchResult = { ok: true; patch: NormalizedPatch } | { ok: false; error: PatchError };

const PATCH_KEYS = ["lane", "frame", "view", "width", "register", "binop", "lfo", "dataset", "expression", "source", "record", "reset"] as const;

/** Validate a bridge patch without applying it; never throws. */
export function normalizeAgentPatch(value: unknown): PatchResult {
  try {
    const input = argsObject(value);
    onlyKeys(input, PATCH_KEYS, "patch");
    const patch: NormalizedPatch = {};

    if (input.lane !== undefined) {
      const lane = laneKeyFromNumber(input.lane);
      if (!lane) bad("E_BAD_ENUM", "lane must be an integer 1–8");
      patch.lane = Number(lane);
    }

    if (input.frame !== undefined) {
      const frame = frameRefFromName(input.frame);
      if (!frame) bad("E_BAD_ENUM", "frame must be A–P or Z1–Z8");
      patch.frame = frame.name;
    }

    if (input.view !== undefined) {
      if (typeof input.view !== "string" || !(VIEW_MODES as readonly string[]).includes(input.view)) {
        bad("E_BAD_ENUM", `view must be one of: ${VIEW_MODES.join(", ")}`);
      }
      patch.view = input.view as ViewMode;
    }

    if (input.width !== undefined) {
      patch.width = widthOf(input.width);
    }

    if (input.register !== undefined) {
      const register = objectValue(input.register, "register");
      onlyKeys(register, ["frame", "hex"], "register");
      const frame = frameRefFromName(register.frame);
      if (!frame) bad("E_BAD_ENUM", "register.frame must be an operand frame (A–P)");
      if (frame.frame === "z") bad("E_BAD_ENUM", "Z is derived and cannot be written; choose an operand frame");
      patch.register = { frame: frame.name, hex: hexText(register.hex, "register.hex") };
    }

    if (input.binop !== undefined) {
      patch.binop = binopOf(input.binop, "xor");
    }

    if (input.lfo !== undefined) {
      const lfo = objectValue(input.lfo, "lfo");
      onlyKeys(lfo, ["on", "mode", "rate"], "lfo");
      const patchLfo: NormalizedPatch["lfo"] = {};
      if (lfo.on !== undefined) {
        if (typeof lfo.on !== "boolean") bad("E_BAD_ARGS", "lfo.on must be a boolean");
        patchLfo.on = lfo.on;
      }
      if (lfo.mode !== undefined) {
        if (typeof lfo.mode !== "string" || !(LFO_MODES as readonly string[]).includes(lfo.mode)) {
          bad("E_BAD_ENUM", `lfo.mode must be one of: ${LFO_MODES.join(", ")}`);
        }
        patchLfo.mode = lfo.mode;
      }
      if (lfo.rate !== undefined) {
        if (typeof lfo.rate !== "number" || !(LFO_RATES as readonly number[]).includes(lfo.rate)) {
          bad("E_BAD_ENUM", `lfo.rate must be one of: ${LFO_RATES.join(", ")}`);
        }
        patchLfo.rate = lfo.rate;
      }
      if (Object.keys(patchLfo).length === 0) bad("E_BAD_ARGS", "lfo patch has no keys");
      patch.lfo = patchLfo;
    }

    if (input.dataset !== undefined) {
      const dataset = objectValue(input.dataset, "dataset");
      onlyKeys(dataset, ["csv", "index"], "dataset");
      const patchDataset: NormalizedPatch["dataset"] = {};
      if (dataset.csv !== undefined) {
        if (typeof dataset.csv !== "string") bad("E_BAD_ARGS", "dataset.csv must be a string");
        if (dataset.csv.trim() === "") bad("E_EMPTY_INPUT", "dataset.csv is empty");
        if (dataset.csv.length > MAX_TEXT_CHARS) bad("E_INPUT_TOO_LARGE", "dataset.csv is too large");
        patchDataset.csv = dataset.csv;
      }
      if (dataset.index !== undefined) {
        const index = integerValue(dataset.index, "dataset.index");
        if (index < 0) bad("E_OUT_OF_RANGE", "dataset.index must be non-negative");
        patchDataset.index = index;
      }
      if (Object.keys(patchDataset).length === 0) bad("E_BAD_ARGS", "dataset patch has no keys");
      patch.dataset = patchDataset;
    }

    if (input.expression !== undefined) {
      const expression = objectValue(input.expression, "expression");
      onlyKeys(expression, ["frame", "text"], "expression");
      const frame = frameRefFromName(expression.frame);
      if (!frame) bad("E_BAD_ENUM", "expression.frame must be an operand frame (A–P)");
      if (frame.frame === "z") bad("E_BAD_ENUM", "Z is derived and cannot carry an expression");
      if (typeof expression.text !== "string") bad("E_BAD_ARGS", "expression.text must be a string");
      const text = expression.text.trim();
      if (text.length > EXPRESSION_LIMITS.source) {
        bad("E_INPUT_TOO_LARGE", `expression exceeds ${EXPRESSION_LIMITS.source} characters`);
      }
      if (text !== "") {
        try {
          compileExpression(text);
        } catch (error) {
          if (error instanceof ExpressionError) {
            bad("E_INVALID_EXPRESSION", error.message, error.hint);
          }
          throw error;
        }
      }
      patch.expression = { frame: frame.name, text };
    }

    if (input.record !== undefined) {
      if (typeof input.record !== "boolean") bad("E_BAD_ARGS", "record must be a boolean");
      patch.record = input.record;
    }

    if (input.source !== undefined) {
      const source = objectValue(input.source, "source");
      onlyKeys(source, ["frame", "kind", "column", "from"], "source");
      const frame = frameRefFromName(source.frame);
      if (!frame) bad("E_BAD_ENUM", "source.frame must be an operand frame (A–P)");
      if (frame.frame === "z") bad("E_BAD_ENUM", "Z is derived and cannot carry a source");
      if (source.kind === "none") {
        patch.source = { frame: frame.name, kind: "none" };
      } else if (source.kind === "data") {
        const column = integerValue(source.column, "source.column");
        if (column < 0) bad("E_OUT_OF_RANGE", "source.column must be non-negative");
        patch.source = { frame: frame.name, kind: "data", column };
      } else if (source.kind === "frame") {
        if (typeof source.from !== "string") bad("E_BAD_ARGS", "source.from must be a port string");
        const match = /^([1-8])\.([abz])$/.exec(source.from);
        if (!match) bad("E_BAD_ENUM", "source.from must be a port such as 3.z or 2.a (lanes 1–8)");
        if (match[1] === frame.lane && match[2] === frame.frame) {
          bad("E_BAD_ARGS", `${frame.name} cannot be driven by itself`);
        }
        patch.source = { frame: frame.name, kind: "frame", from: source.from };
      } else {
        bad("E_BAD_ENUM", "source.kind must be none, data or frame");
      }
    }

    if (input.reset !== undefined) {
      if (input.reset !== true) bad("E_BAD_ARGS", "reset must be true");
      patch.reset = true;
    }

    if (Object.keys(patch).length === 0) bad("E_BAD_ARGS", "patch is empty");
    return { ok: true, patch };
  } catch (error) {
    if (error instanceof AgentToolError) {
      return { ok: false, error: { code: error.code, message: error.message, hint: error.hint } };
    }
    return { ok: false, error: { code: "E_INTERNAL", message: "internal error validating patch" } };
  }
}
