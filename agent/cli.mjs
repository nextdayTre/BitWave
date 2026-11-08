#!/usr/bin/env node
/**
 * BitWave agent CLI — the headless, zero-dependency transport.
 *
 * One implementation (docs/AGENT-INTERFACE.md §1): every value printed here
 * comes from `src/core/*`. This file only maps flags to tool arguments and
 * formats envelopes — it never re-implements register maths, project shapes or
 * deeplinks.
 *
 * Usage: node agent/cli.mjs <command> [flags] [--json]
 * Exit codes: 0 ok, 2 usage, 3 tool error (E_*), 4 internal.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOOLS, callTool, getManifest, normalizeAgentPatch } from "../src/core/agent-tools.ts";
import { bootProjectDoc } from "../src/core/agent-defaults.ts";
import { buildUiState } from "../src/core/agent-state.ts";
import { buildShareLink, canonicalShareDocument } from "../src/core/agent-share.ts";
import { ProjectError } from "../src/core/project.ts";
import { checkArtifacts, generateArtifacts } from "./gen-agent-artifacts.mjs";

export const EXIT = { OK: 0, USAGE: 2, TOOL: 3, INTERNAL: 4 };

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(AGENT_DIR, "..");

/** Commands documented by the contract (§9); a command may be a tool or transport. */
export const COMMANDS = [
  "manifest",
  "analyze_register",
  "evaluate_lane",
  "compare_operands",
  "parse_dataset",
  "deeplink",
  "state",
  "artifacts",
  "selftest",
  "help",
];

const VALUE_FLAGS = new Set(["hex", "a", "b", "op", "width", "text", "max-rows", "project", "base", "index"]);
const BOOLEAN_FLAGS = new Set(["json", "check", "help"]);

/** A malformed command line, i.e. exit code 2 rather than a tool failure. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Parse `--flag value` and `--flag=value` forms. Positionals keep their order;
 * the first one is the command (defaulting to `help`).
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== "string") continue;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (name === "") throw new UsageError("empty flag name");
    if (BOOLEAN_FLAGS.has(name)) {
      if (eq !== -1) throw new UsageError(`--${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new UsageError(`unknown flag: --${name}`);
    let value;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else {
      i += 1;
      value = argv[i];
      if (value === undefined || (typeof value === "string" && value.startsWith("--"))) {
        throw new UsageError(`--${name} requires a value`);
      }
    }
    flags[name] = value;
  }
  return { command: positional.length > 0 ? positional[0] : "help", extra: positional.slice(1), flags };
}

const processIo = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

const pad = (text, width) => String(text).padEnd(width);

function required(flags, name, command) {
  const value = flags[name];
  if (value === undefined) throw new UsageError(`${command} requires --${name}`);
  return value;
}

function integerFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const value = Number(flags[name]);
  if (!Number.isInteger(value)) throw new UsageError(`--${name} must be an integer`);
  return value;
}

function readProject(flags) {
  if (flags.project === undefined) return bootProjectDoc();
  const file = path.resolve(String(flags.project));
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`cannot read project file: ${flags.project}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`project file is not valid JSON: ${flags.project}`);
  }
}

// ---------------------------------------------------------------------------
// Human formatting — compact, deterministic, no locale formatting.
// ---------------------------------------------------------------------------

function renderManifest(data) {
  const lines = [`${data.title} ${data.version} — tool id ${data.id}, schema ${data.schemaVersion}`];
  lines.push(`app: ${data.urls.app}`);
  lines.push(`manifest: ${data.urls.manifest}`);
  lines.push(`deeplink: ${data.deeplink.template} (prefix ${data.deeplink.prefix}, budget ${data.deeplink.budgetChars} chars)`);
  lines.push(`tools (${data.tools.length}):`);
  for (const tool of data.tools) lines.push(`  ${pad(tool.name, 17)} ${tool.title}`);
  lines.push(`error codes: ${data.errorCodes.join(" ")}`);
  return lines.join("\n");
}

function renderAnalyze(data) {
  return [
    `${data.hex} (${data.width}-bit)`,
    `  decimal   ${data.decimal}`,
    `  popcount  ${data.popcount}`,
    `  bitLength ${data.bitLength}`,
    `  nibbles   ${data.nibbles.map((nibble) => nibble.toString(16).toUpperCase()).join(" ")}`,
  ].join("\n");
}

function renderEvaluate(data) {
  const lines = [
    `${data.op} · ${data.width}-bit`,
    `  A ${data.a.hex} (${data.a.popcount} set)`,
    `  B ${data.b.hex} (${data.b.popcount} set)`,
    `  Z ${data.z.hex} (${data.z.popcount} set)`,
    `  truth [n00 n01 n10 n11] = [${data.truthCounts.join(", ")}]`,
  ];
  if (data.carry !== null) lines.push(`  carry  ${data.carry}`);
  if (data.borrow !== null) lines.push(`  borrow ${data.borrow}`);
  return lines.join("\n");
}

function renderCompare(data) {
  const lines = [
    `${data.width}-bit · A ${data.a.hex} · B ${data.b.hex}`,
    `  truth [n00 n01 n10 n11] = [${data.truthCounts.join(", ")}]`,
  ];
  for (const result of data.results) {
    let suffix = "";
    if (result.carry !== null) suffix += ` carry=${result.carry}`;
    if (result.borrow !== null) suffix += ` borrow=${result.borrow}`;
    lines.push(`  ${pad(result.op, 5)} ${result.z} (${result.popcount} set)${suffix}`);
  }
  return lines.join("\n");
}

function renderDataset(data) {
  const lines = [`columns (${data.columns.length}):`];
  for (const column of data.columns) lines.push(`  ${column.name}  ${column.mode}  ${column.widthBits}-bit`);
  lines.push(`rows ${data.totalRows} (returned ${data.rows.length}${data.truncated ? ", truncated" : ""})`);
  for (const row of data.rows) lines.push(`  ${row.join(", ")}`);
  return lines.join("\n");
}

function renderDeeplink(data) {
  const lines = [String(data.fragment)];
  if (data.url !== null) lines.push(`url: ${data.url}`);
  lines.push(
    `payload ${data.payloadChars}/${getManifest().deeplink.budgetChars} chars · withinBudget=${data.withinBudget} · datasetDropped=${data.datasetDropped}`,
  );
  return lines.join("\n");
}

function renderEnvelopeHuman(envelope) {
  switch (envelope.tool) {
    case "manifest":
      return renderManifest(envelope.data);
    case "analyze_register":
      return renderAnalyze(envelope.data);
    case "evaluate_lane":
      return renderEvaluate(envelope.data);
    case "compare_operands":
      return renderCompare(envelope.data);
    case "parse_dataset":
      return renderDataset(envelope.data);
    case "build_deeplink":
      return renderDeeplink(envelope.data);
    default:
      return JSON.stringify(envelope.data, null, 2);
  }
}

function renderFailure(envelope) {
  const hint = envelope.error.hint === undefined ? "" : ` (${envelope.error.hint})`;
  return `error ${envelope.error.code}: ${envelope.error.message}${hint}`;
}

function renderState(state) {
  const lines = [
    `BitWave state (schema ${state.schemaVersion}, ${state.width}-bit, lane ${state.lane}, frame ${state.frame}, view ${state.view.mode})`,
    `  lfo: ${state.lfo.on ? "on" : "off"} ${state.lfo.mode} @${state.lfo.rate}`,
  ];
  if (state.dataset) {
    lines.push(
      `  dataset: ${state.dataset.rows} rows · index ${state.dataset.index} · columns ${state.dataset.columns.join(", ")}`,
    );
  } else {
    lines.push("  dataset: none");
  }
  lines.push(`  deeplink: ${state.deeplink}`);
  for (const lane of Object.values(state.lanes)) {
    const frames = Object.entries(lane.frames)
      .map(([name, hex]) => `${name}=${hex}`)
      .join(" ");
    lines.push(`  lane ${lane.lane}: ${frames} (${lane.binop})`);
  }
  return lines.join("\n");
}

export function renderHelp() {
  const version = getManifest().version;
  const lines = [
    `BitWave agent CLI ${version} — headless, zero-dependency, deterministic.`,
    "",
    "Usage:",
    "  node agent/cli.mjs <command> [flags] [--json]",
    "",
    "Commands:",
  ];
  const descriptions = {
    manifest: "capability manifest",
    analyze_register: "nibbles, decimal, popcount, bit length",
    evaluate_lane: "Z = A <op> B for one lane",
    compare_operands: "all five operators for one A/B pair",
    parse_dataset: "parse CSV/TSV with the instrument's import rules",
    deeplink: "canonical #bw= link from a .bitwave document",
    state: "headless UI state (printed without an envelope)",
    artifacts: "regenerate or --check agent/manifest.json and agent/examples",
    selftest: "run agent/selftest.mjs",
    help: "this text",
  };
  for (const command of COMMANDS) lines.push(`  ${pad(command, 18)} ${descriptions[command]}`);
  lines.push(
    "",
    "Flags (--flag value and --flag=value):",
    "  --hex <hex>         analyze_register word",
    "  --a <hex>           operand A",
    "  --b <hex>           operand B",
    "  --op <name>         and | or | xor | add | sub (default xor)",
    "  --width <bits>      8 | 16 | 32 | 64 | 128 | 256 (default 64)",
    "  --text <text>       parse_dataset CSV/TSV text",
    "  --max-rows <n>      parse_dataset row cap, 1..512 (default 64)",
    "  --project <path>    .bitwave document for deeplink/state (boot document otherwise)",
    "  --base <url>        absolute URL without a fragment, for deeplink/state",
    "  --index <n>         dataset cursor for state",
    "  --check             verify generated artifacts (artifacts command)",
    "  --json              envelope only on stdout; diagnostics on stderr",
    "",
    `Pure tools: ${TOOLS.map((tool) => tool.name).join(", ")}`,
    "Exit codes: 0 ok, 2 usage, 3 tool error (E_*), 4 internal.",
  );
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function runTool(toolName, args, io, flags) {
  const envelope = callTool(toolName, args);
  if (flags.json === true) {
    io.out(JSON.stringify(envelope, null, 2) + "\n");
  } else if (envelope.ok) {
    io.out(renderEnvelopeHuman(envelope) + "\n");
  } else {
    io.err(renderFailure(envelope) + "\n");
  }
  return envelope.ok ? EXIT.OK : EXIT.TOOL;
}

function runDeeplink(flags, io) {
  const args = { project: readProject(flags) };
  if (flags.base !== undefined) args.base = String(flags.base);
  return runTool("build_deeplink", args, io, flags);
}

function runState(flags, io) {
  const raw = readProject(flags);
  if (flags.index !== undefined) {
    const patch = normalizeAgentPatch({ dataset: { index: integerFlag(flags, "index") } });
    if (!patch.ok) {
      io.err(`error ${patch.error.code}: ${patch.error.message}\n`);
      return EXIT.TOOL;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !raw.dataset) {
      throw new UsageError("state --index requires a project with a dataset");
    }
    raw.dataset = { ...raw.dataset, index: patch.patch.dataset.index };
  }
  let doc;
  try {
    doc = canonicalShareDocument(raw);
  } catch (error) {
    if (error instanceof ProjectError) {
      io.err(`error E_INVALID_PROJECT: ${error.message}\n`);
      return EXIT.TOOL;
    }
    throw error;
  }
  const base = flags.base === undefined ? "bitwave-v2.html" : String(flags.base);
  const state = buildUiState(doc, { deeplink: base + buildShareLink(doc).fragment });
  if (flags.json === true) io.out(JSON.stringify(state, null, 2) + "\n");
  else io.out(renderState(state) + "\n");
  return EXIT.OK;
}

function runArtifacts(flags, io) {
  const result = flags.check === true ? checkArtifacts(REPO_ROOT) : generateArtifacts(REPO_ROOT);
  if (flags.json === true) {
    io.out(JSON.stringify(result, null, 2) + "\n");
    return result.ok ? EXIT.OK : 1;
  }
  if (flags.check === true) {
    if (result.ok) {
      io.out(`artifacts up to date (${result.files.length} files)\n`);
    } else {
      for (const file of result.missing) io.out(`missing: ${file}\n`);
      for (const file of result.stale) io.out(`stale: ${file}\n`);
      io.err("artifacts are out of date; run node agent/gen-agent-artifacts.mjs\n");
    }
  } else {
    for (const file of result.files) io.out(`wrote ${file}\n`);
    io.out(`generated ${result.files.length} artifacts\n`);
  }
  return result.ok ? EXIT.OK : 1;
}

function runSelftest(io) {
  const result = spawnSync(process.execPath, [path.join(AGENT_DIR, "selftest.mjs")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) io.out(result.stdout);
  if (result.stderr) io.err(result.stderr);
  if (result.error) {
    io.err(`error: cannot run selftest: ${result.error.message}\n`);
    return EXIT.INTERNAL;
  }
  return typeof result.status === "number" ? result.status : EXIT.INTERNAL;
}

/**
 * Run one CLI invocation. Returns the exit code instead of calling
 * `process.exit`, so tests can drive it with captured stdout/stderr.
 */
export function runCli(argv, io = processIo) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`error: ${error.message}\n`);
      io.err('run "node agent/cli.mjs help" for usage\n');
      return EXIT.USAGE;
    }
    throw error;
  }

  const { command, extra, flags } = parsed;
  if (command === "help" || flags.help === true) {
    io.out(renderHelp());
    return EXIT.OK;
  }

  try {
    if (extra.length > 0) throw new UsageError(`unexpected argument: ${extra[0]}`);
    switch (command) {
      case "manifest":
        return runTool("manifest", {}, io, flags);

      case "analyze_register": {
        const args = { hex: required(flags, "hex", command) };
        const width = integerFlag(flags, "width");
        if (width !== undefined) args.width = width;
        return runTool("analyze_register", args, io, flags);
      }

      case "evaluate_lane": {
        const args = { a: required(flags, "a", command) };
        if (flags.b !== undefined) args.b = String(flags.b);
        if (flags.op !== undefined) args.op = String(flags.op);
        const width = integerFlag(flags, "width");
        if (width !== undefined) args.width = width;
        return runTool("evaluate_lane", args, io, flags);
      }

      case "compare_operands": {
        const args = { a: required(flags, "a", command), b: required(flags, "b", command) };
        const width = integerFlag(flags, "width");
        if (width !== undefined) args.width = width;
        return runTool("compare_operands", args, io, flags);
      }

      case "parse_dataset": {
        const args = { text: required(flags, "text", command) };
        const maxRows = integerFlag(flags, "max-rows");
        if (maxRows !== undefined) args.maxRows = maxRows;
        return runTool("parse_dataset", args, io, flags);
      }

      case "deeplink":
        return runDeeplink(flags, io);

      case "state":
        return runState(flags, io);

      case "artifacts":
        return runArtifacts(flags, io);

      case "selftest":
        return runSelftest(io);

      default:
        throw new UsageError(`unknown command: ${JSON.stringify(command)}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`error: ${error.message}\n`);
      io.err('run "node agent/cli.mjs help" for usage\n');
      return EXIT.USAGE;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.err(`internal error: ${message}\n`);
    return EXIT.INTERNAL;
  }
}

/** True when this module is the process entry point (not imported by a test). */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(moduleUrl);
  const resolved = path.resolve(entry);
  return process.platform === "win32"
    ? self.toLowerCase() === resolved.toLowerCase()
    : self === resolved;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
