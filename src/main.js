import {
  FRAME_NAMES,
  OPSYM,
  S,
  SIZES,
  SLOT_KEYS,
  bigToReg,
  curSlot,
  editKey,
  editReg,
  focusEditable,
  focusKey,
  focusReg,
  frameLabel,
  frameName,
  isArith,
  laneLabel,
  nibAt,
  nibCount,
  nibValue,
  nibWeightPow,
  regOf,
  regToBig,
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

(() => {
  "use strict";

  /* ══════════════════════════════════════════════════════════
     APP SHELL — DOM, canvas, input and renderers.
     The mutable state tree lives in `src/state/instrument.ts`;
     writes in `commit()` run inside the `src/state/store.ts`
     transaction. Rendering still lives here until the F2
     render/ui split.
     ══════════════════════════════════════════════════════════ */

  const DEMO = { cols: [], rows: [], i: 0 };
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

  function buildSpline(xs, ys) {
    const n = xs.length;
    const h = new Array(n - 1);
    const d = new Array(n - 1);
    const m = new Array(n);

    for (let i = 0; i < n - 1; i++) {
      h[i] = xs[i + 1] - xs[i];
      d[i] = h[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / h[i];
    }

    m[0] = 0;
    m[n - 1] = 0;

    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) {
        m[i] = 0;                                     // local extremum → level off
      } else {
        const w1 = 2 * h[i] + h[i - 1];               // Fritsch–Butland weighting
        const w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    return { xs, ys, m, h, n };
  }

  function evalSpline(sp, x) {
    const { xs, ys, m, h, n } = sp;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];

    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;

    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;

    return (2 * t3 - 3 * t2 + 1) * ys[i]
         + (t3 - 2 * t2 + t) * h[i] * m[i]
         + (-2 * t3 + 3 * t2) * ys[i + 1]
         + (t3 - t2) * h[i] * m[i + 1];
  }

  /* ══════════════════════════════════════════════════════════
     RENDER — canvas
     ══════════════════════════════════════════════════════════ */

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
      { key: "a", t: frameName(S.slot, "a"), w: 1.8, dash: null, a: 0.82 },
      { key: "b", t: frameName(S.slot, "b"), w: 1.8, dash: [6, 4], a: 0.82 },
      { key: "z", t: frameName(S.slot, "z"), w: 2.5, dash: null, a: 1 },
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
      const vis = curSlot().frameVis[it.key];
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

  function drawField3d(n, sl = curSlot(), rect = G) {
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
    plate(sl.A, 1, { label: `1 \u00B7 ${fa}${colAName}` });
    plate(sl.Z, 0, { label: `128 \u00B7 ${fz} \u00B7 ${fa} ${sym} ${fb}` });
    plate(sl.B, -1, { label: `256 \u00B7 ${fb}${colBName}`, dash: [6, 4] });
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

    const ek = focusKey();
    let handleSp = null;

    if (S.view3d) {
      /* The field is self-contained: no ruler, no handles, no ∞ marker.
         Split 3-D subdivides only the canvas plot, keeping G.x0..G.x1 intact. */
      const fieldY0 = Math.min(y1 - 10, y0 + 6);
      if (S.split3d) {
        const mid = Math.floor(VW / 2);
        const splitPad = narrow ? 10 : Math.min(28, Math.max(16, Math.round(VW * 0.02)));

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, mid, VH);
        ctx.clip();
        drawField3d(n, S.slots[S.splitPair[0]], {
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
        drawField3d(n, S.slots[S.splitPair[1]], {
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
        drawField3d(n, curSlot(), { x0, x1, y0: fieldY0, y1 });
      }
      G.spA = null;
      G.spB = null;
    } else {
      drawGuides(x0, x1, y0, y1, cx, cy, yOf);
    }

    if (S.view3d) {
      /* nothing further — the field is complete */
    } else if (!S.showB) {
      const spA = spFor(S.A);
      G.spA = curSlot().frameVis.a ? spA : null;
      G.spB = null;
      if (curSlot().frameVis.a) paintCurve(spA, { width: 2.2, grad: true, glow: true });
      handleSp = ek !== "z" && curSlot().frameVis.a ? spA : null;
    } else {
      const spA = spFor(S.A);
      const spB = spFor(S.B);
      const spZ = spFor(S.Z);
      G.spA = curSlot().frameVis.a ? spA : null;
      G.spB = curSlot().frameVis.b ? spB : null;

      /* The operand you can edit outweighs its mode-mate, so the
         instrument always shows you where your hands are. */
      if (curSlot().frameVis.a) {
        paintCurve(spA, {
          width: ek === "a" ? 1.8 : 1.3,
          dash: null,
          color: `rgba(52,211,153,${ek === "a" ? 0.82 : 0.3})`,
        });
      }
      if (curSlot().frameVis.b) {
        paintCurve(spB, {
          width: ek === "b" ? 1.8 : 1.3,
          dash: [6, 4],
          color: `rgba(52,211,153,${ek === "b" ? 0.82 : 0.3})`,
        });
      }
      if (curSlot().frameVis.z) paintCurve(spZ, { width: 2.5, grad: true, glow: true });

      drawLegend(x1, y0 + 8);
      handleSp = ek === "z"
        ? null
        : ek === "b"
          ? (curSlot().frameVis.b ? spB : null)
          : (curSlot().frameVis.a ? spA : null);
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
      const v = regOf(ek).target[j];
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

  /* ══════════════════════════════════════════════════════════
     RENDER — bit strip
     ══════════════════════════════════════════════════════════ */

  const stripEl = document.getElementById("strip");
  const nibsEl = document.getElementById("nibs");
  const metaEl = document.getElementById("meta");
  const slotBadgeEl = document.getElementById("slotBadge");
  const truthEl = document.getElementById("truth");
  const hexEl = document.getElementById("hex");
  const decEl = document.getElementById("dec");
  const hexAEl = document.getElementById("hexA");
  const hexBEl = document.getElementById("hexB");
  const hexZEl = document.getElementById("hexZ");
  const popEl = document.getElementById("pop");
  const trendEl = document.getElementById("trend");

  /* The strip always shows the register you are editing. */
  function renderStrip() {
    const r = focusReg();
    const n = nibCount();
    const compact = S.compact;
    const readonly = !focusEditable();

    const midA = S.N / 2 - 1;
    const midB = S.N / 2;

    let html = "";
    for (let j = 0; j < n; j++) {
      const base = S.N - 1 - 4 * j;
      const v = nibValue(r, j);

      html += `<div class="nib" data-j="${j}"><div class="bits">`;
      for (let k = 0; k < 4; k++) {
        const b = base - k;
        const cls = [
          "bit",
          r.bits[b] ? "on" : "",
          (b === midA || b === midB) ? "mid" : "",
        ].join(" ").trim();
        html += `<i class="${cls}" data-b="${b}">${r.bits[b]}</i>`;
      }
      html += `</div>`;
      html += `<div class="hex" title="scroll to adjust this nibble">${v.toString(16).toUpperCase()}</div>`;
      html += `<div class="dec">${v}</div>`;

      /* At 256-bit density a weight under every column would collide, so
         mark every 8th nibble plus the LSB — the scale still reads, and the
         ratio between marks is always 2^32. */
      const showWt = !compact || j % 8 === 0 || j === n - 1;
      html += `<div class="wt">${showWt ? "2^" + nibWeightPow(j) : ""}</div>`;
      html += `</div>`;
    }
    nibsEl.innerHTML = html;
    stripEl.dataset.edit = frameLabel();
    stripEl.classList.toggle("is-readonly", readonly);
    stripEl.setAttribute("aria-readonly", readonly ? "true" : "false");
    syncHoverClasses();
  }

  function patchNibble(j) {
    const r = editReg();
    const el = nibsEl.querySelector(`.nib[data-j="${j}"]`);
    if (!el) return;
    const base = S.N - 1 - 4 * j;
    const cells = el.querySelectorAll(".bit");
    for (let k = 0; k < 4; k++) {
      const b = base - k;
      cells[k].textContent = r.bits[b];
      cells[k].classList.toggle("on", !!r.bits[b]);
    }
    const v = nibValue(r, j);
    el.querySelector(".hex").textContent = v.toString(16).toUpperCase();
    const dec = el.querySelector(".dec");
    if (dec) dec.textContent = v;
  }

  function syncHoverClasses() {
    const kids = nibsEl.children;
    const hotKey = focusKey();
    for (let j = 0; j < kids.length; j++) {
      kids[j].classList.toggle("hot", j === S.hoverJ && S.hoverReg === hotKey);
    }
  }

  /* ══════════════════════════════════════════════════════════
     READOUTS
     ══════════════════════════════════════════════════════════ */

  function toHexOf(r) {
    const n = nibCount();
    let s = "";
    for (let j = 0; j < n; j++) s += nibValue(r, j).toString(16).toUpperCase();
    return s;
  }

  function toDecimalOf(r) {
    let v = 0n;
    for (let b = S.N - 1; b >= 0; b--) v = (v << 1n) | BigInt(r.bits[b]);
    return v.toString();
  }

  const PAIRS = [[0, 0], [0, 1], [1, 0], [1, 1]];

  const binFn = (a, b) =>
    S.binop === "and" ? (a & b) : S.binop === "or" ? (a | b) : (a ^ b);

  /* The truth table is live data: the `n` column counts how many bit
     positions in A and B actually hold each input pair, so the four
     counts always sum to the register width. */
  function renderTruth() {
    const fa = frameName(S.slot, "a");
    const fb = frameName(S.slot, "b");
    const fz = frameName(S.slot, "z");
    /* Arithmetic has no four-row truth table: the result depends on the
       whole word through the carry/borrow, not on the bit pair. */
    if (isArith()) {
      const a = regToBig(S.A);
      const b = regToBig(S.B);
      const over = S.binop === "add"
        ? (a + b) >= (1n << BigInt(S.N))
        : a < b;
      const label = S.binop === "add" ? "carry out" : "borrow out";
      truthEl.innerHTML =
        `<div class="truth-h">${fa} ${OPSYM[S.binop]} ${fb} → ${fz}</div>` +
        `<div class="truth-grid ar">` +
        `<span class="th">${label}</span>` +
        `<span class="ct${over ? " yes" : ""}">${over ? "yes" : "no"}</span>` +
        `</div>`;
      return;
    }

    const counts = [0, 0, 0, 0];
    for (let i = 0; i < S.N; i++) {
      counts[(S.A.bits[i] << 1) | S.B.bits[i]]++;
    }

    let html = `<div class="truth-h">${fa} ${OPSYM[S.binop]} ${fb} → ${fz}</div>`;
    html += `<div class="truth-grid">`;
    html += `<span class="th">a</span><span class="th">b</span><span class="th">→</span><span class="th">n</span>`;
    for (const [a, b] of PAIRS) {
      const z = binFn(a, b);
      html += `<span>${a}</span><span>${b}</span>`;
      html += `<span class="z${z ? " on" : ""}">${z}</span>`;
      html += `<span class="ct">${counts[(a << 1) | b]}</span>`;
    }
    html += `</div>`;
    truthEl.innerHTML = html;
  }

  function updateReadouts(withDecimal = true) {
    /* The truth table is exactly the right companion to the 3-D field. */
    metaEl.classList.toggle("ab", S.showB);
    stripEl.dataset.edit = frameLabel();

    if (slotBadgeEl) {
      slotBadgeEl.hidden = !S.view3d && S.slot === "A";
      slotBadgeEl.textContent = `lane ${laneLabel(S.slot)}`;
    }

    if (S.showB) {
      hexAEl.previousElementSibling.textContent = frameName(S.slot, "a");
      hexBEl.previousElementSibling.textContent = frameName(S.slot, "b");
      hexZEl.previousElementSibling.textContent = frameName(S.slot, "z");
      popEl.previousElementSibling.textContent = `pop ${frameName(S.slot, "z")}`;
      hexAEl.textContent = toHexOf(S.A);
      hexBEl.textContent = toHexOf(S.B);
      hexZEl.textContent = toHexOf(S.Z);
      let pop = 0;
      for (let i = 0; i < S.N; i++) pop += S.Z.bits[i];
      popEl.textContent = String(pop);
      renderTruth();
    } else {
      hexEl.textContent = toHexOf(S.A);
      if (withDecimal) {
        const d = toDecimalOf(S.A);
        decEl.textContent = d;
        decEl.title = d;
      }
    }

    /* Endpoint trend of the frame being shown. */
    const r = focusReg();
    const n = nibCount();
    const diff = r.target[n - 1] - r.target[0];
    trendEl.classList.toggle("flat", diff === 0);
    trendEl.textContent = diff < 0 ? "step-down" : diff > 0 ? "step-up" : "level";
  }

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
    S.lfo.mode = lfoModeSel.value;
    if (S.lfo.on) { S.lfo.t = 0; }        // restart the shape cleanly
    syncEditUi();
  });

  lfoRateSel.addEventListener("change", () => {
    S.lfo.rate = Number(lfoRateSel.value) || 4;
    S.lfoAcc = 0;
  });

  lfoBSel.addEventListener("change", () => {
    curSlot().lfoB = lfoBSel.value;
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
    S.activePane = paneIdx === 1 ? 1 : 0;
    S.slot = S.splitPair[S.activePane];
    enableBOnSlot(curSlot());
    refreshActiveSlotUi();
  }

  function selectSlotInPane(paneIdx, key) {
    if (S.copyArmed) {
      S.copyArmed = false;
      copySlotInto(S.slot, key);
    }
    S.splitPair[paneIdx] = key;
    S.activePane = paneIdx;
    S.slot = key;
    enableBOnSlot(curSlot());
    refreshActiveSlotUi();
  }

  function selectSlot(key) {
    if (!S.slots[key]) return;
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
  }

  function setSplitMode(on) {
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
    S.copyArmed = false;
    S.view3d = !S.view3d;
    if (!S.view3d) S.split3d = false;
    if (S.view3d) enableBOnSlot(curSlot());
    refreshActiveSlotUi();
  });

  slotSeg.querySelectorAll("[data-slot]").forEach((b) => {
    b.addEventListener("click", () => selectSlot(b.dataset.slot));
  });

  splitBtn.addEventListener("click", () => setSplitMode(!(S.view3d && S.split3d)));

  copySlotBtn.addEventListener("click", () => {
    S.copyArmed = !S.copyArmed;
    syncViewUi();
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
    if (sl.frameVis[frame] !== visible) toggleFrameVisibility(sl, frame);
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
    S.copyArmed = false;
    syncViewUi();
    renderFramesPanel();
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
  function parseDelimited(text) {
    const t = text.replace(/^\uFEFF/, "");
    const nl = t.indexOf("\n");
    const head = nl === -1 ? t : t.slice(0, nl);
    const tabs = (head.match(/\t/g) || []).length;
    const commas = (head.match(/,/g) || []).length;
    const delim = tabs > commas ? "\t" : ",";

    const rows = [];
    let row = [], field = "", quoted = false;

    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (quoted) {
        if (c === '"') {
          if (t[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  const normCell = (raw) =>
    String(raw == null ? "" : raw).trim().replace(/[\s_]/g, "");

  const stripPrefix = (s) => s.replace(/^0[xX]/, "").replace(/^0[bB]/, "");

  const isToken = (s) => /^[0-9a-fA-F]+$/.test(stripPrefix(s));

  function isDataRow(cells) {
    let any = false;
    for (const c of cells) {
      const s = normCell(c);
      if (!s) continue;
      if (!isToken(s)) return false;
      any = true;
    }
    return any;
  }

  /* All-0/1 column → binary; anything with a bigger hex digit → hex. */
  function columnMode(rows, ci) {
    let sawHex = false, sawBin = false;
    for (const r of rows) {
      const s = stripPrefix(normCell(r[ci]));
      if (!s || !isToken(s)) continue;
      if (/^[01]+$/.test(s)) sawBin = true; else sawHex = true;
    }
    return sawHex ? "hex" : sawBin ? "bin" : "hex";
  }

  function cellToBits(raw, mode) {
    const s = stripPrefix(normCell(raw));
    if (!s) return null;

    if (mode === "bin") {
      if (!/^[01]+$/.test(s)) return null;
      return s.split("").map(Number);
    }
    if (!/^[0-9a-fA-F]+$/.test(s)) return null;
    const out = [];
    for (const ch of s) {
      const v = parseInt(ch, 16);
      out.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
    }
    return out;
  }

  /* MSB-first bit array into a register, right-aligned. Overflow truncates. */
  function writeBitsInto(reg, arr) {
    reg.bits.fill(0);
    for (let k = 0; k < arr.length; k++) {
      const idx = arr.length - 1 - k;
      if (idx < S.N) reg.bits[idx] = arr[k];
    }
  }

  function columnWidth(ci) {
    if (ci < 0 || ci >= DEMO.cols.length) return 0;
    const mode = columnMode(DEMO.rows, ci);
    let max = 0;
    for (const r of DEMO.rows) {
      const b = cellToBits(r[ci], mode);
      if (b && b.length > max) max = b.length;
    }
    return max;
  }

  function fitToMappedColumns() {
    let maxBits = 8;
    for (const k of SLOT_KEYS) {
      const sl = S.slots[k];
      if (sl.colA >= 0) maxBits = Math.max(maxBits, columnWidth(sl.colA));
      if (sl.colB >= 0) maxBits = Math.max(maxBits, columnWidth(sl.colB));
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
    const widths = cols.map((_, ci) => columnWidth(ci));
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
      pad: PAD,
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
