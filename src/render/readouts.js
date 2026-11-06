/**
 * Readouts — hex / decimal / truth table / trend, and the 3-D A/B/Z rows.
 *
 * Moved out of main.js in F2. Reads the state tree; writes only the meta DOM.
 */

import {
  OPSYM,
  S,
  focusReg,
  frameLabel,
  frameName,
  isArith,
  laneLabel,
  nibCount,
  nibValue,
  regToBig,
} from "../state/instrument.ts";
import { stripEl } from "./strip.js";

  const metaEl = document.getElementById("meta");
  const slotBadgeEl = document.getElementById("slotBadge");
  const truthEl = document.getElementById("truth");
  const hexEl = document.getElementById("hex");
  const decEl = document.getElementById("dec");
  const hexAEl = document.getElementById("hexA");
  const hexBEl = document.getElementById("hexB");
  const hexZEl = document.getElementById("hexZ");
  const popEl = document.getElementById("pop");
  const trendEl = document.getElementById("trend");

  function toHexOf(r) {
    const n = nibCount();
    let s = "";
    for (let j = 0; j < n; j++) s += nibValue(r, j).toString(16).toUpperCase();
    return s;
  }

  function toDecimalOf(r) {
    let v = 0n;
    for (let b = S.N - 1; b >= 0; b--) v = (v << 1n) | BigInt(r.bits[b]);
    return v.toString();
  }

  const PAIRS = [[0, 0], [0, 1], [1, 0], [1, 1]];

  const binFn = (a, b) =>
    S.binop === "and" ? (a & b) : S.binop === "or" ? (a | b) : (a ^ b);

  /* The truth table is live data: the `n` column counts how many bit
     positions in A and B actually hold each input pair, so the four
     counts always sum to the register width. */
  function renderTruth() {
    const fa = frameName(S.slot, "a");
    const fb = frameName(S.slot, "b");
    const fz = frameName(S.slot, "z");
    /* Arithmetic has no four-row truth table: the result depends on the
       whole word through the carry/borrow, not on the bit pair. */
    if (isArith()) {
      const a = regToBig(S.A);
      const b = regToBig(S.B);
      const over = S.binop === "add"
        ? (a + b) >= (1n << BigInt(S.N))
        : a < b;
      const label = S.binop === "add" ? "carry out" : "borrow out";
      truthEl.innerHTML =
        `<div class="truth-h">${fa} ${OPSYM[S.binop]} ${fb} → ${fz}</div>` +
        `<div class="truth-grid ar">` +
        `<span class="th">${label}</span>` +
        `<span class="ct${over ? " yes" : ""}">${over ? "yes" : "no"}</span>` +
        `</div>`;
      return;
    }

    const counts = [0, 0, 0, 0];
    for (let i = 0; i < S.N; i++) {
      counts[(S.A.bits[i] << 1) | S.B.bits[i]]++;
    }

    let html = `<div class="truth-h">${fa} ${OPSYM[S.binop]} ${fb} → ${fz}</div>`;
    html += `<div class="truth-grid">`;
    html += `<span class="th">a</span><span class="th">b</span><span class="th">→</span><span class="th">n</span>`;
    for (const [a, b] of PAIRS) {
      const z = binFn(a, b);
      html += `<span>${a}</span><span>${b}</span>`;
      html += `<span class="z${z ? " on" : ""}">${z}</span>`;
      html += `<span class="ct">${counts[(a << 1) | b]}</span>`;
    }
    html += `</div>`;
    truthEl.innerHTML = html;
  }

  function updateReadouts(withDecimal = true) {
    /* The truth table is exactly the right companion to the 3-D field. */
    metaEl.classList.toggle("ab", S.showB);
    stripEl.dataset.edit = frameLabel();

    if (slotBadgeEl) {
      slotBadgeEl.hidden = !S.view3d && S.slot === "A";
      slotBadgeEl.textContent = `lane ${laneLabel(S.slot)}`;
    }

    if (S.showB) {
      hexAEl.previousElementSibling.textContent = frameName(S.slot, "a");
      hexBEl.previousElementSibling.textContent = frameName(S.slot, "b");
      hexZEl.previousElementSibling.textContent = frameName(S.slot, "z");
      popEl.previousElementSibling.textContent = `pop ${frameName(S.slot, "z")}`;
      hexAEl.textContent = toHexOf(S.A);
      hexBEl.textContent = toHexOf(S.B);
      hexZEl.textContent = toHexOf(S.Z);
      let pop = 0;
      for (let i = 0; i < S.N; i++) pop += S.Z.bits[i];
      popEl.textContent = String(pop);
      renderTruth();
    } else {
      hexEl.textContent = toHexOf(S.A);
      if (withDecimal) {
        const d = toDecimalOf(S.A);
        decEl.textContent = d;
        decEl.title = d;
      }
    }

    /* Endpoint trend of the frame being shown. */
    const r = focusReg();
    const n = nibCount();
    const diff = r.target[n - 1] - r.target[0];
    trendEl.classList.toggle("flat", diff === 0);
    trendEl.textContent = diff < 0 ? "step-down" : diff > 0 ? "step-up" : "level";
  }

export { toHexOf, updateReadouts };
