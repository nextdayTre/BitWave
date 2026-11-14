/**
 * Stage bar — the single canonical home of lane selection, the frames view toggle
 * and `split` (F4 IA, DESIGN §8).
 *
 * Always visible: in 2-D it shows the live lane set, `frames`, a disabled `split`
 * and `LANE 1 · A ⊕ B → Z1`; in 3-D it adds the per-pane focus dots and, in
 * split mode, a second pane head. While the frames view is open it shrinks to
 * `Lanes` (D42).
 *
 * D46: with a dynamic lane set the old `1 | 2 | 3` radiogroup is now one native
 * `<select class="op lane-select">` per pane — options are the live lanes,
 * labelled `Lane 1`…`Lane 8` and valued by the stable lane key. A native select
 * brings its own declared keyboard path (arrows/Home/End/type-ahead) and cannot
 * grow the bar sideways as lanes are added; split has two selects and the
 * second is named "Lane (second pane)". Selection writes only through the
 * instrument's own lane commands.
 */

import { S, curLane, liveLaneKeys } from "../state/instrument.ts";

export function createStageBar(deps) {
  const { element, framesBtn, selectLane, selectLaneInPane, setSplitMode, focusSplitPane, laneExprText, closeFrames } = deps;
  let stageDom = null;

  function makeSelect(paneIdx) {
    const select = document.createElement("select");
    select.className = "op lane-select";
    select.dataset.paneSelect = String(paneIdx);
    select.setAttribute("aria-label", paneIdx === 1 ? "Lane (second pane)" : "Lane");
    select.title = paneIdx === 1
      ? "Select the lane shown in the second pane"
      : "Select the lane shown in this pane";
    select.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const key = select.value;
      if (S.split3d) selectLaneInPane(paneIdx, key);
      else selectLane(key);
    });
    return select;
  }

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

      const select = makeSelect(paneIdx);
      wrap.appendChild(select);

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
      return { wrap, dot, select, expr, spBtn };
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

  /** Keep one pane's native select in step with the live lane set and value. */
  function syncSelect(select, active, laneKeys) {
    const wanted = laneKeys.map((key) => ({ value: key, label: `Lane ${key}` }));
    const current = [...select.options].map((option) => ({ value: option.value, label: option.textContent }));
    const same = current.length === wanted.length
      && current.every((option, i) => option.value === wanted[i].value && option.label === wanted[i].label);
    if (!same) {
      select.textContent = "";
      for (const option of wanted) {
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label;
        select.appendChild(el);
      }
    }
    if (select.value !== active) select.value = active;
    if (select.dataset.lane !== active) select.dataset.lane = active;
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
    const laneKeys = liveLaneKeys();
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
      syncSelect(p0.select, S.laneKey, laneKeys);
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
      syncSelect(p0.select, S.laneKey, laneKeys);
      p0.expr.textContent = laneExprText(sl, true);
      p1.wrap.hidden = true;
    } else {
      const k0 = S.splitPair[0], k1 = S.splitPair[1];
      p0.dot.hidden = false;
      p0.wrap.hidden = false;
      p0.spBtn.hidden = true;
      p0.wrap.classList.toggle("focused", S.activePane === 0);
      syncSelect(p0.select, k0, laneKeys);
      p0.expr.textContent = laneExprText(S.lanes[k0], false);

      p1.wrap.hidden = false;
      p1.dot.hidden = false;
      p1.spBtn.hidden = false;
      p1.spBtn.setAttribute("aria-pressed", "true");
      p1.spBtn.classList.add("on");
      setSplitEnabled(p1.spBtn, true);
      p1.wrap.classList.toggle("focused", S.activePane === 1);
      syncSelect(p1.select, k1, laneKeys);
      p1.expr.textContent = laneExprText(S.lanes[k1], false);
    }
  }

  /* 3-D only means anything with two operands: A and B are the ends of the
     wavetable, so the field view brings B into existence if it isn't there. */

  return { build: buildStageBar, sync: syncStageBar };
}
