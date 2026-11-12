import {
  FRAME_NAMES,
  OPSYM,
  S,
  SIZES,
  SLOT_KEYS,
  curSlot,
  editKey,
  editReg,
  focusEditable,
  focusKey,
  frameName,
  laneLabel,
  nibAt,
  nibCount,
  nibValue,
  regOf,
  setNibAt,
  syncTarget,
} from "./state/instrument.ts";
import {
  applyPreset,
  copyLane,
  setBinop,
  setFocus,
  setLiveNibble,
  setNibble,
  toggleBit,
  unpair,
} from "./state/actions.ts";
import { evaluate } from "./state/routing.ts";
import { createStore } from "./state/store.ts";

import { DEMO } from "./state/dataset.ts";
import {
  bindData,
  bindExpression,
  bindFrame,
  bindNone,
  isFocusDriven,
  isInputDriven,
  listInputs,
  remapParkedBases,
  updateParkedBase,
} from "./state/bindings.ts";
import { readLog } from "./state/record.ts";
import { createFrameNavigator } from "./ui/frame-navigator.js";
import { createStageBar } from "./ui/stage-bar.js";
import { attachKeyboard } from "./ui/keyboard.js";
import { createControls } from "./ui/controls.js";
import { createCsvImport } from "./ui/csv-import.js";
import { createSourceTable } from "./ui/source-table.js";
import { createRecordUI } from "./ui/record.js";
import { createLiveStatus } from "./ui/live-status.js";
import { createCopyMenu } from "./ui/copy-menu.js";
import { createHelpPanel } from "./ui/help.js";
import { createAgentPanel } from "./ui/agent-panel.js";
import { createAgentBridge } from "./agent/bridge.js";
import { createProjectMenu } from "./ui/project-menu.js";
import { setObservationStatus } from "./io/observations.js";
import { createAutosave } from "./io/autosave.js";
import { createShareUrl } from "./io/share-url.js";
import { downloadProject, readProjectFile } from "./io/project-file.js";
import { applyProject, captureProject, rememberUnknownFields } from "./state/project-bridge.ts";
import { evalSpline } from "./core/spline.ts";
import { frameRefFromName } from "./core/agent-defaults.ts";
import { G, canvasEl as canvas, draw, fitCanvas, getPad, shortCol } from "./render/canvas.js";
import { focusNibble, nibsEl, patchNibble, renderStrip, syncHoverClasses } from "./render/strip.js";
import { toHexOf, updateReadouts } from "./render/readouts.js";

(() => {
  "use strict";

  /* ══════════════════════════════════════════════════════════
     COMPOSITION ROOT + CONTROLLERS
     Wires the store, renderers and UI modules together; keeps the
     pointer input, lane/view orchestration, boot loop and agent
     surface. Everything else lives under state/, render/, ui/ and io/.
     ══════════════════════════════════════════════════════════ */

  const store = createStore(S);

  /* DESIGN §7: under `prefers-reduced-motion: reduce` commits are instant and
     the LFO is capped. The preference is read live so a change applies without
     a reload. */
  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* One polite, atomic live region for committed changes (DESIGN §8/§10.34). */
  const liveStatus = createLiveStatus(store);

  /* F5 — persistence & reach. `?fresh` opens an ephemeral instrument: it never
     reads or writes the autosave/share state (a throwaway session or a check). */
  const freshSession = new URLSearchParams(location.search).has("fresh");
  const autosave = createAutosave(store, { enabled: !freshSession });
  const share = createShareUrl({ allow: !freshSession });
  let bootProjectDoc = null;

  const csvStatusEl = document.getElementById("csvStatus");
  function setSourceStatus(text, isError = false) {
    if (!csvStatusEl) return;
    csvStatusEl.textContent = text;
    csvStatusEl.classList.toggle("is-error", Boolean(isError));
  }

  /* Keyboard map panel — the one declared shortcut surface (F4 IA). It also
     houses the agent bridge tab (agent layer, additive); the panel stays closed
     by default so the default rendered instrument is unchanged. */
  let agentPanel = null;
  const help = createHelpPanel({
    panel: document.getElementById("helpPanel"),
    button: document.getElementById("helpBtn"),
    closeButton: document.getElementById("helpClose"),
    onTabChange: (tab) => {
      if (tab === "agent" && agentPanel) agentPanel.refresh();
    },
  });

  const controls = createControls({
    store,
    resizeRegister,
    commit,
    renderStrip,
    updateReadouts,
    syncViewUi,
    applyExample: (...args) => csv.applyExample(...args),
  });

  /* Grow / shrink around the centre: the outermost nibbles on each side
     stay pinned and new nibbles appear at the ∞ point. All three display
     slots remap together before S.N changes. */
  function resizeRegister(newN) {
    if (newN === S.N) return;
    store.patch(() => {
      controls.lfoStop();                     // its snapshot belongs to the old width

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

      remapParkedBases(oldN, newN);
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

  function commit(instant = false) {
    /* One transaction boundary: base writes, then the clocked evaluation
       (routes in dependency order, then every lane's Z), then renderers.
       Reduced motion makes every eased transition instant. */
    if (prefersReducedMotion()) instant = true;
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
    if (isFocusDriven()) return;     // a routed input has no local edit
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;

    store.patch(() => {
      if (S.drag < 0) {
        controls.lfoStop();
        const j = nearestNibble(px);
        if (j < 0) return;
        S.drag = j;
        S.hoverReg = nearestReg(px, py);
        S.hoverJ = j;
        setFocus(curSlot(), S.hoverReg);
        controls.syncEditUi();
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
        frameNav.setFrameVis(S.slot, hit, !curSlot().frameVis[hit]);
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
    liveStatus.announceNow();            // one announcement per drag, not per move
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

  /* bit strip: click a bit to flip it, click the nibble body to focus its
     spinbutton (which also keeps focus out of <body> — DESIGN §10.33). */
  nibsEl.addEventListener("click", (e) => {
    const nib = e.target.closest(".nib");
    const bit = e.target.closest(".bit");
    if (!bit) {
      if (nib && focusEditable() && !isFocusDriven()) nib.focus();
      return;
    }
    if (!focusEditable()) return;   // Z is derived — never editable
    if (isFocusDriven()) return;    // a routed input has no local edit
    controls.lfoStop();
    store.patch(() => {
      const j = toggleBit(editReg(), Number(bit.dataset.b));
      evaluate();
      patchNibble(j);
      updateReadouts();
    });
    if (nib) nib.focus();
  });

  /* Keyboard editing (DESIGN §6): the strip is the semantic editor.
     ↑/↓ ±1 · ←/→ move nibble focus · Home/End first/last · 0–F set the digit.
     Handled keys stop propagation so the global ←/→ CSV stepper does not also
     fire; a manual edit also yields the LFO snapshot (DESIGN §10.19). */
  nibsEl.addEventListener("keydown", (e) => {
    if (!focusEditable() || isFocusDriven()) return;
    const nib = e.target.closest(".nib");
    if (!nib) return;
    const j = Number(nib.dataset.j);
    if (!Number.isInteger(j)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      focusNibble(j + (e.key === "ArrowRight" ? 1 : -1));
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      focusNibble(e.key === "Home" ? 0 : nibCount() - 1);
      return;
    }

    let next = null;
    if (e.key === "ArrowUp") next = nibValue(editReg(), j) + 1;
    else if (e.key === "ArrowDown") next = nibValue(editReg(), j) - 1;
    else if (/^[0-9a-f]$/i.test(e.key)) next = parseInt(e.key, 16);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (next < 0 || next > 15) return;          // clamped 0–F, no wrap

    const reg = editReg();
    if (nibValue(reg, j) === next) return;
    controls.lfoStop();
    store.patch(() => {
      setNibble(reg, j, next);
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
    if (isFocusDriven()) return;        // a routed input has no local edit
    const hexEl = e.target.closest(".hex");
    if (!hexEl) return;
    const nib = hexEl.closest(".nib");
    if (!nib) return;
    const j = Number(nib.dataset.j);
    if (!Number.isInteger(j)) return;

    e.preventDefault();
    controls.lfoStop();
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

  /* ══════════════════════════════════════════════════════════
     OPS — all unary ops act on the register you are editing.
     The implementations live in src/core/ops.ts and run through
     src/state/actions.ts; the render module only calls them.
     ══════════════════════════════════════════════════════════ */

  function unpairB() {
    if (S.view3d) return;
    const sl = curSlot();
    if (!sl.showB) return;
    controls.lfoStop();
    store.patch(() => {
      if (isInputDriven(sl, "b")) bindNone(sl, "b");
      unpair(sl);
      S.hoverReg = null;
      S.hoverJ = -1;
      controls.syncEditUi();
      syncViewUi();
      evaluate();
      renderStrip();
      updateReadouts();
    });
    if (frameNav.isOpen()) frameNav.render(S.slot);
    else frameNav.focusButton();
  }

  const binopBtns = [...document.querySelectorAll("[data-binop]")];
  const binopSet = document.getElementById("binopSet");

  /* The UI disables derive while operand B is absent; a bridge setter still
     records the operator (it is lane state, and Z uses it once B exists), and
     agent calls never steal keyboard focus. */
  function chooseBinop(op, { force = false, focus = true } = {}) {
    if (!S.showB && !force) return;  // reserved-space: disabled until B exists
    store.patch(() => {
      setBinop(curSlot(), op);
      controls.syncEditUi();
      syncViewUi();
      evaluate();
      updateReadouts();
    });
    if (focus) binopSet.querySelector(`[data-binop="${op}"]`)?.focus();
  }

  binopBtns.forEach((b) => {
    b.addEventListener("click", () => chooseBinop(b.dataset.binop));
  });

  /* Radiogroup keyboard model for derive: arrows move the operation, Home/End
     jump to the ends, and only the checked radio is in the tab order. */
  binopSet.addEventListener("keydown", (e) => {
    if (!S.showB) return;
    const keys = binopBtns.map((b) => b.dataset.binop);
    let next = keys.indexOf(S.binop);
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (next + keys.length - 1) % keys.length;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (next + 1) % keys.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = keys.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    chooseBinop(keys[next]);
  });

  /* ══════════════════════════════════════════════════════════
     LANE — 2-D canvas, lanes 1/2/3 & parallel 3-D split
     ══════════════════════════════════════════════════════════ */

  const depthBtn = document.getElementById("depthBtn");
  const foldBtn = document.getElementById("foldBtn");
  const copySlotBtn = document.getElementById("copySlotBtn");
  const frameNav = createFrameNavigator({
    store,
    selectSlot,
    enableBOnSlot,
    syncEditUi: (...args) => controls.syncEditUi(...args),
    syncViewUi,
    renderStrip,
    updateReadouts,
    unpairB,
    slotExprText,
  });

  const stageBar = createStageBar({
    element: document.getElementById("stageBar"),
    framesBtn: document.getElementById("framesBtn"),
    selectSlot,
    selectSlotInPane,
    setSplitMode,
    focusSplitPane,
    slotExprText,
  });

  /* Explicit copy menu — focus moves in, Esc/outside closes, and the live
     status reports the copy in words (F4 IA). */
  const copyMenu = createCopyMenu({
    store,
    button: copySlotBtn,
    onCopy: (srcKey, dstKey) => {
      copySlotInto(srcKey, dstKey);
      liveStatus.say(`copied lane ${laneLabel(srcKey)} → lane ${laneLabel(dstKey)}`);
    },
  });
  const hintEl = document.getElementById("hint");

  /* F5 — project document menu: save, open, reset (explicit, focus-in menu). */
  const projectMenu = createProjectMenu({
    button: document.getElementById("projectBtn"),
    items: [
      {
        label: "save project",
        title: "Download this instrument as a .bitwave file",
        onSelect: () => saveProjectFile(),
      },
      {
        label: "open project…",
        title: "Open a .bitwave project file",
        onSelect: () => openProjectFile(),
      },
      {
        label: "reset instrument",
        title: "Clear autosave and share link and return to the boot state",
        onSelect: () => resetInstrument(),
      },
    ],
  });

  const projectFileInput = document.getElementById("projectFile");
  projectFileInput.addEventListener("change", async () => {
    const file = projectFileInput.files && projectFileInput.files[0];
    if (!file) return;
    projectFileInput.value = "";
    let text;
    try {
      text = await readProjectFile(file);
    } catch {
      setSourceStatus(`could not read ${file.name}`, true);
      return;
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      setSourceStatus(`could not open ${file.name}: not a JSON document`, true);
      return;
    }
    if (applyLoadedProject(raw, file.name)) share.start();
  });

  function slotExprText(sl, withViewPrefix) {
    const hasCsv = DEMO.rows.length > 0;
    const lhs = hasCsv && sl.colA >= 0 && DEMO.cols[sl.colA] ? shortCol(DEMO.cols[sl.colA], 14) : frameName(sl.key, "a");
    const rhs = hasCsv && sl.colB >= 0 && DEMO.cols[sl.colB] ? shortCol(DEMO.cols[sl.colB], 14) : frameName(sl.key, "b");
    const sym = OPSYM[sl.binop] || "\u2295";
    const prefix = withViewPrefix ? `LANE ${laneLabel(sl.key)} \u00B7 ` : "";
    return `${prefix}${lhs} ${sym} ${rhs} \u2192 ${frameName(sl.key, "z")}`;
  }

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
    if (isInputDriven(sl, "b")) updateParkedBase(sl, "b", sl.B.bits);
    evaluate(true);
  }

  function copySlotInto(srcKey, dstKey) {
    if (srcKey === dstKey) return;
    controls.lfoStop();
    const src = S.slots[srcKey];
    const dst = S.slots[dstKey];
    store.patch(() => {
      copyLane(src, dst);
      syncTarget(dst.A, true);
      syncTarget(dst.B, true);
      if (isInputDriven(dst, "a")) updateParkedBase(dst, "a", dst.A.bits);
      if (isInputDriven(dst, "b")) updateParkedBase(dst, "b", dst.B.bits);
      evaluate(true);
    });
  }

  function refreshActiveSlotUi() {
    S.hoverReg = null;
    S.hoverJ = -1;
    controls.syncEditUi();
    syncViewUi();
    csv.renderUi();
    renderStrip();
    updateReadouts();
  }

  function focusSplitPane(paneIdx) {
    store.patch(() => {
      S.activePane = paneIdx === 1 ? 1 : 0;
      S.slot = S.splitPair[S.activePane];
      enableBOnSlot(curSlot());
      refreshActiveSlotUi();
    });
  }

  function selectSlotInPane(paneIdx, key) {
    if (S.copyArmed) copyMenu.close(false);
    store.patch(() => {
      S.splitPair[paneIdx] = key;
      S.activePane = paneIdx;
      S.slot = key;
      enableBOnSlot(curSlot());
      refreshActiveSlotUi();
    });
  }

  function selectSlot(key) {
    if (!S.slots[key]) return;
    if (S.copyArmed) copyMenu.close(false);
    store.patch(() => {
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
    });
  }

  function setSplitMode(on) {
    if (S.copyArmed) copyMenu.close(false);
    store.patch(() => {
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
    });
  }

  function syncViewUi() {
    depthBtn.setAttribute("aria-pressed", String(S.view3d));
    depthBtn.classList.toggle("on", S.view3d);
    depthBtn.title = S.view3d
      ? "Return to the 2D register view"
      : "Show the depth field: operands at frame 1 and 256, the result at 128";
    /* Hinge is a 3-D presentation lens: Z stays the middle plate; this swaps
       which operand is far vs near. It is intentionally session state only. */
    const fold = curSlot().fold;
    foldBtn.hidden = !S.view3d;
    foldBtn.textContent = fold === "a-far" ? "A far" : "B far";
    foldBtn.setAttribute(
      "aria-label",
      S.view3d
        ? `3-D hinge: ${fold === "a-far" ? "A far, B near" : "B far, A near"}; press to swap`
        : "3-D hinge",
    );
    foldBtn.title = S.view3d
      ? `Hinge: ${fold === "a-far" ? "A far, B near" : "B far, A near"} — press to swap the wings`
      : "Show the 3-D field to change the hinge";
    const isSplit = S.view3d && S.split3d;
    canvas.classList.toggle("readonly", S.view3d && !S.split3d);
    canvas.classList.toggle("split-view", isSplit);
    hintEl.hidden = S.view3d;
    stageBar.sync();
  }

  depthBtn.addEventListener("click", () => {
    if (S.copyArmed) copyMenu.close(false);
    store.patch(() => {
      S.view3d = !S.view3d;
      if (!S.view3d) S.split3d = false;
      if (S.view3d) enableBOnSlot(curSlot());
      refreshActiveSlotUi();
    });
  });

  foldBtn.addEventListener("click", () => {
    if (!S.view3d) return;
    const sl = curSlot();
    store.patch(() => {
      sl.fold = sl.fold === "a-far" ? "b-far" : "a-far";
      syncViewUi();
    });
  });

  /* Bridge view setter — the same commands the depth button and split control
     run, so the API and the UI cannot disagree. Idempotent by construction. */
  function setViewMode(mode) {
    if (mode === "2d") {
      if (!S.view3d) return;
      if (S.copyArmed) copyMenu.close(false);
      store.patch(() => {
        S.view3d = false;
        S.split3d = false;
        refreshActiveSlotUi();
      });
      return;
    }
    if (mode === "3d") {
      if (S.view3d && !S.split3d) return;
      if (S.copyArmed) copyMenu.close(false);
      store.patch(() => {
        S.view3d = true;
        S.split3d = false;
        enableBOnSlot(curSlot());
        refreshActiveSlotUi();
      });
      return;
    }
    if (mode !== "split") return;
    if (S.view3d && S.split3d) return;
    if (S.copyArmed) copyMenu.close(false);
    if (!S.view3d) {
      store.patch(() => {
        S.view3d = true;
        enableBOnSlot(curSlot());
        refreshActiveSlotUi();
      });
    }
    setSplitMode(true);
  }

  /* Bridge LFO setter — mirror the motion controls' values after a patch. */
  const lfoModeSel = document.getElementById("lfoMode");
  const lfoRateSel = document.getElementById("lfoRate");
  function syncLfoUi() {
    if (lfoModeSel) lfoModeSel.value = S.lfo.mode;
    if (lfoRateSel) lfoRateSel.value = String(S.lfo.rate);
  }

  /* ── frame navigator ─────────────────────────────────────────
     Pro-Q4-style lane/frame selection: static mini-curves, active lane
     expanded, click a frame to focus it. No animation, no new state. */

  const csv = createCsvImport({
    store,
    resizeRegister,
    lfoStop: (...args) => controls.lfoStop(...args),
    frameNav,
    syncViewUi,
    renderStrip,
    updateReadouts,
    onSizeChange: (...args) => controls.setSize(...args),
    onBindingsChanged: () => sources.render(),
    onStatus: (text, isError) => setSourceStatus(text, isError),
  });
  setObservationStatus(setSourceStatus);

  const sources = createSourceTable({
    store,
    evaluate,
    applyRow: () => csv.applyExample(DEMO.i, true, true),
    fitColumns: () => csv.fitColumns(),
    syncEditUi: (...args) => controls.syncEditUi(...args),
    renderStrip,
    updateReadouts,
  });

  /* DAW-style record (EXTERNAL-ROUTING §3): one row per settled transaction,
     in memory only. Subscribed before the agent bridge installs, so
     `getState().recording` sees each new row in the same transaction pass. */
  const recordUi = createRecordUI({ store });

  /** Source write through the instrument's own commands (bridge setSource/setRoute). */
  function applySourceSource(frame, source) {
    const ref = frameRefFromName(frame);
    if (!ref || ref.frame === "z") return false;
    const sl = S.slots[ref.slotKey];
    store.patch(() => {
      if (source.kind === "none") {
        bindNone(sl, ref.frame);
      } else if (source.kind === "data") {
        bindData(sl, ref.frame, source.column);
        csv.fitColumns();
      } else {
        const [lane, frameKey] = String(source.from).split(".");
        bindFrame(sl, ref.frame, { lane, frame: frameKey });
      }
      evaluate();
      controls.syncEditUi();
      renderStrip();
      updateReadouts();
    });
    if (source.kind === "data") csv.applyExample(DEMO.i, true, true);
    return true;
  }

  /** External-routing expression write through the instrument's own commands. */
  function applyExpressionSource(frame, text) {
    const ref = frameRefFromName(frame);
    if (!ref || ref.frame === "z") return false;
    const sl = S.slots[ref.slotKey];
    store.patch(() => {
      bindExpression(sl, ref.frame, text);
      evaluate();
      controls.syncEditUi();
      renderStrip();
      updateReadouts();
    });
    if (sources.isOpen()) sources.render();
    return true;
  }

  /* Keyboard shortcuts: Alt+1/2/3 switch views, Alt+S toggles split,
     and Arrow keys step CSV examples when focus isn't in a control. */
  attachKeyboard({
    applyExample: csv.applyExample,
    loadCSV: csv.loadCSV,
    frameNav,
    syncViewUi,
    selectSlot,
    setSplitMode,
    copyMenu,
    onDropError: (name) => setSourceStatus(`could not read ${name}`, true),
    S,
    DEMO,
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
    const reduce = prefersReducedMotion();
    if (S.lfo.on) {
      S.lfoAcc += dt;
      /* Reduced motion caps the LFO rather than removing it (DESIGN §7). */
      const rate = reduce ? Math.min(4, S.lfo.rate) : S.lfo.rate;
      const interval = 1000 / rate;
      let guard = 0;
      while (S.lfoAcc >= interval && guard++ < 6) {
        S.lfoAcc -= interval;
        controls.lfoTick();
      }
    }

    for (const k of SLOT_KEYS) {
      const sl = S.slots[k];
      if (reduce) {
        /* No easing: the wave snaps to its committed state. */
        sl.A.anim = sl.A.target.slice();
        if (sl.showB) {
          sl.B.anim = sl.B.target.slice();
          sl.Z.anim = sl.Z.target.slice();
        }
      } else {
        easeReg(sl.A);
        if (sl.showB) { easeReg(sl.B); easeReg(sl.Z); }
      }
    }
    draw();
    requestAnimationFrame(loop);
  }

  /* ══════════════════════════════════════════════════════════
     PERSISTENCE & REACH (F5) — project file, autosave, share link
     ══════════════════════════════════════════════════════════ */

  /** Re-render every surface after a whole-tree replacement. */
  function refreshAfterLoad() {
    S.hoverReg = null;
    S.hoverJ = -1;
    S.drag = -1;
    controls.setSize(SIZES.indexOf(S.N));
    controls.syncEditUi();
    syncViewUi();
    csv.renderUi();
    if (frameNav.isOpen()) frameNav.render(S.slot);
    else frameNav.close(false);
    sources.render();
    renderStrip();
    updateReadouts();
    fitCanvas();
  }

  /** Apply a document through one transaction, then refresh every surface. */
  function applyLoadedProject(raw, name, { quiet = false } = {}) {
    rememberUnknownFields(raw);
    let result;
    store.patch(() => { result = applyProject(raw); });
    if (!result || !result.ok) {
      setSourceStatus(`could not open ${name}: ${result ? result.message : "invalid document"}`, true);
      return false;
    }
    refreshAfterLoad();
    if (!quiet) {
      const dataset = result.dataset
        ? ` · ${DEMO.rows.length} rows · ${DEMO.cols.length} columns`
        : " · no dataset";
      setSourceStatus(`opened ${name}${dataset}`);
    }
    return true;
  }

  function saveProjectFile() {
    const name = downloadProject();
    if (autosave.isEnabled()) autosave.saveNow();
    setSourceStatus(`saved ${name}`);
  }

  function openProjectFile() {
    projectFileInput.click();
  }

  function resetInstrument() {
    if (!bootProjectDoc) return;
    autosave.clear();
    share.clear();
    if (applyLoadedProject(bootProjectDoc, "boot state", { quiet: true })) {
      setSourceStatus("reset to the boot state");
      share.start();
    }
  }

  /** Boot priority: shared link, then autosave, then the boot defaults. */
  function restoreSession() {
    if (freshSession) {
      setSourceStatus("fresh session — autosave and sharing are off");
      return;
    }
    let shared = null;
    try { shared = share.read(); } catch { setSourceStatus("could not read the shared link", true); }
    if (shared) {
      if (applyLoadedProject(shared, "shared link", { quiet: true })) {
        setSourceStatus("restored from the shared link");
        return;
      }
    }
    const saved = autosave.load();
    if (saved) {
      if (applyLoadedProject(saved, "autosave", { quiet: true })) {
        setSourceStatus("restored from autosave");
        return;
      }
      autosave.clear();
    }
    setSourceStatus("no dataset loaded");
  }

  /* ══════════════════════════════════════════════════════════
     AGENT LAYER — window.bitwave bridge + help-panel agent tab
     Additive: installed after boot so the instrument is settled.
     ══════════════════════════════════════════════════════════ */

  /* Contract §7 automation hooks: additive data attributes on the existing
     lane buttons and frame rows. The modules that build them are untouched;
     a small observer keeps dynamically rebuilt rows labelled. */
  (function setupAgentAttributes() {
    const annotate = () => {
      const stageEl = document.getElementById("stageBar");
      if (stageEl) {
        for (const btn of stageEl.querySelectorAll("[data-slot]")) {
          const pane = btn.closest(".pane-head");
          /* Only the panes actually on screen: 2-D has one lane set, split 3-D
             has two. Duplicate hidden mirrors would confuse selector-driven
             tooling (`[data-agent-lane]` should be the three live buttons). */
          const value = pane && pane.hidden ? null : laneLabel(btn.dataset.slot);
          if (value === null) {
            if (btn.hasAttribute("data-agent-lane")) btn.removeAttribute("data-agent-lane");
          } else if (btn.getAttribute("data-agent-lane") !== value) {
            btn.setAttribute("data-agent-lane", value);
          }
        }
      }
      const rowsEl = document.getElementById("framesBody");
      if (rowsEl) {
        for (const row of rowsEl.querySelectorAll(".frame-row[data-frame]")) {
          const value = frameName(S.slot, row.dataset.frame);
          if (row.getAttribute("data-agent-frame") !== value) row.setAttribute("data-agent-frame", value);
        }
      }
    };
    const observe = (el) => {
      if (!el || typeof MutationObserver !== "function") return;
      new MutationObserver(annotate).observe(el, { childList: true, subtree: true, attributes: true });
    };
    observe(document.getElementById("stageBar"));
    observe(document.getElementById("framesBody"));
    annotate();
  })();

  function installAgentSurface() {
    const bridge = createAgentBridge({
      store,
      share,
      selectSlot,
      selectFrame: (slotKey, frame) => frameNav.selectFrame(slotKey, frame),
      setView: setViewMode,
      resizeRegister,
      setSize: (index) => controls.setSize(index),
      chooseBinop,
      lfoStart: () => controls.lfoStart(),
      lfoStop: () => controls.lfoStop(),
      syncLfoUi,
      loadCSV: (text) => csv.loadCSV(text),
      applyExample: (index) => csv.applyExample(index, true),
      resetInstrument,
      syncEditUi: () => controls.syncEditUi(),
      setExpression: applyExpressionSource,
      setSource: applySourceSource,
      startRecording: () => recordUi.start(),
      stopRecording: () => recordUi.stop(),
      skipRecordSnapshot: () => recordUi.skipNextSnapshot(),
      readLog,
    });
    bridge.install();
    agentPanel = createAgentPanel({ root: document.querySelector('[data-agent-panel="agent"]') });
    agentPanel.refresh();
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

    stageBar.build();
    controls.syncSizeLabel();
    controls.syncEditUi();
    syncViewUi();
    csv.renderUi();
    renderStrip();
    updateReadouts();

    const ro = new ResizeObserver(() => fitCanvas());
    ro.observe(canvas);
    fitCanvas();

    /* F5: remember the boot state for Reset, then restore the session. */
    bootProjectDoc = captureProject();
    restoreSession();
    share.start();

    /* Agent layer: install the bridge and the help-panel agent tab last, so
       the instrument is fully settled when the first state is captured. */
    installAgentSurface();

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
      pad: getPad(),
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

  function snapshotBindings() {
    return deepFreeze({ schema: 1, inputs: listInputs() });
  }

  if (!Object.prototype.hasOwnProperty.call(window, "BitWave")) {
    Object.defineProperty(window, "BitWave", {
      value: Object.freeze({
        schema: 1,
        artifact: "bitwave-v2.html",
        frames: snapshotFrames,
        bindings: snapshotBindings,
        state: snapshotState,
        geometry: snapshotGeometry,
      }),
      enumerable: true,
    });
  }

  boot();
})();
