/**
 * Input source table — two rows per live lane, one row per operand frame.
 *
 * Moved out of the spike and into the instrument for F3, extended with the
 * external-routing `expr` source (EXTERNAL-ROUTING §4/§6). A row reads one
 * source: an imported CSV column (`data`), a frame output (`1:1` / `z⁻¹`), a
 * validated one-line expression (`expr`), or nothing. The label carries the
 * assignment (D15 / author note): a data-bound row reads `A · sine`, matching
 * the column name the import dropdown shows.
 *
 * D46: the table follows the live lane set — `2L` rows for `L` lanes, grouped
 * under a per-lane header row and scrollable in the panel body. Expression
 * labels, the frame source lists and the state chips derive from each binding,
 * so extra lanes need no table changes.
 *
 * Expressions are validated with the shared core evaluator before they reach
 * the state tree; invalid text restores the previous valid expression and is
 * reported in the panel's status line.
 */

import { compileExpression } from "../core/expression.ts";
import { setFreeFrameMeta } from "../state/actions.ts";
import {
  availableSources,
  availableSourcesForFree,
  bindData,
  bindExpression,
  bindFrame,
  bindFreeData,
  bindFreeExpression,
  bindFreeFrame,
  bindFreeNone,
  bindNone,
  describeFreeInput,
  describeInput,
  expressionOf,
  inputLabel,
  listFreeInputs,
  listInputs,
} from "../state/bindings.ts";
import { DEMO } from "../state/dataset.ts";
import { S, frameName } from "../state/instrument.ts";

const EXPR_PLACEHOLDER = "round(1.2599210498948732 * C)";

export function createSourceTable(deps) {
  const { store, evaluate, applyRow, fitColumns, syncEditUi, renderStrip, updateReadouts } = deps;

  const btn = document.getElementById("sourcesBtn");
  const panel = document.getElementById("sourcesPanel");
  const rowsEl = document.getElementById("sourcesRows");
  const closeBtn = document.getElementById("sourcesClose");
  const statusEl = document.getElementById("sourcesStatus");

  let rowIndex = -1;
  /* Rows that are showing the expression editor while the (still empty) draft
     is not a bound source yet: `${lane}:${operand}` -> draft text. */
  const drafts = new Map();
  let committing = false;
  let suppressBlur = false;

  const draftKey = (binding) => `${binding.lane}:${binding.operand}`;

  function sourceLabel(binding) {
    if (binding.source.kind === "data") return `data · ${binding.source.column}`;
    if (binding.source.kind === "frame") return `frame · ${binding.source.name}`;
    if (binding.source.kind === "expr") return `expr · ${binding.source.text}`;
    return "—";
  }

  function stateClass(state) {
    if (state === "data") return "is-data";
    if (state === "1:1") return "is-feed";
    if (state === "z⁻¹") return "is-delay";
    if (state === "expr") return "is-expr";
    return "is-none";
  }

  function report(text, isError = false) {
    if (!statusEl) return;
    statusEl.dataset.userMessage = "1";
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function option(value, label, disabled = false) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (disabled) opt.disabled = true;
    return opt;
  }

  /* ── expression editing ─────────────────────────────────────────────── */

  function commitExpression(binding, index, input) {
    if (committing) return;
    const sl = S.lanes[binding.lane];
    const key = draftKey(binding);
    const text = input.value.trim();
    const previous = expressionOf(sl, binding.operand);

    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");

    if (text === previous) {
      /* Nothing to commit; an empty draft simply stops showing the editor. */
      drafts.delete(key);
      const stillExpr = describeInput(sl, binding.operand).source.kind === "expr";
      if (stillExpr) drafts.set(key, previous);
      if (!stillExpr) {
        rowIndex = index;
        render();
        focusRow(index);
      }
      return;
    }

    if (text !== "") {
      try {
        compileExpression(text);
      } catch (error) {
        /* Refuse the edit: keep the last valid expression and say why. */
        input.classList.add("invalid");
        input.setAttribute("aria-invalid", "true");
        input.value = previous;
        const message = error && error.message ? error.message : "invalid expression";
        report(`Lane ${binding.laneNumber} · ${binding.frame} expression: ${message}`, true);
        return;
      }
    }

    committing = true;
    try {
      store.patch(() => {
        bindExpression(sl, binding.operand, text);
        evaluate();
        syncEditUi();
        renderStrip();
        updateReadouts();
      });
    } finally {
      committing = false;
    }

    if (text === "") {
      drafts.delete(key);
      report(`Lane ${binding.laneNumber} · ${binding.frame} expression cleared.`);
      rowIndex = index;
      render();
      focusRow(index);
      return;
    }

    drafts.set(key, text);
    report(`Lane ${binding.laneNumber} · ${binding.frame} now reads expr · ${text}.`);
    rowIndex = index;
    render();
    focusRow(index, "expr");
  }

  function makeExpressionInput(binding, index, value) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "src-expr";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = EXPR_PLACEHOLDER;
    input.value = value;
    input.setAttribute("aria-label", `Lane ${binding.laneNumber} ${binding.frame} expression`);
    input.title = "One-line register expression — Enter or blur commits, Esc reverts";
    /* D53: the live pass could not evaluate this expression; the operand is frozen. */
    const liveError = S.expressionErrors[binding.frame] ?? null;
    if (liveError) {
      input.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
      input.title = `did not evaluate: ${liveError} — keeping the last settled bits`;
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitExpression(binding, index, input);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        input.value = expressionOf(S.lanes[binding.lane], binding.operand);
        input.classList.remove("invalid");
        input.removeAttribute("aria-invalid");
      }
    });
    input.addEventListener("input", () => {
      input.classList.remove("invalid");
      input.removeAttribute("aria-invalid");
    });
    input.addEventListener("blur", () => {
      if (committing || suppressBlur) return;
      commitExpression(binding, index, input);
    });
    return input;
  }

  /* ── rows ───────────────────────────────────────────────────────────── */

  function buildRow(binding, index) {
    const sl = S.lanes[binding.lane];
    const key = draftKey(binding);
    const tr = document.createElement("tr");
    tr.className = "src-binding";

    const dest = document.createElement("td");
    dest.className = "src-dest";
    const lane = document.createElement("span");
    lane.className = "src-lane";
    lane.textContent = `Lane ${binding.laneNumber}`;
    dest.appendChild(lane);
    dest.appendChild(document.createTextNode(binding.frame));
    if (binding.source.kind === "data") {
      const col = document.createElement("span");
      col.className = "src-col";
      col.textContent = ` · ${binding.source.column}`;
      dest.appendChild(col);
    } else if (binding.source.kind === "frame") {
      const col = document.createElement("span");
      col.className = "src-col";
      col.textContent = ` · ${binding.source.name}`;
      dest.appendChild(col);
    } else if (binding.source.kind === "expr") {
      const col = document.createElement("span");
      col.className = "src-col";
      col.textContent = " · expr";
      dest.appendChild(col);
    }
    tr.appendChild(dest);

    const sourceCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "src-pick";
    select.setAttribute("aria-label", `Lane ${binding.laneNumber} ${binding.frame} source`);
    select.appendChild(option("", "—"));

    if (DEMO.cols.length) {
      const dataGroup = document.createElement("optgroup");
      dataGroup.label = "data";
      DEMO.cols.forEach((column, ci) => {
        dataGroup.appendChild(option(`data:${ci}`, `data · ${column}`));
      });
      select.appendChild(dataGroup);
    }

    const frameGroup = document.createElement("optgroup");
    frameGroup.label = "frame";
    for (const candidate of availableSources(sl, binding.operand)) {
      const optVal = candidate.free
        ? `free:${candidate.free}`
        : `frame:${candidate.lane}:${candidate.frame}`;
      const optLbl = candidate.label
        ? `frame · ${candidate.name} (${candidate.label})`
        : `frame · ${candidate.name}`;
      frameGroup.appendChild(option(optVal, optLbl, candidate.disabled));
    }
    select.appendChild(frameGroup);
    select.appendChild(option("expr", "expr · expression"));

    if (binding.source.kind === "expr") drafts.set(key, binding.source.text);
    else if (binding.source.kind !== "none") drafts.delete(key);

    const editing = binding.source.kind === "expr" || drafts.has(key);
    select.value = editing
      ? "expr"
      : binding.source.kind === "data"
        ? `data:${binding.source.index}`
        : binding.source.kind === "frame"
          ? (binding.source.free
            ? `free:${binding.source.free}`
            : `frame:${binding.source.lane}:${binding.source.frame}`)
          : "";

    select.addEventListener("change", () => {
      const value = select.value;
      if (value === "expr") {
        drafts.set(key, expressionOf(sl, binding.operand));
        store.patch(() => {
          bindExpression(sl, binding.operand, "");
          evaluate();
          syncEditUi();
          renderStrip();
          updateReadouts();
        });
        report(`Lane ${binding.laneNumber} · ${binding.frame} reads expr — type an expression and press Enter.`);
        rowIndex = index;
        render();
        focusRow(index, "expr");
        return;
      }

      drafts.delete(key);
      store.patch(() => {
        if (!value) bindNone(sl, binding.operand);
        else if (value.startsWith("data:")) {
          bindData(sl, binding.operand, Number(value.slice(5)));
          fitColumns();
        } else if (value.startsWith("free:")) {
          bindFrame(sl, binding.operand, { free: value.slice(5) });
        } else {
          const [, laneKey, frame] = value.split(":");
          bindFrame(sl, binding.operand, { lane: laneKey, frame });
        }
        evaluate();
        syncEditUi();
        renderStrip();
        updateReadouts();
      });
      if (value.startsWith("data:")) applyRow();

      const updated = describeInput(sl, binding.operand);
      report(
        `Lane ${updated.laneNumber} · ${inputLabel(updated)} now reads ${sourceLabel(updated)} (${updated.state}).`
      );
      rowIndex = index;
      render();
      focusRow(rowIndex);
    });
    sourceCell.appendChild(select);

    if (editing) {
      const draft = drafts.has(key) ? drafts.get(key) : expressionOf(sl, binding.operand);
      sourceCell.appendChild(makeExpressionInput(binding, index, draft));
    }
    tr.appendChild(sourceCell);

    const state = document.createElement("td");
    state.className = `src-state ${stateClass(binding.state)}`;
    state.textContent = binding.state;
    if (binding.driven) {
      state.title = `driven by ${binding.source.kind === "frame" ? binding.source.name : binding.source.kind === "expr" ? "an expression" : "a route"}`;
    }
    tr.appendChild(state);

    return tr;
  }

  function laneGroupRow(laneKey, laneNumber) {
    const tr = document.createElement("tr");
    tr.className = "src-group-head";
    tr.dataset.lane = laneKey;
    const th = document.createElement("th");
    th.scope = "rowgroup";
    th.colSpan = 3;
    const names = ["a", "b"].map((frame) => frameName(laneKey, frame));
    th.textContent = `Lane ${laneNumber} · ${names[0]}/${names[1]}/${frameName(laneKey, "z")}`;
    tr.appendChild(th);
    return tr;
  }

  function focusRow(index, target = "select") {
    const rows = rowsEl.querySelectorAll("tr.src-binding");
    const row = rows[index];
    if (!row) return;
    const el = target === "expr" ? row.querySelector(".src-expr") : row.querySelector("select");
    if (el) el.focus();
  }

  function freeGroupRow(count) {
    const tr = document.createElement("tr");
    tr.className = "src-group-head";
    const th = document.createElement("th");
    th.scope = "rowgroup";
    th.colSpan = 3;
    th.textContent = `Free Frames · ${count}`;
    tr.appendChild(th);
    return tr;
  }

  function commitFreeExpression(binding, index, input) {
    if (committing) return;
    const ff = S.freeFrames[binding.free];
    if (!ff) return;
    const key = `F:${binding.free}`;
    const text = input.value.trim();
    const previous = ff.expression.trim();

    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");

    if (text === previous) {
      drafts.delete(key);
      if (previous !== "") drafts.set(key, previous);
      else {
        rowIndex = index;
        render();
        focusRow(index);
      }
      return;
    }
    if (text !== "") {
      try {
        compileExpression(text);
      } catch (error) {
        input.classList.add("invalid");
        input.setAttribute("aria-invalid", "true");
        input.value = previous;
        const message = error && error.message ? error.message : "invalid expression";
        report(`${binding.frame} expression: ${message}`, true);
        return;
      }
    }

    committing = true;
    try {
      store.patch(() => {
        bindFreeExpression(ff, text);
        evaluate();
        syncEditUi();
        renderStrip();
        updateReadouts();
      });
    } finally {
      committing = false;
    }

    if (text === "") {
      drafts.delete(key);
      report(`${binding.frame} expression cleared.`);
      rowIndex = index;
      render();
      focusRow(index);
      return;
    }
    drafts.set(key, text);
    report(`${binding.frame} now reads expr · ${text}.`);
    rowIndex = index;
    render();
    focusRow(index, "expr");
  }

  function buildFreeRow(binding, index) {
    const ff = S.freeFrames[binding.free];
    const key = `F:${binding.free}`;
    const tr = document.createElement("tr");
    tr.className = "src-binding src-free-binding";

    const dest = document.createElement("td");
    dest.className = "src-dest";
    const tag = document.createElement("span");
    tag.className = "src-lane";
    tag.textContent = "Free";
    dest.appendChild(tag);
    dest.appendChild(document.createTextNode(binding.frame));
    if (binding.label) {
      const col = document.createElement("span");
      col.className = "src-col";
      col.textContent = ` · ${binding.label}`;
      dest.appendChild(col);
    }
    const metaWrap = document.createElement("div");
    metaWrap.className = "src-free-meta";
    const labelIn = document.createElement("input");
    labelIn.type = "text";
    labelIn.className = "src-meta-input";
    labelIn.placeholder = "label (e.g. rfft)";
    labelIn.value = ff.label;
    labelIn.setAttribute("aria-label", `${binding.frame} label`);
    const noteIn = document.createElement("input");
    noteIn.type = "text";
    noteIn.className = "src-meta-input";
    noteIn.placeholder = "source note (e.g. numpy.fft.rfft)";
    noteIn.value = ff.sourceNote;
    noteIn.setAttribute("aria-label", `${binding.frame} source note`);
    const saveMeta = () => {
      const nextLabel = labelIn.value.trim();
      const nextNote = noteIn.value.trim();
      if (nextLabel === ff.label && nextNote === ff.sourceNote) return;
      store.patch(() => {
        setFreeFrameMeta(ff, { label: nextLabel, sourceNote: nextNote });
        syncEditUi();
        updateReadouts();
      });
    };
    labelIn.addEventListener("blur", saveMeta);
    noteIn.addEventListener("blur", saveMeta);
    labelIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveMeta(); } });
    noteIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveMeta(); } });
    metaWrap.append(labelIn, noteIn);
    dest.appendChild(metaWrap);
    tr.appendChild(dest);

    const sourceCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "src-pick";
    select.setAttribute("aria-label", `${binding.frame} source`);
    select.appendChild(option("", "—"));

    if (DEMO.cols.length) {
      const dataGroup = document.createElement("optgroup");
      dataGroup.label = "data";
      DEMO.cols.forEach((column, ci) => {
        dataGroup.appendChild(option(`data:${ci}`, `data · ${column}`));
      });
      select.appendChild(dataGroup);
    }

    const frameGroup = document.createElement("optgroup");
    frameGroup.label = "frame";
    for (const candidate of availableSourcesForFree(ff)) {
      const optVal = candidate.free
        ? `free:${candidate.free}`
        : `frame:${candidate.lane}:${candidate.frame}`;
      const optLbl = candidate.label
        ? `frame · ${candidate.name} (${candidate.label})`
        : `frame · ${candidate.name}`;
      frameGroup.appendChild(option(optVal, optLbl, candidate.disabled));
    }
    select.appendChild(frameGroup);
    select.appendChild(option("expr", "expr · expression"));

    if (binding.source.kind === "expr") drafts.set(key, binding.source.text);
    else if (binding.source.kind !== "none") drafts.delete(key);

    const editing = binding.source.kind === "expr" || drafts.has(key);
    select.value = editing
      ? "expr"
      : binding.source.kind === "data"
        ? `data:${binding.source.index}`
        : binding.source.kind === "frame"
          ? (binding.source.free
            ? `free:${binding.source.free}`
            : `frame:${binding.source.lane}:${binding.source.frame}`)
          : "";

    select.addEventListener("change", () => {
      const value = select.value;
      if (value === "expr") {
        drafts.set(key, ff.expression);
        store.patch(() => {
          bindFreeExpression(ff, "");
          evaluate();
          syncEditUi();
          renderStrip();
          updateReadouts();
        });
        report(`${binding.frame} reads expr — type an expression and press Enter.`);
        rowIndex = index;
        render();
        focusRow(index, "expr");
        return;
      }
      drafts.delete(key);
      store.patch(() => {
        if (!value) bindFreeNone(ff);
        else if (value.startsWith("data:")) {
          bindFreeData(ff, Number(value.slice(5)));
          fitColumns();
        } else if (value.startsWith("free:")) {
          bindFreeFrame(ff, { free: value.slice(5) });
        } else {
          const [, laneKey, frame] = value.split(":");
          bindFreeFrame(ff, { lane: laneKey, frame });
        }
        evaluate();
        syncEditUi();
        renderStrip();
        updateReadouts();
      });
      if (value.startsWith("data:")) applyRow();
      const updated = describeFreeInput(ff);
      report(`${inputLabel(updated)} now reads ${sourceLabel(updated)} (${updated.state}).`);
      rowIndex = index;
      render();
      focusRow(rowIndex);
    });
    sourceCell.appendChild(select);

    if (editing) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "src-expr";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.placeholder = "F1 << 4";
      input.value = drafts.has(key) ? drafts.get(key) : ff.expression;
      input.setAttribute("aria-label", `${binding.frame} expression`);
      /* D53: frozen-register warning, same rule as lane operands. */
      const freeLiveError = S.expressionErrors[binding.frame] ?? null;
      if (freeLiveError) {
        input.classList.add("invalid");
        input.setAttribute("aria-invalid", "true");
        input.title = `did not evaluate: ${freeLiveError} — keeping the last settled bits`;
      }
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitFreeExpression(binding, index, input);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          input.value = ff.expression;
          input.classList.remove("invalid");
          input.removeAttribute("aria-invalid");
        }
      });
      input.addEventListener("input", () => {
        input.classList.remove("invalid");
        input.removeAttribute("aria-invalid");
      });
      input.addEventListener("blur", () => {
        if (committing || suppressBlur) return;
        commitFreeExpression(binding, index, input);
      });
      sourceCell.appendChild(input);
    }
    tr.appendChild(sourceCell);

    const state = document.createElement("td");
    state.className = `src-state ${stateClass(binding.state)}`;
    state.textContent = binding.state;
    if (binding.driven) {
      state.title = `driven by ${binding.source.kind === "frame" ? binding.source.name : binding.source.kind === "expr" ? "an expression" : "a route"}`;
    }
    tr.appendChild(state);

    return tr;
  }

  function render() {
    rowIndex = -1;
    suppressBlur = true;
    try {
      rowsEl.textContent = "";
      const bindings = listInputs();
      const freeBindings = listFreeInputs();
      let lane = null;
      bindings.forEach((binding, index) => {
        if (binding.lane !== lane) {
          lane = binding.lane;
          rowsEl.appendChild(laneGroupRow(binding.lane, binding.laneNumber));
        }
        rowsEl.appendChild(buildRow(binding, index));
      });
      if (freeBindings.length > 0) {
        rowsEl.appendChild(freeGroupRow(freeBindings.length));
        freeBindings.forEach((fb, offset) => {
          rowsEl.appendChild(buildFreeRow(fb, bindings.length + offset));
        });
      }
      const total = bindings.length + freeBindings.length;
      const bound = bindings.filter((b) => b.source.kind !== "none").length
        + freeBindings.filter((b) => b.source.kind !== "none").length;
      if (statusEl && !statusEl.dataset.userMessage) {
        const lanes = new Set(bindings.map((binding) => binding.lane)).size;
        const freePart = freeBindings.length > 0 ? ` · ${freeBindings.length} free` : "";
        statusEl.textContent = `${bound} / ${total} bound · ${lanes} lane${lanes === 1 ? "" : "s"}${freePart} · one source each`;
      }
    } finally {
      suppressBlur = false;
    }
  }

  function openPanel() {
    statusEl.dataset.userMessage = "";
    statusEl.classList.remove("is-error");
    render();
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const first = rowsEl.querySelector("select");
    if (first) first.focus();
  }

  function closePanel(returnFocus = false) {
    if (panel.hidden) return;
    panel.hidden = true;
    drafts.clear();
    btn.setAttribute("aria-expanded", "false");
    if (returnFocus) btn.focus();
  }

  btn.addEventListener("click", () => (panel.hidden ? openPanel() : closePanel(true)));
  closeBtn.addEventListener("click", () => closePanel(true));
  document.addEventListener("pointerdown", (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || e.target === btn) return;
    closePanel(false);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      closePanel(true);
      e.preventDefault();
    }
  });

  return {
    render,
    open: openPanel,
    close: closePanel,
    isOpen: () => !panel.hidden,
  };
}
