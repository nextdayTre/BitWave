/**
 * Record UI (EXTERNAL-ROUTING §3) — the DAW-style take and its log export.
 *
 * One toggle (`record`), one row count and one `export log` download. Rows are
 * appended by the shared `src/state/record.ts` module on every settled store
 * transaction (the module itself skips the active pointer-drag stream). Start
 * clears the take; stop freezes it. Arming/disarming itself is a UI preference,
 * not a recorded update, so the transaction that toggles it does not append the
 * row it would otherwise record.
 *
 * The log is a session artifact: in memory only, never in `.bitwave` or the
 * share link, so a shared document stays small and reproducible.
 */

import { S } from "../state/instrument.ts";
import {
  recordCount,
  recordCsv,
  recordSnapshot,
  startRecording,
  stopRecording,
} from "../state/record.ts";

export function createRecordUI({ store }) {
  const button = document.getElementById("recordBtn");
  const countEl = document.getElementById("recordCount");
  const exportEl = document.getElementById("exportLogBtn");

  /* Set by start() / the bridge's no-op suppression; consumed by one
     transaction notification so that transaction appends no row. */
  let skipSnapshot = false;

  function sync() {
    const rows = recordCount();
    if (button) {
      button.setAttribute("aria-pressed", String(S.record.on));
      button.classList.toggle("on", S.record.on);
      button.title = S.record.on
        ? "Recording every settled update — click to stop"
        : "Record every settled update into an in-memory log (not saved in the project)";
    }
    if (countEl) countEl.textContent = `${rows} rows`;
    if (exportEl) {
      exportEl.disabled = rows === 0;
      exportEl.setAttribute("aria-disabled", String(rows === 0));
    }
  }

  /** Arm a fresh take (clears the buffer). Call inside a store transaction. */
  function start() {
    skipSnapshot = true;
    startRecording();
    sync();
  }

  /** Freeze the take. Call inside a store transaction. */
  function stop() {
    stopRecording();
    sync();
  }

  /* The bridge uses this when a patch changes nothing: a no-op setter must not
     grow the log either. */
  function skipNextSnapshot() {
    skipSnapshot = true;
  }

  function toggle() {
    store.patch(() => {
      if (S.record.on) stop();
      else start();
    });
  }

  function exportLog() {
    if (recordCount() === 0) return;
    const blob = new Blob([recordCsv()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bitwave_recording.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /* One row per settled transaction. Subscribed before the agent bridge is
     installed, so `getState().recording` sees the row in the same pass. */
  store.subscribe(() => {
    if (skipSnapshot) skipSnapshot = false;
    else if (S.record.on) recordSnapshot();
    sync();
  });

  if (button) button.addEventListener("click", toggle);
  if (exportEl) exportEl.addEventListener("click", exportLog);

  sync();
  return { start, stop, toggle, sync, skipNextSnapshot, exportLog };
}
