/**
 * CSV import + example stepper.
 *
 * Moved out of main.js in F2, and re-housed as the source table's data path in
 * F3: an import fills the six bindings with columns, then steps write each
 * bound input. Driven inputs are left to the routing engine.
 */

import {
  alignBits,
  cellToBits,
  columnMode,
  columnWidth,
  isDataRow,
  normCell,
  parseDelimited,
} from "../core/csv.ts";
import { S, SLOT_KEYS, SIZES, syncTarget } from "../state/instrument.ts";
import { DEMO } from "../state/dataset.ts";
import { isInputDriven, resetBindings } from "../state/bindings.ts";
import { evaluate } from "../state/routing.ts";
import { observations } from "../io/observations.js";

export function createCsvImport(deps) {
  const {
    store,
    resizeRegister,
    lfoStop,
    frameNav,
    syncViewUi,
    renderStrip,
    updateReadouts,
    onSizeChange,
    onBindingsChanged,
  } = deps;

  const csvBtn = document.getElementById("csvBtn");
  const csvFile = document.getElementById("csvFile");
  const stepSeg = document.getElementById("stepSeg");
  const exCount = document.getElementById("exCount");
  const prevEx = document.getElementById("prevEx");
  const nextEx = document.getElementById("nextEx");
  const obsSeg = document.getElementById("obsSeg");
  const obsCount = document.getElementById("obsCount");

  function writeBitsInto(reg, arr) {
    reg.bits = alignBits(arr, S.N);
  }

  function fitToMappedColumns() {
    let maxBits = 8;
    for (const k of SLOT_KEYS) {
      const sl = S.slots[k];
      if (sl.colA >= 0) maxBits = Math.max(maxBits, columnWidth(DEMO.rows, sl.colA));
      if (sl.colB >= 0) maxBits = Math.max(maxBits, columnWidth(DEMO.rows, sl.colB));
    }
    let want = SIZES[0];
    for (const s of SIZES) { want = s; if (s >= maxBits) break; }
    if (want !== S.N) {
      resizeRegister(want);
      onSizeChange(SIZES.indexOf(want));
    }
  }

  function applyExample(idx, instant, keepLfo = false) {
    if (!DEMO.rows.length) return;
    store.patch(() => {
      if (frameNav.isOpen()) frameNav.close(false);
      if (!keepLfo) lfoStop();
      const n = DEMO.rows.length;
      DEMO.i = ((idx % n) + n) % n;
      const row = DEMO.rows[DEMO.i];

      for (const k of SLOT_KEYS) {
        const sl = S.slots[k];
        if (sl.colA >= 0 && !isInputDriven(sl, "a")) {
          const a = cellToBits(row[sl.colA], columnMode(DEMO.rows, sl.colA));
          if (a) writeBitsInto(sl.A, a);
          syncTarget(sl.A, instant === true);
        }
        if (sl.colB >= 0 && !isInputDriven(sl, "b")) {
          const b = cellToBits(row[sl.colB], columnMode(DEMO.rows, sl.colB));
          if (b) {
            writeBitsInto(sl.B, b);
            sl.seededB = true;
          }
          syncTarget(sl.B, instant === true);
        }
      }

      evaluate(instant === true);
      renderStrip();
      updateReadouts();
      syncViewUi();
      renderDemoUi();
    });
  }

  function renderDemoUi() {
    const loaded = DEMO.rows.length > 0;
    [stepSeg, exCount, obsSeg, obsCount].forEach((el) => { if (el) el.hidden = !loaded; });
    if (!loaded) return;
    exCount.textContent = `${DEMO.i + 1} / ${DEMO.rows.length}`;
    if (obsCount) obsCount.textContent = `${observations.length} obs`;
  }

  function loadCSV(text) {
    const rows = parseDelimited(text).filter((r) => r.some((c) => normCell(c) !== ""));
    if (rows.length < 1) return;

    const hasHeader = !isDataRow(rows[0]);
    const cols = hasHeader
      ? rows[0].map((c, i) => String(c).trim() || `col${i + 1}`)
      : rows[0].map((_, i) => `col${i + 1}`);
    const body = hasHeader ? rows.slice(1) : rows;
    if (!body.length) return;

    DEMO.cols = cols;
    DEMO.rows = body;
    DEMO.i = 0;

    /* A fresh import replaces the binding board: frame routes are dropped and
       the six rows are filled from the imported columns (D11). */
    resetBindings();

    /* Default to the WIDEST token column, not the first: id/label columns
       are often present and the payload is what you want to see. */
    const widths = cols.map((_, ci) => columnWidth(DEMO.rows, ci));
    let best = -1, bestW = -1;
    for (let ci = 0; ci < cols.length; ci++) {
      if (widths[ci] > bestW) { bestW = widths[ci]; best = ci; }
    }
    const primary = bestW > 0 ? best : 0;

    /* Collect payload-grade columns so lanes 2 & 3 pre-route extra columns
       automatically for instant multi-column / side-by-side comparison. */
    const minPayload = Math.max(8, Math.floor(bestW / 2));
    let payload = [];
    for (let ci = 0; ci < cols.length; ci++) {
      if (widths[ci] >= minPayload) payload.push(ci);
    }
    if (!payload.length) {
      for (let ci = 0; ci < cols.length; ci++) if (widths[ci] > 0) payload.push(ci);
    }
    if (!payload.length) payload = [primary];

    const rest = payload.filter((c) => c !== primary);
    const ordered = [primary, ...rest];

    const slA = S.slots.A, slB = S.slots.B, slC = S.slots.C;
    slA.colA = primary;
    slA.colB = (S.view3d || slA.showB) && ordered.length >= 2 ? ordered[1] : -1;

    if (ordered.length >= 4) {
      const off = slA.colB >= 0 ? 2 : 1;
      slB.colA = ordered[off] ?? ordered[0];
      slB.colB = ordered[off + 1] ?? ordered[1];
      slB.showB = true;
      slC.colA = ordered[off + 2] ?? ordered[0];
      slC.colB = ordered[off + 3] ?? ordered[ordered.length - 1];
      slC.showB = true;
    } else if (ordered.length === 3) {
      slB.colA = slA.colB >= 0 ? ordered[0] : ordered[1];
      slB.colB = ordered[2];
      slB.showB = true;
      slC.colA = ordered[1];
      slC.colB = ordered[2];
      slC.showB = true;
    } else if (ordered.length === 2) {
      slB.colA = ordered[0];
      slB.colB = ordered[1];
      slB.showB = true;
      if (slB.binop === slA.binop) slB.binop = "and";
      slC.colA = ordered[1];
      slC.colB = ordered[0];
      slC.showB = true;
    } else {
      slB.colA = primary; slB.colB = -1;
      slC.colA = primary; slC.colB = -1;
    }

    fitToMappedColumns();
    applyExample(0, true);
    onBindingsChanged();
  }

  csvBtn.addEventListener("click", () => csvFile.click());

  csvFile.addEventListener("change", () => {
    const f = csvFile.files && csvFile.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => loadCSV(String(rd.result || ""));
    rd.readAsText(f);
    csvFile.value = "";
  });

  prevEx.addEventListener("click", () => applyExample(DEMO.i - 1));
  nextEx.addEventListener("click", () => applyExample(DEMO.i + 1));

  return { loadCSV, applyExample, renderUi: renderDemoUi, fitColumns: fitToMappedColumns };
}
