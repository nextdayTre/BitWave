/**
 * Canonical share links for the agent layer.
 *
 * The `.bitwave` codec already exists in `share.ts`. This module adds the one rule
 * the agent contract needs: a state has exactly one link, so the timestamp is not
 * part of a shared document. It also reproduces the app's budget policy (drop the
 * dataset before giving up) so `build_deeplink` and the address bar agree.
 *
 * Schema 1-4 documents are accepted: `deserializeProject` upgrades a legacy
 * document on read and the canonical form is always schema 4 (D44). Top-level
 * fields this build does not understand ride along, matching the app bridge.
 */

import { CANONICAL_SAVED_AT } from "./agent-defaults.ts";
import { deserializeProject, serializeProject, type ProjectDoc } from "./project.ts";
import { SHARE_MAX_CHARS, SHARE_PREFIX, encodeShare } from "./share.ts";

export interface ShareLink {
  /** `#bw=<payload>` */
  fragment: string;
  /** Characters after `bw=` (no prefix, no leading `#`). */
  payloadChars: number;
  withinBudget: boolean;
  datasetDropped: boolean;
}

const KNOWN_DOC_KEYS = new Set([
  "schema", "app", "savedAt", "N", "view", "lanes", "routes", "parked", "dataset",
]);

/**
 * Validate a document and re-serialize it canonically: schema 4, no `savedAt`,
 * extras preserved, unknown top-level fields carried along, engine recomputed.
 * Throws ProjectError on an invalid document.
 */
export function canonicalShareDocument(doc: ProjectDoc): ProjectDoc {
  const loaded = deserializeProject(doc);
  const out = serializeProject(
    loaded.lanes,
    loaded.routing,
    loaded.N,
    loaded.view,
    loaded.dataset,
    CANONICAL_SAVED_AT,
    {
      focus: loaded.extras.focus,
      frameVis: loaded.extras.frameVis,
      lfoMode: loaded.extras.lfoMode,
      lfoRate: loaded.extras.lfoRate,
      expressions: loaded.extras.expressions,
    },
  );
  delete (out as { savedAt?: string }).savedAt;
  for (const [key, value] of Object.entries(doc)) {
    if (!KNOWN_DOC_KEYS.has(key)) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Build the canonical fragment, dropping the dataset when the payload would
 * exceed the share budget (mirroring `src/io/share-url.js`).
 */
export function buildShareLink(doc: ProjectDoc): ShareLink {
  let canonical = canonicalShareDocument(doc);
  let payload = encodeShare(canonical);
  let datasetDropped = false;

  if (payload.length > SHARE_MAX_CHARS && canonical.dataset) {
    const { dataset: _dropped, ...rest } = canonical;
    canonical = rest as ProjectDoc;
    payload = encodeShare(canonical);
    datasetDropped = true;
  }

  return {
    fragment: `#${SHARE_PREFIX}${payload}`,
    payloadChars: payload.length,
    withinBudget: payload.length <= SHARE_MAX_CHARS,
    datasetDropped,
  };
}
