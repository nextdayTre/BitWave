import {
  FRAME_NAMES,
  OPSYM,
  S,
  SIZES,
  SLOT_KEYS,
  curSlot,
  editKey,
  editReg,
  focusEditable,
  focusKey,
  frameLabel,
  frameName,
  laneLabel,
  nibAt,
  nibCount,
  nibValue,
  regOf,
  setNibAt,
  syncTarget,
} from "./state/instrument.ts";
import {
  applyPreset,
  applyUnary,
  copyLane,
  setBinop,
  setFocus,
  setLiveNibble,
  setNibble,
  toggleBit,
  toggleFrameVisibility,
  unpair,
} from "./state/actions.ts";
import { evaluate } from "./state/routing.ts";
import { createStore } from "./state/store.ts";

import { DEMO } from "./state/dataset.ts";
import {
  alignBits,
  cellToBits,
  columnMode,
  columnWidth,
  isDataRow,
  normCell,
  parseDelimited,
} from "./core/csv.ts";
import { buildSpline, evalSpline } from "./core/spline.ts";
import { G, canvasEl as canvas, draw, fitCanvas, getPad, shortCol } from "./render/canvas.js";
import { nibsEl, patchNibble, renderStrip, stripEl, syncHoverClasses } from "./render/strip.js";
import { toHexOf, updateReadouts } from "./render/readouts.js";

(() => {
  "use strict";

  /* ══════════════════════════════════════════════════════════
     APP SHELL — controls, pointer/keyboard input, stage bar, frame
     navigator, CSV import, observations and boot.
     State lives in `src/state/`; renderers in `src/render/`. Every
     mutation runs inside a `store.patch(...)` transaction, then the
     renderers read the settled tree. `main.js` is becoming the
     composition root rather than the app.
     ══════════════════════════════════════════════════════════ */

  const store = createStore(S);

  /* Grow / shrink around the centre: the outermost nibbles on each side
     stay pinned and new nibbles appear at the ∞ point. All three display
     slots remap together before S.N changes. */
  function resizeRegister(newN) {
    if (newN === S.N) return;
    store.patch(() => {
      lfoStop();                     // its snapshot belongs to the old width

      const oldN = S.N;
      const oldNibs = oldN >> 2;
      const newNibs = newN >> 2;
      const keep = Math.min(oldNibs, newNibs) >> 1;

      const remap = (r) => {
        const oldVals = new Array(oldNibs);
        for (let j = 0; j < oldNibs; j++) oldVals[j] = nibAt(r.bits, j);
        const vals = new Array(newNibs).fill(0);
        for (let k = 0; k < keep; k++) {
          vals[k] = oldVals[k];                               // MSB side
          vals[newNibs - 1 - k] = oldVals[oldNibs - 1 - k];   // LSB side
        }
        return vals;
      };

      const mapped = {};
      for (const k of SLOT_KEYS) {
        mapped[k] = {
          a: remap(S.slots[k].A),
          b: remap(S.slots[k].B),
        };
      }

      S.N = newN;

      for (const k of SLOT_KEYS) {
        const sl = S.slots[k];
        for (const [r, vals] of [[sl.A, mapped[k].a], [sl.B, mapped[k].b]]) {
          r.bits = new Uint8Array(newN);
          r.target = vals.slice();
          r.anim = vals.slice();
          for (let j = 0; j < newNibs; j++) setNibAt(r.bits, j, vals[j]);
        }
        sl.Z.bits = new Uint8Array(newN);
        sl.Z.target = new Array(newNibs).fill(0);
        sl.Z.anim = new Array(newNibs).fill(0);
      }

      evaluate(true);

      S.drag = -1;
      S.hoverReg = null;
      S.hoverJ = -1;

      renderStrip();
      updateReadouts();
    });
  }

  /* ══════════════════════════════════════════════════════════
     SPLINE — monotone cubic Hermite, flat at both ends.
     Flat end tangents are what give the reference curves their
     level shoulders; with two control points it degenerates to
     smoothstep, which is exactly the sketch.
     ══════════════════════════════════════════════════════════ */

  function commit(instant = false) {
    /* One transaction boundary: base writes, then the clocked evaluation
       (routes in dependency order, then every lane's Z), then renderers. */
    store.patch(() => {
      syncTarget(S.A, instant);
      syncTarget(S.B, instant);
      evaluate(instant);
      renderStrip();
      updateReadouts();
    });
  }

  /* ══════════════════════════════════════════════════════════
     INTERACTION — canvas drag
     ══════════════════════════════════════════════════════════ */

  function nearestNibble(px) {
    const n = nibCount();
    const { x0, nibW, nibGap } = G;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      const x = x0 + j * (nibW + nibGap) + nibW / 2;
      const d = Math.abs(x - px);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  }

  /* With two operands live, grabbing picks whichever curve is nearer
     the pointer — the instrument should never make you hunt for a knob. */
  function nearestReg(px, py) {
    if (!S.showB || S.view3d) return editKey();
    const ya = curSlot().frameVis.a && G.spA ? evalSpline(G.spA, px) : Infinity;
    const yb = curSlot().frameVis.b && G.spB ? evalSpline(G.spB, px) : Infinity;
    if (!Number.isFinite(ya) && !Number.isFinite(yb)) return editKey();
    return Math.abs(py - ya) <= Math.abs(py - yb) ? "a" : "b";
  }

  /* The drawn legend entries double as hit targets. */
  function legendHitAt(px, py) {
    if (S.view3d || !S.showB) return null;
    for (const h of G.legendHits) {
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h.key;
    }
    return null;
  }

  function valueFromY(py) {
    const v = ((G.y1 - py) / G.ph) * 15;
    return Math.max(0, Math.min(15, Math.round(v)));
  }

  function setFromPointer(e) {
    if (S.view3d) return;            // the field view is read-only
    if (!focusEditable()) return;    // a focused derived frame is read-only
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;

    store.patch(() => {
      if (S.drag < 0) {
        lfoStop();
        const j = nearestNibble(px);
        if (j < 0) return;
        S.drag = j;
        S.hoverReg = nearestReg(px, py);
        S.hoverJ = j;
        setFocus(curSlot(), S.hoverReg);
        syncEditUi();
        renderStrip();
        canvas.classList.add("grabbing");
        document.getElementById("hint").classList.add("off");
      }

      const k = S.hoverReg || editKey();
      const reg = regOf(k);
      const v = valueFromY(py);
      setLiveNibble(reg, S.drag, v);
      evaluate();
      S.Z.anim = S.Z.target.slice();   // results follow the drag exactly
      patchNibble(S.drag);
      updateReadouts(false);
    });
  }

    canvas.addEventListener("pointerdown", (e) => {
      if (S.view3d) {
        if (S.split3d) {
          const r = canvas.getBoundingClientRect();
          focusSplitPane(e.clientX - r.left < r.width / 2 ? 0 : 1);
        }
        return;
      }
      if (!focusEditable()) return;  // derived frame focused — read-only
      const r = canvas.getBoundingClientRect();
      const hit = legendHitAt(e.clientX - r.left, e.clientY - r.top);
      if (hit) {
        setFrameVis(S.slot, hit, !curSlot().frameVis[hit]);
        e.preventDefault();
        return;
      }
      // Throws if the pointer is not active (released early, or synthetic).
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* non-fatal */ }
      setFromPointer(e);
    });

  canvas.addEventListener("pointermove", (e) => {
    if (S.view3d) return;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    canvas.classList.toggle("legend-hover", Boolean(legendHitAt(px, py)));
    if (!focusEditable()) {
      if (S.hoverReg !== null) { S.hoverReg = null; S.hoverJ = -1; syncHoverClasses(); }
      return;
    }
    if (S.drag >= 0) { setFromPointer(e); return; }

    const j = nearestNibble(px);
    const k = nearestReg(px, py);
    if (j !== S.hoverJ || k !== S.hoverReg) {
      S.hoverJ = j;
      S.hoverReg = k;
      syncHoverClasses();
    }
  });

  function endDrag(e) {
    if (S.drag < 0) return;
    S.drag = -1;
    canvas.classList.remove("grabbing");
    updateReadouts(true);
    if (e && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    canvas.classList.remove("legend-hover");
    if (S.drag < 0 && S.hoverJ !== -1) {
      S.hoverJ = -1;
      S.hoverReg = null;
      syncHoverClasses();
    }
  });

  /* bit strip: click a bit to flip it, hover to highlight the nibble */
  nibsEl.addEventListener("click", (e) => {
    const bit = e.target.closest(".bit");
    if (!bit) return;
    if (!focusEditable()) return;   // Z is derived — never editable
    lfoStop();
    store.patch(() => {
      const j = toggleBit(editReg(), Number(bit.dataset.b));
      evaluate();
      patchNibble(j);
      updateReadouts();
    });
  });

  /* Mouse-wheel over a hex glyph nudges that nibble by ±1, clamped 0–F.
     Same update path as a bit click; no wrap and no page scrolling. */
  nibsEl.addEventListener("wheel", (e) => {
    if (S.drag >= 0 || e.deltaY === 0) return;
    if (e.ctrlKey || e.metaKey) return; // leave browser zoom alone
    if (!focusEditable()) return;       // Z is derived — never editable
    const hexEl = e.target.closest(".hex");
    if (!hexEl) return;
    const nib = hexEl.closest(".nib");
    if (!nib) return;
    const j = Number(nib.dataset.j);
    if (!Number.isInteger(j)) return;

    e.preventDefault();
    lfoStop();
    store.patch(() => {
      const reg = editReg();
      const current = nibValue(reg, j);
      const next = Math.max(0, Math.min(15, current + (e.deltaY < 0 ? 1 : -1)));
      if (next === current) return;
      setNibble(reg, j, next);
      evaluate();
      patchNibble(j);
      updateReadouts();
    });
  }, { passive: false });

  nibsEl.addEventListener("pointerover", (e) => {
    if (!focusEditable()) return;
    const nib = e.target.closest(".nib");
    const j = nib ? Number(nib.dataset.j) : -1;
    const hotKey = focusKey();
    if (j !== S.hoverJ || S.hoverReg !== hotKey) {
      S.hoverJ = j;
      S.hoverReg = j >= 0 ? hotKey : null;
      syncHoverClasses();
    }
  });

  nibsEl.addEventListener("pointerleave", () => {
    if (S.hoverJ !== -1) {
      S.hoverJ = -1;
      S.hoverReg = null;
      syncHoverClasses();
    }
  });

  /* ══════════════════════════════════════════════════════════
     LFO — a stepped modulation source across all display slots.

     It mutates, but never destroys: the pre-LFO bits are snapshotted on
     start and restored on stop, so the register you hand it is the
     register you get back. Every tick is a REAL register state, which
     means the hex, the strip, the truth table and Z stay truthful —
     unlike a fractional-phase animation, which would draw states the
     hardware can never hold.
     ══════════════════════════════════════════════════════════ */

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

  function applyTable(name, reg = editReg()) {
    applyPreset(reg, name);
    commit();
  }

  /* ══════════════════════════════════════════════════════════
     OPS — all unary ops act on the register you are editing.
     The implementations live in src/core/ops.ts and run through
     src/state/actions.ts; the render module only calls them.
     ══════════════════════════════════════════════════════════ */

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
  function unpairB() {
    if (S.view3d) return;
    const sl = curSlot();
    if (!sl.showB) return;
    lfoStop();
    store.patch(() => {
      unpair(sl);
      S.hoverReg = null;
      S.hoverJ = -1;
      syncEditUi();
      syncViewUi();
      evaluate();
      renderStrip();
      updateReadouts();
    });
    if (!framesPanel.hidden) renderFramesPanel(S.slot);
    else framesBtn.focus();
  }

  binopBtns.forEach((b) => {
    b.addEventListener("click", () => {
      store.patch(() => {
        setBinop(curSlot(), b.dataset.binop);
        syncEditUi();
        syncViewUi();
        evaluate();
        updateReadouts();
      });
    });
  });

  /* ══════════════════════════════════════════════════════════
     LANE — 2-D canvas, lanes 1/2/3 & parallel 3-D split
     ══════════════════════════════════════════════════════════ */

  const depthBtn = document.getElementById("depthBtn");
  const slotSeg = document.getElementById("slotSeg");
  const splitBtn = document.getElementById("splitBtn");
  const copySlotBtn = document.getElementById("copySlotBtn");
  const framesBtn = document.getElementById("framesBtn");
  const framesPanel = document.getElementById("framesPanel");
  const framesBody = document.getElementById("framesBody");
  const framesLegend = document.getElementById("framesLegend");
  const framesClose = document.getElementById("framesClose");
  const unpairBBtn = document.getElementById("unpairB");
  const hintEl = document.getElementById("hint");
  const stageBarEl = document.getElementById("stageBar");

  const SVG_NS = "http://www.w3.org/2000/svg";
  const FRAME_ORDER = ["a", "z", "b"];

  let stageDom = null;

  function buildStageBar() {
    const makePane = (paneIdx) => {
      const wrap = document.createElement("div");
      wrap.className = "pane-head";
      wrap.dataset.pane = String(paneIdx);

      const dot = document.createElement("i");
      dot.className = "focus-dot";
      dot.title = "Focused lane (controls & strip edit this lane)";
      wrap.appendChild(dot);

      const seg = document.createElement("div");
      seg.className = "seg mini";
      const btns = {};
      for (const k of SLOT_KEYS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "op";
        b.dataset.slot = k;
        b.textContent = laneLabel(k);
        b.title = `Lane ${laneLabel(k)}`;
        b.setAttribute("aria-label", `Lane ${laneLabel(k)}`);
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (S.split3d) selectSlotInPane(paneIdx, k);
          else selectSlot(k);
        });
        seg.appendChild(b);
        btns[k] = b;
      }
      wrap.appendChild(seg);

      const expr = document.createElement("span");
      expr.className = "stage-expr";
      wrap.appendChild(expr);

      const spBtn = document.createElement("button");
      spBtn.type = "button";
      spBtn.className = "op mini";
      spBtn.textContent = "split";
      spBtn.title = paneIdx === 0
        ? "Split main 3D view into two side-by-side visualizers (Alt+S)"
        : "Return to single 3D view (Alt+S)";
      spBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setSplitMode(!S.split3d);
      });
      if (paneIdx === 0) wrap.insertBefore(spBtn, expr);
      else wrap.appendChild(spBtn);

      wrap.addEventListener("click", () => {
        if (S.split3d) focusSplitPane(paneIdx);
      });

      stageBarEl.appendChild(wrap);
      return { wrap, dot, btns, expr, spBtn };
    };

    stageBarEl.innerHTML = "";
    stageDom = { p0: makePane(0), p1: makePane(1) };
  }

  function slotExprText(sl, withViewPrefix) {
    const hasCsv = DEMO.rows.length > 0;
    const lhs = hasCsv && sl.colA >= 0 && DEMO.cols[sl.colA] ? shortCol(DEMO.cols[sl.colA], 14) : frameName(sl.key, "a");
    const rhs = hasCsv && sl.colB >= 0 && DEMO.cols[sl.colB] ? shortCol(DEMO.cols[sl.colB], 14) : frameName(sl.key, "b");
    const sym = OPSYM[sl.binop] || "\u2295";
    const prefix = withViewPrefix ? `LANE ${laneLabel(sl.key)} \u00B7 ` : "";
    return `${prefix}${lhs} ${sym} ${rhs} \u2192 ${frameName(sl.key, "z")}`;
  }

  function syncStageBar() {
    if (!stageDom) return;
    stageBarEl.hidden = !S.view3d;
    if (!S.view3d) return;

    const { p0, p1 } = stageDom;
    stageBarEl.classList.toggle("is-split", S.split3d);

    if (!S.split3d) {
      const sl = curSlot();
      p0.dot.hidden = true;
      p0.wrap.classList.add("focused");
      p0.spBtn.hidden = false;
      p0.spBtn.setAttribute("aria-pressed", "false");
      p0.spBtn.classList.remove("on");
      for (const k of SLOT_KEYS) p0.btns[k].classList.toggle("on", k === S.slot);
      p0.expr.textContent = slotExprText(sl, true);
      p1.wrap.hidden = true;
    } else {
      const k0 = S.splitPair[0], k1 = S.splitPair[1];
      p0.dot.hidden = false;
      p0.spBtn.hidden = true;
      p0.wrap.classList.toggle("focused", S.activePane === 0);
      for (const k of SLOT_KEYS) p0.btns[k].classList.toggle("on", k === k0);
      p0.expr.textContent = slotExprText(S.slots[k0], false);

      p1.wrap.hidden = false;
      p1.dot.hidden = false;
      p1.spBtn.hidden = false;
      p1.spBtn.setAttribute("aria-pressed", "true");
      p1.spBtn.classList.add("on");
      p1.wrap.classList.toggle("focused", S.activePane === 1);
      for (const k of SLOT_KEYS) p1.btns[k].classList.toggle("on", k === k1);
      p1.expr.textContent = slotExprText(S.slots[k1], false);
    }
  }

  /* 3-D only means anything with two operands: A and B are the ends of the
     wavetable, so the field view brings B into existence if it isn't there. */
  function enableBOnSlot(sl = curSlot()) {
    if (sl.showB) return;
    sl.showB = true;
    if (!sl.seededB) {
      sl.seededB = true;
      applyPreset(sl.B, "square");
      syncTarget(sl.B, true);
      if (S.lfo.base && S.lfo.base[sl.key]) {
        S.lfo.base[sl.key].b = sl.B.bits.slice();
      }
    }
    evaluate(true);
  }

  function enableB() {
    enableBOnSlot(curSlot());
    syncEditUi();
  }

  function copySlotInto(srcKey, dstKey) {
    if (srcKey === dstKey) return;
    lfoStop();
    const src = S.slots[srcKey];
    const dst = S.slots[dstKey];
    store.patch(() => {
      copyLane(src, dst);
      syncTarget(dst.A, true);
      syncTarget(dst.B, true);
      evaluate(true);
    });
  }

  function refreshActiveSlotUi() {
    S.hoverReg = null;
    S.hoverJ = -1;
    syncEditUi();
    syncViewUi();
    renderDemoUi();
    renderStrip();
    updateReadouts();
  }

  function focusSplitPane(paneIdx) {
    store.patch(() => {
      S.activePane = paneIdx === 1 ? 1 : 0;
      S.slot = S.splitPair[S.activePane];
      enableBOnSlot(curSlot());
      refreshActiveSlotUi();
    });
  }

  function selectSlotInPane(paneIdx, key) {
    store.patch(() => {
      if (S.copyArmed) {
        S.copyArmed = false;
        copySlotInto(S.slot, key);
      }
      S.splitPair[paneIdx] = key;
      S.activePane = paneIdx;
      S.slot = key;
      enableBOnSlot(curSlot());
      refreshActiveSlotUi();
    });
  }

  function selectSlot(key) {
    if (!S.slots[key]) return;
    store.patch(() => {
      if (S.copyArmed) {
        S.copyArmed = false;
        copySlotInto(S.slot, key);
      }
      if (S.view3d && S.split3d) {
        if (S.splitPair[0] === key && S.splitPair[1] !== key) {
          S.activePane = 0;
        } else if (S.splitPair[1] === key && S.splitPair[0] !== key) {
          S.activePane = 1;
        } else {
          S.splitPair[S.activePane] = key;
        }
      }
      S.slot = key;
      if (S.view3d) enableBOnSlot(curSlot());
      refreshActiveSlotUi();
    });
  }

  function setSplitMode(on) {
    store.patch(() => {
      S.copyArmed = false;
      if (on) {
        S.view3d = true;
        S.split3d = true;
        if (!S.splitPair.includes(S.slot)) {
          const other = S.splitPair[0] === S.slot ? "B" : S.splitPair[0];
          S.splitPair = [other === S.slot ? "A" : other, S.slot];
          S.activePane = 1;
        } else {
          S.activePane = S.splitPair[0] === S.slot ? 0 : 1;
        }
        if (S.splitPair[0] === S.splitPair[1]) {
          S.splitPair[1] = S.splitPair[0] === "A" ? "B" : "A";
        }
        enableBOnSlot(S.slots[S.splitPair[0]]);
        enableBOnSlot(S.slots[S.splitPair[1]]);
      } else {
        S.split3d = false;
        if (S.view3d) enableBOnSlot(curSlot());
      }
      refreshActiveSlotUi();
    });
  }

  function syncViewUi() {
    depthBtn.setAttribute("aria-pressed", String(S.view3d));
    depthBtn.classList.toggle("on", S.view3d);
    depthBtn.title = S.view3d
      ? "Return to the 2D register view"
      : "Show the depth field: operands at frame 1 and 256, the result at 128";
    slotSeg.querySelectorAll("[data-slot]").forEach((b) => {
      const active = b.dataset.slot === S.slot;
      b.classList.toggle("on", active);
      b.setAttribute("aria-pressed", String(active));
      b.textContent = laneLabel(b.dataset.slot);
    });
    const isSplit = S.view3d && S.split3d;
    splitBtn.setAttribute("aria-pressed", String(isSplit));
    splitBtn.classList.toggle("on", isSplit);

    copySlotBtn.setAttribute("aria-pressed", String(S.copyArmed));
    copySlotBtn.classList.toggle("on", S.copyArmed);
    copySlotBtn.textContent = S.copyArmed ? "pick lane" : "copy to\u2026";
    copySlotBtn.title = S.copyArmed
      ? "Choose lane 1, 2, or 3 to copy into"
      : "Copy the focused lane into another lane (click, then pick 1, 2, or 3)";

    canvas.classList.toggle("readonly", S.view3d && !S.split3d);
    canvas.classList.toggle("split-view", isSplit);

    hintEl.hidden = S.view3d;
    syncStageBar();
  }

  depthBtn.addEventListener("click", () => {
    store.patch(() => {
      S.copyArmed = false;
      S.view3d = !S.view3d;
      if (!S.view3d) S.split3d = false;
      if (S.view3d) enableBOnSlot(curSlot());
      refreshActiveSlotUi();
    });
  });

  slotSeg.querySelectorAll("[data-slot]").forEach((b) => {
    b.addEventListener("click", () => selectSlot(b.dataset.slot));
  });

  splitBtn.addEventListener("click", () => setSplitMode(!(S.view3d && S.split3d)));

  copySlotBtn.addEventListener("click", () => {
    store.patch(() => {
      S.copyArmed = !S.copyArmed;
      syncViewUi();
    });
  });

  /* ── frame navigator ─────────────────────────────────────────
     Pro-Q4-style lane/frame selection: static mini-curves, active lane
     expanded, click a frame to focus it. No animation, no new state. */

  function previewPoints(reg) {
    const vals = reg.target;
    if (!vals || vals.length === 0) return "";
    const w = 96;
    const h = 24;
    const pad = 2;
    const xs = vals.map((_, j) => (vals.length === 1 ? w / 2 : (j / (vals.length - 1)) * w));
    const ys = vals.map((v) => h - pad - (v / 15) * (h - pad * 2));
    const sp = buildSpline(xs, ys);
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const x = (i / 48) * w;
      pts.push(`${x.toFixed(1)},${evalSpline(sp, x).toFixed(1)}`);
    }
    return pts.join(" ");
  }

  function makePreview(reg, frame) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", `frame-preview ${frame}`);
    svg.setAttribute("viewBox", "0 0 96 24");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", previewPoints(reg));
    svg.appendChild(line);
    return svg;
  }

  const frameReg = (sl, frame) => (frame === "a" ? sl.A : frame === "b" ? sl.B : sl.Z);
  const frameSub = (frame) => (frame === "z" ? "derived" : "operand");

  function frameVisLabel(laneKey, frame) {
    const visible = S.slots[laneKey].frameVis[frame];
    return `${visible ? "Hide" : "Show"} frame ${frameName(laneKey, frame)} in the 2D view`;
  }

  function makeEyeButton(laneKey, frame) {
    const sl = S.slots[laneKey];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "eye-btn" + (sl.frameVis[frame] ? "" : " is-hidden");
    btn.setAttribute("aria-pressed", String(sl.frameVis[frame]));
    btn.setAttribute("aria-label", frameVisLabel(laneKey, frame));
    btn.title = frameVisLabel(laneKey, frame);
    if (S.view3d) {
      btn.disabled = true;
      btn.setAttribute("aria-label", "2D visibility only");
      btn.title = "2D visibility only";
    }

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const eye = document.createElementNS(SVG_NS, "path");
    eye.setAttribute("d", "M1.5 8C4.3 3.8 11.7 3.8 14.5 8C11.7 12.2 4.3 12.2 1.5 8Z");
    const pupil = document.createElementNS(SVG_NS, "circle");
    pupil.setAttribute("cx", "8");
    pupil.setAttribute("cy", "8");
    pupil.setAttribute("r", "2.6");
    const slash = document.createElementNS(SVG_NS, "path");
    slash.setAttribute("class", "eye-slash");
    slash.setAttribute("d", "M2.5 13.5L13.5 2.5");
    svg.append(eye, pupil, slash);
    btn.appendChild(svg);

    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setFrameVis(laneKey, frame, !S.slots[laneKey].frameVis[frame]);
    });
    return btn;
  }

  function setFrameVis(laneKey, frame, visible) {
    const sl = S.slots[laneKey];
    if (sl.frameVis[frame] !== visible) {
      store.patch(() => toggleFrameVisibility(sl, frame));
    }
    if (framesPanel.hidden) return;
    const row = framesBody.querySelector(`.frame-row[data-frame="${frame}"]`);
    if (!row) return;
    row.classList.toggle("is-hidden", !visible);
    const eye = row.querySelector(".eye-btn");
    if (eye) {
      eye.classList.toggle("is-hidden", !visible);
      eye.setAttribute("aria-pressed", String(visible));
      eye.setAttribute("aria-label", frameVisLabel(laneKey, frame));
      eye.title = frameVisLabel(laneKey, frame);
    }
  }

  function buildFrameRow(laneKey, frame) {
    const sl = S.slots[laneKey];
    const reg = frameReg(sl, frame);
    const name = frameName(laneKey, frame);
    const active = laneKey === S.slot && focusKey(sl) === frame;

    const row = document.createElement("div");
    row.className = "frame-row" + (active ? " is-active" : "") + (sl.frameVis[frame] ? "" : " is-hidden");
    row.dataset.frame = frame;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-btn";
    const focused = active ? ", focused" : "";
    btn.setAttribute("aria-label", `Lane ${laneLabel(laneKey)} frame ${name}, ${frameSub(frame)}${focused}`);
    btn.title = `Lane ${laneLabel(laneKey)} · ${name} (${frameSub(frame)})`;

    const label = document.createElement("span");
    label.className = "frame-label";
    const swatch = document.createElement("span");
    swatch.className = "frame-swatch";
    const glyph = document.createElement("span");
    glyph.className = "frame-glyph";
    glyph.textContent = name;
    const sub = document.createElement("span");
    sub.className = "frame-sub";
    sub.textContent = frameSub(frame);
    label.append(swatch, glyph, sub);
    btn.appendChild(label);

    btn.appendChild(makePreview(reg, frame));

    const hex = document.createElement("span");
    hex.className = "frame-hex";
    hex.textContent = toHexOf(reg);
    hex.title = toHexOf(reg);
    btn.appendChild(hex);

    btn.addEventListener("click", () => selectFrame(laneKey, frame));
    row.append(btn, makeEyeButton(laneKey, frame));
    return row;
  }

  function buildLaneButton(laneKey) {
    const sl = S.slots[laneKey];
    const expanded = laneKey === S.slot;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lane-btn";
    btn.dataset.lane = laneKey;
    btn.setAttribute("aria-expanded", String(expanded));
    btn.setAttribute("aria-label", `Lane ${laneLabel(laneKey)}${expanded ? ", expanded" : ""}`);
    const num = document.createElement("span");
    num.className = "lane-num";
    num.textContent = `LANE ${laneLabel(laneKey)}`;
    const meta = document.createElement("span");
    meta.className = "lane-meta";
    meta.textContent = slotExprText(sl, false);
    btn.append(num, meta);
    btn.addEventListener("click", () => {
      S.copyArmed = false;
      if (S.slot !== laneKey) selectSlot(laneKey);
      renderFramesPanel(laneKey);
    });
    return btn;
  }

  function renderFramesPanel(focusLane) {
    framesBody.textContent = "";
    for (const laneKey of SLOT_KEYS) {
      framesBody.appendChild(buildLaneButton(laneKey));
      if (laneKey !== S.slot) continue;
      for (const frame of FRAME_ORDER) framesBody.appendChild(buildFrameRow(laneKey, frame));
    }
    const sl = curSlot();
    const fa = frameName(sl.key, "a");
    const fb = frameName(sl.key, "b");
    const fz = frameName(sl.key, "z");
    if (framesLegend) framesLegend.textContent = `${fa} solid · ${fz} glow · ${fb} dashed`;
    unpairBBtn.textContent = `unpair ${fb}`;
    unpairBBtn.title = `Remove operand ${fb} from this lane`;
    unpairBBtn.hidden = !sl.showB || S.view3d;
    if (focusLane) {
      const head = framesBody.querySelector(`.lane-btn[data-lane="${focusLane}"]`);
      if (head) head.focus();
    }
  }

  function openFrames() {
    store.patch(() => {
      S.copyArmed = false;
      syncViewUi();
      renderFramesPanel();
    });
    framesPanel.hidden = false;
    framesBtn.setAttribute("aria-expanded", "true");
    const first =
      framesPanel.querySelector(".frame-row.is-active .frame-btn") ||
      framesPanel.querySelector(".frame-btn") ||
      framesClose;
    first.focus();
  }

  function closeFrames(returnFocus) {
    if (framesPanel.hidden) return;
    framesPanel.hidden = true;
    framesBtn.setAttribute("aria-expanded", "false");
    if (returnFocus) framesBtn.focus();
  }

  /* Focus, not navigation: clicking a frame shows it in the strip and
     readouts without leaving the current view (2-D or 3-D). Operands stay
     editable; Z is a read-only lens (DESIGN §10.8). */
  function selectFrame(laneKey, frame) {
    S.copyArmed = false;
    store.patch(() => {
      if (!S.slots[laneKey].frameVis[frame]) toggleFrameVisibility(S.slots[laneKey], frame);
      if (S.slot !== laneKey) selectSlot(laneKey);
      const sl = curSlot();
      if (frame !== "a" && !sl.showB) enableBOnSlot(sl);
      setFocus(sl, frame);
      S.hoverReg = null;
      S.hoverJ = -1;
      syncEditUi();
      syncViewUi();
      renderStrip();
      updateReadouts();
    });
    if (!framesPanel.hidden) {
      renderFramesPanel();
      const focusedBtn = framesBody.querySelector(`.frame-row[data-frame="${frame}"] .frame-btn`);
      if (focusedBtn) focusedBtn.focus();
    }
  }

  framesBtn.addEventListener("click", () => {
    if (framesPanel.hidden) openFrames();
    else closeFrames(true);
  });
  framesClose.addEventListener("click", () => closeFrames(true));
  unpairBBtn.addEventListener("click", unpairB);

  document.addEventListener("pointerdown", (e) => {
    if (framesPanel.hidden) return;
    if (framesPanel.contains(e.target) || e.target === framesBtn) return;
    closeFrames(false);
  });

  /* ══════════════════════════════════════════════════════════
     REGISTER SIZE
     ══════════════════════════════════════════════════════════ */

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

  /* ══════════════════════════════════════════════════════════
     CSV EXAMPLES
     Load a CSV/TSV, pick columns per view slot, and step through rows
     like slides. Columns are classified per-column, because "1011" is
     binary in a flags column and hex in an id column.

     Values are RIGHT-aligned into the register (padded with zeros on
     the left) so a cell's numeric value is preserved: 0xDEAD in a
     64-bit register is 0x000000000000DEAD.
     ══════════════════════════════════════════════════════════ */

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
  const logObsBtn = document.getElementById("logObsBtn");
  const exportObsBtn = document.getElementById("exportObsBtn");
  const observations = [];

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
      if (!framesPanel.hidden) closeFrames(false);
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

  function logCurrentObservation() {
    const exName = (DEMO.rows.length && DEMO.rows[DEMO.i] && DEMO.rows[DEMO.i][0]) || `ex_${DEMO.i + 1}`;
    const hexA = toHexOf(S.A);
    const hexB = S.showB ? toHexOf(S.B) : "";
    const hexZ = S.showB ? toHexOf(S.Z) : "";
    let popZ = 0;
    if (S.showB) {
      for (let i = 0; i < S.N; i++) popZ += S.Z.bits[i];
    }

    let c00 = 0, c01 = 0, c10 = 0, c11 = 0;
    if (S.showB) {
      for (let i = 0; i < S.N; i++) {
        const a = S.A.bits[i], b = S.B.bits[i];
        if (!a && !b) c00++;
        else if (!a && b) c01++;
        else if (a && !b) c10++;
        else c11++;
      }
    }

    const obs = {
      timestamp: new Date().toISOString(),
      view: laneLabel(S.slot),
      index: DEMO.i + 1,
      name: exName,
      width_bits: S.N,
      op: S.showB ? S.binop : "none",
      hex_A: hexA,
      hex_B: hexB,
      hex_Z: hexZ,
      pop_Z: popZ,
      count_00: c00,
      count_01: c01,
      count_10: c10,
      count_11: c11
    };

    observations.push(obs);
    if (obsCount) obsCount.textContent = `${observations.length} obs`;
  }

  function exportObservationsCSV() {
    if (!observations.length) return;
    const keys = Object.keys(observations[0]);
    const header = keys.join(",");
    const lines = observations.map(o => keys.map(k => `"${String(o[k]).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bitwave_observations_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (logObsBtn) logObsBtn.addEventListener("click", logCurrentObservation);
  if (exportObsBtn) exportObsBtn.addEventListener("click", exportObservationsCSV);

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

  /* Keyboard shortcuts: Alt+1/2/3 switch views, Alt+S toggles split,
     and Arrow keys step CSV examples when focus isn't in a control. */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !framesPanel.hidden) {
      closeFrames(true);
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && S.copyArmed) {
      S.copyArmed = false;
      syncViewUi();
      e.preventDefault();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "1" || e.code === "Digit1") { selectSlot("A"); if (!framesPanel.hidden) renderFramesPanel(); e.preventDefault(); return; }
      if (e.key === "2" || e.code === "Digit2") { selectSlot("B"); if (!framesPanel.hidden) renderFramesPanel(); e.preventDefault(); return; }
      if (e.key === "3" || e.code === "Digit3") { selectSlot("C"); if (!framesPanel.hidden) renderFramesPanel(); e.preventDefault(); return; }
      if (e.key === "s" || e.key === "S" || e.code === "KeyS") { setSplitMode(!(S.view3d && S.split3d)); e.preventDefault(); return; }
    }
    if (!DEMO.rows.length) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    if (e.key === "ArrowRight") { applyExample(DEMO.i + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { applyExample(DEMO.i - 1); e.preventDefault(); }
  });

  /* Drop a file anywhere. */
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => loadCSV(String(rd.result || ""));
    rd.readAsText(f);
  });

  /* ══════════════════════════════════════════════════════════
     LOOP
     ══════════════════════════════════════════════════════════ */

  function easeReg(r) {
    const n = nibCount();
    for (let j = 0; j < n; j++) {
      const d = r.anim[j];
      const t = r.target[j];
      const diff = t - d;
      if (Math.abs(diff) < 0.004) r.anim[j] = t;
      else r.anim[j] = d + diff * 0.24;
    }
  }

  let lfoPrev = 0;

  function loop(now) {
    if (!lfoPrev) lfoPrev = now;
    const dt = Math.min(120, Math.max(0, now - lfoPrev));
    lfoPrev = now;

    /* Clamped dt and a bounded catch-up loop: a backgrounded tab must not
       fire hundreds of ticks the moment it is refocused. */
    if (S.lfo.on) {
      S.lfoAcc += dt;
      const interval = 1000 / S.lfo.rate;
      let guard = 0;
      while (S.lfoAcc >= interval && guard++ < 6) {
        S.lfoAcc -= interval;
        lfoTick();
      }
    }

    for (const k of SLOT_KEYS) {
      const sl = S.slots[k];
      easeReg(sl.A);
      if (sl.showB) { easeReg(sl.B); easeReg(sl.Z); }
    }
    draw();
    requestAnimationFrame(loop);
  }

  /* ══════════════════════════════════════════════════════════
     BOOT
     ══════════════════════════════════════════════════════════ */

  function boot() {
    // Lane 1: sine + square (classic default)
    applyPreset(S.slots.A.A, "sine");
    applyPreset(S.slots.A.B, "square");

    // Lane 2: cosine + triangle (ready for instant lane & split exploration)
    applyPreset(S.slots.B.A, "cosine");
    applyPreset(S.slots.B.B, "triangle");
    S.slots.B.seededB = true;

    // Lane 3: sawUp + sine (AND mask)
    applyPreset(S.slots.C.A, "sawUp");
    applyPreset(S.slots.C.B, "sine");
    S.slots.C.seededB = true;

    for (const k of SLOT_KEYS) {
      const sl = S.slots[k];
      syncTarget(sl.A, true);
      syncTarget(sl.B, true);
    }
    evaluate(true);

    buildStageBar();
    syncSizeLabel();
    syncEditUi();
    syncViewUi();
    renderStrip();
    updateReadouts();

    const ro = new ResizeObserver(() => fitCanvas());
    ro.observe(canvas);
    fitCanvas();

    requestAnimationFrame(loop);
  }

  /* ══════════════════════════════════════════════════════════
     AGENT / TEST SURFACE — read-only and versioned (AGENTS.md)
     Everything visible is a deterministic function of this state.
     There are no setters: the instrument's controls remain the only
     write path, so an agent cannot drift the picture from the truth.
     ══════════════════════════════════════════════════════════ */

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  const round3 = (value) => Math.round(value * 1000) / 1000;

  function snapshotState() {
    const lanes = {};
    for (const key of SLOT_KEYS) {
      const sl = S.slots[key];
      const lane = Number(laneLabel(key));
      const names = FRAME_NAMES[key];
      lanes[String(lane)] = {
        lane,
        frames: {
          [names.a]: toHexOf(sl.A),
          [names.b]: toHexOf(sl.B),
          [names.z]: toHexOf(sl.Z),
        },
        showB: sl.showB,
        sources: {
          [names.a]: sl.colA >= 0 && DEMO.cols[sl.colA] ? DEMO.cols[sl.colA] : null,
          [names.b]: sl.colB >= 0 && DEMO.cols[sl.colB] ? DEMO.cols[sl.colB] : null,
        },
        binop: sl.binop,
        focus: frameName(key, focusKey(sl)),
        edit: frameName(key, editKey(sl)),
        lfo: sl.lfoB,
        visibility: {
          [names.a]: sl.frameVis.a,
          [names.b]: sl.frameVis.b,
          [names.z]: sl.frameVis.z,
        },
      };
    }

    const mode = S.view3d ? (S.split3d ? "split" : "3d") : "2d";
    return deepFreeze({
      schema: 1,
      artifact: "bitwave-v2.html",
      registers: { width: S.N, bits: S.N, nibbles: nibCount() },
      lane: Number(laneLabel(S.slot)),
      frame: frameName(S.slot, focusKey()),
      view: {
        mode,
        splitPair: S.splitPair.map((key) => Number(laneLabel(key))),
        activePane: S.activePane,
      },
      lanes,
      lfo: { on: S.lfo.on, mode: S.lfo.mode, rate: S.lfo.rate },
      dataset: DEMO.rows.length
        ? {
            columns: DEMO.cols.slice(),
            rows: DEMO.rows.length,
            index: DEMO.i,
            row: DEMO.rows[DEMO.i].slice(),
          }
        : null,
      editing: { copyArmed: S.copyArmed, enabled: focusEditable() },
    });
  }

  function snapshotGeometry() {
    const n = nibCount();
    const controlPoints = new Array(n);
    for (let j = 0; j < n; j++) {
      controlPoints[j] = G.x0 + j * (G.nibW + G.nibGap) + G.nibW / 2;
    }
    const rect = canvas.getBoundingClientRect();
    const nibs = [...nibsEl.children].map((nib, j) => {
      const box = nib.getBoundingClientRect();
      return {
        index: j,
        left: round3(box.left),
        width: round3(box.width),
        center: round3(box.left + box.width / 2),
      };
    });
    return deepFreeze({
      schema: 1,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pad: getPad(),
      canvas: {
        width: canvas.width,
        height: canvas.height,
        cssWidth: round3(rect.width),
        cssHeight: round3(rect.height),
      },
      plot: { x0: G.x0, x1: G.x1, y0: G.y0, y1: G.y1, width: G.pw, height: G.ph },
      nibble: { count: n, width: round3(G.nibW), gap: round3(G.nibGap) },
      controlPoints: controlPoints.map(round3),
      dom: { nibs },
    });
  }

  function snapshotFrames() {
    const lanes = {};
    for (const key of SLOT_KEYS) {
      const names = FRAME_NAMES[key];
      const lane = Number(laneLabel(key));
      lanes[String(lane)] = { lane, operands: [names.a, names.b], derived: names.z };
    }
    return deepFreeze({ schema: 1, lanes });
  }

  if (!Object.prototype.hasOwnProperty.call(window, "BitWave")) {
    Object.defineProperty(window, "BitWave", {
      value: Object.freeze({
        schema: 1,
        artifact: "bitwave-v2.html",
        frames: snapshotFrames,
        state: snapshotState,
        geometry: snapshotGeometry,
      }),
      enumerable: true,
    });
  }

  boot();
})();
