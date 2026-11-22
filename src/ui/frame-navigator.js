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
import { describeInput } from "../state/bindings.ts";
import { OPSYM, liveLaneKeys, S, curLane, focusKey, frameName } from "../state/instrument.ts";
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
  const framesTree = document.getElementById("framesTree");
  const framesLaneCount = document.getElementById("framesLaneCount");
  const framesTitle = document.getElementById("framesTitle");
  const framesSub = document.getElementById("framesSub");
  const framesFilters = document.getElementById("framesFilters");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const FRAME_ORDER = ["a", "b", "z"];
  const FILTER_TITLES = {
    all: "All Frames",
    operands: "Operand Frames",
    derived: "Derived Frames",
    visible: "Visible in 2D",
  };
  /** Lane key whose delete button is showing its inline confirmation. */
  let pendingDelete = null;
  /** Transient visual filter in the frames browser (resets to "all" on open). */
  let filterMode = "all";

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const compactHex = (hex) => (hex.length > 10 ? `${hex.slice(0, 4)}\u2026${hex.slice(-4)}` : hex);

  /* ── previews ─────────────────────────────────────────────────────────── */

  function previewPoints(reg) {
    const vals = reg.target;
    if (!vals || vals.length === 0) return "";
    const w = 160;
    const h = 44;
    const pad = 4;
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
    svg.setAttribute("viewBox", "0 0 160 44");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    const mid = document.createElementNS(SVG_NS, "line");
    mid.setAttribute("class", "frame-mid");
    mid.setAttribute("x1", "0");
    mid.setAttribute("y1", "22");
    mid.setAttribute("x2", "160");
    mid.setAttribute("y2", "22");
    svg.appendChild(mid);

    const points = previewPoints(reg);
    if (points) {
      const area = document.createElementNS(SVG_NS, "polygon");
      area.setAttribute("class", "frame-area");
      area.setAttribute("points", `0,44 ${points} 160,44`);
      svg.appendChild(area);

      if (frame === "z") {
        const glow = document.createElementNS(SVG_NS, "polyline");
        glow.setAttribute("class", "frame-glow");
        glow.setAttribute("points", points);
        svg.appendChild(glow);
      }

      const line = document.createElementNS(SVG_NS, "polyline");
      line.setAttribute("class", "frame-line");
      line.setAttribute("points", points);
      svg.appendChild(line);
    }
    return svg;
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
    if (filterMode === "operands") return frame !== "z";
    if (filterMode === "derived") return frame === "z";
    if (filterMode === "visible") return sl.frameVis[frame];
    return true;
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
    const active = laneKey === S.laneKey && focusKey(sl) === frame;
    const visible = sl.frameVis[frame];
    const hex = toHexOf(reg);
    const role = frameRoleBadge(sl, frame);
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
    box.appendChild(makePreview(reg, frame));

    const glyph = document.createElement("span");
    glyph.className = "frame-glyph";
    glyph.textContent = name;

    btn.append(box, glyph);
    btn.addEventListener("click", () => chooseCard(laneKey, frame));

    const extra = document.createElement("div");
    extra.className = "frame-card-extra";
    extra.setAttribute("aria-hidden", "true");
    const roleEl = document.createElement("span");
    roleEl.className = "frame-role" + (role.accent ? " is-accent" : "");
    roleEl.textContent = role.text;
    const hexEl = document.createElement("span");
    hexEl.className = "frame-hex";
    hexEl.textContent = compactHex(hex);
    extra.append(roleEl, hexEl);

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
    col.className = "lane-col" + (laneKey === S.laneKey ? " is-active" : "");
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

  function renderSidebar(laneKeys) {
    if (framesLaneCount) {
      framesLaneCount.textContent = `${laneKeys.length} / ${APP_LANE_CAP}`;
    }
    if (framesTitle) {
      framesTitle.textContent = FILTER_TITLES[filterMode] || "All Frames";
    }
    if (framesSub) {
      const total = laneKeys.length * 3;
      const laneWord = laneKeys.length === 1 ? "lane" : "lanes";
      framesSub.textContent = `${total} frames · ${laneKeys.length} ${laneWord} · click a card to focus · eye toggles 2D`;
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
    allCount.textContent = String(laneKeys.length * 3);
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
      const active = laneKey === S.laneKey;
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
          if (S.laneKey !== laneKey) selectLane(laneKey);
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

    /* Focused lane quick frames section */
    const focusedLane = curLane();
    if (focusedLane) {
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
    /* A lane deleted elsewhere (bridge/document load) cannot keep its confirm. */
    if (pendingDelete !== null && !S.lanes[pendingDelete]) pendingDelete = null;

    const active = document.activeElement;
    const card = active && active.closest ? active.closest("[data-lane][data-frame]") : null;
    const headControl = active && active.closest ? active.closest(".lane-act, .lane-btn") : null;
    const treeControl = active && active.closest ? active.closest(".fs-item") : null;
    const keepCard = card
      ? { lane: card.dataset.lane, frame: card.dataset.frame, eye: active.classList.contains("eye-btn") }
      : null;
    const keepHead = headControl
      ? {
          lane: headControl.closest("[data-lane]")?.dataset.lane,
          act: headControl.classList.contains("lane-btn") ? "lane-btn" : headControl.dataset.act,
        }
      : null;
    const keepTree = treeControl
      ? { lane: treeControl.dataset.treeLane || null, frame: treeControl.dataset.treeFrame || null }
      : null;

    const laneKeys = liveLaneKeys();
    renderSidebar(laneKeys);

    framesGrid.textContent = "";
    for (const laneKey of laneKeys) framesGrid.appendChild(buildLaneColumn(laneKey));
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
    } else if (keepTree && framesTree) {
      const target = keepTree.lane
        ? framesTree.querySelector(`[data-tree-lane="${keepTree.lane}"]`)
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
