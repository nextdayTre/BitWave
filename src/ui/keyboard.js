/**
 * Keyboard map and file drop — global shortcuts for the instrument.
 *
 * Moved out of main.js in F2. Escape closes the navigator or copy mode,
 * Alt+1..8 selects a live lane (by its stable lane key; an absent key is a
 * no-op), Alt+S toggles split; arrows step the dataset. The stage-bar lane
 * dropdown is the declared lane-selection keyboard path; Alt+digit is the
 * shortcut beside it.
 */

export function attachKeyboard(deps) {
  const { frameNav, syncViewUi, selectLane, setSplitMode, applyExample, loadCSV, copyMenu, onDropError, S: liveState, DEMO } = deps;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && frameNav.isOpen()) {
      frameNav.close(true);
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && liveState.copyArmed) {
      copyMenu.close(true);
      e.preventDefault();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const digit = /^(?:Digit([1-9])|([1-9]))$/.exec(e.code || "") || /^([1-9])$/.exec(e.key || "");
      const laneKey = digit ? (digit[1] || digit[2]) : null;
      if (laneKey) {
        /* Alt+1..8 selects a lane when it exists; the freed/gapped keys simply
           do nothing (D46: no renumbering, so a live set may be 1, 3, 4). */
        if (liveState.lanes[laneKey]) selectLane(laneKey);
        if (frameNav.isOpen()) frameNav.render();
        e.preventDefault();
        return;
      }
      if (e.key === "s" || e.key === "S" || e.code === "KeyS") {
        /* Split is 3-D only; the stage-bar button is disabled in 2-D too. */
        if (liveState.view3d) setSplitMode(!liveState.split3d);
        e.preventDefault();
        return;
      }
    }
    if (!DEMO.rows.length) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    /* The strip owns ←/→ for nibble focus (DESIGN §6); never also step CSV. */
    if (e.target && e.target.closest && e.target.closest("#nibs")) return;
    if (e.key === "ArrowRight") { applyExample(DEMO.i + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { applyExample(DEMO.i - 1); e.preventDefault(); }
  });

  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => loadCSV(String(rd.result || ""), f.name);
    rd.onerror = () => { if (onDropError) onDropError(f.name); };
    rd.readAsText(f);
  });
}
