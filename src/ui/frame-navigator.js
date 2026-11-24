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
import { APP_FREE_FRAME_CAP, APP_LANE_CAP, freeFrameName } from "../core/lanedefs.ts";
import { isFreePort } from "../core/types.ts";
import { setFocus, toggleFrameVisibility, toggleFreeFrameVisibility } from "../state/actions.ts";
import { describeFreeInput, describeInput } from "../state/bindings.ts";
import {
  OPSYM,
  S,
  curLane,
  focusKey,
  frameName,
  liveFreeFrameKeys,
  liveLaneKeys,
} from "../state/instrument.ts";
import { routing } from "../state/routing.ts";
import { toHexOf } from "../render/readouts.js";

export function createFrameNavigator(deps) {
  const {
    store,
    selectLane,
    selectFreeFrame,
    enableBOnLane,
    syncEditUi,
    syncViewUi,
    renderStrip,
    updateReadouts,
    unpairB,
    addLaneFromUi,
    duplicateLaneFromUi,
    deleteLaneFromUi,
    addFreeFrameFromUi,
    duplicateFreeFrameFromUi,
    deleteFreeFrameFromUi,
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
  const framesTree = document.getElementById("framesTree");
  const framesLaneCount = document.getElementById("framesLaneCount");
  const framesTitle = document.getElementById("framesTitle");
  const framesSub = document.getElementById("framesSub");
  const framesFilters = document.getElementById("framesFilters");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const FRAME_ORDER = ["a", "b", "z"];
  const FILTER_TITLES = {
    all: "All Frames",
    free: "Free Frames",
    operands: "Operand Frames",
    derived: "Derived Frames",
    visible: "Visible in 2D",
  };
  /** Lane key whose delete button is showing its inline confirmation. */
  let pendingDelete = null;
  /** Free-frame key whose delete button is showing its inline confirmation. */
  let pendingFreeDelete = null;
  /** Transient visual filter in the frames browser (resets to "all" on open). */
  let filterMode = "all";
  /** Rolling visual tail history per lane:frame while LFO is running. */
  const tailHistory = new Map();

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const compactHex = (hex) => (hex.length > 10 ? `${hex.slice(0, 4)}\u2026${hex.slice(-4)}` : hex);

  /* ── isometric 3D wavetable previews (D52: GitWave-style visual tail) ─── */

  const ISO_W = 184;
  const ISO_H = 104;
  const ISO_SAMPLES = 40;
  const ISO_SLICES = 16;

  function sampleNormalizedWave(reg) {
    const vals = reg.target;
    const out = new Float32Array(ISO_SAMPLES);
    if (!vals || vals.length === 0) return out;
    const xs = vals.map((_, j) => (vals.length === 1 ? 0.5 : j / (vals.length - 1)));
    const ys = vals.map((v) => v / 15);
    const sp = buildSpline(xs, ys);
    for (let i = 0; i < ISO_SAMPLES; i++) {
      const u = i / (ISO_SAMPLES - 1);
      const v = evalSpline(sp, u);
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    return out;
  }

  function buildTailSlices(laneKey, frame, reg) {
    const current = sampleNormalizedWave(reg);
    const key = `${laneKey}:${frame}`;

    if (S.lfo.on) {
      let ring = tailHistory.get(key);
      if (!ring) {
        ring = [];
        for (let s = 0; s < ISO_SLICES; s++) ring.push(current);
        tailHistory.set(key, ring);
      } else {
        ring.push(current);
        if (ring.length > ISO_SLICES) ring.shift();
      }
      return ring;
    }

    /* LFO off: clean static visual tail extruded from the live frame state. */
    if (tailHistory.size > 0) tailHistory.clear();
    const slices = new Array(ISO_SLICES);
    for (let s = 0; s < ISO_SLICES; s++) {
      const d = s / (ISO_SLICES - 1);
      const scale = 0.84 + 0.16 * d;
      const arr = new Float32Array(ISO_SAMPLES);
      for (let i = 0; i < ISO_SAMPLES; i++) arr[i] = current[i] * scale;
      slices[s] = arr;
    }
    return slices;
  }

  const ISO_PALETTES = {
    a: { low: [10, 26, 22], mid: [26, 134, 98], hi: [110, 240, 190], edge: "#6ee7b7", glow: "rgba(52,211,153,0.22)" },
    b: { low: [10, 22, 26], mid: [22, 104, 108], hi: [92, 210, 204], edge: "#5eead4", glow: "rgba(45,212,191,0.18)" },
    z: { low: [12, 32, 28], mid: [36, 168, 130], hi: [168, 252, 226], edge: "#a7f3d0", glow: "rgba(94,234,212,0.36)" },
  };

  function mixRgb(pal, t) {
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    let a, b, f;
    if (c < 0.55) {
      a = pal.low; b = pal.mid; f = c / 0.55;
    } else {
      a = pal.mid; b = pal.hi; f = (c - 0.55) / 0.45;
    }
    const r = Math.round(a[0] + (b[0] - a[0]) * f);
    const g = Math.round(a[1] + (b[1] - a[1]) * f);
    const bl = Math.round(a[2] + (b[2] - a[2]) * f);
    return [r, g, bl];
  }

  function paintIsometricWavetable(canvas, slices, frame) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = ISO_W * dpr;
    canvas.height = ISO_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ISO_W, ISO_H);

    const ox = 60, oy = 48;
    const vx = 104, vy = 22;
    const dx = -44, dy = 26;
    const amp = 35;

    const px = (u, d) => ox + u * vx + d * dx;
    const py = (u, d, h) => oy + u * vy + d * dy - h * amp;

    const pal = ISO_PALETTES[frame] || ISO_PALETTES.a;

    /* 1. Recessed isometric floor slab (gives flat/zero frames a sleek plinth). */
    ctx.beginPath();
    ctx.moveTo(px(0, 0), py(0, 0, 0));
    ctx.lineTo(px(1, 0), py(1, 0, 0));
    ctx.lineTo(px(1, 1), py(1, 1, 0));
    ctx.lineTo(px(0, 1), py(0, 1, 0));
    ctx.closePath();
    ctx.fillStyle = "rgba(13, 22, 21, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(52, 211, 153, 0.14)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    /* 2. Shaded volumetric surface quads back-to-front (Painter's algorithm). */
    const S = slices.length;
    const M = ISO_SAMPLES;
    for (let s = 0; s < S - 1; s++) {
      const d0 = s / (S - 1);
      const d1 = (s + 1) / (S - 1);
      const depth = (d0 + d1) * 0.5;
      const row0 = slices[s];
      const row1 = slices[s + 1];
      const alpha = 0.48 + 0.50 * depth;

      for (let i = 0; i < M - 1; i++) {
        const u0 = i / (M - 1);
        const u1 = (i + 1) / (M - 1);
        const h00 = row0[i], h10 = row0[i + 1];
        const h01 = row1[i], h11 = row1[i + 1];

        const hAvg = (h00 + h10 + h01 + h11) * 0.25;
        const slopeU = (h10 + h11 - h00 - h01) * 0.5;
        const slopeD = (h01 + h11 - h00 - h10) * 0.5;
        const shade = Math.max(
          0.05,
          Math.min(1, 0.12 + 0.56 * hAvg + 0.34 * depth - slopeU * 2.1 - slopeD * 0.8),
        );
        const [r, g, b] = mixRgb(pal, shade);

        ctx.beginPath();
        ctx.moveTo(px(u0, d0), py(u0, d0, h00));
        ctx.lineTo(px(u1, d0), py(u1, d0, h10));
        ctx.lineTo(px(u1, d1), py(u1, d1, h11));
        ctx.lineTo(px(u0, d1), py(u0, d1, h01));
        ctx.closePath();
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        ctx.fill();
      }

      /* Subtle wavetable slice rib every 3rd depth layer for tactile texture. */
      if (s % 3 === 0) {
        ctx.beginPath();
        for (let i = 0; i < M; i++) {
          const u = i / (M - 1);
          const x = px(u, d0);
          const y = py(u, d0, row0[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(94, 234, 212, ${(0.05 + 0.11 * d0).toFixed(3)})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }

    /* 3. Front skirt wall under the front live waveform slice. */
    const front = slices[S - 1];
    ctx.beginPath();
    for (let i = 0; i < M; i++) {
      const u = i / (M - 1);
      const x = px(u, 1);
      const y = py(u, 1, front[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(px(1, 1), py(1, 1, 0));
    ctx.lineTo(px(0, 1), py(0, 1, 0));
    ctx.closePath();
    const wallGrad = ctx.createLinearGradient(0, oy - amp, 0, oy + vy + dy);
    wallGrad.addColorStop(0, "rgba(24, 72, 58, 0.72)");
    wallGrad.addColorStop(1, "rgba(8, 10, 13, 0.94)");
    ctx.fillStyle = wallGrad;
    ctx.fill();

    /* Subtle front base lip (anchors zero/flat slabs cleanly). */
    ctx.beginPath();
    ctx.moveTo(px(0, 1), py(0, 1, 0));
    ctx.lineTo(px(1, 1), py(1, 1, 0));
    ctx.strokeStyle = "rgba(94, 234, 212, 0.24)";
    ctx.lineWidth = 0.9;
    ctx.stroke();

    /* 4. Luminous front waveform crest (A solid, B dashed, Z double-glow). */
    const traceFront = () => {
      ctx.beginPath();
      for (let i = 0; i < M; i++) {
        const u = i / (M - 1);
        const x = px(u, 1);
        const y = py(u, 1, front[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    traceFront();
    ctx.strokeStyle = pal.glow;
    ctx.lineWidth = frame === "z" ? 5.5 : 3.2;
    ctx.stroke();

    if (frame === "b") ctx.setLineDash([4, 3]);
    traceFront();
    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = frame === "z" ? 1.85 : 1.4;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function makePreview(laneKey, reg, frame) {
    const canvas = document.createElement("canvas");
    canvas.className = `frame-preview ${frame}`;
    canvas.setAttribute("aria-hidden", "true");
    paintIsometricWavetable(canvas, buildTailSlices(laneKey, frame, reg), frame);
    return canvas;
  }

  const frameReg = (sl, frame) => (frame === "a" ? sl.A : frame === "b" ? sl.B : sl.Z);
  const frameSub = (frame) => (frame === "z" ? "derived" : "operand");

  function frameRoleBadge(sl, frame) {
    if (frame === "z") return { text: "derived", accent: true };
    const info = describeInput(sl, frame);
    if (info.source.kind === "data") return { text: "data", accent: false };
    if (info.source.kind === "frame") return { text: info.state, accent: true };
    if (info.source.kind === "expr") return { text: "expr", accent: true };
    return { text: "operand", accent: false };
  }

  function matchesFilter(sl, frame) {
    if (filterMode === "free") return false;
    if (filterMode === "operands") return frame !== "z";
    if (filterMode === "derived") return frame === "z";
    if (filterMode === "visible") return sl.frameVis[frame];
    return true;
  }

  function matchesFreeFilter(ff) {
    if (filterMode === "derived") return false;
    if (filterMode === "visible") return ff.visible;
    return true;
  }

  function freeRoleBadge(ff) {
    const info = describeFreeInput(ff);
    if (info.source.kind === "data") return { text: `data · ${info.source.column}`, accent: false };
    if (info.source.kind === "frame") return { text: `${info.state} · ${info.source.name}`, accent: true };
    if (info.source.kind === "expr") return { text: "expr", accent: true };
    if (ff.sourceNote) return { text: ff.sourceNote, accent: true };
    return { text: "free", accent: false };
  }

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
    const active = !S.activeFree && laneKey === S.laneKey && focusKey(sl) === frame;
    const visible = sl.frameVis[frame];
    const hex = toHexOf(reg);
    const role = frameRoleBadge(sl, frame);
    /* D53: a failed expression leaves the last settled bits; say so on the card. */
    const exprError = S.expressionErrors[name] ?? null;
    const dimmed = !matchesFilter(sl, frame);

    const wrap = document.createElement("div");
    wrap.className =
      "frame-card-wrap"
      + (active ? " is-active" : "")
      + (visible ? "" : " is-hidden")
      + (dimmed ? " is-dimmed" : "");
    wrap.dataset.lane = laneKey;
    wrap.dataset.frame = frame;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-card";
    btn.setAttribute("aria-pressed", String(active));
    btn.setAttribute("aria-label", `Lane ${laneKey} · ${name} ${frameSub(frame)} · ${hex}`);
    btn.title = `Lane ${laneKey} · ${name} (${frameSub(frame)}) · ${hex}`;

    const box = document.createElement("span");
    box.className = "frame-box";
    box.appendChild(makePreview(laneKey, reg, frame));

    const glyph = document.createElement("span");
    glyph.className = "frame-glyph";
    glyph.textContent = name;

    btn.append(box, glyph);
    btn.addEventListener("click", () => chooseCard(laneKey, frame));

    const extra = document.createElement("div");
    extra.className = "frame-card-extra";
    extra.setAttribute("aria-hidden", "true");
    const sub = document.createElement("span");
    sub.className = "frame-sub" + (role.accent ? " is-accent" : "") + (exprError ? " is-error" : "");
    sub.textContent = `${role.text}${exprError ? " \u26A0" : ""} \u00B7 ${compactHex(hex)}`;
    if (exprError) {
      sub.title = `expression did not evaluate: ${exprError} \u2014 showing the last settled value`;
    }
    extra.appendChild(sub);

    const eye = makeEyeButton(laneKey, frame);
    wrap.append(btn, extra, eye);
    return wrap;
  }

  /* ── lane management (D46) ────────────────────────────────────────────── */

  const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** How many live routes/expressions reference this lane's frames. */
  function laneReferences(laneKey) {
    let routes = 0;
    for (const route of routing.routes) {
      const fromLane = !isFreePort(route.from) && route.from.lane === laneKey;
      const toLane = !isFreePort(route.to) && route.to.lane === laneKey;
      if (fromLane || toLane) routes += 1;
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
    for (const fk of liveFreeFrameKeys()) {
      const text = S.freeFrames[fk]?.expression;
      if (text && text.trim() !== "" && matcher.test(text)) expressions += 1;
    }
    return { routes, expressions, total: routes + expressions };
  }

  /** How many live routes/expressions reference this free frame. */
  function freeReferences(freeKey) {
    let routes = 0;
    for (const route of routing.routes) {
      const fromFree = isFreePort(route.from) && route.from.free === freeKey;
      const toFree = isFreePort(route.to) && route.to.free === freeKey;
      if (fromFree || toFree) routes += 1;
    }
    const name = escapeRe(freeFrameName(freeKey));
    const matcher = new RegExp(`(^|[^A-Za-z0-9_])(${name})([^A-Za-z0-9_]|$)`);
    let expressions = 0;
    for (const key of liveLaneKeys()) {
      const lane = S.lanes[key];
      if (!lane) continue;
      for (const operand of ["a", "b"]) {
        const text = lane.expressions[operand];
        if (text && text.trim() !== "" && matcher.test(text)) expressions += 1;
      }
    }
    for (const fk of liveFreeFrameKeys()) {
      if (fk === freeKey) continue;
      const text = S.freeFrames[fk]?.expression;
      if (text && text.trim() !== "" && matcher.test(text)) expressions += 1;
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
    const active = !S.activeFree && laneKey === S.laneKey;
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
    const opBadge = document.createElement("span");
    opBadge.className = "lane-op-badge";
    const sym = OPSYM[sl.binop] || "\u2295";
    opBadge.textContent = `${frameName(laneKey, "a")} ${sym} ${frameName(laneKey, "b")}`;
    head.appendChild(opBadge);

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
    col.className = "lane-col" + (!S.activeFree && laneKey === S.laneKey ? " is-active" : "");
    col.dataset.lane = laneKey;
    col.setAttribute("role", "group");
    col.setAttribute("aria-label", `Lane ${laneKey}`);
    col.appendChild(buildLaneHead(laneKey));
    const cards = document.createElement("div");
    cards.className = "lane-cards";
    for (const frame of FRAME_ORDER) cards.appendChild(buildCard(laneKey, frame));
    col.appendChild(cards);
    return col;
  }

  /* ── free frame cards & section (D52) ─────────────────────────────────── */

  function makeFreeEyeButton(freeKey) {
    const ff = S.freeFrames[freeKey];
    const name = freeFrameName(freeKey);
    const label = `${ff.visible ? "Hide" : "Show"} free frame ${name} in the 2D view`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "eye-btn" + (ff.visible ? "" : " is-hidden");
    btn.setAttribute("aria-pressed", String(ff.visible));
    btn.setAttribute("aria-label", label);
    btn.title = label;
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
      store.patch(() => toggleFreeFrameVisibility(S.freeFrames[freeKey]));
      renderGrid();
    });
    return btn;
  }

  function buildFreeCard(freeKey) {
    const ff = S.freeFrames[freeKey];
    const name = freeFrameName(freeKey);
    const active = S.activeFree === freeKey;
    const hex = toHexOf(ff.reg);
    const role = freeRoleBadge(ff);
    /* D53: same frozen-register warning as lane cards. */
    const exprError = S.expressionErrors[name] ?? null;
    const dimmed = !matchesFreeFilter(ff);

    const wrap = document.createElement("div");
    wrap.className =
      "frame-card-wrap is-free"
      + (active ? " is-active" : "")
      + (ff.visible ? "" : " is-hidden")
      + (dimmed ? " is-dimmed" : "");
    wrap.dataset.free = freeKey;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-card";
    btn.setAttribute("aria-pressed", String(active));
    const displayName = ff.label ? `${name} · ${ff.label}` : name;
    btn.setAttribute("aria-label", `${displayName} · free frame · ${hex}`);
    btn.title = `${displayName}${ff.sourceNote ? ` (${ff.sourceNote})` : ""} · ${hex}`;

    const box = document.createElement("span");
    box.className = "frame-box";
    box.appendChild(makePreview(name, ff.reg, "a"));

    const glyph = document.createElement("span");
    glyph.className = "frame-glyph";
    glyph.textContent = displayName;

    btn.append(box, glyph);
    btn.addEventListener("click", () => chooseFreeCard(freeKey));

    const extra = document.createElement("div");
    extra.className = "frame-card-extra";
    extra.setAttribute("aria-hidden", "true");
    const sub = document.createElement("span");
    sub.className = "frame-sub" + (role.accent ? " is-accent" : "") + (exprError ? " is-error" : "");
    const roleText = role.text.length > 20 ? `${role.text.slice(0, 19)}\u2026` : role.text;
    sub.textContent = `${roleText}${exprError ? " \u26A0" : ""} \u00B7 ${compactHex(hex)}`;
    if (exprError) {
      sub.title = `expression did not evaluate: ${exprError} \u2014 showing the last settled value`;
    }
    extra.appendChild(sub);

    const eye = makeFreeEyeButton(freeKey);

    const actions = document.createElement("div");
    actions.className = "free-card-actions";
    if (pendingFreeDelete === freeKey) {
      const refs = freeReferences(freeKey);
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "lane-act is-danger";
      confirm.dataset.act = "free-confirm";
      confirm.textContent = "delete";
      confirm.title = refs.total > 0
        ? `Confirm delete ${name} (${describeReferences(refs)} reference it)`
        : `Confirm delete ${name}`;
      confirm.setAttribute("aria-label", `delete ${name}`);
      confirm.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pendingFreeDelete = null;
        deleteFreeFrameFromUi(freeKey);
        renderGrid();
        reportNote(`deleted free frame ${name} — routes cleared and parked bases restored`);
      });

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "lane-act";
      cancel.dataset.act = "free-cancel";
      cancel.textContent = "cancel";
      cancel.setAttribute("aria-label", `cancel deleting ${name}`);
      cancel.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pendingFreeDelete = null;
        renderGrid();
        reportNote(`delete ${name} cancelled`);
      });
      actions.append(confirm, cancel);
    } else {
      const atCap = liveFreeFrameKeys().length >= APP_FREE_FRAME_CAP;
      const dup = document.createElement("button");
      dup.type = "button";
      dup.className = "lane-act";
      dup.dataset.act = "free-dup";
      dup.textContent = "dup";
      dup.setAttribute("aria-disabled", String(atCap));
      dup.setAttribute("aria-label", `dup ${name}`);
      dup.title = atCap ? `${APP_FREE_FRAME_CAP} free frames max` : `Duplicate ${name}`;
      dup.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pendingFreeDelete = null;
        if (atCap) {
          reportNote(`${APP_FREE_FRAME_CAP} free frames is this build's maximum`);
          return;
        }
        const created = duplicateFreeFrameFromUi(freeKey);
        renderGrid();
        if (created) reportNote(`duplicated ${name} as ${freeFrameName(created)}`);
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "lane-act";
      del.dataset.act = "free-del";
      del.textContent = "del";
      del.setAttribute("aria-label", `del ${name}`);
      del.title = `Delete ${name} (asks for confirmation)`;
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pendingDelete = null;
        pendingFreeDelete = freeKey;
        renderGrid();
        const refs = freeReferences(freeKey);
        const refMsg = refs.total > 0 ? ` — ${describeReferences(refs)} reference it` : "";
        reportNote(`delete ${name}?${refMsg} press delete again to confirm`);
      });
      actions.append(dup, del);
    }

    wrap.append(btn, extra, eye, actions);
    return wrap;
  }

  function buildFreeSection(freeKeys) {
    const col = document.createElement("div");
    col.className = "lane-col free-section" + (S.activeFree ? " is-active" : "");
    col.setAttribute("role", "group");
    col.setAttribute("aria-label", "Free Frames");

    const head = document.createElement("div");
    head.className = "lane-head";
    const title = document.createElement("span");
    title.className = "lane-btn free-section-title";
    title.textContent = "FREE FRAMES";
    const badge = document.createElement("span");
    badge.className = "lane-op-badge";
    badge.textContent = `${freeKeys.length} / ${APP_FREE_FRAME_CAP} · standalone`;
    head.append(title, badge);
    col.appendChild(head);

    const cards = document.createElement("div");
    cards.className = "lane-cards free-cards";
    for (const fk of freeKeys) cards.appendChild(buildFreeCard(fk));
    col.appendChild(cards);
    return col;
  }

  /* The add tile offers both `+ add lane` (D46) and `+ add frame` (D52), so
     decoupling standalone registers from A/B/Z lanes is one click away. */
  function buildAddColumn() {
    const col = document.createElement("div");
    col.className = "lane-col is-add";

    const head = document.createElement("div");
    head.className = "lane-head";
    head.setAttribute("aria-hidden", "true");
    col.appendChild(head);

    const row = document.createElement("div");
    row.className = "add-pair";

    const atLaneCap = liveLaneKeys().length >= APP_LANE_CAP;
    const laneCapNote = `${APP_LANE_CAP} lanes is this build's maximum — delete a lane to add another`;
    const laneWrap = document.createElement("div");
    laneWrap.className = "add-slot";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-add";
    btn.setAttribute("aria-disabled", String(atLaneCap));
    btn.textContent = "+";
    btn.setAttribute(
      "aria-label",
      atLaneCap
        ? `Add lane — ${APP_LANE_CAP} lanes is this build's maximum`
        : "Add lane — create a blank lane and focus it",
    );
    btn.title = atLaneCap ? laneCapNote : "Add a blank lane (A/B/Z pair)";
    btn.addEventListener("click", () => {
      if (atLaneCap) {
        reportNote(laneCapNote);
        return;
      }
      pendingDelete = null;
      pendingFreeDelete = null;
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
    laneWrap.append(btn, hint);

    const atFreeCap = liveFreeFrameKeys().length >= APP_FREE_FRAME_CAP;
    const freeCapNote = `${APP_FREE_FRAME_CAP} free frames is this build's maximum — delete one to add another`;
    const freeWrap = document.createElement("div");
    freeWrap.className = "add-slot";
    const freeBtn = document.createElement("button");
    freeBtn.type = "button";
    freeBtn.className = "frame-add is-free-add";
    freeBtn.setAttribute("aria-disabled", String(atFreeCap));
    freeBtn.textContent = "+";
    freeBtn.setAttribute(
      "aria-label",
      atFreeCap
        ? `Add free frame — ${APP_FREE_FRAME_CAP} free frames is this build's maximum`
        : "Add free frame — create a standalone register (F1..F16)",
    );
    freeBtn.title = atFreeCap
      ? freeCapNote
      : "Add a standalone free frame (decoupled from A/B/Z lanes for chains & external outputs)";
    freeBtn.addEventListener("click", () => {
      if (atFreeCap) {
        reportNote(freeCapNote);
        return;
      }
      pendingDelete = null;
      pendingFreeDelete = null;
      const key = addFreeFrameFromUi();
      renderGrid();
      if (!key) {
        reportNote(`${APP_FREE_FRAME_CAP} free frames is this build's maximum`);
        return;
      }
      reportNote(`added free frame ${freeFrameName(key)} — standalone register`);
    });
    const freeHint = document.createElement("span");
    freeHint.className = "frame-add-hint";
    freeHint.textContent = "add frame";
    freeWrap.append(freeBtn, freeHint);

    row.append(laneWrap, freeWrap);
    col.appendChild(row);
    return col;
  }

  /* ── sidebar + header (browser organization) ──────────────────────────── */

  function scrollLaneIntoView(laneKey) {
    const col = framesGrid.querySelector(`.lane-col[data-lane="${laneKey}"]`);
    if (!col) return;
    col.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }

  function syncFilterUi() {
    if (!framesFilters) return;
    for (const btn of framesFilters.querySelectorAll(".frames-filter")) {
      const on = btn.dataset.filter === filterMode;
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  function renderSidebar(laneKeys, freeKeys = []) {
    if (framesLaneCount) {
      framesLaneCount.textContent = `${laneKeys.length} / ${APP_LANE_CAP}`;
    }
    if (framesTitle) {
      framesTitle.textContent = FILTER_TITLES[filterMode] || "All Frames";
    }
    if (framesSub) {
      const total = laneKeys.length * 3 + freeKeys.length;
      const laneWord = laneKeys.length === 1 ? "lane" : "lanes";
      const freePart = freeKeys.length > 0 ? ` · ${freeKeys.length} free` : "";
      framesSub.textContent = `${total} frames · ${laneKeys.length} ${laneWord}${freePart} · click a card to focus · eye toggles 2D`;
    }
    syncFilterUi();
    if (!framesTree) return;

    framesTree.textContent = "";

    /* Summary row: All Frames */
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "fs-item fs-all" + (filterMode === "all" ? " is-active" : "");
    allBtn.setAttribute("aria-pressed", String(filterMode === "all"));
    const allLabel = document.createElement("span");
    allLabel.className = "fs-label";
    allLabel.textContent = "All Frames";
    const allCount = document.createElement("span");
    allCount.className = "fs-badge";
    allCount.textContent = String(laneKeys.length * 3 + freeKeys.length);
    allBtn.append(allLabel, allCount);
    allBtn.addEventListener("click", () => {
      filterMode = "all";
      renderGrid();
      framesScroll.scrollTo({ left: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
    framesTree.appendChild(allBtn);

    /* Lanes section */
    const lanesSec = document.createElement("div");
    lanesSec.className = "fs-section";
    const lanesHeading = document.createElement("div");
    lanesHeading.className = "fs-sec-head";
    const lanesTitle = document.createElement("span");
    lanesTitle.textContent = "Lanes";
    const lanesNum = document.createElement("span");
    lanesNum.className = "fs-sec-count";
    lanesNum.textContent = String(laneKeys.length);
    lanesHeading.append(lanesTitle, lanesNum);
    lanesSec.appendChild(lanesHeading);

    for (const laneKey of laneKeys) {
      const sl = S.lanes[laneKey];
      const active = !S.activeFree && laneKey === S.laneKey;
      const sym = OPSYM[sl.binop] || "\u2295";
      const row = document.createElement("button");
      row.type = "button";
      row.className = "fs-item" + (active ? " is-active" : "");
      row.dataset.treeLane = laneKey;
      row.setAttribute("aria-pressed", String(active));
      row.title = `Focus lane ${laneKey} (${frameName(laneKey, "a")} ${sym} ${frameName(laneKey, "b")} → ${frameName(laneKey, "z")})`;

      const dot = document.createElement("span");
      dot.className = "fs-dot";
      dot.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "fs-label";
      label.textContent = `Lane ${laneKey}`;

      const badge = document.createElement("span");
      badge.className = "fs-badge";
      badge.textContent = `${frameName(laneKey, "a")}${sym}${frameName(laneKey, "b")}`;

      row.append(dot, label, badge);
      row.addEventListener("click", () => {
        S.copyArmed = false;
        store.patch(() => {
          if (S.laneKey !== laneKey || S.activeFree) selectLane(laneKey);
          syncViewUi();
          syncEditUi();
          renderStrip();
          updateReadouts();
        });
        renderGrid();
        scrollLaneIntoView(laneKey);
      });
      lanesSec.appendChild(row);
    }
    framesTree.appendChild(lanesSec);

    /* Free Frames section (D52) */
    const freeSec = document.createElement("div");
    freeSec.className = "fs-section";
    const freeHeading = document.createElement("div");
    freeHeading.className = "fs-sec-head";
    const freeTitle = document.createElement("span");
    freeTitle.textContent = "Free Frames";
    const freeHeadRight = document.createElement("span");
    freeHeadRight.className = "fs-sec-actions";
    const freeNum = document.createElement("span");
    freeNum.className = "fs-sec-count";
    freeNum.textContent = String(freeKeys.length);
    const addMini = document.createElement("button");
    addMini.type = "button";
    addMini.className = "fs-add-btn";
    addMini.textContent = "+";
    const atFreeCap = freeKeys.length >= APP_FREE_FRAME_CAP;
    addMini.setAttribute("aria-disabled", String(atFreeCap));
    addMini.setAttribute("aria-label", "Add free frame");
    addMini.title = atFreeCap ? `${APP_FREE_FRAME_CAP} free frames max` : "Add a standalone free frame";
    addMini.addEventListener("click", () => {
      if (atFreeCap) {
        reportNote(`${APP_FREE_FRAME_CAP} free frames is this build's maximum`);
        return;
      }
      const key = addFreeFrameFromUi();
      renderGrid();
      if (key) reportNote(`added free frame ${freeFrameName(key)}`);
    });
    freeHeadRight.append(freeNum, addMini);
    freeHeading.append(freeTitle, freeHeadRight);
    freeSec.appendChild(freeHeading);

    for (const fk of freeKeys) {
      const ff = S.freeFrames[fk];
      const name = freeFrameName(fk);
      const active = S.activeFree === fk;
      const hex = toHexOf(ff.reg);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "fs-item fs-frame-item" + (active ? " is-active" : "");
      row.dataset.treeFree = fk;
      row.setAttribute("aria-pressed", String(active));
      row.title = `Open ${name}${ff.label ? ` · ${ff.label}` : ""} · ${hex}`;

      const swatch = document.createElement("span");
      swatch.className = "fs-swatch is-a";
      swatch.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "fs-label";
      label.textContent = ff.label ? `${name} · ${ff.label}` : name;

      const badge = document.createElement("span");
      badge.className = "fs-badge";
      badge.textContent = compactHex(hex);

      row.append(swatch, label, badge);
      row.addEventListener("click", () => chooseFreeCard(fk));
      freeSec.appendChild(row);
    }
    framesTree.appendChild(freeSec);

    /* Focused lane quick frames section */
    const focusedLane = curLane();
    if (focusedLane && !S.activeFree) {
      const fk = focusedLane.key;
      const curSec = document.createElement("div");
      curSec.className = "fs-section";
      const curHeading = document.createElement("div");
      curHeading.className = "fs-sec-head";
      const curTitle = document.createElement("span");
      curTitle.textContent = `Lane ${fk} Frames`;
      const curNum = document.createElement("span");
      curNum.className = "fs-sec-count";
      curNum.textContent = "3";
      curHeading.append(curTitle, curNum);
      curSec.appendChild(curHeading);

      for (const frame of FRAME_ORDER) {
        const name = frameName(fk, frame);
        const active = focusKey(focusedLane) === frame;
        const hex = toHexOf(frameReg(focusedLane, frame));
        const row = document.createElement("button");
        row.type = "button";
        row.className = "fs-item fs-frame-item" + (active ? " is-active" : "");
        row.dataset.treeFrame = frame;
        row.setAttribute("aria-pressed", String(active));
        row.title = `Open ${name} (${frameSub(frame)}) · ${hex}`;

        const swatch = document.createElement("span");
        swatch.className = `fs-swatch is-${frame}`;
        swatch.setAttribute("aria-hidden", "true");

        const label = document.createElement("span");
        label.className = "fs-label";
        label.textContent = name;

        const badge = document.createElement("span");
        badge.className = "fs-badge";
        badge.textContent = compactHex(hex);

        row.append(swatch, label, badge);
        row.addEventListener("click", () => chooseCard(fk, frame));
        curSec.appendChild(row);
      }
      framesTree.appendChild(curSec);
    }
  }

  /* ── render ───────────────────────────────────────────────────────────── */

  function renderGrid() {
    if (!S.framesView) return;
    if (pendingDelete !== null && !S.lanes[pendingDelete]) pendingDelete = null;
    if (pendingFreeDelete !== null && !S.freeFrames[pendingFreeDelete]) pendingFreeDelete = null;

    const active = document.activeElement;
    const card = active && active.closest ? active.closest("[data-lane][data-frame]") : null;
    const freeCard = active && active.closest ? active.closest("[data-free]") : null;
    const headControl = active && active.closest ? active.closest(".lane-act, .lane-btn") : null;
    const treeControl = active && active.closest ? active.closest(".fs-item") : null;
    const keepCard = card
      ? { lane: card.dataset.lane, frame: card.dataset.frame, eye: active.classList.contains("eye-btn") }
      : null;
    const keepFree = freeCard
      ? { free: freeCard.dataset.free, eye: active.classList.contains("eye-btn") }
      : null;
    const keepHead = headControl
      ? {
          lane: headControl.closest("[data-lane]")?.dataset.lane,
          act: headControl.classList.contains("lane-btn") ? "lane-btn" : headControl.dataset.act,
        }
      : null;
    const keepTree = treeControl
      ? {
          lane: treeControl.dataset.treeLane || null,
          frame: treeControl.dataset.treeFrame || null,
          free: treeControl.dataset.treeFree || null,
        }
      : null;

    const laneKeys = liveLaneKeys();
    const freeKeys = liveFreeFrameKeys();
    renderSidebar(laneKeys, freeKeys);

    framesGrid.textContent = "";
    for (const laneKey of laneKeys) framesGrid.appendChild(buildLaneColumn(laneKey));
    if (freeKeys.length > 0) framesGrid.appendChild(buildFreeSection(freeKeys));
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
    } else if (keepFree) {
      const selector = `[data-free="${keepFree.free}"]`;
      const target = keepFree.eye
        ? framesGrid.querySelector(`${selector} .eye-btn`)
        : framesGrid.querySelector(`${selector} .frame-card`);
      if (target) target.focus({ preventScroll: true });
    } else if (keepHead && keepHead.lane) {
      const selector = keepHead.act === "lane-btn"
        ? ".lane-btn"
        : `[data-act="${keepHead.act}"]`;
      const target = framesGrid.querySelector(`[data-lane="${keepHead.lane}"] ${selector}`);
      if (target) target.focus({ preventScroll: true });
    } else if (keepTree && framesTree) {
      const target = keepTree.lane
        ? framesTree.querySelector(`[data-tree-lane="${keepTree.lane}"]`)
        : keepTree.free
          ? framesTree.querySelector(`[data-tree-free="${keepTree.free}"]`)
          : keepTree.frame
            ? framesTree.querySelector(`[data-tree-frame="${keepTree.frame}"]`)
            : framesTree.querySelector(".fs-all");
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
    if (S.activeFree) {
      const freeTarget = framesGrid.querySelector(`[data-free="${S.activeFree}"] .frame-card`);
      if (freeTarget) {
        freeTarget.focus({ preventScroll: true });
        return;
      }
    }
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
      filterMode = "all";
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
      if (S.laneKey !== laneKey || S.activeFree) selectLane(laneKey);
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
      if (S.laneKey !== laneKey || S.activeFree) selectLane(laneKey);
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

  function chooseFreeCard(freeKey) {
    if (!S.freeFrames[freeKey]) return;
    S.copyArmed = false;
    store.patch(() => {
      S.framesView = false;
      if (!S.freeFrames[freeKey].visible) toggleFreeFrameVisibility(S.freeFrames[freeKey]);
      selectFreeFrame(freeKey);
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

  if (framesFilters) {
    framesFilters.addEventListener("click", (e) => {
      const btn = e.target.closest(".frames-filter");
      if (!btn || !btn.dataset.filter) return;
      if (filterMode === btn.dataset.filter) return;
      filterMode = btn.dataset.filter;
      renderGrid();
    });
  }

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
      if (e.key !== "Escape" || !S.framesView) return;
      if (pendingFreeDelete !== null) {
        const fk = pendingFreeDelete;
        pendingFreeDelete = null;
        e.preventDefault();
        e.stopPropagation();
        renderGrid();
        reportNote(`delete ${freeFrameName(fk)} cancelled`);
        return;
      }
      if (pendingDelete === null) return;
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

  function setFreeFrameVis(freeKey, visible) {
    const ff = S.freeFrames[freeKey];
    if (!ff || ff.visible === visible) return;
    store.patch(() => toggleFreeFrameVisibility(ff));
  }

  return {
    framesBtn,
    isOpen,
    close,
    render: () => renderGrid(),
    selectFrame,
    chooseCard,
    chooseFreeCard,
    setFrameVis,
    setFreeFrameVis,
    focusButton: () => (S.framesView ? document.getElementById("lanesBtn")?.focus() : framesBtn.focus()),
  };
}
