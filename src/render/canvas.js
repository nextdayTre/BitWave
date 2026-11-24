/**
 * Canvas renderer — the 2-D curve, the 3-D depth field and the legend.
 *
 * Moved out of main.js in F2. Reads the state tree; writes only the canvas
 * (and the strip's compact class). Design constants live here deliberately:
 * §5 geometry, §6 curve contract, §8 field ratios. `fitCanvas()` remains the
 * single writer of `--pad`.
 */

import { buildSpline, evalSpline } from "../core/spline.ts";
import { DEMO } from "../state/dataset.ts";
import {
  OPSYM,
  S,
  curFreeFrame,
  curLane,
  focusKey,
  frameName,
  freeFrameName,
  liveFreeFrameKeys,
  nibCount,
  nibWeightPow,
  regOf,
} from "../state/instrument.ts";
import { nibsEl, renderStrip, stripEl } from "./strip.js";

  const canvas = document.getElementById("wave");
  const ctx = canvas.getContext("2d");
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  /* Canvas can't read CSS vars directly — resolve the few it needs once
     so retheming stays a :root-only edit. */
  const ROOT = getComputedStyle(document.documentElement);
  const C_ACCENT = ROOT.getPropertyValue("--accent").trim() || "#34d399";
  const C_ACCENT_HI = ROOT.getPropertyValue("--accent-hi").trim() || "#5eead4";
  const C_ACCENT_LOW = ROOT.getPropertyValue("--accent-low").trim() || "#22c55e";
  const C_DIMMER = ROOT.getPropertyValue("--dimmer").trim() || "#3f4859";
  const C_HANDLE_HI = ROOT.getPropertyValue("--handle-hi").trim() || "#eafaf3";
  const C_LINE = ROOT.getPropertyValue("--line").trim() || "#1b212b";

  const shortCol = (s, max = 16) => {
    const t = String(s || "").trim();
    return t.length > max ? t.slice(0, max - 1) + "\u2026" : t;
  };

  /* Turn a hex token into rgba() so canvas fills stay token-driven. */
  function rgbaToken(hex, a) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  let VW = 0, VH = 0;
  let PAD = 40;                       // single gutter authority, written by fitCanvas()
  let G = { x0: 0, x1: 0, y0: 0, y1: 0, pw: 0, ph: 0, nibW: 0, nibGap: 0, spA: null, spB: null, legendHits: [] };

  function fitCanvas() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    VW = Math.max(1, Math.round(r.width));
    VH = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Keep the bit strip's gutter identical to the plot's gutter.
    // The breakpoint is DESIGN §5/§9: one 720px breakpoint, 16px at or below it.
    PAD = VW <= 720 ? 16 : 40;
    document.documentElement.style.setProperty("--pad", PAD + "px");
  }

  function strokeCurve(sp, x0, x1) {
    ctx.beginPath();
    const steps = Math.max(2, Math.ceil(x1 - x0));
    for (let s = 0; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = evalSpline(sp, x);
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function paintCurve(sp, opts) {
    const { x0, x1, y0, y1 } = G;
    if (opts.glow) {
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(52,211,153,0.14)";
      ctx.lineWidth = 9;
      strokeCurve(sp, x0, x1);
    }
    ctx.setLineDash(opts.dash || []);
    if (opts.grad) {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, C_ACCENT_HI);
      g.addColorStop(1, C_ACCENT_LOW);
      ctx.strokeStyle = g;
    } else {
      ctx.strokeStyle = opts.color;
    }
    ctx.lineWidth = opts.width;
    strokeCurve(sp, x0, x1);
    ctx.setLineDash([]);
  }

  /* Top-right legend: each entry is also a show/hide control. The eye glyph
     carries the state; a hidden frame stays listed (dimmed, crossed) so it can
     always be brought back. */
  function drawEyeGlyph(cx, cy, visible) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = visible ? "rgba(103,114,138,0.9)" : "rgba(63,72,89,0.9)";
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy);
    ctx.quadraticCurveTo(cx, cy - 5, cx + 6, cy);
    ctx.quadraticCurveTo(cx, cy + 5, cx - 6, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 1.7, 0, Math.PI * 2);
    ctx.stroke();
    if (!visible) {
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy + 4);
      ctx.lineTo(cx + 5, cy - 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLegend(x1, ly) {
    const items = [
      { key: "a", t: frameName(S.laneKey, "a"), w: 1.8, dash: null, a: 0.82 },
      { key: "b", t: frameName(S.laneKey, "b"), w: 1.8, dash: [6, 4], a: 0.82 },
      { key: "z", t: frameName(S.laneKey, "z"), w: 2.5, dash: null, a: 1 },
    ];
    ctx.font = `10px ${MONO}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const eyeW = 14;
    const lineW = 17;
    const textGap = 4;
    const itemGap = 14;
    let total = 0;
    for (const it of items) {
      total += eyeW + lineW + textGap + ctx.measureText(it.t).width + itemGap;
    }

    let lx = x1 - total;
    const hits = [];
    for (const it of items) {
      const vis = curLane().frameVis[it.key];
      drawEyeGlyph(lx + 7, ly, vis);
      ctx.save();
      ctx.setLineDash(it.dash || []);
      ctx.lineWidth = it.w;
      ctx.strokeStyle = `rgba(52,211,153,${vis ? it.a : 0.18})`;
      ctx.beginPath();
      ctx.moveTo(lx + eyeW, ly);
      ctx.lineTo(lx + eyeW + lineW, ly);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = vis ? C_DIMMER : "rgba(63,72,89,0.55)";
      ctx.fillText(it.t, lx + eyeW + lineW + textGap, ly);

      const itemW = eyeW + lineW + textGap + ctx.measureText(it.t).width + itemGap;
      hits.push({ x: lx - 4, y: ly - 10, w: itemW + 4, h: 20, key: it.key });
      lx += itemW;
    }
    G.legendHits = hits;
  }

  /* ══════════════════════════════════════════════════════════
     3-D FIELD
     The two operands sit at the far and near ends of a wavetable —
     frame 1 and frame 256 — and the operation's result is the middle
     frame, 128. Three planes in axonometric projection, not 256
     animated frames: the depth axis exists to show the relationship
     between the inputs and the result, not to imply morphing.
     ══════════════════════════════════════════════════════════ */

  function drawField3d(n, sl = curLane(), rect = G) {
    const AX = rect.x0, BX = rect.x1, AY = rect.y0, BY = rect.y1;
    const paneW = Math.max(20, BX - AX);
    const ph = Math.max(20, BY - AY);
    /* Aspect-clamp box width so ultra-wide screens do not flatten the depth
       angle, while preserving the exact 0.58 / 0.48 / 0.14 / 0.155 ratios. */
    const pw = Math.min(paneW, ph * 2.45);
    /* Shift cx slightly right so near.left and far.right have equal margins. */
    const cx = (AX + BX) / 2 + pw * 0.029;
    const cy = (AY + BY) / 2;

    /* The planes must be meaningfully smaller than the offset between them,
       or three similar waveforms collapse into one blob. */
    const iw = pw * 0.58, ih = ph * 0.48;    // middle plane
    const dx = pw * 0.14, dy = ph * 0.155;   // depth offset per frame step

    // d = +1 is the far frame, 0 the middle, -1 the near frame.
    /* Appearance is a MONOTONIC function of depth — farther is dimmer and
       thinner — because that is the only cue that actually reads as depth.
       A highlight on one plane inverts the order and flattens the box. */
    const plane = (d) => {
      const s = 1 - d * 0.10;
      const c = (1 - d) / 2;                    // closeness: far 0 → near 1
      return {
        w: iw * s, h: ih * s,
        ox: cx + d * dx, oy: cy - d * dy,
        alpha: 0.30 + 0.55 * c,
        width: 1.1 + 0.9 * c,
        edge: 0.05 + 0.08 * c,
      };
    };

    /* Volume edges first, so they sit behind every plane. The projection is
       linear in d, so the middle plane's corner lies exactly on the line
       between the outer two — one stroke spans all three. */
    const far = plane(1);
    const near = plane(-1);
    ctx.strokeStyle = rgbaToken(C_ACCENT, 0.10);
    ctx.lineWidth = 1;
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(far.ox + sx * far.w, far.oy + sy * far.h);
        ctx.lineTo(near.ox + sx * near.w, near.oy + sy * near.h);
        ctx.stroke();
      }
    }

    const plate = (reg, d, o) => {
      const p = plane(d);
      const left = p.ox - p.w / 2;
      const top = p.oy - p.h / 2;
      const bottom = p.oy + p.h / 2;

      /* Outline only. Translucent rectangle fills stack additively wherever
         the planes overlap, so the intersections light up and the box reads
         as flat stacked panels rather than as one volume. */
      ctx.strokeStyle = rgbaToken(C_ACCENT, p.edge);
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, p.w, p.h);

      const xs = new Array(n);
      const ys = new Array(n);
      for (let j = 0; j < n; j++) {
        xs[j] = left + ((j + 0.5) / n) * p.w;
        ys[j] = bottom - (reg.anim[j] / 15) * p.h;
      }
      const sp = buildSpline(xs, ys);

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash(o.dash || []);
      ctx.strokeStyle = rgbaToken(C_ACCENT, p.alpha);
      ctx.lineWidth = p.width;
      strokeCurve(sp, left, left + p.w);
      ctx.setLineDash([]);

      ctx.font = `10px ${MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = rgbaToken(C_DIMMER, 0.50 + 0.45 * ((1 - d) / 2));
      ctx.fillText(o.label, left + 6, top + 5, Math.max(20, p.w - 12));
    };

    const showCol = DEMO.rows.length > 0 && iw >= 145;
    const colAName = showCol && sl.colA >= 0 && DEMO.cols[sl.colA] ? ` \u00B7 ${shortCol(DEMO.cols[sl.colA])}` : "";
    const colBName = showCol && sl.colB >= 0 && DEMO.cols[sl.colB] ? ` \u00B7 ${shortCol(DEMO.cols[sl.colB])}` : "";
    const sym = OPSYM[sl.binop] || "\u2295";

    const fa = frameName(sl.key, "a");
    const fb = frameName(sl.key, "b");
    const fz = frameName(sl.key, "z");
    /* Hinge: Z is the fixed middle plate. The fold swaps which operand occupies
       frame 1 (far) and frame 256 (near); the math and the Z label do not move.
       Line style follows the operand (A solid, B dashed), not the position. */
    const farFrame = sl.fold === "b-far" ? "b" : "a";
    const nearFrame = farFrame === "a" ? "b" : "a";
    const farReg = farFrame === "a" ? sl.A : sl.B;
    const nearReg = farFrame === "a" ? sl.B : sl.A;
    const farCol = farFrame === "a" ? colAName : colBName;
    const nearCol = nearFrame === "a" ? colAName : colBName;
    plate(farReg, 1, {
      label: `1 \u00B7 ${frameName(sl.key, farFrame)}${farCol}`,
      dash: farFrame === "b" ? [6, 4] : null,
    });
    plate(sl.Z, 0, { label: `128 \u00B7 ${fz} \u00B7 ${fa} ${sym} ${fb}` });
    plate(nearReg, -1, {
      label: `256 \u00B7 ${frameName(sl.key, nearFrame)}${nearCol}`,
      dash: nearFrame === "b" ? [6, 4] : null,
    });
  }

  /** Single-register 3-D depth plate for a focused free frame (D52). */
  function drawFreeField3d(n, ff, rect = G) {
    const AX = rect.x0, BX = rect.x1, AY = rect.y0, BY = rect.y1;
    const paneW = Math.max(20, BX - AX);
    const ph = Math.max(20, BY - AY);
    const pw = Math.min(paneW, ph * 2.45);
    const cx = (AX + BX) / 2;
    const cy = (AY + BY) / 2;
    const w = pw * 0.64;
    const h = ph * 0.56;
    const left = cx - w / 2;
    const top = cy - h / 2;
    const bottom = cy + h / 2;

    ctx.strokeStyle = rgbaToken(C_ACCENT, 0.16);
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, w, h);

    const xs = new Array(n);
    const ys = new Array(n);
    for (let j = 0; j < n; j++) {
      xs[j] = left + ((j + 0.5) / n) * w;
      ys[j] = bottom - (ff.reg.anim[j] / 15) * h;
    }
    const sp = buildSpline(xs, ys);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = rgbaToken(C_ACCENT, 0.16);
    ctx.lineWidth = 7;
    strokeCurve(sp, left, left + w);
    ctx.strokeStyle = rgbaToken(C_ACCENT_HI, 0.92);
    ctx.lineWidth = 2.0;
    strokeCurve(sp, left, left + w);

    const name = freeFrameName(ff.key);
    const parts = [name];
    if (ff.label) parts.push(ff.label);
    else if (DEMO.rows.length > 0 && ff.col >= 0 && DEMO.cols[ff.col]) parts.push(shortCol(DEMO.cols[ff.col]));
    if (ff.sourceNote) parts.push(ff.sourceNote);
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = rgbaToken(C_DIMMER, 0.92);
    ctx.fillText(parts.join(" \u00B7 "), left + 8, top + 6, Math.max(20, w - 16));
  }

  function drawFreeLegend(x1, ly, activeFreeKey) {
    const keys = liveFreeFrameKeys();
    if (keys.length <= 1) return;
    const items = keys.map((k) => {
      const ff = S.freeFrames[k];
      return {
        freeKey: k,
        t: ff.label ? `${freeFrameName(k)}·${shortCol(ff.label, 10)}` : freeFrameName(k),
        active: k === activeFreeKey,
        vis: ff.visible,
      };
    });
    ctx.font = `10px ${MONO}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const eyeW = 14;
    const lineW = 12;
    const textGap = 4;
    const itemGap = 12;
    let total = 0;
    for (const it of items) {
      total += eyeW + lineW + textGap + ctx.measureText(it.t).width + itemGap;
    }
    let lx = Math.max(G.x0, x1 - total);
    const hits = [];
    for (const it of items) {
      drawEyeGlyph(lx + 7, ly, it.vis);
      ctx.save();
      ctx.setLineDash(it.active ? [] : [4, 4]);
      ctx.lineWidth = it.active ? 2.2 : 1.4;
      ctx.strokeStyle = `rgba(52,211,153,${it.vis ? (it.active ? 0.95 : 0.45) : 0.16})`;
      ctx.beginPath();
      ctx.moveTo(lx + eyeW, ly);
      ctx.lineTo(lx + eyeW + lineW, ly);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = it.vis ? (it.active ? C_HANDLE_HI : C_DIMMER) : "rgba(63,72,89,0.55)";
      ctx.fillText(it.t, lx + eyeW + lineW + textGap, ly);
      const itemW = eyeW + lineW + textGap + ctx.measureText(it.t).width + itemGap;
      hits.push({ x: lx - 4, y: ly - 10, w: itemW + 4, h: 20, freeKey: it.freeKey });
      lx += itemW;
    }
    G.legendHits = hits;
  }

  /* Ruler, zero-crossing level and the ∞ axis. Drawn after the depth stack
     (so the stack cannot erase them) but before the curves. */
  function drawGuides(x0, x1, y0, y1, cx, cy, yOf) {
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of [0, 4, 8, 12, 15]) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillStyle = C_DIMMER;
      ctx.fillText(v.toString(16).toUpperCase(), x0 - 9, y);
    }

    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = "rgba(245,181,68,0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(cy) + 0.5);
    ctx.lineTo(x1, Math.round(cy) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(245,181,68,0.10)";
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, y0);
    ctx.lineTo(Math.round(cx) + 0.5, y1);
    ctx.stroke();
  }

  function draw() {
    if (!VW || !VH) return;

    const padX = PAD;                   // read the gutter; never recompute it here (§10.4)
    const narrow = padX < 40;
    const padT = 34;
    const padB = 26;

    const x0 = padX;
    const x1 = Math.max(x0 + 10, VW - padX);
    const y0 = padT;
    const y1 = Math.max(y0 + 10, VH - padB);
    const pw = x1 - x0;
    const ph = y1 - y0;

    G.x0 = x0; G.x1 = x1; G.y0 = y0; G.y1 = y1; G.pw = pw; G.ph = ph;

    /* Column geometry — computed once here and pushed to the strip,
       so every control point sits dead centre over its bit cells. */
    const n = nibCount();
    const nibGap = Math.max(1.5, Math.min(12, (pw / n) * 0.16));
    const nibW = (pw - (n - 1) * nibGap) / n;
    G.nibW = nibW;
    G.nibGap = nibGap;
    const gapPx = nibGap.toFixed(2) + "px";
    if (nibsEl.style.gap !== gapPx) nibsEl.style.gap = gapPx;

    /* Below ~46px per nibble the four bit glyphs stop being legible,
       so drop to a hex-only strip rather than overlapping digits.
       The weight row thins out, so the strip must re-render on change. */
    const compact = pw / n < 46;
    if (S.compact !== compact) {
      S.compact = compact;
      stripEl.classList.toggle("compact", compact);
      renderStrip();
    }

    const yOf = (v) => y1 - (v / 15) * ph;
    const cx = (x0 + x1) / 2;
    const cy = yOf(7.5);

    ctx.clearRect(0, 0, VW, VH);
    G.legendHits = [];

    /* control points — these mirror the bit strip's nibble groups */
    const xs = new Array(n);
    for (let j = 0; j < n; j++) xs[j] = x0 + j * (nibW + nibGap) + nibW / 2;

    const spFor = (r) => buildSpline(xs, r.anim.map(yOf));

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const ff = curFreeFrame();
    const ek = ff ? "a" : focusKey();
    let handleSp = null;

    if (S.view3d) {
      /* The field is self-contained: no ruler, no handles, no ∞ marker.
         Split 3-D subdivides only the canvas plot, keeping G.x0..G.x1 intact. */
      const fieldY0 = Math.min(y1 - 10, y0 + 6);
      if (ff) {
        drawFreeField3d(n, ff, { x0, x1, y0: fieldY0, y1 });
      } else if (S.split3d) {
        const mid = Math.floor(VW / 2);
        const splitPad = narrow ? 10 : Math.min(28, Math.max(16, Math.round(VW * 0.02)));

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, mid, VH);
        ctx.clip();
        drawField3d(n, S.lanes[S.splitPair[0]], {
          x0: splitPad,
          x1: Math.max(splitPad + 20, mid - splitPad),
          y0: fieldY0,
          y1,
        });
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(mid + 1, 0, VW - mid - 1, VH);
        ctx.clip();
        drawField3d(n, S.lanes[S.splitPair[1]], {
          x0: mid + 1 + splitPad,
          x1: Math.max(mid + 21 + splitPad, VW - splitPad),
          y0: fieldY0,
          y1,
        });
        ctx.restore();

        ctx.strokeStyle = C_LINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mid + 0.5, 0);
        ctx.lineTo(mid + 0.5, VH);
        ctx.stroke();
      } else {
        drawField3d(n, curLane(), { x0, x1, y0: fieldY0, y1 });
      }
      G.spA = null;
      G.spB = null;
    } else {
      drawGuides(x0, x1, y0, y1, cx, cy, yOf);
    }

    if (S.view3d) {
      /* nothing further — the field is complete */
    } else if (ff) {
      /* Overlay any other visible free frames in subtle dashed lines for chain comparison. */
      for (const otherKey of liveFreeFrameKeys()) {
        if (otherKey === ff.key) continue;
        const other = S.freeFrames[otherKey];
        if (!other.visible) continue;
        paintCurve(spFor(other.reg), {
          width: 1.35,
          dash: [5, 4],
          color: "rgba(52,211,153,0.34)",
        });
      }
      const spF = spFor(ff.reg);
      G.spA = ff.visible ? spF : null;
      G.spB = null;
      if (ff.visible) paintCurve(spF, { width: 2.2, grad: true, glow: true });
      drawFreeLegend(x1, y0 + 8, ff.key);
      handleSp = ff.visible ? spF : null;
    } else if (!S.showB) {
      const spA = spFor(S.A);
      G.spA = curLane().frameVis.a ? spA : null;
      G.spB = null;
      if (curLane().frameVis.a) paintCurve(spA, { width: 2.2, grad: true, glow: true });
      handleSp = ek !== "z" && curLane().frameVis.a ? spA : null;
    } else {
      const spA = spFor(S.A);
      const spB = spFor(S.B);
      const spZ = spFor(S.Z);
      G.spA = curLane().frameVis.a ? spA : null;
      G.spB = curLane().frameVis.b ? spB : null;

      /* The operand you can edit outweighs its mode-mate, so the
         instrument always shows you where your hands are. */
      if (curLane().frameVis.a) {
        paintCurve(spA, {
          width: ek === "a" ? 1.8 : 1.3,
          dash: null,
          color: `rgba(52,211,153,${ek === "a" ? 0.82 : 0.3})`,
        });
      }
      if (curLane().frameVis.b) {
        paintCurve(spB, {
          width: ek === "b" ? 1.8 : 1.3,
          dash: [6, 4],
          color: `rgba(52,211,153,${ek === "b" ? 0.82 : 0.3})`,
        });
      }
      if (curLane().frameVis.z) paintCurve(spZ, { width: 2.5, grad: true, glow: true });

      drawLegend(x1, y0 + 8);
      handleSp = ek === "z"
        ? null
        : ek === "b"
          ? (curLane().frameVis.b ? spB : null)
          : (curLane().frameVis.a ? spA : null);
    }

    /* handles — only on the operand you can actually edit */
    const dense = n > 32;
    for (let j = 0; handleSp && j < n; j++) {
      const active =
        (S.drag === j && S.hoverReg === ek) ||
        (S.drag < 0 && S.hoverReg === ek && S.hoverJ === j);
      if (!active && dense) continue;

      const x = xs[j];
      const y = handleSp.ys[j];
      const r = active ? 4.4 : 2.5;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = active ? C_HANDLE_HI : "rgba(52,211,153,0.8)";
      ctx.fill();

      if (active) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(52,211,153,0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    /* In 3-D there is nothing to hover: the field is read-only.
       Returning here also skips the ∞ marker, which the field replaces. */
    if (S.view3d) return;

    /* Hover readout — the nibble's quantitative potential at its position:
       value × 2^weight. At the LSB this reads "n × 2^0", i.e. just n. */
    if (S.hoverJ >= 0 && S.hoverReg === ek && handleSp) {
      const j = S.hoverJ;
      const v = (ff ? ff.reg : regOf(ek)).target[j];
      const txt = `${v} \u00D7 2^${nibWeightPow(j)}`;
      const hx = Math.min(x1 - 44, Math.max(x0 + 44, xs[j]));
      const hy = Math.max(y0 + 13, handleSp.ys[j] - 15);

      ctx.font = `10px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = C_HANDLE_HI;
      ctx.fillText(txt, hx, hy);
      ctx.textAlign = "left";
    }

    /* ∞ marker */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245,181,68,0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(245,181,68,0.95)";
    ctx.fill();

    ctx.font = `600 14px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(245,181,68,0.85)";
    ctx.fillText("∞", cx + 14, cy);
    ctx.restore();
  }

export { canvas as canvasEl, G, fitCanvas, draw, shortCol };
export const getPad = () => PAD;
export const getViewport = () => ({ width: VW, height: VH });
