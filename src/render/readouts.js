/**
 * Readouts — hex / decimal / truth table / trend, and the 3-D A/B/Z rows.
 *
 * Moved out of main.js in F2. Reads the state tree; writes only the meta DOM.
 */

import {
  OPSYM,
  S,
  focusKey,
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
  const canvasEl = document.getElementById("wave");
  const lblAEl = document.getElementById("lblA");
  const lblBEl = document.getElementById("lblB");
  const lblZEl = document.getElementById("lblZ");

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
        `<div class="truth-grid ar" role="table" aria-label="${label}">` +
        `<div role="row">` +
        `<span class="th" role="columnheader">${label}</span>` +
        `<span class="ct${over ? " yes" : ""}" role="cell">${over ? "yes" : "no"}</span>` +
        `</div>` +
        `</div>`;
      return;
    }

    const counts = [0, 0, 0, 0];
    for (let i = 0; i < S.N; i++) {
      counts[(S.A.bits[i] << 1) | S.B.bits[i]]++;
    }

    let html = `<div class="truth-h">${fa} ${OPSYM[S.binop]} ${fb} → ${fz}</div>`;
    html += `<div class="truth-grid" role="table" aria-label="truth table">`;
    html += `<div role="row">` +
      `<span class="th" role="columnheader">a</span>` +
      `<span class="th" role="columnheader">b</span>` +
      `<span class="th" role="columnheader">→</span>` +
      `<span class="th" role="columnheader">n</span>` +
      `</div>`;
    for (const [a, b] of PAIRS) {
      const z = binFn(a, b);
      html += `<div role="row">` +
        `<span role="cell">${a}</span>` +
        `<span role="cell">${b}</span>` +
        `<span class="z${z ? " on" : ""}" role="cell">${z}</span>` +
        `<span class="ct" role="cell">${counts[(a << 1) | b]}</span>` +
        `</div>`;
    }
    html += `</div>`;
    truthEl.innerHTML = html;
  }

  /* D41: the A/B/Z1 readout labels are the frame lens. Names follow the lane,
     aria-pressed follows the focused frame; Z1 is a read-only focus. */
  function renderFrameLens() {
    const frames = [["a", lblAEl], ["b", lblBEl], ["z", lblZEl]];
    const focused = focusKey();
    for (const [frame, el] of frames) {
      if (!el) continue;
      const name = frameName(S.slot, frame);
      el.textContent = name;
      el.setAttribute("aria-pressed", String(frame === focused));
      if (frame === "z") {
        el.setAttribute("aria-label", `focus ${name} (read-only)`);
        el.title = `${name} is derived — focus to inspect (read-only)`;
      } else {
        el.setAttribute("aria-label", `focus ${name}`);
        el.title = `Focus ${name} to edit it`;
      }
    }
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
      renderFrameLens();
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

    /* DESIGN §8: the canvas is a lens, not a control — it is an image with a
       live text alternative, updated on every commit (never per animation
       frame; the curve is the visual, the words are the data). */
    let pop = 0;
    for (let i = 0; i < S.N; i++) pop += S.Z.bits[i];
    const alt = [
      S.view3d ? "3-D depth field" : "2-D waveform",
      `lane ${laneLabel(S.slot)}`,
      `${frameName(S.slot, "a")} ${toHexOf(S.A)}`,
    ];
    if (S.showB) {
      alt.push(`${frameName(S.slot, "b")} ${toHexOf(S.B)}`);
      alt.push(`${frameName(S.slot, "z")} ${toHexOf(S.Z)}`);
      alt.push(`popcount ${pop}`);
    }
    alt.push(`editing ${frameLabel()}`);
    canvasEl.setAttribute("aria-label", alt.join(" · "));
  }

export { toHexOf, updateReadouts };
