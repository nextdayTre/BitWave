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
  curSlot,
  focusReg,
  frameLabel,
  frameName,
  laneLabel,
  nibCount,
  nibValue,
} from "../state/instrument.ts";

export function createLiveStatus(store) {
  const el = document.getElementById("liveStatus");
  let timer = 0;
  let pending = "";

  const quiet = () => S.drag >= 0 || S.lfo.on;

  function describe() {
    const r = focusReg();
    const n = nibCount();
    let hex = "";
    for (let j = 0; j < n; j++) hex += nibValue(r, j).toString(16).toUpperCase();
    const sl = curSlot();
    let pop = 0;
    for (let i = 0; i < S.N; i++) pop += sl.Z.bits[i];
    return `lane ${laneLabel(S.slot)} · ${frameLabel()} = ${hex} · ${frameName(S.slot, "z")} popcount ${pop}`;
  }

  function flush() {
    timer = 0;
    if (el.textContent === pending) return;
    el.textContent = pending;
  }

  /* Called once per completed transaction. */
  function schedule() {
    if (quiet()) {
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

  store.subscribe(schedule);
  return { schedule, announceNow, describe };
}
