/**
 * Frames view — the stage-level lane/frame browser and the focus lens.
 *
 * Replaces the original pop-out frame navigator (D42). The `frames` button
 * swaps the stage into a card grid: one column per lane, one equal card per
 * frame (operand A, operand B, derived Z), with the lane/frame names beside
 * each box and a mini spline of the settled register. Choosing a card focuses
 * that frame and returns to the Lanes view; the eyes keep per-frame 2-D
 * visibility, the lane heads keep lane focus and `unpair B`, and the footer
 * carries the horizontal scroll affordance for many lanes.
 *
 * The `+` tile is present at this build's 3-lane maximum: dynamic lanes are a
 * separate pass (docs/DYNAMIC-LANES.md), so the tile reports the cap instead of
 * silently doing nothing.
 */

import { buildSpline, evalSpline } from "../core/spline.ts";
import { setFocus, toggleFrameVisibility } from "../state/actions.ts";
import { LANE_KEYS, S, curLane, focusKey, frameName } from "../state/instrument.ts";
import { toHexOf } from "../render/readouts.js";

export function createFrameNavigator(deps) {
  const {
    store,
    selectLane,
    enableBOnLane,
    syncEditUi,
    syncViewUi,
    renderStrip,
    updateReadouts,
    unpairB,
  } = deps;

  const framesBtn = document.getElementById("framesBtn");
  const stageEl = document.querySelector(".stage");
  const framesView = document.getElementById("framesView");
  const framesScroll = document.getElementById("framesScroll");
  const framesGrid = document.getElementById("framesGrid");
  const framesLegend = document.getElementById("framesLegend");
  const framesNote = document.getElementById("framesNote");
  const framesLeft = document.getElementById("framesLeft");
  const framesRight = document.getElementById("framesRight");
  const framesThumb = document.getElementById("framesThumb");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const FRAME_ORDER = ["a", "b", "z"];
  const ADD_CAP_NOTE = "3 lanes is this build's maximum — dynamic lanes are a separate pass";

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── previews ─────────────────────────────────────────────────────────── */

  function previewPoints(reg) {
    const vals = reg.target;
    if (!vals || vals.length === 0) return "";
    const w = 160;
    const h = 28;
    const pad = 2;
    const xs = vals.map((_, j) => (vals.length === 1 ? w / 2 : (j / (vals.length - 1)) * w));
    const ys = vals.map((v) => h - pad - (v / 15) * (h - pad * 2));
    const sp = buildSpline(xs, ys);
    const pts = [];
    for (let i = 0; i <= 56; i++) {
      const x = (i / 56) * w;
      pts.push(`${x.toFixed(1)},${evalSpline(sp, x).toFixed(1)}`);
    }
    return pts.join(" ");
  }

  function makePreview(reg, frame) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", `frame-preview ${frame}`);
    svg.setAttribute("viewBox", "0 0 160 28");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", previewPoints(reg));
    svg.appendChild(line);
    return svg;
  }

  const frameReg = (sl, frame) => (frame === "a" ? sl.A : frame === "b" ? sl.B : sl.Z);
  const frameSub = (frame) => (frame === "z" ? "derived" : "operand");

  /* ── visibility eyes ──────────────────────────────────────────────────── */

  function frameVisLabel(laneKey, frame) {
    const visible = S.lanes[laneKey].frameVis[frame];
    return `${visible ? "Hide" : "Show"} frame ${frameName(laneKey, frame)} in the 2D view`;
  }

  function makeEyeButton(laneKey, frame) {
    const sl = S.lanes[laneKey];
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
      const next = !S.lanes[laneKey].frameVis[frame];
      store.patch(() => toggleFrameVisibility(S.lanes[laneKey], frame));
      btn.setAttribute("aria-pressed", String(next));
      btn.classList.toggle("is-hidden", !next);
      btn.setAttribute("aria-label", frameVisLabel(laneKey, frame));
      btn.title = frameVisLabel(laneKey, frame);
      renderGrid();
    });
    return btn;
  }

  /* ── cards ────────────────────────────────────────────────────────────── */

  function buildCard(laneKey, frame) {
    const sl = S.lanes[laneKey];
    const reg = frameReg(sl, frame);
    const name = frameName(laneKey, frame);
    const active = laneKey === S.laneKey && focusKey(sl) === frame;
    const visible = sl.frameVis[frame];
    const hex = toHexOf(reg);

    const wrap = document.createElement("div");
    wrap.className = "frame-card-wrap" + (active ? " is-active" : "") + (visible ? "" : " is-hidden");
    wrap.dataset.lane = laneKey;
    wrap.dataset.frame = frame;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-card";
    btn.setAttribute("aria-pressed", String(active));
    btn.setAttribute("aria-label", `Lane ${laneKey} · ${name} ${frameSub(frame)} · ${hex}`);
    btn.title = `Lane ${laneKey} · ${name} (${frameSub(frame)}) · ${hex}`;

    const glyph = document.createElement("span");
    glyph.className = "frame-glyph";
    glyph.textContent = name;
    const box = document.createElement("span");
    box.className = "frame-box";
    box.appendChild(makePreview(reg, frame));
    btn.append(glyph, box);
    btn.addEventListener("click", () => chooseCard(laneKey, frame));

    const eye = makeEyeButton(laneKey, frame);
    wrap.append(btn, eye);
    return wrap;
  }

  function buildLaneHead(laneKey) {
    const head = document.createElement("div");
    head.className = "lane-head";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lane-btn";
    btn.dataset.lane = laneKey;
    const active = laneKey === S.laneKey;
    btn.setAttribute("aria-pressed", String(active));
    btn.textContent = `LANE ${laneKey}`;
    btn.title = `Focus lane ${laneKey}`;
    btn.addEventListener("click", () => {
      S.copyArmed = false;
      store.patch(() => {
        if (S.laneKey !== laneKey) selectLane(laneKey);
        syncViewUi();
        syncEditUi();
        renderStrip();
        updateReadouts();
      });
      renderGrid();
    });
    head.appendChild(btn);

    const sl = S.lanes[laneKey];
    if (active && sl.showB && !S.view3d) {
      const unpairBtn = document.createElement("button");
      unpairBtn.type = "button";
      unpairBtn.className = "unpair-btn";
      unpairBtn.textContent = `unpair ${frameName(laneKey, "b")}`;
      unpairBtn.title = `Remove operand ${frameName(laneKey, "b")} from this lane`;
      unpairBtn.addEventListener("click", () => unpairB());
      head.appendChild(unpairBtn);
    }
    return head;
  }

  function buildLaneColumn(laneKey) {
    const col = document.createElement("div");
    col.className = "lane-col";
    col.dataset.lane = laneKey;
    col.setAttribute("role", "group");
    col.setAttribute("aria-label", `Lane ${laneKey}`);
    col.appendChild(buildLaneHead(laneKey));
    for (const frame of FRAME_ORDER) col.appendChild(buildCard(laneKey, frame));
    return col;
  }

  /* The next-lane tile is present at every width (the mockup's perpetual `+`);
     at this build's 3-lane cap it reports the cap instead of inventing lanes. */
  function buildAddColumn() {
    const col = document.createElement("div");
    col.className = "lane-col is-add";

    const head = document.createElement("div");
    head.className = "lane-head";
    head.setAttribute("aria-hidden", "true");
    col.appendChild(head);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-add";
    btn.setAttribute("aria-disabled", "true");
    btn.textContent = "+";
    btn.setAttribute("aria-label", "Add lane — 3 lanes is this build's maximum");
    btn.title = ADD_CAP_NOTE;
    btn.addEventListener("click", () => {
      framesNote.textContent = ADD_CAP_NOTE;
    });
    const hint = document.createElement("span");
    hint.className = "frame-add-hint";
    hint.textContent = "next lane";
    col.append(btn, hint);
    return col;
  }

  /* ── render ───────────────────────────────────────────────────────────── */

  function renderGrid() {
    if (!S.framesView) return;
    const active = document.activeElement;
    const host = active && active.closest ? active.closest("[data-lane][data-frame]") : null;
    const keep = host
      ? { lane: host.dataset.lane, frame: host.dataset.frame, eye: active.classList.contains("eye-btn") }
      : null;

    framesGrid.textContent = "";
    for (const laneKey of LANE_KEYS) framesGrid.appendChild(buildLaneColumn(laneKey));
    framesGrid.appendChild(buildAddColumn());

    const fa = frameName(curLane().key, "a");
    const fb = frameName(curLane().key, "b");
    const fz = frameName(curLane().key, "z");
    framesLegend.textContent = `${fa} solid · ${fz} glow · ${fb} dashed`;

    updateScrollbar();

    if (keep) {
      const selector = `[data-lane="${keep.lane}"][data-frame="${keep.frame}"]`;
      const target = keep.eye
        ? framesGrid.querySelector(`${selector} .eye-btn`)
        : framesGrid.querySelector(`${selector} .frame-card`);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function updateScrollbar() {
    if (!framesView || framesView.hidden) return;
    const max = framesScroll.scrollWidth - framesScroll.clientWidth;
    const overflow = max > 1;
    framesLeft.disabled = !overflow || framesScroll.scrollLeft <= 1;
    framesRight.disabled = !overflow || framesScroll.scrollLeft >= max - 1;
    const track = framesThumb.parentElement;
    const trackWidth = track ? track.clientWidth : 0;
    if (!trackWidth) return;
    const ratio = framesScroll.clientWidth / Math.max(1, framesScroll.scrollWidth);
    const width = Math.max(20, Math.round(trackWidth * ratio));
    framesThumb.style.width = `${width}px`;
    const left = overflow ? (framesScroll.scrollLeft / max) * (trackWidth - width) : 0;
    framesThumb.style.transform = `translateX(${left}px)`;
  }

  function stepScroll(direction) {
    const col = framesGrid.querySelector(".lane-col");
    const gap = parseFloat(getComputedStyle(framesGrid).columnGap) || 24;
    const step = (col ? col.getBoundingClientRect().width : 240) + gap;
    framesScroll.scrollBy({
      left: direction * step,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  function focusActiveCard() {
    const selector = `[data-lane="${S.laneKey}"] .frame-card`;
    const active = framesGrid.querySelector(
      `[data-lane="${S.laneKey}"][data-frame="${focusKey(curLane())}"] .frame-card`
    );
    const target = active || framesGrid.querySelector(selector);
    if (target) target.focus({ preventScroll: true });
  }

  /* ── view state ───────────────────────────────────────────────────────── */

  function applyViewDom(open) {
    framesView.hidden = !open;
    stageEl.classList.toggle("is-frames", open);
    framesBtn.setAttribute("aria-pressed", String(open));
    framesBtn.title = open ? "Close the frames view" : "Browse every frame as a card";
    if (open) {
      framesNote.textContent = "";
      renderGrid();
      framesScroll.scrollLeft = 0;
      updateScrollbar();
      focusActiveCard();
    }
  }

  function setOpen(open, { returnFocus = true } = {}) {
    if (S.framesView === open) return;
    S.copyArmed = false;
    store.patch(() => {
      S.framesView = open;
      syncViewUi();
    });
    applyViewDom(open);
    if (!open) {
      framesNote.textContent = "";
      if (returnFocus) framesBtn.focus();
    }
  }

  function isOpen() {
    return S.framesView === true;
  }

  /* Focus, not navigation: used by the readout lens and the agent bridge.
     The frames view, if open, stays open and re-marks the focused card. */
  function selectFrame(laneKey, frame) {
    S.copyArmed = false;
    store.patch(() => {
      if (!S.lanes[laneKey].frameVis[frame]) toggleFrameVisibility(S.lanes[laneKey], frame);
      if (S.laneKey !== laneKey) selectLane(laneKey);
      const sl = curLane();
      if (frame !== "a" && !sl.showB) enableBOnLane(sl);
      setFocus(sl, frame);
      S.hoverReg = null;
      S.hoverJ = -1;
      syncEditUi();
      syncViewUi();
      renderStrip();
      updateReadouts();
    });
    renderGrid();
  }

  /* Choosing a card is navigation: focus the frame, then return to the lanes
     view so the wave is visible (the view replaces the stage, not a panel). */
  function chooseCard(laneKey, frame) {
    S.copyArmed = false;
    store.patch(() => {
      S.framesView = false;
      if (!S.lanes[laneKey].frameVis[frame]) toggleFrameVisibility(S.lanes[laneKey], frame);
      if (S.laneKey !== laneKey) selectLane(laneKey);
      const sl = curLane();
      if (frame !== "a" && !sl.showB) enableBOnLane(sl);
      setFocus(sl, frame);
      S.hoverReg = null;
      S.hoverJ = -1;
      syncEditUi();
      syncViewUi();
      renderStrip();
      updateReadouts();
    });
    applyViewDom(false);
    framesBtn.focus();
  }

  function close(returnFocus = true) {
    setOpen(false, { returnFocus });
  }

  /* ── wiring ───────────────────────────────────────────────────────────── */

  framesBtn.addEventListener("click", () => setOpen(!S.framesView));

  framesLeft.addEventListener("click", () => stepScroll(-1));
  framesRight.addEventListener("click", () => stepScroll(1));
  framesScroll.addEventListener("scroll", updateScrollbar, { passive: true });
  window.addEventListener("resize", () => updateScrollbar());

  framesScroll.addEventListener("keydown", (e) => {
    if (e.target !== framesScroll) return;
    if (e.key === "ArrowLeft") {
      stepScroll(-1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      stepScroll(1);
      e.preventDefault();
    }
  });

  /* Live cards: every settled transaction (LFO tick, CSV step, agent write)
     refreshes the mini splines while the view is open; focus is preserved. */
  store.subscribe(() => {
    if (S.framesView) renderGrid();
  });

  /* 2-D canvas legend eye: toggle one frame's visibility by lane key. The rAF
     render loop redraws the wave/legend; the frames view, if open, re-renders
     through the store subscription. */
  function setFrameVis(laneKey, frame, visible) {
    const sl = S.lanes[laneKey];
    if (!sl || sl.frameVis[frame] === visible) return;
    store.patch(() => toggleFrameVisibility(sl, frame));
  }

  return {
    framesBtn,
    isOpen,
    close,
    render: () => renderGrid(),
    selectFrame,
    chooseCard,
    setFrameVis,
    focusButton: () => (S.framesView ? document.getElementById("lanesBtn")?.focus() : framesBtn.focus()),
  };
}
