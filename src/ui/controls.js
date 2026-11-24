/**
 * Controls + LFO — the op/preset/binop/lane-size controls, edit-target sync
 * and the modulation engine.
 *
 * Moved out of main.js in F2. Reads/writes the state tree; all writes happen
 * inside the store transaction (via the injected store) and re-evaluate through
 * the core pass.
 */

import { applyPreset, applyUnary, setBinop, setHexWord } from "../state/actions.ts";
import { activeDriverName, isFocusDriven, isFreeInputDriven, isInputDriven } from "../state/bindings.ts";
import { DEMO } from "../state/dataset.ts";
import {
  S,
  SIZES,
  activeEditable,
  activeFrameLabel,
  activeReg,
  curLane,
  isFreeFocused,
  liveFreeFrameKeys,
  liveLaneKeys,
  nibCount,
  syncTarget,
} from "../state/instrument.ts";
import { evaluate } from "../state/routing.ts";
import { stripEl } from "../render/strip.js";
import { toHexOf } from "../render/readouts.js";

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
  const hexEntry = document.getElementById("hexEntry");
  const editTarget = document.getElementById("editTarget");
  const bState = document.getElementById("bState");

  function lfoBConfig(v = curLane().lfoB) {
    const frac = v === "q" ? 0.25 : v === "h" ? 0.5 : 0;
    return { opp: v === "opp", off: Math.round(S.N * frac) };
  }

  function lfoStart() {
    if (S.lfo.on) return;
    if (S.lfo.mode === "csvStep" && (!DEMO.rows || !DEMO.rows.length)) return;
    store.patch(() => {
      const base = { free: {} };
      for (const k of liveLaneKeys()) {
        const sl = S.lanes[k];
        base[k] = { a: sl.A.bits.slice(), b: sl.B.bits.slice() };
      }
      for (const fk of liveFreeFrameKeys()) {
        base.free[fk] = S.freeFrames[fk].reg.bits.slice();
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
          for (const k of liveLaneKeys()) {
            const sl = S.lanes[k];
            if (snap[k]) {
              if (!isInputDriven(sl, "a")) sl.A.bits = snap[k].a.slice();
              if (!isInputDriven(sl, "b")) sl.B.bits = snap[k].b.slice();
            }
            if (!isInputDriven(sl, "a")) syncTarget(sl.A);
            if (!isInputDriven(sl, "b")) syncTarget(sl.B);
          }
          for (const fk of liveFreeFrameKeys()) {
            const ff = S.freeFrames[fk];
            if (snap.free && snap.free[fk] && !isFreeInputDriven(ff)) {
              ff.reg.bits = snap.free[fk].slice();
              syncTarget(ff.reg);
            }
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
        applyExample(DEMO.i + 1, false, true);
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

      for (const sk of liveLaneKeys()) {
        const sl = S.lanes[sk];
        const sb = base[sk];
        if (!sb) continue;
        if (!isInputDriven(sl, "a")) sweepInto(sl.A, sb.a, shift, rotate);
        if (sl.showB && !isInputDriven(sl, "b")) {
          const cfg = lfoBConfig(sl.lfoB);
          /* Counter-rotation is the only offset that makes Z *change shape*;
             a fixed offset just slides a rigid pattern around the register. */
          sweepInto(sl.B, sb.b, (cfg.opp ? -shift : shift) + cfg.off, rotate);
        }
        if (!isInputDriven(sl, "a")) syncTarget(sl.A);
        if (!isInputDriven(sl, "b")) syncTarget(sl.B);
      }
      for (const fk of liveFreeFrameKeys()) {
        const ff = S.freeFrames[fk];
        const fb = base.free && base.free[fk];
        if (!fb || isFreeInputDriven(ff)) continue;
        sweepInto(ff.reg, fb, shift, rotate);
        syncTarget(ff.reg);
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
      curLane().lfoB = lfoBSel.value;
    });
  });

  function applyTable(name, reg = activeReg()) {
    if (isFocusDriven()) return;
    applyPreset(reg, name);
    commit();
  }

  document.querySelectorAll("[data-op]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isFocusDriven()) return;     // a driven input has no local edit
      lfoStop();                       // a manual op takes the wheel back
      const k = Number(document.getElementById("amount").value) || 4;
      applyUnary(activeReg(), btn.dataset.op, k);
      commit();
    });
  });

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isFocusDriven()) return;
      lfoStop();
      applyTable(btn.dataset.preset);
    });
  });

  /* ══════════════════════════════════════════════════════════
     OPERAND B / BINARY LOGIC
     B is enabled from the frames view (or a CSV B column / 3D).
     ══════════════════════════════════════════════════════════ */

  const logicGroup = document.getElementById("logicGroup");
  const binopSet = document.getElementById("binopSet");
  const binopBtns = [...document.querySelectorAll("[data-binop]")];

  function syncEditUi() {
    const freeOn = isFreeFocused();
    const driven = isFocusDriven();
    const editable = activeEditable();
    const label = activeFrameLabel();
    const deriveEnabled = !freeOn && S.showB;

    /* Derive is a live radiogroup that never disappears; without operand B or
       on a free frame, radios stay in place, dimmed and `aria-disabled`. */
    logicGroup.setAttribute("aria-disabled", String(!deriveEnabled));
    binopSet.setAttribute("aria-disabled", String(!deriveEnabled));
    binopBtns.forEach((b) => {
      const on = !freeOn && b.dataset.binop === S.binop;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
      b.setAttribute("aria-disabled", String(!deriveEnabled));
      b.setAttribute("tabindex", deriveEnabled && on ? "0" : "-1");
    });
    if (bState) {
      if (freeOn) {
        bState.textContent = "free";
        bState.title = "Free frame — route into a lane for binary ops";
      } else {
        bState.textContent = S.showB ? "B on" : "B off";
        bState.title = S.showB
          ? "Operand B is live in this lane"
          : "Operand B is enabled by focusing a B/D/F frame or entering 3-D";
      }
    }

    /* Register edit: the target label and the whole-word hex entry. */
    if (driven) editTarget.textContent = `${label} · driven`;
    else if (editable) editTarget.textContent = `edit · ${label}`;
    else editTarget.textContent = `${label} · read-only`;
    hexEntry.disabled = !editable || driven;
    hexEntry.setAttribute("aria-label", `hex value for ${label}`);
    if (document.activeElement !== hexEntry) {
      hexEntry.value = toHexOf(activeReg());
    }

    stripEl.dataset.edit = label;
    if (hintEl) {
      hintEl.textContent = !editable
        ? `${label} is derived — read-only`
        : driven
          ? `${label} is driven by ${activeDriverName()} — unplug in sources`
          : "drag a nibble · click a bit · Tab to edit";
    }
    lfoBSel.value = curLane().lfoB;
    lfoBSel.hidden = freeOn || S.lfo.mode === "csvStep" || (!S.view3d && !S.showB);
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

  function setSize(index) {
    sizeInput.value = String(index);
    syncSizeLabel();
  }

  /* Whole-word hex entry (DESIGN §8): Enter commits, Esc reverts, invalid
     input is refused with a visible state and never reaches the register. */
  let hexInvalidTimer = 0;

  function currentEditHex() {
    return toHexOf(activeReg());
  }

  function flashInvalidHex() {
    hexEntry.classList.add("invalid");
    hexEntry.setAttribute("aria-invalid", "true");
    clearTimeout(hexInvalidTimer);
    hexInvalidTimer = setTimeout(() => {
      hexEntry.classList.remove("invalid");
      hexEntry.removeAttribute("aria-invalid");
    }, 800);
  }

  function commitHex() {
    if (!activeEditable() || isFocusDriven()) return;
    const raw = hexEntry.value.trim().replace(/^0x/i, "");
    if (!/^[0-9a-f]+$/i.test(raw) || raw.length > nibCount()) {
      flashInvalidHex();
      return;
    }
    hexEntry.classList.remove("invalid");
    hexEntry.removeAttribute("aria-invalid");
    store.patch(() => {
      setHexWord(activeReg(), raw);
      evaluate();
      renderStrip();
      updateReadouts();
      syncEditUi();
    });
    /* Normalise the field to the committed, zero-padded word (CSV rule). */
    hexEntry.value = toHexOf(activeReg());
  }

  hexEntry.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitHex();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hexEntry.value = currentEditHex();
      hexEntry.blur();
    }
  });

  hexEntry.addEventListener("input", () => {
    if (!hexEntry.classList.contains("invalid")) return;
    hexEntry.classList.remove("invalid");
    hexEntry.removeAttribute("aria-invalid");
  });

  hexEntry.addEventListener("blur", () => {
    hexEntry.value = currentEditHex();
  });

  return { lfoStart, lfoStop, lfoTick, syncEditUi, syncSizeLabel, setSize };
}
