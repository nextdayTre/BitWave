/**
 * Stage bar — the single canonical home of lane selection, the frames view toggle,
 * `split`, the 3-D hinge and `copy to…` (F4 IA, DESIGN §8; D47).
 *
 * Always visible: in 2-D it shows the live lane set, `frames`, a disabled `split`,
 * `LANE 1 · A ⊕ B → Z1` and `copy to…`; in 3-D it adds the per-pane focus dots and
 * the per-pane hinge (`A far` / `B far`, independent per pane); in split mode there
 * is a second pane head with its own hinge and its own copy menu. While the frames
 * view is open it shrinks to `Lanes` (D42).
 *
 * D46: with a dynamic lane set the old `1 | 2 | 3` radiogroup is one native
 * `<select class="op lane-select">` per pane — options are the live lanes,
 * labelled `Lane 1`…`Lane 8` and valued by the stable lane key. A native select
 * brings its own declared keyboard path (arrows/Home/End/type-ahead) and cannot
 * grow the bar sideways as lanes are added; split has two selects and the
 * second is named "Lane (second pane)". Selection writes only through the
 * instrument's own lane commands. The visible select also carries the agent
 * selector hook `[data-agent-lane="<active lane key>"]` (contract §7), kept in
 * step synchronously with the value and cleared on hidden panes.
 *
 * D47: each pane head also carries the 3-D hinge and the `copy to…` menu opener.
 * Both act on **that pane's lane**, not on the globally focused lane: in split the
 * two hinges are independent, and the copy menu lists live lanes except the pane's
 * own source lane. The hinge is hidden in 2-D (it only means something in the
 * depth field); the copy opener stays in place and becomes `aria-disabled` with an
 * explanation when there is no destination lane. Neither control changes the
 * focused lane.
 */

import { S, curLane, liveLaneKeys } from "../state/instrument.ts";

export function createStageBar(deps) {
  const {
    element,
    framesBtn,
    selectLane,
    selectLaneInPane,
    setSplitMode,
    focusSplitPane,
    laneExprText,
    closeFrames,
    toggleFold,
    toggleCopy,
  } = deps;
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

      /* D47: per-pane 3-D hinge — visible only in the depth field, acting on
         this pane's lane so split panes fold independently. */
      const fold = document.createElement("button");
      fold.type = "button";
      fold.className = "op pane-fold";
      fold.hidden = true;
      fold.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!S.view3d) return;
        toggleFold(paneIdx);
      });
      wrap.appendChild(fold);

      /* D47: per-pane `copy to…` opener. The menu itself is a body overlay built
         by copy-menu.js; this button is only its anchor and source-lane owner. */
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "op pane-copy";
      copy.textContent = "copy to…";
      copy.setAttribute("aria-haspopup", "menu");
      copy.setAttribute("aria-expanded", "false");
      copy.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (copy.getAttribute("aria-disabled") === "true") return;
        toggleCopy(copy, copy.dataset.lane);
      });
      wrap.appendChild(copy);

      wrap.addEventListener("click", () => {
        if (S.split3d) focusSplitPane(paneIdx);
      });

      element.appendChild(wrap);
      return { wrap, dot, select, expr, spBtn, fold, copy };
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
    /* The active (visible) select is the documented lane selector; keep the
       hook synchronous with the value so selector-driven tooling never sees a
       stale lane between a setter and the next render. */
    if (select.getAttribute("data-agent-lane") !== active) select.setAttribute("data-agent-lane", active);
  }

  function clearAgentLane(select) {
    if (select.hasAttribute("data-agent-lane")) select.removeAttribute("data-agent-lane");
  }

  function setSplitEnabled(btn, enabled) {
    btn.setAttribute("aria-disabled", String(!enabled));
    btn.title = enabled
      ? "Split the 3-D view into two side-by-side visualizers (Alt+S)"
      : "Split is 3-D only — turn on 3D first (Alt+S)";
  }

  /** D47: keep one pane's hinge in step with that lane's session fold state. */
  function syncFold(pane, laneKey) {
    const sl = S.lanes[laneKey];
    const fold = sl ? sl.fold : "a-far";
    const far = fold === "a-far" ? "A far, B near" : "B far, A near";
    pane.fold.hidden = !S.view3d || !sl;
    pane.fold.textContent = fold === "a-far" ? "A far" : "B far";
    pane.fold.setAttribute(
      "aria-label",
      S.view3d && sl
        ? `3-D hinge for lane ${laneKey}: ${far}; press to swap`
        : "3-D hinge",
    );
    pane.fold.title = S.view3d && sl
      ? `Hinge for lane ${laneKey}: ${far} — press to swap the wings`
      : "Show the 3-D field to change the hinge";
  }

  /** D47: the copy opener names its own source lane and disables at one lane. */
  function syncCopy(pane, laneKey, canCopy) {
    pane.copy.dataset.lane = laneKey;
    pane.copy.setAttribute("aria-disabled", String(!canCopy));
    /* SC 2.5.3: the visible `copy to…` text must be part of the accessible name. */
    pane.copy.setAttribute(
      "aria-label",
      canCopy ? `copy to… lane ${laneKey}` : `copy to… lane ${laneKey} — no other lane`,
    );
    pane.copy.title = canCopy
      ? `Copy lane ${laneKey} into another live lane`
      : "Copying needs a second live lane — add one in the frames view";
  }

  function syncStageBar() {
    if (!stageDom) return;

    const { p0, p1 } = stageDom;
    const laneKeys = liveLaneKeys();
    const canCopy = laneKeys.length > 1;
    /* Only the panes actually on screen advertise a lane; the hidden mirror and
       the frames-view stage must not carry a stale [data-agent-lane]. */
    clearAgentLane(p0.select);
    clearAgentLane(p1.select);
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
      /* 2-D: one pane head, the lane set, a reserved-space disabled split and
         no hinge (it only means something in the depth field). */
      p0.dot.hidden = true;
      p0.wrap.classList.add("focused");
      p0.wrap.hidden = false;
      p0.spBtn.hidden = false;
      p0.spBtn.setAttribute("aria-pressed", "false");
      p0.spBtn.classList.remove("on");
      setSplitEnabled(p0.spBtn, false);
      syncSelect(p0.select, S.laneKey, laneKeys);
      p0.expr.textContent = laneExprText(curLane(), true);
      syncFold(p0, S.laneKey);
      syncCopy(p0, S.laneKey, canCopy);
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
      syncFold(p0, S.laneKey);
      syncCopy(p0, S.laneKey, canCopy);
      p1.wrap.hidden = true;
    } else {
      const k0 = S.splitPair[0], k1 = S.splitPair[1];
      p0.dot.hidden = false;
      p0.wrap.hidden = false;
      p0.spBtn.hidden = true;
      p0.wrap.classList.toggle("focused", S.activePane === 0);
      syncSelect(p0.select, k0, laneKeys);
      p0.expr.textContent = laneExprText(S.lanes[k0], false);
      syncFold(p0, k0);
      syncCopy(p0, k0, canCopy);

      p1.wrap.hidden = false;
      p1.dot.hidden = false;
      p1.spBtn.hidden = false;
      p1.spBtn.setAttribute("aria-pressed", "true");
      p1.spBtn.classList.add("on");
      setSplitEnabled(p1.spBtn, true);
      p1.wrap.classList.toggle("focused", S.activePane === 1);
      syncSelect(p1.select, k1, laneKeys);
      p1.expr.textContent = laneExprText(S.lanes[k1], false);
      syncFold(p1, k1);
      syncCopy(p1, k1, canCopy);
    }
  }

  /* 3-D only means anything with two operands: A and B are the ends of the
     wavetable, so the field view brings B into existence if it isn't there. */

  return { build: buildStageBar, sync: syncStageBar };
}
