/**
 * Canonical share links for the agent layer.
 *
 * The `.bitwave` codec already exists in `share.ts`. This module adds the rules
 * the agent contract needs: a state has exactly one link, so the timestamp is
 * not part of a shared document, routes and parked bases are written in a
 * deterministic order, and the link is the compact payload (D45) rather than
 * the legacy JSON document. It also reproduces the app's budget policy (drop
 * the dataset first, then expression sources, each with an explicit flag) so
 * `build_deeplink`, the address bar and `getDeeplink()` agree.
 *
 * Schema 1-4 documents are accepted: `deserializeProject` upgrades a legacy
 * document on read and the canonical form is always schema 4 (D44). Top-level
 * fields this build does not understand ride along, matching the app bridge.
 */

import { CANONICAL_SAVED_AT } from "./agent-defaults.ts";
import { deserializeProject, serializeProject, type ProjectDoc, type ProjectRoute } from "./project.ts";
import { SHARE_DOC_KEYS, SHARE_MAX_CHARS, SHARE_PREFIX, encodeCompactShare } from "./share.ts";

export interface ShareLink {
  /** `#bw=<payload>` */
  fragment: string;
  /** Characters after `bw=` (no prefix, no leading `#`). */
  payloadChars: number;
  withinBudget: boolean;
  datasetDropped: boolean;
  /** True when expression sources were dropped to fit the budget (after the dataset). */
  expressionsDropped: boolean;
}

const FRAME_ORDER = ["a", "b", "z"];

/** Destination-first total order (destinations are unique in a document). */
function comparePorts(a: string, b: string): number {
  const [aLane, aFrame] = [Number(a.slice(0, a.indexOf("."))), FRAME_ORDER.indexOf(a.slice(a.indexOf(".") + 1))];
  const [bLane, bFrame] = [Number(b.slice(0, b.indexOf("."))), FRAME_ORDER.indexOf(b.slice(b.indexOf(".") + 1))];
  return aLane - bLane || aFrame - bFrame;
}

function compareRoutes(a: ProjectRoute, b: ProjectRoute): number {
  return comparePorts(a.to, b.to) || comparePorts(a.from, b.from);
}

/**
 * Validate a document and re-serialize it canonically: schema 4, no `savedAt`,
 * extras preserved, unknown top-level fields carried along, engine recomputed,
 * routes and parked bases in deterministic order. Throws ProjectError on an
 * invalid document.
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
    if (!SHARE_DOC_KEYS.has(key)) (out as unknown as Record<string, unknown>)[key] = value;
  }
  // Deterministic document order makes the compact link a function of state.
  out.routes = out.routes.slice().sort(compareRoutes);
  out.parked = Object.fromEntries(Object.entries(out.parked).sort(([a], [b]) => comparePorts(a, b)));
  return out;
}

function hasExpressions(doc: ProjectDoc): boolean {
  return Object.values(doc.lanes).some(
    (lane) => lane.expressions !== undefined && Object.keys(lane.expressions).length > 0,
  );
}

function withoutDataset(doc: ProjectDoc): ProjectDoc {
  const { dataset: _dropped, ...rest } = doc;
  return rest as ProjectDoc;
}

function withoutExpressions(doc: ProjectDoc): ProjectDoc {
  const lanes = {} as ProjectDoc["lanes"];
  for (const [key, lane] of Object.entries(doc.lanes)) {
    const { expressions: _dropped, ...rest } = lane;
    lanes[key] = rest;
  }
  return { ...doc, lanes };
}

/**
 * Build the canonical compact fragment, applying the share budget in its
 * documented order: the dataset first, then expression sources, each reported
 * by its own flag — never silently.
 */
export function buildShareLink(doc: ProjectDoc): ShareLink {
  let canonical = canonicalShareDocument(doc);
  let payload = encodeCompactShare(canonical);
  let datasetDropped = false;
  let expressionsDropped = false;

  if (payload.length > SHARE_MAX_CHARS && canonical.dataset) {
    canonical = withoutDataset(canonical);
    payload = encodeCompactShare(canonical);
    datasetDropped = true;
  }
  if (payload.length > SHARE_MAX_CHARS && hasExpressions(canonical)) {
    canonical = withoutExpressions(canonical);
    payload = encodeCompactShare(canonical);
    expressionsDropped = true;
  }

  return {
    fragment: `#${SHARE_PREFIX}${payload}`,
    payloadChars: payload.length,
    withinBudget: payload.length <= SHARE_MAX_CHARS,
    datasetDropped,
    expressionsDropped,
  };
}
