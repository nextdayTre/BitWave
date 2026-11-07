/**
 * Frame navigator — the Pro-Q4-style lane/frame panel and the focus lens.
 *
 * Moved out of main.js in F2. Reads the state tree; DOM only inside the panel.
 * Callbacks injected by the composition root handle selection/focus orchestration.
 */

import { buildSpline, evalSpline } from "../core/spline.ts";
import { setFocus, toggleFrameVisibility } from "../state/actions.ts";
import { S, SLOT_KEYS, curSlot, focusKey, frameName, laneLabel } from "../state/instrument.ts";
import { toHexOf } from "../render/readouts.js";

export function createFrameNavigator(deps) {
  const {
    store,
    selectSlot,
    enableBOnSlot,
    syncEditUi,
    syncViewUi,
    renderStrip,
    updateReadouts,
    unpairB,
    slotExprText,
  } = deps;

  const framesBtn = document.getElementById("framesBtn");
  const framesPanel = document.getElementById("framesPanel");
  const framesBody = document.getElementById("framesBody");
  const framesLegend = document.getElementById("framesLegend");
  const framesClose = document.getElementById("framesClose");
  const unpairBBtn = document.getElementById("unpairB");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const FRAME_ORDER = ["a", "z", "b"];

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
    /* Name comes from the visible content (frame glyph, kind, hex) so
       voice-control can match what the user reads (SC 2.5.3). */
    btn.title = `Lane ${laneLabel(laneKey)} · ${name} (${frameSub(frame)})${active ? " — focused" : ""}`;

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
    btn.title = `Lane ${laneLabel(laneKey)}${expanded ? " · expanded" : ""}`;
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

  return {
    framesBtn,
    isOpen: () => !framesPanel.hidden,
    close: closeFrames,
    render: renderFramesPanel,
    selectFrame,
    setFrameVis,
    focusButton: () => framesBtn.focus(),
  };
}
