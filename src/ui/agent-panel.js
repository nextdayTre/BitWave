/**
 * Agent tab of the help panel — the in-app human-readable agent surface.
 *
 * Additive by design: the tab lives inside the existing `?` help panel (hidden
 * by default), so the default rendered instrument is unchanged. It shows the
 * bridge status, copy-prompt/deeplink/state buttons, the live state JSON and
 * the tool catalogue read straight from `src/core/agent-tools.ts` — the same
 * registry the CLI and MCP server use, never a re-implementation.
 */

import { SCHEMA_VERSION, TOOLS, TOOLSET_VERSION } from "../core/agent-tools.ts";

const COPY_FEEDBACK_MS = 2400;

const PATHS = [
  ["bridge", "window.bitwave"],
  ["state", "#bitwave-state"],
  ["manifest", "agent/manifest.json"],
  ["contract", "docs/AGENT-INTERFACE.md"],
  ["onboarding", "AGENTS.md"],
  ["tools", "agent/cli.mjs · agent/mcp-server.mjs"],
];

/** Clipboard write with a selection fallback for `file://` / denied contexts. */
async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* Fall through to the legacy path. */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === "function" && document.execCommand("copy");
    area.remove();
    return Boolean(ok);
  } catch (_) {
    return false;
  }
}

export function createAgentPanel({ root }) {
  if (!root) return { refresh() {} };

  const statusEl = root.querySelector("[data-agent-status]");
  const versionEl = root.querySelector("[data-agent-version]");
  const stateEl = root.querySelector("[data-agent-state-json]");
  const toolsEl = root.querySelector("[data-agent-tools]");
  const copyStatusEl = root.querySelector("[data-agent-copy-status]");
  const copyButtons = [...root.querySelectorAll("[data-agent-copy]")];
  let feedbackTimer = 0;

  const bridge = () => (typeof window !== "undefined" ? window.bitwave : undefined);

  function buildPaths() {
    const list = root.querySelector("[data-agent-paths]");
    if (!list) return;
    list.textContent = "";
    for (const [label, value] of PATHS) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      const code = document.createElement("code");
      code.textContent = value;
      dd.appendChild(code);
      list.append(dt, dd);
    }
  }

  function buildToolList() {
    if (!toolsEl) return;
    toolsEl.textContent = "";
    for (const tool of TOOLS) {
      const item = document.createElement("li");
      item.className = "agent-tool";

      const head = document.createElement("div");
      head.className = "agent-tool-head";
      const name = document.createElement("code");
      name.className = "agent-tool-name";
      name.textContent = tool.name;
      const title = document.createElement("span");
      title.className = "agent-tool-title";
      title.textContent = tool.title;
      head.append(name, title);

      const description = document.createElement("p");
      description.className = "agent-tool-desc";
      description.textContent = tool.description;

      const example = tool.examples && tool.examples[0];
      const call = document.createElement("code");
      call.className = "agent-call";
      call.textContent = example
        ? `window.bitwave.call(${JSON.stringify(tool.name)}, ${JSON.stringify(example.args)})`
        : `window.bitwave.call(${JSON.stringify(tool.name)}, {})`;

      item.append(head, description, call);
      toolsEl.appendChild(item);
    }
  }

  function rawStateText() {
    const node = document.getElementById("bitwave-state");
    if (node && node.textContent) return node.textContent;
    const api = bridge();
    return api && typeof api.getState === "function" ? JSON.stringify(api.getState()) : "";
  }

  function promptText() {
    const api = bridge();
    const version = api ? api.version : TOOLSET_VERSION;
    return [
      `BitWave agent layer (schema ${SCHEMA_VERSION}, toolset ${version})`,
      "Read AGENTS.md, then the normative contract docs/AGENT-INTERFACE.md.",
      "Read state from window.bitwave.getState() or the hidden #bitwave-state node;",
      "pure tools are read-only and changes go only through the bridge setters.",
      `Tools: ${TOOLS.map((tool) => tool.name).join(", ")}.`,
      'Try: window.bitwave.getState(); window.bitwave.call("manifest", {});',
      'Deeplink: window.bitwave.getDeeplink(); setters: setLane, setFrame, setView,',
      "setWidth, setRegister, setBinop, setLfo, setDataset, setExpression, record,",
      "stepDataset, reset. Read the transient take with window.bitwave.getLog().",
    ].join("\n");
  }

  function flashCopyStatus(text) {
    if (!copyStatusEl) return;
    copyStatusEl.textContent = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      copyStatusEl.textContent = "";
    }, COPY_FEEDBACK_MS);
  }

  function stateJsonText() {
    const api = bridge();
    if (!api) return "";
    try {
      return JSON.stringify(api.getState(), null, 2);
    } catch (_) {
      return "";
    }
  }

  function refresh() {
    const api = bridge();
    const active = Boolean(api && api.ready === true);
    if (statusEl) {
      statusEl.setAttribute("data-agent-status", active ? "bridge-active" : "bridge-unavailable");
      statusEl.textContent = active ? "bridge active" : "bridge unavailable";
    }
    if (versionEl) {
      versionEl.textContent = active
        ? `schema ${api.schemaVersion} · bridge v${api.version}`
        : "instrument running without the bridge";
    }
    if (stateEl) stateEl.textContent = active ? stateJsonText() : "(bridge not installed)";
    for (const button of copyButtons) {
      button.disabled = !active;
      button.setAttribute("aria-disabled", String(!active));
    }
  }

  async function handleCopy(button) {
    const kind = button.dataset.agentCopy;
    const api = bridge();
    const text =
      kind === "prompt" ? promptText() : kind === "deeplink" ? (api ? api.getDeeplink() : "") : rawStateText();
    if (!text) {
      flashCopyStatus("nothing to copy — bridge not installed");
      return;
    }
    const ok = await copyText(text);
    if (ok) flashCopyStatus(`${kind} copied`);
    else if (stateEl) {
      stateEl.focus();
      flashCopyStatus("copy unavailable here — select the text and copy it");
    } else {
      flashCopyStatus("copy unavailable here");
    }
  }

  /* ── wiring (once) ──────────────────────────────────────────────────── */

  buildPaths();
  buildToolList();
  for (const button of copyButtons) {
    button.addEventListener("click", () => handleCopy(button));
  }
  window.addEventListener("bitwave:ready", refresh);
  window.addEventListener("bitwave:change", () => {
    /* Only repaint the JSON while the tab is actually on screen. */
    if (root.hidden) return;
    if (stateEl) stateEl.textContent = stateJsonText();
  });

  refresh();
  return { refresh };
}
