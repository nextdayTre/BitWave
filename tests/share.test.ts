/**
 * URL-share codec — JSON project document -> UTF-8 -> unpadded base64url.
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
  SHARE_MAX_CHARS,
  SHARE_PREFIX,
  decodeShare,
  encodeShare,
  parseShareHash,
  shareFragment,
} from "../src/core/share.ts";
import { buildShareLink, canonicalShareDocument } from "../src/core/agent-share.ts";
import { exampleProjectDoc } from "../src/core/agent-defaults.ts";
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

