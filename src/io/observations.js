/**
 * Observation logger — capture the focused lane's state and export it as CSV.
 *
 * I/O only: reads the state tree and the dataset cursor, writes a Blob when the
 * user asks. Moved out of main.js in F2.
 */

import { DEMO } from "../state/dataset.ts";
import { S, laneLabel } from "../state/instrument.ts";
import { toHexOf } from "../render/readouts.js";

const obsCount = document.getElementById("obsCount");
const logObsBtn = document.getElementById("logObsBtn");
const exportObsBtn = document.getElementById("exportObsBtn");

const observations = [];
let notify = null;

/** Wire the visible source status line (F5); export with no rows explains why. */
export function setObservationStatus(fn) {
  notify = fn;
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
    if (!observations.length) {
      if (notify) notify("nothing to export yet — log an observation first", true);
      return;
    }
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

export { observations };
