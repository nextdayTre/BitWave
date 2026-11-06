/**
 * Input source table — the six fixed bindings, one row per operand frame A–F.
 *
 * Moved out of the spike and into the instrument for F3. A row reads one
 * source: an imported CSV column (`data`), a frame output (`1:1` / `z⁻¹`), or
 * nothing. The label carries the assignment (D15 / author note): a data-bound
 * row reads `A · sine`, matching the column name the import dropdown shows.
 */

import {
  availableSources,
  bindData,
  bindFrame,
  bindNone,
  describeInput,
  inputLabel,
  listInputs,
} from "../state/bindings.ts";
import { DEMO } from "../state/dataset.ts";
import { S } from "../state/instrument.ts";

export function createSourceTable(deps) {
  const { store, evaluate, applyRow, fitColumns, syncEditUi, renderStrip, updateReadouts } = deps;

  const btn = document.getElementById("sourcesBtn");
  const panel = document.getElementById("sourcesPanel");
  const rowsEl = document.getElementById("sourcesRows");
  const closeBtn = document.getElementById("sourcesClose");
  const statusEl = document.getElementById("sourcesStatus");

  let rowIndex = -1;

  function sourceLabel(binding) {
    if (binding.source.kind === "data") return `data · ${binding.source.column}`;
    if (binding.source.kind === "frame") return `frame · ${binding.source.name}`;
    return "—";
  }

  function option(value, label, disabled = false) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (disabled) opt.disabled = true;
    return opt;
  }

  function buildRow(binding, index) {
    const sl = S.slots[binding.lane];
    const tr = document.createElement("tr");

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
    }
    tr.appendChild(dest);

    const sourceCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "src-pick";
    select.setAttribute("aria-label", `Lane ${binding.laneNumber} ${binding.operand.toUpperCase()} source`);
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
      frameGroup.appendChild(
        option(
          `frame:${candidate.lane}:${candidate.frame}`,
          `frame · ${candidate.name}`,
          candidate.disabled
        )
      );
    }
    select.appendChild(frameGroup);

    select.value =
      binding.source.kind === "data"
        ? `data:${binding.source.index}`
        : binding.source.kind === "frame"
          ? `frame:${binding.source.lane}:${binding.source.frame}`
          : "";

    select.addEventListener("change", () => {
      const value = select.value;
      store.patch(() => {
        if (!value) bindNone(sl, binding.operand);
        else if (value.startsWith("data:")) {
          bindData(sl, binding.operand, Number(value.slice(5)));
          fitColumns();
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
      if (statusEl) {
        statusEl.dataset.userMessage = "1";
        statusEl.textContent = `Lane ${updated.laneNumber} · ${inputLabel(updated)} now reads ${sourceLabel(updated)} (${updated.state}).`;
      }
      rowIndex = index;
      render();
      focusRow(rowIndex);
    });
    sourceCell.appendChild(select);
    tr.appendChild(sourceCell);

    const state = document.createElement("td");
    state.className = `src-state is-${binding.state === "—" ? "none" : binding.state === "data" ? "data" : binding.state === "z⁻¹" ? "delay" : "feed"}`;
    state.textContent = binding.state;
    if (binding.driven) state.title = `driven by ${binding.source.kind === "frame" ? binding.source.name : "a route"}`;
    tr.appendChild(state);

    return tr;
  }

  function focusRow(index) {
    const select = rowsEl.querySelectorAll("tr select")[index];
    if (select) select.focus();
  }

  function render() {
    rowIndex = -1;
    rowsEl.textContent = "";
    const bindings = listInputs();
    bindings.forEach((binding, index) => rowsEl.appendChild(buildRow(binding, index)));
    const bound = bindings.filter((binding) => binding.source.kind !== "none").length;
    if (statusEl && !statusEl.dataset.userMessage) {
      statusEl.textContent = `${bound} / ${bindings.length} bound · one source each`;
    }
  }

  function openPanel() {
    statusEl.dataset.userMessage = "";
    render();
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const first = rowsEl.querySelector("select");
    if (first) first.focus();
  }

  function closePanel(returnFocus = false) {
    if (panel.hidden) return;
    panel.hidden = true;
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
