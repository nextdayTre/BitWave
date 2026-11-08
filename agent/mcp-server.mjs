#!/usr/bin/env node
/**
 * BitWave MCP stdio server — newline-delimited JSON-RPC 2.0, zero dependencies.
 *
 * Implements docs/AGENT-INTERFACE.md §10:
 *   initialize -> protocolVersion 2025-06-18, capabilities.tools, serverInfo
 *   notifications/initialized -> silent
 *   ping -> {}
 *   tools/list -> the six pure tools (name, description, inputSchema)
 *   tools/call -> the same JSON envelope the CLI and browser bridge return
 *
 * The server never logs to stdout: stdout is the JSON-RPC channel. Diagnostics,
 * if any, go to stderr. A clean stdin EOF exits 0.
 *
 * Usage: node agent/mcp-server.mjs
 */

import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { TOOLS, callTool } from "../src/core/agent-tools.ts";
import { TOOL_ID, TOOLSET_VERSION } from "../src/core/agent-defaults.ts";

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_NAME = TOOL_ID;

const NOTIFICATION = Symbol("notification");

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolList() {
  return {
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
}

function toolCall(params) {
  const input = typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
  const envelope = callTool(input.name, input.arguments);
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    isError: envelope.ok !== true,
  };
}

function dispatch(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: TOOLSET_VERSION },
      };
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
      return NOTIFICATION;
    case "ping":
      return {};
    case "tools/list":
      return toolList();
    case "tools/call":
      return toolCall(params);
    default:
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

/**
 * Handle one parsed JSON-RPC message. Returns the response object, or null for
 * notifications (a message without an `id` always produces no response).
 */
export function handleMessage(message) {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return errorResponse(null, -32600, "Invalid Request");
  }
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = hasId ? message.id : null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return hasId ? errorResponse(id, -32600, "Invalid Request") : null;
  }
  try {
    const result = dispatch(message.method, message.params);
    if (result === NOTIFICATION || !hasId) return null;
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (!hasId) return null;
    if (error instanceof RpcError) return errorResponse(id, error.code, error.message);
    return errorResponse(id, -32603, "Internal error");
  }
}

/**
 * Handle one NDJSON line: blank lines are ignored, unparseable lines produce a
 * JSON-RPC parse error (-32700), and notifications produce no response.
 */
export function handleLine(line) {
  const text = String(line).trim();
  if (text === "") return null;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return errorResponse(null, -32700, "Parse error");
  }
  try {
    return handleMessage(message);
  } catch {
    return errorResponse(null, -32603, "Internal error");
  }
}

/**
 * Start the stdio server. Reads one JSON-RPC message per line and writes one
 * response per request; returns the readline interface so callers can close it.
 */
export function startServer({ input = process.stdin, output = process.stdout } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const response = handleLine(line);
    if (response !== null) output.write(JSON.stringify(response) + "\n");
  });
  lines.on("close", () => {
    process.exitCode = 0;
  });
  return lines;
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
  startServer();
}
