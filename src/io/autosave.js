/**
 * Autosave (F5) — the work survives a reload.
 *
 * One debounced `localStorage` write per settled transaction burst. The LFO
 * ticks every 125 ms and a drag commits per pointermove, so a plain timer that
 * resets on each transaction naturally writes only when the instrument settles
 * (DESIGN §10.19/§10.20 in spirit). Storage failures (private mode, a browser
 * that blocks `file://` storage) are non-fatal: the instrument keeps working,
 * just without persistence.
 */

import { stringifyProject } from "../core/project.ts";
import { captureProject } from "../state/project-bridge.ts";

export const AUTOSAVE_KEY = "bitwave.autosave.v2";
const DEBOUNCE_MS = 650;

export function createAutosave(store, { enabled = true } = {}) {
  let timer = 0;
  let available = true;
  let active = enabled;

  function saveNow() {
    clearTimeout(timer);
    timer = 0;
    if (!active) return false;
    try {
      localStorage.setItem(AUTOSAVE_KEY, stringifyProject(captureProject()));
      available = true;
      return true;
    } catch {
      available = false;
      return false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!active) return;
    timer = setTimeout(saveNow, DEBOUNCE_MS);
  }

  /** Returns the raw parsed document, or null when nothing usable is stored. */
  function load() {
    if (!active) return null;
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  function clear() {
    clearTimeout(timer);
    timer = 0;
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* non-fatal */ }
  }

  function setEnabled(value) {
    active = value;
    if (!active) clearTimeout(timer);
  }

  store.subscribe(schedule);
  window.addEventListener("beforeunload", saveNow);

  return { load, saveNow, schedule, clear, setEnabled, isEnabled: () => active, isAvailable: () => available };
}
