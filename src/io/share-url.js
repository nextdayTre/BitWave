/**
 * URL-fragment sharing (F5) — the address bar is the share link.
 *
 * The current document is encoded into `#bw=...` on every settled change with
 * `replaceState`, so a teacher can copy the URL and hand a student the exact
 * state. Reading a link wins over the autosave. Works from `file://` because
 * only the fragment is used — no network, no server.
 *
 * The fragment comes from the shared canonical builder
 * (`src/core/agent-share.ts`): links omit `savedAt`, so equal state gives equal
 * links and the address bar matches `window.bitwave.getDeeplink()` and
 * `build_deeplink`. The builder also enforces the budget by dropping the
 * dataset first, exactly as the app always has.
 */

import { buildShareLink } from "../core/agent-share.ts";
import { parseShareHash } from "../core/share.ts";
import { captureProject } from "../state/project-bridge.ts";

const DEBOUNCE_MS = 550;

export function createShareUrl({ allow = true } = {}) {
  let timer = 0;
  let enabled = false;

  function encodeCurrent() {
    try {
      const link = buildShareLink(captureProject());
      return link.withinBudget ? link.fragment : null;
    } catch (_) {
      /* A document that cannot serialize does not get a share link. */
      return null;
    }
  }

  /**
   * The address bar settled. Additive automation hook: the agent bridge mirrors
   * the new URL into `#bitwave-state` without treating it as a UI change.
   */
  function announce() {
    try {
      window.dispatchEvent(new CustomEvent("bitwave:urlsettled", { detail: location.href }));
    } catch (_) {
      /* Events are best-effort. */
    }
  }

  function update() {
    if (!enabled || !allow) return;
    const fragment = encodeCurrent();
    if (!fragment || fragment === location.hash) return;
    try {
      history.replaceState(null, "", fragment);
    } catch (_) {
      return; // non-fatal: the state is still fully usable
    }
    announce();
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
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (_) {
      /* non-fatal */
    }
    announce();
  }

  return { read, schedule, start, clear, update };
}
