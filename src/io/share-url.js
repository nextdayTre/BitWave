/**
 * URL-fragment sharing (F5) — the address bar is the share link.
 *
 * The current document (minus the dataset when it would overflow the budget)
 * is encoded into `#bw=...` on every settled change with `replaceState`, so a
 * teacher can copy the URL and hand a student the exact state. Reading a link
 * wins over the autosave. Works from `file://` because only the fragment is
 * used — no network, no server.
 */

import { SHARE_MAX_CHARS, parseShareHash, shareFragment } from "../core/share.ts";
import { captureProject } from "../state/project-bridge.ts";

const MAX_FRAGMENT = SHARE_MAX_CHARS + 1; // leading "#"
const DEBOUNCE_MS = 550;

export function createShareUrl({ allow = true } = {}) {
  let timer = 0;
  let enabled = false;

  function encodeCurrent() {
    const doc = captureProject();
    let fragment = shareFragment(doc);
    if (fragment.length > MAX_FRAGMENT && doc.dataset) {
      const { dataset, ...rest } = doc;
      fragment = shareFragment(rest);
    }
    return fragment.length <= MAX_FRAGMENT ? fragment : null;
  }

  function update() {
    if (!enabled || !allow) return;
    const fragment = encodeCurrent();
    if (!fragment || fragment === location.hash) return;
    try { history.replaceState(null, "", fragment); } catch { /* non-fatal */ }
  }

  function schedule() {
    clearTimeout(timer);
    if (!allow) return;
    timer = setTimeout(update, DEBOUNCE_MS);
  }

  function start() {
    if (!allow) return;
    enabled = true;
    schedule();
  }

  /** The raw shared document, or null when the URL carries no (valid) state. */
  function read() {
    return parseShareHash(location.hash);
  }

  function clear() {
    enabled = false;
    clearTimeout(timer);
    try { history.replaceState(null, "", location.pathname + location.search); } catch { /* non-fatal */ }
  }

  return { read, schedule, start, clear, update };
}
