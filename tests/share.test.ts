/**
 * URL-share codec — compact `#bw=` payloads (canonical since toolset 1.3.0),
 * legacy JSON payloads, canonical determinism and the measured share budget.
 *
 * The browser is not involved: the codec is pure, so the same round trip that
 * `#bw=...` performs in the address bar runs here in Node.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  ProjectError,
  addRoute,
  createRouting,
  deserializeProject,
  evaluateAll,
  fromHex,
  makeBootLanes,
  makeLane,
  serializeProject,
  toHex,
} from "../src/core/index.ts";
import {
  COMPACT_SHARE_TAG,
  SHARE_MAX_CHARS,
  SHARE_PREFIX,
  decodeCompactShare,
  decodeShare,
  decodeShareDocument,
  encodeShare,
  parseShareHash,
  shareFragment,
} from "../src/core/share.ts";
import { buildShareLink, canonicalShareDocument } from "../src/core/agent-share.ts";
import { exampleProjectDoc } from "../src/core/agent-defaults.ts";
import { callTool } from "../src/core/agent-tools.ts";
import { captureProject } from "../src/state/project-bridge.ts";
import { buildShareBudgetDoc, measureShareBudget } from "../tools/share-budget.mjs";
import type { Dataset } from "../src/core/csv.ts";
import type { ProjectDoc, ProjectExtras, ProjectViewState } from "../src/core/project.ts";

const NOW = "2026-11-05T00:00:00.000Z";
const VIEW: ProjectViewState = {
  lane: "1",
  view3d: false,
  split3d: false,
  splitPair: ["1", "2"],
  activePane: 0,
};

/** The app captures all extras on every save, so share docs carry them too. */
const EXTRAS: ProjectExtras = {
  focus: { "1": "b", "2": "z", "3": "a" },
  frameVis: {
    "1": { a: false, b: true, z: true },
    "2": { a: true, b: false, z: true },
    "3": { a: true, b: true, z: false },
  },
  lfoMode: "slide",
  lfoRate: 8,
};

/** A patched, two-route document at width `n`; `dataset` is usually excluded. */
function projectDoc(n: number, dataset: Dataset | null = null): ProjectDoc {
  const lanes = makeBootLanes(n);
  const routing = createRouting();
  addRoute(routing, lanes, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  addRoute(routing, lanes, { lane: "1", frame: "z" }, { lane: "2", frame: "b" });
  evaluateAll(routing, lanes, n);
  return serializeProject(lanes, routing, n, VIEW, dataset, NOW, EXTRAS);
}

test("round-trip: routes, parked bases and non-ASCII columns survive UTF-8/base64url", () => {
  const dataset: Dataset = {
    cols: ["id", "données", "列", "payload 🎛"],
    rows: [["1", "café", "0x10", "DEAD"]],
  };
  const doc = projectDoc(64, dataset);
  const payload = encodeShare(doc);

  // Independent cross-check: Node's own base64url codec decodes our payload
  // back to exactly the JSON text, including every non-ASCII character.
  assert.equal(Buffer.from(payload, "base64url").toString("utf8"), JSON.stringify(doc));

  const decoded = decodeShare(payload);
  assert.deepEqual(decoded, doc);

  const loaded = deserializeProject(decoded);
  assert.equal(loaded.N, 64);
  assert.deepEqual(loaded.dataset?.cols, dataset.cols);
  assert.deepEqual(loaded.dataset?.rows, dataset.rows);
  assert.equal(loaded.routing.routes.length, 2);
  assert.equal(loaded.extras.focus["1"], "b");

  const parked: Record<string, string> = {};
  for (const [key, bits] of loaded.routing.parked) {
    parked[key.replace(":", ".")] = toHex(bits, 64);
  }
  assert.deepEqual(parked, doc.parked);
});

test("payload alphabet is base64url: no '+', '/' or '='", () => {
  const payload = encodeShare(projectDoc(64));
  assert.match(payload, /^[A-Za-z0-9_-]+$/, "payload is A-Za-z0-9-_ only");
  for (const ch of ["+", "/", "="]) {
    assert.ok(!payload.includes(ch), `payload must not contain ${JSON.stringify(ch)}`);
  }
});

test("parseShareHash accepts '#bw=' and 'bw=', returns null when absent", () => {
  const doc = projectDoc(64);
  const fragment = shareFragment(doc);
  assert.ok(fragment.startsWith("#" + SHARE_PREFIX));
  assert.deepEqual(parseShareHash(fragment), doc);
  assert.deepEqual(parseShareHash(fragment.slice(1)), doc);

  assert.equal(parseShareHash(""), null);
  assert.equal(parseShareHash("#"), null);
  assert.equal(parseShareHash("#other=1"), null);
  assert.equal(parseShareHash(SHARE_PREFIX), null);
});

test("decodeShare throws ProjectError('malformed') on bad input", () => {
  const garbage = [
    "", // empty payload
    "!!!!", // characters outside the base64url alphabet
    "a", // impossible base64url length (len % 4 === 1)
    Buffer.from("not json").toString("base64url"), // valid UTF-8, invalid JSON
    Buffer.from("{").toString("base64url"), // truncated JSON
    Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url"), // invalid UTF-8
    Buffer.from([0xe2, 0x82]).toString("base64url"), // truncated UTF-8 sequence
  ];
  for (const payload of garbage) {
    assert.throws(
      () => decodeShare(payload),
      (err: unknown) => err instanceof ProjectError && err.code === "malformed",
      `expected a malformed share for ${JSON.stringify(payload)}`,
    );
  }
});

test("a 256-bit document without a dataset fits SHARE_MAX_CHARS", () => {
  const p64 = encodeShare(projectDoc(64));
  const p256 = encodeShare(projectDoc(256));
  const fragment = shareFragment(projectDoc(256));

  assert.ok(p64.length > 0);
  assert.ok(p256.length > p64.length);
  assert.ok(
    p256.length <= SHARE_MAX_CHARS,
    `256-bit payload is ${p256.length} chars, over the ${SHARE_MAX_CHARS} budget`,
  );
  // SHARE_MAX_CHARS budgets the payload; the fragment adds '#' + 'bw='.
  assert.equal(fragment.length, p256.length + "#bw=".length);
  // Decodes without a dataset, so nothing had to be dropped for this document.
  const decoded = decodeShare(p256) as Record<string, unknown>;
  assert.ok(!("dataset" in decoded));
  assert.equal(decoded.N, 256);
});

test("canonical share links preserve expression sources and save schema 4", () => {
  const lanes = makeBootLanes(64);
  const routing = createRouting();
  const doc = serializeProject(
    lanes,
    routing,
    64,
    {
      lane: "1",
      view3d: false,
      split3d: false,
      splitPair: ["1", "2"],
      activePane: 0,
    },
    null,
    "2026-11-06T00:00:00.000Z",
    { expressions: { "2": { b: "round(1.2599210498948732 * C)" } } },
  );

  const link = buildShareLink(doc);
  const payload = parseShareHash(link.fragment) as Record<string, unknown>;
  assert.equal(payload.schema, 4, "a canonical link is always schema 4");
  const decoded = deserializeProject(payload);
  assert.deepEqual(decoded.extras.expressions, {
    "1": {},
    "2": { b: "round(1.2599210498948732 * C)" },
    "3": {},
  });
});

test("legacy #bw= links decode and upgrade to schema 4", () => {
  const schema4 = projectDoc(64);
  /* Genuine legacy payloads: the closed three-lane object at the old version. */
  const schema2 = { ...schema4, schema: 2 };
  const schema1 = {
    ...schema4,
    schema: 1,
    view: { lane: "1", view3d: false, split3d: false, splitPair: ["1", "2"], activePane: 0 },
    lanes: Object.fromEntries(
      Object.entries(schema4.lanes).map(([lane, data]) => {
        const { focus: _focus, frameVis: _frameVis, ...rest } = data;
        return [lane, rest];
      }),
    ),
  };
  for (const legacy of [schema1, schema2]) {
    const fragment = shareFragment(legacy);
    const raw = parseShareHash(fragment) as Record<string, unknown>;
    assert.equal(raw.schema, legacy.schema);
    const loaded = deserializeProject(raw);
    assert.equal(loaded.N, 64);
    assert.deepEqual(Object.keys(loaded.lanes), ["1", "2", "3"]);

    const canonical = canonicalShareDocument(legacy as ProjectDoc);
    assert.equal(canonical.schema, 4);
    const canonicalDecoded = parseShareHash(buildShareLink(legacy as ProjectDoc).fragment);
    assert.equal((canonicalDecoded as Record<string, unknown>).schema, 4);
  }
});

test("a schema-4 document with gaps canonicalizes in ascending key order", () => {
  /* Lane keys "1", "3" and "4": a gapped wider map (lane 2 removed). */
  const lanes = makeBootLanes(8);
  delete lanes["2"];
  lanes["4"] = makeLane("4", 8);
  lanes["4"].A.bits = fromHex("0A", 8);
  const routing = createRouting();
  const view: ProjectViewState = {
    lane: "4",
    view3d: false,
    split3d: false,
    splitPair: ["1", "3"],
    activePane: 0,
  };
  const doc = serializeProject(lanes, routing, 8, view, null, NOW);
  assert.deepEqual(Object.keys(doc.lanes), ["1", "3", "4"]);

  const canonical = canonicalShareDocument(doc);
  assert.deepEqual(Object.keys(canonical.lanes), ["1", "3", "4"]);
  assert.equal(canonical.view.lane, "4");
  const reloaded = deserializeProject(parseShareHash(buildShareLink(doc).fragment));
  assert.deepEqual(Object.keys(reloaded.lanes), ["1", "3", "4"]);
});

test("canonical links carry unknown top-level fields through load/save", () => {
  const doc = exampleProjectDoc() as ProjectDoc & { futureField: unknown };
  doc.futureField = { keep: true };
  const canonical = canonicalShareDocument(doc) as Record<string, unknown>;
  assert.deepEqual(canonical.futureField, { keep: true });

  const decoded = parseShareHash(buildShareLink(doc).fragment) as Record<string, unknown>;
  assert.deepEqual(decoded.futureField, { keep: true });
  assert.equal(decoded.schema, 4);
});

// ---------------------------------------------------------------------------
// Compact payload (D45)
// ---------------------------------------------------------------------------

/** Decode a `#bw=` fragment to the raw JSON value (array = compact, object = legacy). */
function fragmentValue(fragment: string): unknown {
  assert.ok(fragment.startsWith("#" + SHARE_PREFIX), `not a #bw= fragment: ${fragment.slice(0, 16)}`);
  return JSON.parse(Buffer.from(fragment.slice("#bw=".length), "base64url").toString("utf8"));
}

test("compact payload: array with the schema tag, deterministic and canonical", () => {
  const doc = projectDoc(64);
  const link = buildShareLink(doc);
  const value = fragmentValue(link.fragment);
  assert.ok(Array.isArray(value), "the canonical link is a compact JSON array");
  assert.equal(value[0], COMPACT_SHARE_TAG, "leading tag is the served schema");
  assert.equal(value[1], 64);
  assert.equal(link.payloadChars, link.fragment.length - "#bw=".length);
  assert.ok(link.payloadChars <= SHARE_MAX_CHARS);

  // Equal state => equal link, including a different savedAt and a different
  // route insertion order (canonical routes are destination-sorted).
  const again = buildShareLink({ ...doc, savedAt: "2030-01-01T00:00:00.000Z" });
  const reordered = buildShareLink({ ...doc, routes: doc.routes.slice().reverse() });
  assert.equal(again.fragment, link.fragment);
  assert.equal(reordered.fragment, link.fragment);

  // Expansion restores the full canonical document (not just the engine state).
  const canonical = canonicalShareDocument(doc);
  assert.deepEqual(decodeCompactShare(value), canonical);
  assert.deepEqual(parseShareHash(link.fragment), canonical);
  assert.equal(
    toHex(deserializeProject(decodeShareDocument(value)).lanes["1"].A.bits, 64),
    canonical.lanes["1"].a,
  );
});

test("compact payload omits documented defaults and restores them on expansion", () => {
  // A boot document: all additive defaults (focus A, frames visible, LFO
  // rotcw/4, no expressions), so the trailing tuple fields are omitted.
  const boot = serializeProject(makeBootLanes(64), createRouting(), 64, VIEW, null, NOW);
  const value = fragmentValue(buildShareLink(boot).fragment) as unknown[];
  const laneTuples = value[3] as unknown[][];
  for (const tuple of laneTuples) assert.equal(tuple.length, 10, "default lane tuple keeps 10 fields");
  assert.equal((value[2] as unknown[]).length, 5, "default view tuple keeps 5 fields");

  const expanded = decodeCompactShare(value);
  assert.equal(expanded.view.lfoMode, "rotcw");
  assert.equal(expanded.view.lfoRate, 4);
  for (const lane of Object.values(expanded.lanes)) {
    assert.equal(lane.focus, "a");
    assert.deepEqual(lane.frameVis, { a: true, b: true, z: true });
    assert.equal(lane.expressions, undefined);
  }

  // With extras present the tuple grows: focus/frameVis and LFO are written.
  const withExtras = fragmentValue(buildShareLink(projectDoc(64)).fragment) as unknown[];
  assert.equal((withExtras[2] as unknown[]).length, 7, "non-default LFO mode/rate are written");
  const firstLane = (withExtras[3] as unknown[][])[0];
  assert.ok(firstLane.length >= 12, "non-default focus/frameVis are written");
  const decodedDefaults = decodeCompactShare(withExtras);
  assert.equal(decodedDefaults.lanes["1"].focus, "b");
  assert.deepEqual(decodedDefaults.lanes["1"].frameVis, { a: false, b: true, z: true });
});

test("compact payload keeps expression texts and unknown top-level fields under x", () => {
  const lanes = makeBootLanes(64);
  const doc = serializeProject(lanes, createRouting(), 64, VIEW, null, NOW, {
    expressions: { "2": { b: "round(1.2599210498948732 * C)" } },
  });
  const unknown = doc as ProjectDoc & { futureField: unknown };
  unknown.futureField = { keep: true };

  const value = fragmentValue(buildShareLink(doc).fragment) as unknown[];
  assert.equal(value[6], null, "no dataset: the dataset slot is present but null");
  assert.deepEqual(value[7], { futureField: { keep: true } }, "unknown fields ride under x");

  const expanded = parseShareHash(buildShareLink(doc).fragment) as unknown as ProjectDoc;
  assert.deepEqual(expanded.lanes["2"].expressions, { b: "round(1.2599210498948732 * C)" });
  assert.equal((expanded as unknown as Record<string, unknown>).futureField !== undefined, true);
});

test("legacy JSON payloads still decode, upgrade and canonicalize to compact", () => {
  const legacy = projectDoc(64);
  const legacyFragment = shareFragment(legacy);
  // The raw legacy envelope is a JSON object, not the compact array.
  assert.equal(Array.isArray(decodeShare(legacyFragment.slice("#bw=".length))), false);

  const raw = parseShareHash(legacyFragment) as Record<string, unknown>;
  assert.equal(raw.schema, 4, "a legacy payload is returned for deserializeProject to upgrade");
  assert.equal(raw.savedAt, NOW, "the legacy JSON envelope is returned as written");

  const link = buildShareLink(legacy);
  assert.ok(Array.isArray(fragmentValue(link.fragment)), "the canonical link is compact");
  const upgraded = parseShareHash(link.fragment) as unknown as ProjectDoc;
  assert.equal(upgraded.schema, 4);
  assert.equal(Object.keys(upgraded.lanes).length, 3);
  deserializeProject(upgraded);
});

test("corrupt or truncated compact payloads are refused", () => {
  const malformed = (value: unknown) =>
    assert.throws(
      () => decodeShareDocument(value),
      (error: unknown) => error instanceof ProjectError && error.code === "malformed",
      `expected a malformed compact payload for ${JSON.stringify(value).slice(0, 80)}`,
    );
  malformed([]);
  malformed([COMPACT_SHARE_TAG]);
  malformed([COMPACT_SHARE_TAG, 64, [], [], [], []]);
  malformed([COMPACT_SHARE_TAG, 64, [1, 0, 1, 2, 0], [], [], []]);
  malformed("not an array");

  // A newer codec tag is a distinct, non-lossy refusal.
  assert.throws(
    () => decodeShareDocument([COMPACT_SHARE_TAG + 1, 64]),
    (error: unknown) => error instanceof ProjectError && error.code === "newer-schema",
  );
  // An older/unknown tag is malformed.
  malformed([COMPACT_SHARE_TAG - 1, 64]);

  const good = fragmentValue(buildShareLink(projectDoc(64)).fragment) as unknown[];
  const clone = () => JSON.parse(JSON.stringify(good)) as unknown[];
  const variants: Array<(value: unknown[]) => unknown> = [
    (value) => {
      (value[3] as unknown[][]).length = 0; // a document needs at least one lane
      return value;
    },
    (value) => {
      (value[3] as unknown[][])[0][1] = "AAAA"; // wrong raw-word length for 64 bits
      return value;
    },
    (value) => {
      (value[4] as unknown[][]).push([1, 0, 2, 0]); // route tuple is truncated
      return value;
    },
    (value) => {
      (value[5] as unknown[][]).push([1]); // parked tuple is truncated
      return value;
    },
    (value) => {
      value.push([["id"], "rows"]); // dataset cols/rows are not arrays
      return value;
    },
    (value) => {
      value.push(null); // dataset slot, empty
      value.push("not an object"); // x slot must be an object
      return value;
    },
  ];
  for (const mutate of variants) malformed(mutate(clone()));

  // Truncated base64url/JSON payloads fail at the envelope decode, like before.
  for (const payload of ["WzQs", Buffer.from("[4,64").toString("base64url"), "!!!!"]) {
    assert.throws(
      () => parseShareHash("#" + SHARE_PREFIX + payload),
      (error: unknown) => error instanceof ProjectError && error.code === "malformed",
    );
  }
});

test("share budget: documented fixtures, measured sizes and the drop policy", () => {
  const rows = measureShareBudget();
  type Row = ReturnType<typeof measureShareBudget>[number];
  const row = (lanes: number, N: number, dataset: string, expressions: boolean, routes = 0): Row => {
    const found = rows.find(
      (candidate) =>
        candidate.lanes === lanes &&
        candidate.N === N &&
        candidate.dataset === dataset &&
        candidate.expressions === expressions &&
        candidate.routes === routes,
    );
    assert.ok(found, `missing budget fixture ${lanes}/${N}/${dataset}/${expressions}/${routes}`);
    return found;
  };

  // Requirement table: 3/64, 3/256 and 8/256, each with and without a dataset
  // and with and without expression sources. Exact characters = the proof.
  const expected: Array<[number, number, string, boolean, number]> = [
    [3, 64, "none", false, 243],
    [3, 64, "none", true, 507],
    [3, 64, "demo", false, 458],
    [3, 64, "demo", true, 722],
    [3, 256, "none", false, 500],
    [3, 256, "none", true, 764],
    [3, 256, "demo", false, 715],
    [3, 256, "demo", true, 979],
    [8, 256, "none", false, 1260],
    [8, 256, "none", true, 1978],
    [8, 256, "demo", false, 1475],
  ];
  for (const [lanes, N, dataset, expressions, payloadChars] of expected) {
    const measured = row(lanes, N, dataset, expressions);
    assert.equal(measured.payloadChars, payloadChars, `${lanes}/${N}/${dataset}/expressions=${expressions}`);
    assert.equal(measured.withinBudget, true);
    assert.equal(measured.datasetDropped, false);
    assert.equal(measured.expressionsDropped, false);
  }
  // The target: an 8-lane 256-bit document with no dataset is portable.
  const eightLane = row(8, 256, "none", false);
  assert.ok(eightLane.payloadChars < SHARE_MAX_CHARS, `8/256 is ${eightLane.payloadChars} chars`);
  assert.ok(SHARE_MAX_CHARS - eightLane.payloadChars >= 500, "the 8/256 proof keeps real headroom");

  // Dataset drop first: a big dataset overflows and is dropped, expressions stay.
  const wide = row(8, 256, "wide", false);
  assert.equal(wide.withinBudget, true);
  assert.equal(wide.datasetDropped, true);
  assert.equal(wide.expressionsDropped, false);
  assert.equal(wide.linkPayloadChars, 1260);

  const datasetAndExpressions = row(8, 256, "demo", true);
  assert.equal(datasetAndExpressions.payloadChars, 2192);
  assert.equal(datasetAndExpressions.linkPayloadChars, 1978);
  assert.equal(datasetAndExpressions.datasetDropped, true);
  assert.equal(datasetAndExpressions.expressionsDropped, false, "dataset drop made room, expressions survive");

  // Expressions drop second, only when the dataset was already gone and the
  // link still overflows, and only with the explicit flag.
  const routedExpressions = row(8, 256, "none", true, 8);
  assert.equal(routedExpressions.payloadChars, 2658);
  assert.equal(routedExpressions.linkPayloadChars, 1940);
  assert.equal(routedExpressions.datasetDropped, false);
  assert.equal(routedExpressions.expressionsDropped, true);
  assert.equal(routedExpressions.withinBudget, true);

  const both = row(8, 256, "demo", true, 8);
  assert.equal(both.datasetDropped, true);
  assert.equal(both.expressionsDropped, true);
  assert.equal(both.withinBudget, true);

  // A document that overflows even after both drops is reported, not silently
  // truncated: `withinBudget` is false and no flag pretends otherwise.
  const tooBig = row(8, 256, "none", false, 16);
  assert.equal(tooBig.payloadChars, 2623);
  assert.equal(tooBig.withinBudget, false);
  assert.equal(tooBig.datasetDropped, false);
  assert.equal(tooBig.expressionsDropped, false);

  // The flags describe the actual link payload, not just the numbers.
  const exprsDoc = buildShareBudgetDoc({ lanes: 8, N: 256, dataset: "demo", expressions: true });
  const exprsLink = buildShareLink(exprsDoc);
  const exprsDecoded = parseShareHash(exprsLink.fragment) as unknown as ProjectDoc;
  assert.equal(exprsDecoded.dataset, undefined);
  assert.equal(exprsDecoded.lanes["2"].expressions?.a, "round(1.2599210498948732 * C)");

  const droppedDoc = buildShareBudgetDoc({ lanes: 8, N: 256, routes: 8, expressions: true });
  const droppedLink = buildShareLink(droppedDoc);
  assert.equal(droppedLink.expressionsDropped, true);
  const droppedDecoded = parseShareHash(droppedLink.fragment) as unknown as ProjectDoc;
  assert.equal(droppedDecoded.lanes["2"].expressions, undefined);
  assert.equal(droppedDecoded.routes.length, 8);
  assert.equal(Object.keys(droppedDecoded.parked).length, 8);

  // The fixture builder is deterministic.
  assert.deepEqual(buildShareBudgetDoc({ lanes: 8, N: 256, dataset: "demo", expressions: true }), exprsDoc);
});

test("app capture, canonical builder and build_deeplink produce the same link", () => {
  const captured = captureProject();
  const appLink = buildShareLink(captured);
  const envelope = callTool("build_deeplink", { project: captured });
  assert.equal(envelope.ok, true);
  if (!envelope.ok) return;
  const data = envelope.data as Record<string, unknown>;
  assert.equal(data.fragment, appLink.fragment, "the address bar and build_deeplink agree");
  assert.equal(data.payloadChars, appLink.payloadChars);
  assert.equal(data.expressionsDropped, false);
  assert.equal(envelope.deeplink, appLink.fragment);

  // The same state validates back through the shared project codec.
  assert.deepEqual(parseShareHash(appLink.fragment), canonicalShareDocument(captured));
  assert.deepEqual(deserializeProject(decodeShareDocument(fragmentValue(appLink.fragment))).N, 64);
});

