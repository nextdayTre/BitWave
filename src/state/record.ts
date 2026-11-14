/**
 * DAW-style frame record — a transient log of every update.
 *
 * When armed, one row is appended per settled evaluation transaction (the
 * pointer-drag stream is skipped; the row lands on release). Each row holds the
 * 3L global frame registers (three per live lane) as N-bit uppercase hex plus a
 * monotonic step number. Rows live in memory only (ring buffer, not `.bitwave`,
 * not the share link); an expression can read the previous row as `log.<frame>`.
 *
 * DOM-free: the UI module and the agent bridge both call this module.
 */

import { fromHex, regToBig, toHex } from "../core/registers.ts";
import { FRAME_NAMES, S, liveLaneKeys } from "./instrument.ts";

export const RECORD_CAP = 2048;

export function isRecording(): boolean {
  return S.record.on;
}

export function recordCount(): number {
  return S.record.rows.length;
}

/** Start a new take: arm the toggle and clear the buffer. */
export function startRecording(): void {
  S.record.on = true;
  S.record.rows = [];
  S.record.nextStep = 1;
}

export function stopRecording(): void {
  S.record.on = false;
}

/** Toggle and return the new armed state. */
export function toggleRecording(): boolean {
  if (S.record.on) stopRecording();
  else startRecording();
  return S.record.on;
}

export function clearRecording(): void {
  S.record.rows = [];
  S.record.nextStep = 1;
}

/**
 * Append one row if armed and the instrument is settled. Returns true when a row
 * was appended. Call once per completed store transaction.
 */
export function recordSnapshot(): boolean {
  if (!S.record.on || S.drag >= 0) return false;

  const frames: Record<string, string> = {};
  for (const key of liveLaneKeys()) {
    const sl = S.lanes[key];
    const names = FRAME_NAMES[key];
    frames[names.a] = toHex(sl.A.bits, S.N);
    frames[names.b] = toHex(sl.B.bits, S.N);
    frames[names.z] = toHex(sl.Z.bits, S.N);
  }

  S.record.rows.push({ step: S.record.nextStep, frames });
  S.record.nextStep += 1;
  if (S.record.rows.length > RECORD_CAP) S.record.rows.shift();
  return true;
}

/** How many rows the buffer currently holds (for UI/agent state). */
export function recordingInfo(): { on: boolean; rows: number } {
  return { on: S.record.on, rows: S.record.rows.length };
}

/**
 * The previous recorded snapshot as frame-name -> BigInt, or null before the
 * first row. This is the one-update-late log expressions read.
 */
export function lastLog(): Record<string, bigint> | null {
  const row = S.record.rows[S.record.rows.length - 1];
  if (!row) return null;
  const out: Record<string, bigint> = {};
  for (const [name, hex] of Object.entries(row.frames)) {
    out[name] = regToBig(fromHex(hex, S.N), S.N);
  }
  return out;
}

/** Recorded rows as a plain array (agent bridge / export). */
export function readLog(): Array<{ step: number; frames: Record<string, string> }> {
  return S.record.rows.map((row) => ({ step: row.step, frames: { ...row.frames } }));
}

/** Deterministic CSV of the recorded rows (no timestamps). One column per frame. */
export function recordCsv(): string {
  const header = ["step"];
  for (const key of liveLaneKeys()) {
    const names = FRAME_NAMES[key];
    header.push(names.a, names.b, names.z);
  }
  const lines = [header.join(",")];
  for (const row of S.record.rows) {
    lines.push(
      [String(row.step), ...header.slice(1).map((name) => row.frames[name] ?? "")].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
