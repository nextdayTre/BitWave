/**
 * One committed-change live region (DESIGN §8, §10.34).
 *
 * Every register change is visible but silent to a screen reader. Naïvely
 * making the readouts live would flood: a drag commits per pointermove and the
 * LFO commits 1–8×/s. So there is exactly one polite, atomic status region,
 * driven by transaction boundaries, debounced ~150 ms, and quiet while a drag
 * or the LFO is running. One short sentence: lane, frame, value, Z popcount.
 */

import {
  S,
  curLane,
  focusReg,
  frameLabel,
  frameName,
  nibCount,
  nibValue,
} from "../state/instrument.ts";

export function createLiveStatus(store) {
  const el = document.getElementById("liveStatus");
  let timer = 0;
  let pending = "";
  let holdUntil = 0;

  const quiet = () => S.drag >= 0 || S.lfo.on;

  function describe() {
    const r = focusReg();
    const n = nibCount();
    let hex = "";
    for (let j = 0; j < n; j++) hex += nibValue(r, j).toString(16).toUpperCase();
    const sl = curLane();
    let pop = 0;
    for (let i = 0; i < S.N; i++) pop += sl.Z.bits[i];
    return `lane ${S.laneKey} · ${frameLabel()} = ${hex} · ${frameName(S.laneKey, "z")} popcount ${pop}`;
  }

  function flush() {
    timer = 0;
    if (el.textContent === pending) return;
    el.textContent = pending;
  }

  /* Called once per completed transaction. */
  function schedule() {
    if (quiet() || Date.now() < holdUntil) {
      clearTimeout(timer);
      timer = 0;
      return;
    }
    pending = describe();
    clearTimeout(timer);
    timer = setTimeout(flush, 150);
  }

  /* Pointer-up / explicit announcements bypass the debounce. */
  function announceNow() {
    clearTimeout(timer);
    timer = 0;
    pending = describe();
    el.textContent = pending;
  }

  /* A one-shot message that holds the region against the next auto-updates
     (e.g. "copied lane 1 → lane 2" must not be replaced by the register text
     a moment later). */
  function say(text) {
    clearTimeout(timer);
    timer = 0;
    pending = text;
    el.textContent = text;
    holdUntil = Date.now() + 1400;
  }

  store.subscribe(schedule);
  return { schedule, announceNow, say, describe };
}
