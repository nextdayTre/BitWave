/**
 * `.bitwave` project file — download the current document, read a chosen file.
 *
 * I/O only (Blob + FileReader); the state mapping lives in
 * `src/state/project-bridge.ts` and the schema in `src/core/project.ts`.
 */

import { stringifyProject } from "../core/project.ts";
import { captureProject } from "../state/project-bridge.ts";

function stamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Captures the instrument and triggers a `.bitwave` download. Returns the name. */
export function downloadProject(date = new Date()) {
  const filename = `bitwave-project-${stamp(date)}.bitwave`;
  const text = stringifyProject(captureProject(date.toISOString()));
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return filename;
}

/** Reads a user-chosen project file as text. Rejects on read errors. */
export function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("could not read the file"));
    reader.readAsText(file);
  });
}
