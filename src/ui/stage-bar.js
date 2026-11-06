/**
 * 3-D stage bar — lane selector, split toggle and the lane expression.
 *
 * Moved out of main.js in F2. Reads the state tree; writes only the stage bar.
 */

import { S, SLOT_KEYS, curSlot, laneLabel } from "../state/instrument.ts";

export function createStageBar(deps) {
  const { element, selectSlot, selectSlotInPane, setSplitMode, focusSplitPane, slotExprText } = deps;
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

      element.appendChild(wrap);
      return { wrap, dot, btns, expr, spBtn };
    };

    element.innerHTML = "";
    stageDom = { p0: makePane(0), p1: makePane(1) };
  }

  function syncStageBar() {
    if (!stageDom) return;
    element.hidden = !S.view3d;
    if (!S.view3d) return;

    const { p0, p1 } = stageDom;
    element.classList.toggle("is-split", S.split3d);

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

  return { build: buildStageBar, sync: syncStageBar };
}
