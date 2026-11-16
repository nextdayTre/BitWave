/**
 * window.bitwave — the command bridge (docs/AGENT-INTERFACE.md §7).
 *
 * Installed exactly once, after the instrument has booted. Everything it reports
 * comes from the shared core (`buildUiState` over `captureProject`); every write
 * goes through the instrument's own commands inside one store transaction, never
 * by writing DOM state. The legacy read-only `window.BitWave` surface is not
 * touched.
 *
 * Event semantics:
 *   - `bitwave:ready` + exactly one `bitwave:change` on install;
 *   - one `bitwave:change` per genuine (state-changing) store transaction;
 *   - a setter that changes nothing emits nothing;
 *   - the debounced address-bar mirror (`bitwave:urlsettled` from io/share-url)
 *     refreshes the hidden state node silently — a URL write is not a UI change.
 *
 * Toolset 1.1.0 added external routing: expression sources (`setExpression`,
 * patch key `expression`), the transient recorded take (`record(on)`,
 * `getLog({limit?})`) and `recording` / per-lane `expressions` in `getState()`.
 * Toolset 1.2.0 (D44) moved the shared `.bitwave` document to schema 4 (lane map
 * keyed by stable lane key); toolset 1.3.0 (D45) changed the canonical `#bw=`
 * link to the compact codec (legacy links still load). Toolset 1.4.0 (D43/D46)
 * widens the closed lane/frame enums to the shipped 1–8 range (frames `A`–`P`,
 * `Z1`–`Z8`): setters accept only lanes the live tree carries, so focusing an
 * absent lane is a truthful `E_OUT_OF_RANGE`, never a silent lane creation.
 * Toolset 1.5.0 (D48) adds the opt-in dataset readback (`getDataset()`): the
 * live bridge could already load processed data through `setDataset({csv})` but
 * could not read it back. The getter is read-only and synchronous, returns
 * `null` when no dataset is loaded, and never puts the full matrix into
 * `getState()` / `#bitwave-state` / change payloads — the state schema and the
 * `.bitwave` schema are unchanged.
 */

import {
  SCHEMA_VERSION,
  TOOLSET_VERSION,
  TOOLS,
  callTool,
  getManifest,
  normalizeAgentPatch,
} from "../core/agent-tools.ts";
import { buildUiState } from "../core/agent-state.ts";
import { frameRefFromName, laneKeyFromNumber } from "../core/agent-defaults.ts";
import { columnMode, columnWidth, parseDataset } from "../core/csv.ts";
import { SIZES } from "../core/registers.ts";
import { captureProject } from "../state/project-bridge.ts";
import { DEMO } from "../state/dataset.ts";
import { S, focusEditable, regOf, syncTarget } from "../state/instrument.ts";
import { setHexWord } from "../state/actions.ts";
import { driverName, isFocusDriven, isInputDriven } from "../state/bindings.ts";
import { evaluate } from "../state/routing.ts";
import { renderStrip } from "../render/strip.js";
import { updateReadouts } from "../render/readouts.js";

const STATE_NODE_ID = "bitwave-state";
const READY_ATTR = "agent-ready";

const stringify = (value) => JSON.stringify(value);

/** The pure tool definitions, without the internal `run` closures. */
function toolDefinitions() {
  return TOOLS.map(({ name, title, description, scope, inputSchema, examples }) => ({
    name,
    title,
    description,
    scope,
    inputSchema,
    examples,
  }));
}

export function createAgentBridge(deps) {
  const {
    store,
    share,
    selectLane,
    selectFrame,
    setView: applyView,
    resizeRegister,
    setSize,
    chooseBinop,
    lfoStart,
    lfoStop,
    syncLfoUi,
    loadCSV,
    applyExample,
    resetInstrument,
    syncEditUi,
    setExpression: applyExpressionSource,
    setSource: applySourceSource,
    startRecording,
    stopRecording,
    skipRecordSnapshot,
    readLog,
  } = deps;

  /** Subscriber set; each listener is wrapped so one thrower cannot break others. */
  const subscribers = new Set();
  let installed = null;
  let lastKey = null;
  /* True while a setter's store transaction is open. The immediate address-bar
     mirror inside that transaction dispatches `bitwave:urlsettled`; the exit
     notification already refreshes, so the silent URL path must stand down. */
  let inTransaction = false;

  /* ── state + DOM mirror ─────────────────────────────────────────────── */

  function currentState() {
    return buildUiState(captureProject(), {
      deeplink: location.href,
      lfoOn: S.lfo.on,
      copyArmed: S.copyArmed,
      /* The take is transient session state, reported but never persisted. */
      recording: { on: S.record.on, rows: S.record.rows.length },
      /* Kept for parity with the contract wording; buildUiState derives the
         same boolean from the captured document. */
      enabled: focusEditable() && !isFocusDriven(),
    });
  }

  function writeStateNode(state) {
    let node = document.getElementById(STATE_NODE_ID);
    if (!node) {
      node = document.createElement("pre");
      node.id = STATE_NODE_ID;
      node.hidden = true;
      document.body.appendChild(node);
    }
    node.setAttribute("data-schema-version", String(SCHEMA_VERSION));
    node.textContent = stringify(state);
  }

  function dispatch(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_) {
      /* Events are best-effort; the hidden node is the durable surface. */
    }
  }

  function emitChange(state) {
    dispatch("bitwave:change", state);
    for (const listener of [...subscribers]) {
      try {
        listener(state);
      } catch (_) {
        /* An agent subscriber must not be able to disrupt the instrument. */
      }
    }
  }

  /**
   * Recompute the state after a store transaction (or a URL mirror). `silent`
   * updates the hidden node without emitting a change event.
   */
  function refresh(silent = false) {
    const state = currentState();
    const key = stringify(state);
    if (key === lastKey) return state;
    lastKey = key;
    writeStateNode(state);
    if (!silent) emitChange(state);
    return state;
  }

  /* ── patch application ──────────────────────────────────────────────── */

  function failure(code, message, hint) {
    const error = hint === undefined ? { code, message } : { code, message, hint };
    return { ok: false, error, state: currentState() };
  }

  /**
   * Bridge-only checks that need live routes/dataset (the pure patch validator
   * cannot know them). Runs before any mutation.
   *
   * Since toolset 1.4.0 the pure lane/frame enums are the shipped 1–8 range, so
   * this is also where a well-formed reference to a lane the live tree does not
   * carry is refused: the agent may focus/manage live lanes only, never create a
   * lane by naming it.
   */
  function liveLaneKeys() {
    return Object.keys(S.lanes).sort((a, b) => Number(a) - Number(b));
  }

  function notLive(lane) {
    const live = liveLaneKeys();
    return {
      code: "E_OUT_OF_RANGE",
      message: `lane ${lane} is not live; this instrument has lane${live.length === 1 ? "" : "s"} ${live.join(", ")}`,
      hint: "add the lane in the frames view first, then retry",
    };
  }

  function preflight(patch) {
    if (patch.lane !== undefined && !S.lanes[String(patch.lane)]) {
      return notLive(patch.lane);
    }

    if (patch.frame !== undefined) {
      const ref = frameRefFromName(patch.frame);
      if (ref && !S.lanes[ref.lane]) return notLive(ref.lane);
    }

    if (patch.register) {
      const ref = frameRefFromName(patch.register.frame);
      if (!ref) return { code: "E_BAD_ENUM", message: "register.frame must be an operand frame (A–P)" };
      if (ref.frame === "z") {
        return {
          code: "E_BAD_ENUM",
          message: "Z is derived and cannot be written; choose an operand frame",
        };
      }
      if (!S.lanes[ref.lane]) return notLive(ref.lane);
      const sl = S.lanes[ref.lane];
      if (isInputDriven(sl, ref.frame)) {
        const driver = driverName(sl, ref.frame) || "a route";
        return {
          code: "E_DRIVEN_INPUT",
          message: `${ref.name} is driven by ${driver}; unplug it in sources`,
          hint: "set the operand's source to none (or bind a different one) and retry",
        };
      }
    }

    if (patch.expression) {
      const ref = frameRefFromName(patch.expression.frame);
      if (ref && !S.lanes[ref.lane]) return notLive(ref.lane);
    }

    if (patch.source) {
      const ref = frameRefFromName(patch.source.frame);
      if (ref && !S.lanes[ref.lane]) return notLive(ref.lane);
      if (patch.source.kind === "frame") {
        const fromLane = patch.source.from.split(".")[0];
        if (!S.lanes[fromLane]) return notLive(fromLane);
      }
      if (patch.source.kind === "data" && !DEMO.cols[patch.source.column]) {
        return {
          code: "E_BAD_STATE",
          message: `source.column ${patch.source.column} is outside the current dataset`,
          hint: "load a dataset first or choose an existing column index",
        };
      }
    }

    if (patch.dataset) {
      const dataset = patch.dataset;
      if (dataset.csv !== undefined) {
        const parsed = parseDataset(dataset.csv);
        if (!parsed) return { code: "E_BAD_STATE", message: "dataset.csv has no data rows" };
        let usable = false;
        for (let ci = 0; ci < parsed.cols.length && !usable; ci++) {
          if (columnWidth(parsed.rows, ci) > 0) usable = true;
        }
        if (!usable) {
          return {
            code: "E_BAD_STATE",
            message: "dataset.csv has no numeric columns (expects hex or binary tokens)",
          };
        }
        if (dataset.index !== undefined && dataset.index >= parsed.rows.length) {
          return {
            code: "E_OUT_OF_RANGE",
            message: `dataset.index ${dataset.index} is outside 0..${parsed.rows.length - 1}`,
          };
        }
      } else if (dataset.index !== undefined) {
        if (!DEMO.rows.length) {
          return { code: "E_BAD_STATE", message: "dataset.index requires a loaded dataset", hint: "send dataset.csv first" };
        }
        if (dataset.index >= DEMO.rows.length) {
          return {
            code: "E_OUT_OF_RANGE",
            message: `dataset.index ${dataset.index} is outside 0..${DEMO.rows.length - 1}`,
          };
        }
      }
    }

    return null;
  }

  function applyRegister(register) {
    const ref = frameRefFromName(register.frame);
    if (!ref) return; // normalizeAgentPatch already rejects this
    const sl = S.lanes[ref.lane];
    const reg = regOf(ref.frame, sl);
    /* DESIGN §10.19: the LFO yields to a manual edit. Stop it (restoring its
       pre-LFO snapshot) inside the same transaction, then write, so the next
       tick cannot overwrite the new word. The UI's drag/preset/unary paths do
       the same before touching a register. */
    lfoStop();
    setHexWord(reg, register.hex);
    syncTarget(reg, true);
    evaluate(true);
    renderStrip();
    updateReadouts();
    if (syncEditUi) syncEditUi();
  }

  function applyLfo(lfo) {
    if (lfo.on !== undefined) {
      if (lfo.on && !S.lfo.on) lfoStart();
      else if (lfo.on === false && S.lfo.on) lfoStop();
    }
    if (lfo.mode !== undefined) {
      store.patch(() => {
        S.lfo.mode = lfo.mode;
        if (S.lfo.on) S.lfo.t = 0; // restart the shape cleanly, snapshot kept
      });
    }
    if (lfo.rate !== undefined) {
      store.patch(() => {
        S.lfo.rate = lfo.rate;
        S.lfoAcc = 0;
      });
    }
    if (syncLfoUi) syncLfoUi();
    if (syncEditUi) syncEditUi();
  }

  function applyDataset(dataset) {
    if (dataset.csv !== undefined) loadCSV(dataset.csv);
    if (dataset.index !== undefined) applyExample(dataset.index);
    if (syncEditUi) syncEditUi();
  }

  /** Expression source write: the app owns binding + evaluation + UI sync. */
  /** Source write (none/data/frame): the app owns binding + evaluation + UI sync. */
  function applySource(source) {
    if (typeof applySourceSource === "function") {
      applySourceSource(source.frame, source);
    }
  }

  function applyExpression(expression) {
    if (typeof applyExpressionSource === "function") {
      applyExpressionSource(expression.frame, expression.text);
    }
  }

  /** The record toggle is idempotent at the bridge: arming an armed take does
      not clear it, disarming a stopped take does nothing. */
  function applyRecord(on) {
    if (on && !S.record.on) startRecording();
    else if (!on && S.record.on) stopRecording();
  }

  /** Apply a validated patch in the instrument's canonical key order. */
  function applyNormalized(patch) {
    if (patch.reset) resetInstrument();
    if (patch.lane !== undefined) {
      /* The agent surface accepts the closed 1–8 range; preflight proved the
         lane is live, so this focuses it through the instrument's own command. */
      const lane = laneKeyFromNumber(patch.lane);
      if (lane !== null) selectLane(lane);
    }
    if (patch.frame !== undefined) {
      const ref = frameRefFromName(patch.frame);
      if (ref) selectFrame(ref.lane, ref.frame);
    }
    if (patch.view !== undefined) applyView(patch.view);
    if (patch.width !== undefined) {
      resizeRegister(patch.width);
      if (setSize) setSize(SIZES.indexOf(patch.width));
    }
    if (patch.register) applyRegister(patch.register);
    if (patch.binop !== undefined) chooseBinop(patch.binop, { force: true, focus: false });
    if (patch.lfo) applyLfo(patch.lfo);
    if (patch.dataset) applyDataset(patch.dataset);
    if (patch.source) applySource(patch.source);
    if (patch.expression) applyExpression(patch.expression);
    if (patch.record !== undefined) applyRecord(patch.record);
  }

  /** One transaction; the address bar is mirrored in the same pass when it changed. */
  function runTransaction(mutate) {
    const before = stringify(currentState());
    inTransaction = true;
    try {
      store.patch(() => {
        mutate();
        if (stringify(currentState()) !== before) {
          try {
            share.update();
          } catch (_) {
            /* The share link is best-effort; state is already truthful. */
          }
        } else if (typeof skipRecordSnapshot === "function") {
          /* A no-op setter must not grow the take, but the transaction still
             notifies: tell the recorder UI to skip this one snapshot. */
          try {
            skipRecordSnapshot();
          } catch (_) {
            /* Recording is a side surface; never fail a setter for it. */
          }
        }
      });
    } finally {
      inTransaction = false;
    }
  }

  function setState(patch) {
    const normalized = normalizeAgentPatch(patch);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error, state: currentState() };
    }
    const problem = preflight(normalized.patch);
    if (problem) return { ok: false, error: problem, state: currentState() };
    try {
      runTransaction(() => applyNormalized(normalized.patch));
    } catch (_) {
      return failure("E_INTERNAL", "internal error applying the patch");
    }
    return { ok: true, state: currentState(), warnings: [] };
  }

  function stepDataset(delta) {
    if (typeof delta !== "number" || !Number.isInteger(delta)) {
      return failure("E_BAD_ARGS", "stepDataset(delta) expects an integer");
    }
    if (!DEMO.rows.length) {
      return failure("E_BAD_STATE", "no dataset loaded", "send dataset.csv first");
    }
    try {
      runTransaction(() => applyExample(DEMO.i + delta));
    } catch (_) {
      return failure("E_INTERNAL", "internal error stepping the dataset");
    }
    return { ok: true, state: currentState(), warnings: [] };
  }

  /* Thin wrappers — each is exactly `setState({…})`. */
  const setLane = (lane) => setState({ lane });
  const setFrame = (frame) => setState({ frame });
  const setView = (view) => setState({ view });
  const setWidth = (width) => setState({ width });
  const setRegister = (frame, hex) => setState({ register: { frame, hex } });
  const setBinop = (binop) => setState({ binop });
  const setLfo = (lfo) => setState({ lfo });
  const setDataset = (dataset) => setState({ dataset });
  const setExpression = (frame, text) => setState({ expression: { frame, text } });
  const setSource = (frame, source) =>
    setState({ source: { ...(source && typeof source === "object" ? source : {}), frame } });
  const setRoute = (frame, from) => setSource(frame, { kind: "frame", from });
  const record = (on) => setState({ record: on });
  const reset = () => setState({ reset: true });

  /**
   * Read the transient recorded take (newest rows last). `limit` keeps the most
   * recent N rows; the log is in memory only, so this is never a file read.
   */
  function getLog(options) {
    let limit = null;
    if (options !== undefined && options !== null) {
      if (typeof options !== "object" || Array.isArray(options)) {
        return { ok: false, error: { code: "E_BAD_ARGS", message: "getLog(options) expects an object" }, warnings: [] };
      }
      for (const key of Object.keys(options)) {
        if (key !== "limit") {
          return {
            ok: false,
            error: { code: "E_BAD_ARGS", message: `getLog has an unknown option: ${key}` },
            warnings: [],
          };
        }
      }
      if (options.limit !== undefined) {
        if (typeof options.limit !== "number" || !Number.isInteger(options.limit)) {
          return {
            ok: false,
            error: { code: "E_BAD_ARGS", message: "getLog({limit}) expects an integer" },
            warnings: [],
          };
        }
        if (options.limit < 0) {
          return {
            ok: false,
            error: { code: "E_OUT_OF_RANGE", message: "getLog({limit}) must be >= 0" },
            warnings: [],
          };
        }
        limit = options.limit;
      }
    }
    const rows = typeof readLog === "function" ? readLog() : [];
    const selected = limit === null ? rows : rows.slice(Math.max(0, rows.length - limit));
    return { ok: true, rows: selected, warnings: [] };
  }

  /**
   * Read the live dataset back (toolset 1.5.0, D48) — the opt-in full matrix.
   *
   * Read-only and synchronous: no store transaction, no state write and no
   * `bitwave:change` event. The matrix never enters `getState()` /
   * `#bitwave-state` (their `dataset` is metadata plus the current row); this is
   * the only surface that carries every cell. Returns `null` when no dataset is
   * loaded and fresh arrays on every call, so a caller cannot mutate live state.
   * `rows` are the raw imported cells (leading zeros preserved); `kinds` and
   * `widths` come from the shared per-column typing in `src/core/csv.ts`.
   */
  function getDataset() {
    if (!DEMO.rows.length) return null;
    const columns = DEMO.cols.slice();
    return {
      columns,
      rows: DEMO.rows.map((row) => row.slice()),
      index: DEMO.i,
      kinds: columns.map((_, ci) => columnMode(DEMO.rows, ci)),
      widths: columns.map((_, ci) => columnWidth(DEMO.rows, ci)),
    };
  }

  function getDeeplink() {
    try {
      share.update();
    } catch (_) {
      /* Return whatever the address bar holds. */
    }
    return location.href;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    let active = true;
    const listener = (state) => {
      if (!active) return;
      try {
        fn(state);
      } catch (_) {
        /* isolated */
      }
    };
    subscribers.add(listener);
    try {
      fn(currentState());
    } catch (_) {
      /* isolated */
    }
    return () => {
      if (!active) return;
      active = false;
      subscribers.delete(listener);
    };
  }

  /* ── installation ───────────────────────────────────────────────────── */

  function install() {
    if (installed) return installed;
    if (Object.prototype.hasOwnProperty.call(window, "bitwave")) {
      installed = window.bitwave;
      return installed;
    }

    const api = Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      version: TOOLSET_VERSION,
      ready: true,
      getState: currentState,
      getDataset,
      getManifest,
      tools: toolDefinitions,
      call: (name, args) => callTool(name, args),
      getDeeplink,
      setState,
      setLane,
      setFrame,
      setView,
      setWidth,
      setRegister,
      setBinop,
      setLfo,
      setDataset,
      setExpression,
      setSource,
      setRoute,
      record,
      getLog,
      stepDataset,
      reset,
      subscribe,
    });
    Object.defineProperty(window, "bitwave", { value: api, enumerable: true });
    installed = api;

    /* Every completed store transaction refreshes the hidden state node; only
       genuinely different state emits a change. */
    store.subscribe(() => {
      if (installed) refresh(false);
    });
    /* The settled address-bar mirror updates the node without a change event. */
    window.addEventListener("bitwave:urlsettled", () => {
      if (installed && !inTransaction) refresh(true);
    });

    const first = currentState();
    lastKey = stringify(first);
    writeStateNode(first);
    document.body.setAttribute(`data-${READY_ATTR}`, "true");
    dispatch("bitwave:ready", first);
    emitChange(first);
    return api;
  }

  return { install };
}
