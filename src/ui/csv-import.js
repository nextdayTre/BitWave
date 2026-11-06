/**
 * CSV import + example stepper.
 *
 * Moved out of main.js in F2. Reads/writes the dataset and lane column
 * bindings; all register writes run inside the store transaction and go
 * through the core evaluation pass.
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
import { S, SLOT_KEYS, SIZES, curSlot, syncTarget } from "../state/instrument.ts";
import { DEMO } from "../state/dataset.ts";
import { evaluate } from "../state/routing.ts";
import { observations } from "../io/observations.js";

export function createCsvImport(deps) {
  const {
    store,
    resizeRegister,
    lfoStop,
    enableB,
    frameNav,
    syncViewUi,
    renderStrip,
    updateReadouts,
  } = deps;

  const csvBtn = document.getElementById("csvBtn");
  const csvFile = document.getElementById("csvFile");
  const stepSeg = document.getElementById("stepSeg");
  const exCount = document.getElementById("exCount");
  const colAWrap = document.getElementById("colAWrap");
  const colBWrap = document.getElementById("colBWrap");
  const colASel = document.getElementById("colA");
  const colBSel = document.getElementById("colB");
  const prevEx = document.getElementById("prevEx");
  const nextEx = document.getElementById("nextEx");
  const obsSeg = document.getElementById("obsSeg");
  const obsCount = document.getElementById("obsCount");

  const escHtml = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  /* Minimal RFC4180 reader: quoted fields, doubled quotes, CRLF, and
     comma-or-tab chosen by whichever appears more in the first line. */
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
      sizeInput.value = String(SIZES.indexOf(want));
      syncSizeLabel();
    }
  }

  function refreshColumnSelects() {
    const opts = `<option value="-1">—</option>` +
      DEMO.cols.map((c, i) => `<option value="${i}">${escHtml(c)}</option>`).join("");
    colASel.innerHTML = opts;
    colBSel.innerHTML = opts;
    const sl = curSlot();
    colASel.value = String(sl.colA);
    colBSel.value = String(sl.colB);
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
        if (sl.colA >= 0) {
          const a = cellToBits(row[sl.colA], columnMode(DEMO.rows, sl.colA));
          if (a) writeBitsInto(sl.A, a);
          syncTarget(sl.A, instant === true);
        }
        if (sl.colB >= 0) {
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
    [stepSeg, exCount, colAWrap, colBWrap, obsSeg, obsCount].forEach((el) => { if (el) el.hidden = !loaded; });
    if (!loaded) return;
    const sl = curSlot();
    exCount.textContent = `${DEMO.i + 1} / ${DEMO.rows.length}`;
    colASel.value = String(sl.colA);
    colBSel.value = String(sl.colB);
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

    /* Default to the WIDEST token column, not the first: id/label columns
       are often present and the payload is what you want to see. */
    const widths = cols.map((_, ci) => columnWidth(DEMO.rows, ci));
    let best = -1, bestW = -1;
    for (let ci = 0; ci < cols.length; ci++) {
      if (widths[ci] > bestW) { bestW = widths[ci]; best = ci; }
    }
    const primary = bestW > 0 ? best : 0;

    /* Collect payload-grade columns so Views B & C pre-route extra columns
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
    refreshColumnSelects();
    applyExample(0, true);
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

  colASel.addEventListener("change", () => {
    curSlot().colA = Number(colASel.value);
    fitToMappedColumns();
    refreshColumnSelects();
    applyExample(DEMO.i, true);
  });

  colBSel.addEventListener("change", () => {
    const sl = curSlot();
    sl.colB = Number(colBSel.value);
    if (sl.colB >= 0 && !sl.showB) enableB();
    fitToMappedColumns();
    refreshColumnSelects();
    applyExample(DEMO.i);
  });

  return { loadCSV, applyExample, renderUi: renderDemoUi };
}
