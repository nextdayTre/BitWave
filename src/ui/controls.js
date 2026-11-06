/**
 * Controls + LFO — the op/preset/binop/lane-size controls, edit-target sync
 * and the modulation engine.
 *
 * Moved out of main.js in F2. Reads/writes the state tree; all writes happen
 * inside the store transaction (via the injected store) and re-evaluate through
 * the core pass.
 */

import { applyPreset, applyUnary, setBinop } from "../state/actions.ts";
import {
  S,
  SIZES,
  SLOT_KEYS,
  curSlot,
  editReg,
  focusEditable,
  frameLabel,
  nibCount,
  syncTarget,
} from "../state/instrument.ts";
import { evaluate } from "../state/routing.ts";
import { stripEl } from "../render/strip.js";

export function createControls(deps) {
  const {
    store,
    resizeRegister,
    commit,
    renderStrip,
    updateReadouts,
    syncViewUi,
    applyExample,
  } = deps;

  const hintEl = document.getElementById("hint");

  const lfoBtn = document.getElementById("lfoBtn");
  const lfoModeSel = document.getElementById("lfoMode");
  const lfoRateSel = document.getElementById("lfoRate");
  const amountSel = document.getElementById("amount");
  const lfoBSel = document.getElementById("lfoB");

  function lfoBConfig(v = curSlot().lfoB) {
    const frac = v === "q" ? 0.25 : v === "h" ? 0.5 : 0;
    return { opp: v === "opp", off: Math.round(S.N * frac) };
  }

  function lfoStart() {
    if (S.lfo.on) return;
    if (S.lfo.mode === "csvStep" && (!DEMO.rows || !DEMO.rows.length)) return;
    store.patch(() => {
      const base = {};
      for (const k of SLOT_KEYS) {
        const sl = S.slots[k];
        base[k] = { a: sl.A.bits.slice(), b: sl.B.bits.slice() };
      }
      S.lfo.base = base;
      S.lfo.t = 0;
      S.lfo.on = true;
      S.lfoAcc = 0;
      lfoBtn.setAttribute("aria-pressed", "true");
    });
  }

  function lfoStop() {
    if (!S.lfo.on) return;
    store.patch(() => {
      S.lfo.on = false;
      lfoBtn.setAttribute("aria-pressed", "false");
      const snap = S.lfo.base;
      if (snap) {
        if (S.lfo.mode !== "csvStep") {
          for (const k of SLOT_KEYS) {
            const sl = S.slots[k];
            if (snap[k]) {
              sl.A.bits = snap[k].a.slice();
              sl.B.bits = snap[k].b.slice();
            }
            syncTarget(sl.A);
            syncTarget(sl.B);
          }
          evaluate();
        }
        S.lfo.base = null;
        renderStrip();
        updateReadouts();
      }
    });
  }

  /* Rotate (wrapping) or truncate a snapshot by a SIGNED bit count. */
  function sweepInto(reg, baseBits, bits, rotate) {
    const N = S.N;
    const out = new Uint8Array(N);
    if (rotate) {
      const sh = ((bits % N) + N) % N;
      for (let i = 0; i < N; i++) out[(i + sh) % N] = baseBits[i];
    } else {
      for (let i = 0; i < N; i++) {
        const d = i + bits;
        if (d >= 0 && d < N) out[d] = baseBits[i];
      }
    }
    reg.bits = out;
  }

  function lfoTick() {
    if (S.lfo.mode === "csvStep") {
      if (DEMO.rows && DEMO.rows.length) {
        csv.applyExample(DEMO.i + 1, false, true);
      }
      return;
    }

    const base = S.lfo.base;
    if (!base) return;

    store.patch(() => {
      const k = Math.max(1, Number(amountSel.value) || 4);
      const rotate = S.lfo.mode !== "slide";
      S.lfo.t++;
      const t = S.lfo.t;

      let shift;
      if (rotate) {
        shift = t * k * (S.lfo.mode === "rotccw" ? -1 : 1);
      } else {
        const maxSteps = Math.max(1, Math.ceil(S.N / k));
        const p = t % (2 * maxSteps);
        shift = (p <= maxSteps ? p : 2 * maxSteps - p) * k;
      }

      for (const sk of SLOT_KEYS) {
        const sl = S.slots[sk];
        const sb = base[sk];
        if (!sb) continue;
        sweepInto(sl.A, sb.a, shift, rotate);
        if (sl.showB) {
          const cfg = lfoBConfig(sl.lfoB);
          /* Counter-rotation is the only offset that makes Z *change shape*;
             a fixed offset just slides a rigid pattern around the register. */
          sweepInto(sl.B, sb.b, (cfg.opp ? -shift : shift) + cfg.off, rotate);
        }
        syncTarget(sl.A);
        syncTarget(sl.B);
      }

      evaluate();
      renderStrip();
      updateReadouts();
    });
  }

  lfoBtn.addEventListener("click", () => (S.lfo.on ? lfoStop() : lfoStart()));

  lfoModeSel.addEventListener("change", () => {
    store.patch(() => {
      S.lfo.mode = lfoModeSel.value;
      if (S.lfo.on) { S.lfo.t = 0; }      // restart the shape cleanly
      syncEditUi();
    });
  });

  lfoRateSel.addEventListener("change", () => {
    store.patch(() => {
      S.lfo.rate = Number(lfoRateSel.value) || 4;
      S.lfoAcc = 0;
    });
  });

  lfoBSel.addEventListener("change", () => {
    store.patch(() => {
      curSlot().lfoB = lfoBSel.value;
    });
  });

  document.querySelectorAll("[data-op]").forEach((btn) => {
    btn.addEventListener("click", () => {
      lfoStop();                       // a manual op takes the wheel back
      const k = Number(document.getElementById("amount").value) || 4;
      applyUnary(editReg(), btn.dataset.op, k);
      commit();
    });
  });

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      lfoStop();
      applyTable(btn.dataset.preset);
    });
  });

  /* ══════════════════════════════════════════════════════════
     OPERAND B / BINARY LOGIC
     B is enabled from the frame navigator (or a CSV B column / 3D).
     ══════════════════════════════════════════════════════════ */

  const logicGroup = document.getElementById("logicGroup");
  const binopBtns = [...document.querySelectorAll("[data-binop]")];

  function syncEditUi() {
    logicGroup.hidden = !S.showB;
    binopBtns.forEach((b) => {
      b.hidden = !S.showB;
      b.classList.toggle("on", b.dataset.binop === S.binop);
      b.setAttribute("aria-pressed", String(b.dataset.binop === S.binop));
    });
    stripEl.dataset.edit = frameLabel();
    if (hintEl) {
      hintEl.textContent = focusEditable()
        ? "drag a nibble · click a bit · scroll a hex"
        : `${frameLabel()} is derived — read-only`;
    }
    lfoBSel.value = curSlot().lfoB;
    lfoBSel.hidden = S.lfo.mode === "csvStep" || (!S.view3d && !S.showB);
  }

  /* The old "B" toggle's only unique capability was unpairing the second
     operand. The navigator keeps that, without the ambiguous button. */

  const sizeInput = document.getElementById("size");
  const sizeOut = document.getElementById("sizeOut");

  function syncSizeLabel() {
    sizeOut.textContent = `${S.N} bits · ${nibCount()} nibbles`;
  }

  sizeInput.addEventListener("input", () => {
    const idx = Number(sizeInput.value);
    resizeRegister(SIZES[idx]);
    syncSizeLabel();
  });

  return { lfoStart, lfoStop, lfoTick, syncEditUi, syncSizeLabel };
}
