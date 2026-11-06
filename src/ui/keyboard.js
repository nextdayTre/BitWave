/**
 * Keyboard map and file drop — global shortcuts for the instrument.
 *
 * Moved out of main.js in F2. Escape closes the navigator or copy mode,
 * Alt+1/2/3 select a lane, Alt+S toggles split; arrows step the dataset.
 */

export function attachKeyboard(deps) {
  const { frameNav, syncViewUi, selectSlot, setSplitMode, applyExample, loadCSV, S, DEMO } = deps;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && frameNav.isOpen()) {
      frameNav.close(true);
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
      if (e.key === "1" || e.code === "Digit1") { selectSlot("A"); if (frameNav.isOpen()) frameNav.render(); e.preventDefault(); return; }
      if (e.key === "2" || e.code === "Digit2") { selectSlot("B"); if (frameNav.isOpen()) frameNav.render(); e.preventDefault(); return; }
      if (e.key === "3" || e.code === "Digit3") { selectSlot("C"); if (frameNav.isOpen()) frameNav.render(); e.preventDefault(); return; }
      if (e.key === "s" || e.key === "S" || e.code === "KeyS") { setSplitMode(!(S.view3d && S.split3d)); e.preventDefault(); return; }
    }
    if (!DEMO.rows.length) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    if (e.key === "ArrowRight") { applyExample(DEMO.i + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { applyExample(DEMO.i - 1); e.preventDefault(); }
  });

  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => loadCSV(String(rd.result || ""));
    rd.readAsText(f);
  });
}
