/**
 * Bit-strip renderer — the semantic editor under the curve.
 *
 * Moved out of main.js in F2. Reads the state tree; writes only the strip DOM.
 * The strip label (data-edit), compact mode and read-only class are DESIGN §8.
 */

import {
  S,
  editReg,
  focusEditable,
  focusKey,
  focusReg,
  frameLabel,
  nibCount,
  nibValue,
  nibWeightPow,
} from "../state/instrument.ts";
import { isFocusDriven } from "../state/bindings.ts";

  const stripEl = document.getElementById("strip");
  const nibsEl = document.getElementById("nibs");

  /* The strip always shows the register you are editing. */
  function renderStrip() {
    const r = focusReg();
    const n = nibCount();
    const compact = S.compact;
    const readonly = !focusEditable() || isFocusDriven();

    const midA = S.N / 2 - 1;
    const midB = S.N / 2;

    let html = "";
    for (let j = 0; j < n; j++) {
      const base = S.N - 1 - 4 * j;
      const v = nibValue(r, j);

      html += `<div class="nib" data-j="${j}"><div class="bits">`;
      for (let k = 0; k < 4; k++) {
        const b = base - k;
        const cls = [
          "bit",
          r.bits[b] ? "on" : "",
          (b === midA || b === midB) ? "mid" : "",
        ].join(" ").trim();
        html += `<i class="${cls}" data-b="${b}">${r.bits[b]}</i>`;
      }
      html += `</div>`;
      html += `<div class="hex" title="scroll to adjust this nibble">${v.toString(16).toUpperCase()}</div>`;
      html += `<div class="dec">${v}</div>`;

      /* At 256-bit density a weight under every column would collide, so
         mark every 8th nibble plus the LSB — the scale still reads, and the
         ratio between marks is always 2^32. */
      const showWt = !compact || j % 8 === 0 || j === n - 1;
      html += `<div class="wt">${showWt ? "2^" + nibWeightPow(j) : ""}</div>`;
      html += `</div>`;
    }
    nibsEl.innerHTML = html;
    stripEl.dataset.edit = frameLabel();
    stripEl.classList.toggle("is-readonly", readonly);
    stripEl.setAttribute("aria-readonly", readonly ? "true" : "false");
    syncHoverClasses();
  }

  function patchNibble(j) {
    const r = editReg();
    const el = nibsEl.querySelector(`.nib[data-j="${j}"]`);
    if (!el) return;
    const base = S.N - 1 - 4 * j;
    const cells = el.querySelectorAll(".bit");
    for (let k = 0; k < 4; k++) {
      const b = base - k;
      cells[k].textContent = r.bits[b];
      cells[k].classList.toggle("on", !!r.bits[b]);
    }
    const v = nibValue(r, j);
    el.querySelector(".hex").textContent = v.toString(16).toUpperCase();
    const dec = el.querySelector(".dec");
    if (dec) dec.textContent = v;
  }

  function syncHoverClasses() {
    const kids = nibsEl.children;
    const hotKey = focusKey();
    for (let j = 0; j < kids.length; j++) {
      kids[j].classList.toggle("hot", j === S.hoverJ && S.hoverReg === hotKey);
    }
  }

export { stripEl, nibsEl, renderStrip, patchNibble, syncHoverClasses };
