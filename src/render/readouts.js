/**
 * Readouts — hex / decimal / truth table / trend, and the 3-D A/B/Z rows.
 *
 * Moved out of main.js in F2. Reads the state tree; writes only the meta DOM.
 */

import {
  OPSYM,
  S,
  activeFrameLabel,
  curFreeFrame,
  focusKey,
  focusReg,
  frameLabel,
  frameName,
  freeFrameName,
  isArith,
  nibCount,
  nibValue,
  regToBig,
} from "../state/instrument.ts";
import { stripEl } from "./strip.js";

  const metaEl = document.getElementById("meta");
  const slotBadgeEl = document.getElementById("slotBadge");
  const truthBlockEl = document.getElementById("truthBlock");
  const truthEl = document.getElementById("truth");
  const truthToggleEl = document.getElementById("truthToggle");
  const truthTitleEl = truthToggleEl ? truthToggleEl.querySelector(".truth-title") : null;
  const truthChevEl = truthToggleEl ? truthToggleEl.querySelector(".truth-chev") : null;
  const truthBodyEl = document.getElementById("truthBody");
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

  /* D47: the truth table is a collapsible disclosure in the readout/meta row and
     is rendered for the focused lane in every view (A-only included). The header
     button carries the live algebra (`A ⊕ B → Z1`), aria-expanded and the
     accessible name; the body keeps the same role="table" grid and live counts,
     including the arithmetic carry/borrow variant. Open/closed is the transient
     session preference `S.truthOpen` (not persisted). */
  function renderTruth() {
    const fa = frameName(S.laneKey, "a");
    const fb = frameName(S.laneKey, "b");
    const fz = frameName(S.laneKey, "z");
    const sym = OPSYM[S.binop] || "\u2295";
    const subject = `${fa} ${sym} ${fb} \u2192 ${fz}`;
    const open = S.truthOpen !== false;
    if (truthTitleEl) truthTitleEl.textContent = subject;
    if (truthToggleEl) {
      truthToggleEl.setAttribute("aria-expanded", String(open));
      truthToggleEl.setAttribute("aria-label", `truth table for lane ${S.laneKey} ${subject}`);
      truthToggleEl.title = open ? "Collapse the truth table" : "Expand the truth table";
    }
    if (truthChevEl) truthChevEl.textContent = open ? "\u25BE" : "\u25B8";
    if (truthBodyEl) truthBodyEl.hidden = !open;

    const tableLabel = `truth table for lane ${S.laneKey}: ${subject}`;

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
        `<div class="truth-grid ar" role="table" aria-label="${tableLabel}">` +
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

    let html = `<div class="truth-grid" role="table" aria-label="${tableLabel}">`;
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
      const name = frameName(S.laneKey, frame);
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
    const ff = curFreeFrame();
    if (ff) {
      const name = freeFrameName(ff.key);
      metaEl.classList.toggle("ab", false);
      stripEl.dataset.edit = name;
      if (truthBlockEl) truthBlockEl.hidden = true;
      if (slotBadgeEl) {
        /* D53: a failed expression freezes the register at its last settled bits. */
        const stale = S.expressionErrors[name] ?? null;
        slotBadgeEl.hidden = false;
        slotBadgeEl.classList.toggle("is-stale", Boolean(stale));
        slotBadgeEl.textContent = (ff.label ? `${name} · ${ff.label}` : `${name} · free`)
          + (stale ? " · stale" : "");
        slotBadgeEl.title = stale
          ? `expression did not evaluate: ${stale} — showing the last settled value`
          : ff.sourceNote ? `${name}: ${ff.sourceNote}` : `Free frame ${name}`;
      }
      hexEl.textContent = toHexOf(ff.reg);
      if (withDecimal) {
        const d = toDecimalOf(ff.reg);
        decEl.textContent = d;
        decEl.title = d;
      }
      const n = nibCount();
      const diff = ff.reg.target[n - 1] - ff.reg.target[0];
      trendEl.classList.toggle("flat", diff === 0);
      trendEl.textContent = diff < 0 ? "step-down" : diff > 0 ? "step-up" : "level";
      const alt = [
        S.view3d ? "3-D depth plate" : "2-D waveform",
        `free frame ${name}`,
        ff.label || null,
        toHexOf(ff.reg),
        ff.sourceNote || null,
      ].filter(Boolean);
      canvasEl.setAttribute("aria-label", alt.join(" · "));
      return;
    }

    if (truthBlockEl) truthBlockEl.hidden = false;
    /* The truth table is exactly the right companion to the 3-D field. */
    metaEl.classList.toggle("ab", S.showB);
    stripEl.dataset.edit = frameLabel();

    if (slotBadgeEl) {
      const focused = focusKey();
      const laneName = frameName(S.laneKey, focused);
      const laneStale = S.expressionErrors[laneName] ?? null;
      slotBadgeEl.hidden = !S.view3d && S.laneKey === "1";
      slotBadgeEl.classList.toggle("is-stale", Boolean(laneStale));
      slotBadgeEl.textContent = `lane ${S.laneKey}` + (laneStale ? " · stale" : "");
      slotBadgeEl.title = laneStale
        ? `expression did not evaluate: ${laneStale} — showing the last settled value`
        : "";
    }

    if (S.showB) {
      renderFrameLens();
      popEl.previousElementSibling.textContent = `pop ${frameName(S.laneKey, "z")}`;
      hexAEl.textContent = toHexOf(S.A);
      hexBEl.textContent = toHexOf(S.B);
      hexZEl.textContent = toHexOf(S.Z);
      let pop = 0;
      for (let i = 0; i < S.N; i++) pop += S.Z.bits[i];
      popEl.textContent = String(pop);
    } else {
      hexEl.textContent = toHexOf(S.A);
      if (withDecimal) {
        const d = toDecimalOf(S.A);
        decEl.textContent = d;
        decEl.title = d;
      }
    }

    /* D47: the truth disclosure is present in every view, not just A·B/3-D. */
    renderTruth();

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
      `lane ${S.laneKey}`,
      `${frameName(S.laneKey, "a")} ${toHexOf(S.A)}`,
    ];
    if (S.showB) {
      alt.push(`${frameName(S.laneKey, "b")} ${toHexOf(S.B)}`);
      alt.push(`${frameName(S.laneKey, "z")} ${toHexOf(S.Z)}`);
      alt.push(`popcount ${pop}`);
    }
    alt.push(`editing ${frameLabel()}`);
    canvasEl.setAttribute("aria-label", alt.join(" · "));
  }

export { toHexOf, updateReadouts };
