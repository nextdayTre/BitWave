/**
 * Stage bar — the single canonical home of lane selection, the frames view toggle
 * and `split` (F4 IA, DESIGN §8).
 *
 * Always visible: in 2-D it shows the lane set, `frames`, a disabled `split`
 * and `LANE 1 · A ⊕ B → Z1`; in 3-D it adds the per-pane focus dots and, in
 * split mode, a second pane head. While the frames view is open it shrinks to
 * `Lanes` (D42). Reads the state tree; writes only this DOM.
 *
 * D43: each lane button carries its stable lane key (`data-lane="1"`), which is
 * also its displayed number.
 */

import { LANE_KEYS, S, curLane } from "../state/instrument.ts";

export function createStageBar(deps) {
  const { element, framesBtn, selectLane, selectLaneInPane, setSplitMode, focusSplitPane, laneExprText, closeFrames } = deps;
  let stageDom = null;

  function buildStageBar() {
    /* The static `frames` opener lives in the stage-bar markup so it is found
       by id before this build; keep that node and re-house it in pane 0. */
    const keep = [...element.children];

    const makePane = (paneIdx) => {
      const wrap = document.createElement("div");
      wrap.className = "pane-head";
      wrap.dataset.pane = String(paneIdx);

      const dot = document.createElement("i");
      dot.className = "focus-dot";
      dot.title = "Focused lane (controls & strip edit this lane)";
      dot.setAttribute("aria-hidden", "true");
      wrap.appendChild(dot);

      const seg = document.createElement("div");
      seg.className = "seg mini";
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", `Lane${paneIdx === 1 ? " (second pane)" : ""}`);
      const btns = {};
      for (const k of LANE_KEYS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "op";
        b.dataset.lane = k;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", "false");
        b.setAttribute("tabindex", "-1");
        b.textContent = k;
        b.title = `Lane ${k}`;
        b.setAttribute("aria-label", `Lane ${k}`);
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (S.split3d) selectLaneInPane(paneIdx, k);
          else selectLane(k);
        });
        seg.appendChild(b);
        btns[k] = b;
      }
      /* Radiogroup keyboard model (DESIGN §8): arrows move the lane selection,
         Home/End jump to the ends, and the set is one Tab stop. */
      seg.addEventListener("keydown", (e) => {
        const current = S.split3d
          ? (paneIdx === 0 ? S.splitPair[0] : S.splitPair[1])
          : S.laneKey;
        let next = LANE_KEYS.indexOf(current);
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (next + LANE_KEYS.length - 1) % LANE_KEYS.length;
        else if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (next + 1) % LANE_KEYS.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = LANE_KEYS.length - 1;
        else return;
        e.preventDefault();
        e.stopPropagation();
        const chosen = LANE_KEYS[next];
        if (S.split3d) selectLaneInPane(paneIdx, chosen);
        else selectLane(chosen);
        seg.querySelector(`[data-lane="${chosen}"]`)?.focus();
      });
      wrap.appendChild(seg);

      if (paneIdx === 0 && framesBtn) wrap.appendChild(framesBtn);

      const spBtn = document.createElement("button");
      spBtn.type = "button";
      spBtn.className = "op mini";
      spBtn.textContent = "split";
      spBtn.setAttribute("aria-pressed", "false");
      spBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!S.view3d && !S.split3d) return;   // split is 3-D only; stays in place
        setSplitMode(!S.split3d);
      });
      wrap.appendChild(spBtn);

      const expr = document.createElement("span");
      expr.className = "stage-expr";
      wrap.appendChild(expr);

      wrap.addEventListener("click", () => {
        if (S.split3d) focusSplitPane(paneIdx);
      });

      element.appendChild(wrap);
      return { wrap, dot, btns, expr, spBtn };
    };

    element.textContent = "";
    stageDom = { p0: makePane(0), p1: makePane(1) };

    /* D42: the frames view is a stage mode, so its way back (`Lanes`) lives
       beside the pane heads, centred, and only when the view is open. */
    const lanesBtn = document.createElement("button");
    lanesBtn.type = "button";
    lanesBtn.className = "op";
    lanesBtn.id = "lanesBtn";
    lanesBtn.textContent = "Lanes";
    lanesBtn.hidden = true;
    lanesBtn.title = "Back to the lanes view (Esc)";
    lanesBtn.setAttribute("aria-label", "Lanes — back to the lanes view");
    lanesBtn.addEventListener("click", () => closeFrames());
    element.appendChild(lanesBtn);
    stageDom.lanesBtn = lanesBtn;

    /* makePane(0) re-appended the captured frames opener; drop unused extras. */
    for (const node of keep) {
      if (node !== framesBtn && node.parentNode !== element) node.remove();
    }
  }

  function syncRadio(btns, active) {
    for (const k of LANE_KEYS) {
      const on = k === active;
      btns[k].classList.toggle("on", on);
      btns[k].setAttribute("aria-checked", String(on));
      btns[k].setAttribute("tabindex", on ? "0" : "-1");
    }
  }

  function setSplitEnabled(btn, enabled) {
    btn.setAttribute("aria-disabled", String(!enabled));
    btn.title = enabled
      ? "Split the 3-D view into two side-by-side visualizers (Alt+S)"
      : "Split is 3-D only — turn on 3D first (Alt+S)";
  }

  function syncStageBar() {
    if (!stageDom) return;

    const { p0, p1 } = stageDom;
    element.classList.toggle("is-split", S.split3d);
    element.dataset.view = S.view3d ? (S.split3d ? "split" : "3d") : "2d";

    /* Frames view: the stage is the card grid; the bar shrinks to `Lanes`. */
    const framesOn = S.framesView === true;
    element.classList.toggle("is-frames", framesOn);
    stageDom.lanesBtn.hidden = !framesOn;
    if (framesOn) {
      p0.wrap.hidden = true;
      p1.wrap.hidden = true;
      return;
    }

    if (!S.view3d) {
      /* 2-D: one pane head, the lane set and a reserved-space disabled split. */
      p0.dot.hidden = true;
      p0.wrap.classList.add("focused");
      p0.wrap.hidden = false;
      p0.spBtn.hidden = false;
      p0.spBtn.setAttribute("aria-pressed", "false");
      p0.spBtn.classList.remove("on");
      setSplitEnabled(p0.spBtn, false);
      syncRadio(p0.btns, S.laneKey);
      p0.expr.textContent = laneExprText(curLane(), true);
      p1.wrap.hidden = true;
      return;
    }

    if (!S.split3d) {
      const sl = curLane();
      p0.dot.hidden = true;
      p0.wrap.classList.add("focused");
      p0.wrap.hidden = false;
      p0.spBtn.hidden = false;
      p0.spBtn.setAttribute("aria-pressed", "false");
      p0.spBtn.classList.remove("on");
      setSplitEnabled(p0.spBtn, true);
      syncRadio(p0.btns, S.laneKey);
      p0.expr.textContent = laneExprText(sl, true);
      p1.wrap.hidden = true;
    } else {
      const k0 = S.splitPair[0], k1 = S.splitPair[1];
      p0.dot.hidden = false;
      p0.wrap.hidden = false;
      p0.spBtn.hidden = true;
      p0.wrap.classList.toggle("focused", S.activePane === 0);
      syncRadio(p0.btns, k0);
      p0.expr.textContent = laneExprText(S.lanes[k0], false);

      p1.wrap.hidden = false;
      p1.dot.hidden = false;
      p1.spBtn.hidden = false;
      p1.spBtn.setAttribute("aria-pressed", "true");
      p1.spBtn.classList.add("on");
      setSplitEnabled(p1.spBtn, true);
      p1.wrap.classList.toggle("focused", S.activePane === 1);
      syncRadio(p1.btns, k1);
      p1.expr.textContent = laneExprText(S.lanes[k1], false);
    }
  }

  /* 3-D only means anything with two operands: A and B are the ends of the
     wavetable, so the field view brings B into existence if it isn't there. */

  return { build: buildStageBar, sync: syncStageBar };
}
