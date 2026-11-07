/**
 * Bit-strip renderer — the semantic editor under the curve.
 *
 * Moved out of main.js in F2. Reads the state tree; writes only the strip DOM.
 * The strip label (data-edit), compact mode and read-only class are DESIGN §8.
 *
 * F4: every operand nibble is a focusable `role="spinbutton"` (DESIGN §6/§8).
 * The roving tabindex lives here so a re-render can restore it — LFO ticks and
 * commits replace the strip's contents, and focus must never fall to <body>
 * (DESIGN §10.33). Read-only strips (derived or driven frames) expose the same
 * values with `aria-readonly` but no tab stop.
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

  /* Roving tabindex: the last-focused nibble survives every re-render and is
     where Tab enters the strip. Clamped when the register width changes. */
  let rovingJ = 0;

  function nibAriaText(j, v, n) {
    const base = S.N - 1 - 4 * j;
    const lo = base - 3;
    const hex = v.toString(16).toUpperCase();
    return `nibble ${j + 1} of ${n}, hex ${hex}, bits ${lo}–${base}, weight 2^${nibWeightPow(j)}`;
  }

  function spinAttrs(j, v, n, readonly) {
    const common =
      `role="spinbutton" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="15"` +
      ` aria-label="nibble ${j + 1} of ${n}" aria-valuetext="${nibAriaText(j, v, n)}"`;
    if (readonly) return `${common} aria-readonly="true"`;
    return `${common} tabindex="${j === rovingJ ? 0 : -1}"`;
  }

  /* The strip always shows the register you are editing. */
  function renderStrip() {
    const r = focusReg();
    const n = nibCount();
    const compact = S.compact;
    const readonly = !focusEditable() || isFocusDriven();

    /* If the strip had focus, remember the nibble before innerHTML wipes it. */
    const hadFocus = nibsEl.contains(document.activeElement);
    if (hadFocus) {
      const active = document.activeElement.closest(".nib");
      if (active) rovingJ = Number(active.dataset.j) || 0;
    }
    rovingJ = Math.max(0, Math.min(n - 1, rovingJ));

    const midA = S.N / 2 - 1;
    const midB = S.N / 2;

    let html = "";
    for (let j = 0; j < n; j++) {
      const base = S.N - 1 - 4 * j;
      const v = nibValue(r, j);
      const attrs = spinAttrs(j, v, n, readonly);

      html += `<div class="nib" data-j="${j}" ${attrs}><div class="bits">`;
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

    /* Restore focus to the same nibble (DESIGN §10.33). */
    if (hadFocus && !readonly) {
      const back = nibsEl.querySelector(`.nib[data-j="${rovingJ}"]`);
      if (back) back.focus({ preventScroll: true });
    }

    stripEl.dataset.edit = frameLabel();
    stripEl.classList.toggle("is-readonly", readonly);
    stripEl.setAttribute("role", "group");
    stripEl.setAttribute(
      "aria-label",
      `${frameLabel()} register${readonly ? ", read-only" : ""}`
    );
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

    /* Keep the semantic value in sync — the fast patch must not leave a stale
       value for a screen reader (aria-valuenow/valuetext). */
    if (!el.hasAttribute("aria-readonly")) {
      const n = nibCount();
      el.setAttribute("aria-valuenow", String(v));
      el.setAttribute("aria-valuetext", nibAriaText(j, v, n));
    }
  }

  /**
   * Moves the roving tabindex to nibble `j` and focuses it.
   * The caller owns the "is this strip editable" check.
   */
  function focusNibble(j) {
    const n = nibCount();
    rovingJ = Math.max(0, Math.min(n - 1, j));
    const kids = nibsEl.children;
    for (let k = 0; k < kids.length; k++) {
      if (kids[k].hasAttribute("role")) {
        kids[k].setAttribute("tabindex", k === rovingJ ? "0" : "-1");
      }
    }
    const target = nibsEl.querySelector(`.nib[data-j="${rovingJ}"]`);
    if (target) target.focus({ preventScroll: false });
    return rovingJ;
  }

  function syncHoverClasses() {
    const kids = nibsEl.children;
    const hotKey = focusKey();
    for (let j = 0; j < kids.length; j++) {
      kids[j].classList.toggle("hot", j === S.hoverJ && S.hoverReg === hotKey);
    }
  }

export {
  stripEl,
  nibsEl,
  renderStrip,
  patchNibble,
  focusNibble,
  syncHoverClasses,
};
