/**
 * Frames view — the stage-level lane/frame browser and the focus lens.
 *
 * Replaces the original pop-out frame navigator (D42). The `frames` button
 * swaps the stage into a card grid: one column per lane, one equal card per
 * frame (operand A, operand B, derived Z), with the lane/frame names beside
 * each box and a mini spline of the settled register. Choosing a card focuses
 * that frame and returns to the Lanes view; the eyes keep per-frame 2-D
 * visibility, the lane heads keep lane focus, `unpair B`, and the lane
 * management controls (D46), and the footer carries the horizontal scroll
 * affordance for many lanes.
 *
 * D46: the grid is built from the **live** lane set, and the `+` tile is the
 * live add-lane control (enabled below the eight-lane cap, `aria-disabled` and
 * explanatory at it). Each lane head gains compact `dup` and `del` controls:
 * duplicate creates a new lane and focuses the copy; delete shows an inline
 * confirmation that names how many routes/expressions reference the lane's
 * frames, needs a second confirming click, cancels on Esc, and reports the
 * result in the footer note.
 */

import { buildSpline, evalSpline } from "../core/spline.ts";
import { APP_LANE_CAP } from "../core/lanedefs.ts";
import { setFocus, toggleFrameVisibility } from "../state/actions.ts";
import { liveLaneKeys, S, curLane, focusKey, frameName } from "../state/instrument.ts";
import { routing } from "../state/routing.ts";
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
    addLaneFromUi,
    duplicateLaneFromUi,
    deleteLaneFromUi,
    renderSources,
    lfoStop,
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
  /** Lane key whose delete button is showing its inline confirmation. */
  let pendingDelete = null;

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

  /* ── lane management (D46) ────────────────────────────────────────────── */

  const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** How many live routes/expressions reference this lane's frames. */
  function laneReferences(laneKey) {
    let routes = 0;
    for (const route of routing.routes) {
      if (route.from.lane === laneKey || route.to.lane === laneKey) routes += 1;
    }
    const names = FRAME_ORDER.map((frame) => escapeRe(frameName(laneKey, frame)));
    const matcher = new RegExp(`(^|[^A-Za-z0-9_])(${names.join("|")})([^A-Za-z0-9_]|$)`);
    let expressions = 0;
    for (const key of liveLaneKeys()) {
      const lane = S.lanes[key];
      if (!lane) continue;
      for (const operand of ["a", "b"]) {
        const text = lane.expressions[operand];
        if (text && text.trim() !== "" && matcher.test(text)) expressions += 1;
      }
    }
    return { routes, expressions, total: routes + expressions };
  }

  function describeReferences({ routes, expressions }) {
    const parts = [];
    if (routes > 0) parts.push(`${routes} route${routes === 1 ? "" : "s"}`);
    if (expressions > 0) parts.push(`${expressions} expression${expressions === 1 ? "" : "s"}`);
    return parts.join(" and ");
  }

  function reportNote(text) {
    framesNote.textContent = text;
  }

  function focusLaneHead(laneKey, selector = ".lane-btn") {
    const target = framesGrid.querySelector(`[data-lane="${laneKey}"] ${selector}`);
    if (target) target.focus({ preventScroll: true });
  }

  function buildDeleteConfirm(laneKey, head) {
    head.classList.add("is-confirming");
    const refs = laneReferences(laneKey);
    const refText = refs.total > 0
      ? ` — ${describeReferences(refs)} reference ${refs.total === 1 ? "it" : "its frames"}`
      : "";

    const text = document.createElement("span");
    text.className = "lane-confirm-text";
    text.id = `laneConfirm${laneKey}`;
    text.textContent = `delete lane ${laneKey}?${refText}`;

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "lane-act is-danger";
    confirm.dataset.act = "confirm";
    confirm.textContent = "delete";
    confirm.title = `Confirm: delete lane ${laneKey}`;
    confirm.setAttribute("aria-label", `Confirm delete lane ${laneKey}`);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "lane-act";
    cancel.dataset.act = "cancel";
    cancel.textContent = "cancel";
    cancel.title = "Cancel (Esc)";
    cancel.setAttribute("aria-label", `Cancel deleting lane ${laneKey}`);

    const actions = document.createElement("span");
    actions.className = "lane-confirm-actions";
    actions.append(confirm, cancel);

    head.append(text, actions);

    confirm.addEventListener("click", (ev) => {
      ev.stopPropagation();
      /* Clear the confirmation before the transaction re-renders the grid. */
      pendingDelete = null;
      const result = deleteLaneFromUi(laneKey);
      renderGrid();
      if (!result || !result.ok) {
        reportNote(result && result.reason === "last"
          ? "cannot delete the only lane — the instrument needs at least one"
          : `could not delete lane ${laneKey}`);
        focusLaneHead(laneKey);
        return;
      }
      reportNote(`deleted lane ${laneKey} — its routes are cleared and parked bases restored`);
      const remaining = liveLaneKeys();
      focusLaneHead(remaining[0] ?? S.laneKey);
    });

    cancel.addEventListener("click", (ev) => {
      ev.stopPropagation();
      pendingDelete = null;
      renderGrid();
      reportNote(`delete lane ${laneKey} cancelled`);
      focusLaneHead(laneKey, '[data-act="del"]');
    });

    return head;
  }

  function buildLaneHead(laneKey) {
    const head = document.createElement("div");
    head.className = "lane-head";
    if (pendingDelete === laneKey) return buildDeleteConfirm(laneKey, head);

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

    const actions = document.createElement("span");
    actions.className = "lane-actions";

    const atCap = liveLaneKeys().length >= APP_LANE_CAP;
    const dup = document.createElement("button");
    dup.type = "button";
    dup.className = "lane-act";
    dup.dataset.act = "dup";
    dup.dataset.lane = laneKey;
    dup.textContent = "dup";
    dup.setAttribute("aria-disabled", String(atCap));
    dup.title = atCap
      ? `Duplicate lane ${laneKey} — ${APP_LANE_CAP} lanes is this build's maximum`
      : `Duplicate lane ${laneKey} as a new lane (values, operator, expressions — not routes)`;
    dup.setAttribute("aria-label", `dup lane ${laneKey}`);
    dup.addEventListener("click", (ev) => {
      ev.stopPropagation();
      pendingDelete = null;
      if (atCap) {
        reportNote(`${APP_LANE_CAP} lanes is this build's maximum — delete a lane to duplicate`);
        return;
      }
      const key = duplicateLaneFromUi(laneKey);
      renderGrid();
      if (!key) {
        reportNote(`could not duplicate lane ${laneKey}`);
        focusLaneHead(laneKey, '[data-act="dup"]');
        return;
      }
      reportNote(`duplicated lane ${laneKey} as lane ${key} — focused`);
      focusLaneHead(key);
    });
    actions.appendChild(dup);

    if (liveLaneKeys().length > 1) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "lane-act";
      del.dataset.act = "del";
      del.dataset.lane = laneKey;
      del.textContent = "del";
      del.title = `Delete lane ${laneKey} (asks for confirmation)`;
      del.setAttribute("aria-label", `del lane ${laneKey}`);
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pendingDelete = laneKey;
        renderGrid();
        const confirm = framesGrid.querySelector(
          `[data-lane="${laneKey}"] [data-act="confirm"]`
        );
        if (confirm) confirm.focus({ preventScroll: true });
        else reportNote(`delete lane ${laneKey}? press delete again to confirm`);
      });
      actions.appendChild(del);
    }
    head.appendChild(actions);
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

  /* The `+` tile is the live add-lane control (D46): it creates a blank lane at
     the lowest free stable key and focuses it. It is `aria-disabled` only at
     the eight-lane cap, where its name and title explain why. */
  function buildAddColumn() {
    const col = document.createElement("div");
    col.className = "lane-col is-add";

    const head = document.createElement("div");
    head.className = "lane-head";
    head.setAttribute("aria-hidden", "true");
    col.appendChild(head);

    const atCap = liveLaneKeys().length >= APP_LANE_CAP;
    const capNote = `${APP_LANE_CAP} lanes is this build's maximum — delete a lane to add another`;
    const label = atCap
      ? `Add lane — ${APP_LANE_CAP} lanes is this build's maximum`
      : "Add lane — create a blank lane and focus it";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-add";
    btn.setAttribute("aria-disabled", String(atCap));
    btn.textContent = "+";
    btn.setAttribute("aria-label", label);
    btn.title = atCap ? capNote : "Add a blank lane (zero registers, XOR, no routes or expressions)";
    btn.addEventListener("click", () => {
      if (atCap) {
        reportNote(capNote);
        return;
      }
      pendingDelete = null;
      const key = addLaneFromUi();
      renderGrid();
      if (!key) {
        reportNote(`${APP_LANE_CAP} lanes is this build's maximum`);
        return;
      }
      reportNote(`added lane ${key} — blank lane, focused`);
      focusLaneHead(key);
    });
    const hint = document.createElement("span");
    hint.className = "frame-add-hint";
    hint.textContent = "add lane";
    col.append(btn, hint);
    return col;
  }

  /* ── render ───────────────────────────────────────────────────────────── */

  function renderGrid() {
    if (!S.framesView) return;
    /* A lane deleted elsewhere (bridge/document load) cannot keep its confirm. */
    if (pendingDelete !== null && !S.lanes[pendingDelete]) pendingDelete = null;

    const active = document.activeElement;
    const card = active && active.closest ? active.closest("[data-lane][data-frame]") : null;
    const headControl = active && active.closest ? active.closest(".lane-act, .lane-btn") : null;
    const keepCard = card
      ? { lane: card.dataset.lane, frame: card.dataset.frame, eye: active.classList.contains("eye-btn") }
      : null;
    const keepHead = headControl
      ? {
          lane: headControl.closest("[data-lane]")?.dataset.lane,
          act: headControl.classList.contains("lane-btn") ? "lane-btn" : headControl.dataset.act,
        }
      : null;

    framesGrid.textContent = "";
    for (const laneKey of liveLaneKeys()) framesGrid.appendChild(buildLaneColumn(laneKey));
    framesGrid.appendChild(buildAddColumn());

    const fa = frameName(curLane().key, "a");
    const fb = frameName(curLane().key, "b");
    const fz = frameName(curLane().key, "z");
    framesLegend.textContent = `${fa} solid · ${fz} glow · ${fb} dashed`;

    updateScrollbar();

    if (keepCard) {
      const selector = `[data-lane="${keepCard.lane}"][data-frame="${keepCard.frame}"]`;
      const target = keepCard.eye
        ? framesGrid.querySelector(`${selector} .eye-btn`)
        : framesGrid.querySelector(`${selector} .frame-card`);
      if (target) target.focus({ preventScroll: true });
    } else if (keepHead && keepHead.lane) {
      const selector = keepHead.act === "lane-btn"
        ? ".lane-btn"
        : `[data-act="${keepHead.act}"]`;
      const target = framesGrid.querySelector(`[data-lane="${keepHead.lane}"] ${selector}`);
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
    pendingDelete = null;
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

  /* Esc cancels a pending inline delete confirmation *before* the global Esc
     handler closes the frames view (capture phase + stopPropagation). */
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || pendingDelete === null || !S.framesView) return;
      const laneKey = pendingDelete;
      pendingDelete = null;
      e.preventDefault();
      e.stopPropagation();
      renderGrid();
      reportNote(`delete lane ${laneKey} cancelled`);
      focusLaneHead(laneKey, '[data-act="del"]');
    },
    true,
  );

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
