/**
 * `.bitwave` project round-trip — the non-HTML carryable document.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_SCHEMA,
  ProjectError,
  addRoute,
  createRouting,
  deserializeProject,
  evaluateAll,
  makeBootLanes,
  removeRoute,
  resizeLanes,
  serializeProject,
  stringifyProject,
  parseProject,
  toHex,
} from "../src/core/index.ts";
import type { ProjectDoc, ProjectExtras, ProjectViewState } from "../src/core/project.ts";
import type { LaneKey } from "../src/core/types.ts";

const N = 64;
const NOW = "2026-11-05T00:00:00.000Z";
const VIEW: ProjectViewState = {
  lane: "1",
  view3d: false,
  split3d: false,
  splitPair: ["1", "2"],
  activePane: 0,
};

/** Schema-2 extras as the app captures them: every lane present. */
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

const snapshot = (lanes: ReturnType<typeof makeBootLanes>, n = N): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of ["1", "2", "3"] as LaneKey[]) {
    out[`${key}.a`] = toHex(lanes[key].A.bits, n);
    out[`${key}.b`] = toHex(lanes[key].B.bits, n);
    out[`${key}.z`] = toHex(lanes[key].Z.bits, n);
  }
  return out;
};

function patched(): { lanes: ReturnType<typeof makeBootLanes>; routing: ReturnType<typeof createRouting> } {
  const lanes = makeBootLanes(N);
  const routing = createRouting();
  addRoute(routing, lanes, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  addRoute(routing, lanes, { lane: "1", frame: "z" }, { lane: "2", frame: "b" });
  evaluateAll(routing, lanes, N);
  return { lanes, routing };
}

test("serialize: format, derived Z never stored, routes and parked bases persist", () => {
  const { lanes, routing } = patched();
  const doc = serializeProject(lanes, routing, N, VIEW, null, NOW);

  assert.equal(doc.schema, PROJECT_SCHEMA);
  assert.equal(doc.schema, 2);
  assert.equal(doc.app, "bitwave");
  assert.equal(doc.N, N);
  assert.equal(doc.lanes["1"].a, "0002444281210125");
  assert.equal(doc.lanes["1"].b, "FFFFFFFF00000000");
  assert.ok(!("z" in doc.lanes["1"]), "Z must never be persisted");
  assert.deepEqual(doc.routes, [
    { from: "3.z", to: "1.a", mix: "set" },
    { from: "1.z", to: "2.b", mix: "set" },
  ]);
  assert.deepEqual(Object.keys(doc.parked).sort(), ["1.a", "2.b"]);
  assert.equal(doc.parked["1.a"], "8ADEFEDA85210125");
  assert.equal(doc.view.lane, "1");
  // No extras: the serializer keeps the schema-1 shape.
  assert.ok(!("focus" in doc.lanes["1"]));
  assert.ok(!("frameVis" in doc.lanes["1"]));
  assert.ok(!("lfoMode" in doc.view));
  assert.ok(!("lfoRate" in doc.view));
});

test("round-trip: lanes, routes and view state survive JSON", () => {
  const { lanes, routing } = patched();
  const before = snapshot(lanes);
  const doc = serializeProject(lanes, routing, N, VIEW);
  const loaded = deserializeProject(JSON.parse(stringifyProject(doc)));

  assert.equal(loaded.N, N);
  assert.deepEqual(loaded.view, VIEW);
  assert.deepEqual(snapshot(loaded.lanes), before);
  assert.equal(loaded.routing.routes.length, 2);
  assert.equal(loaded.routing.routes[0].delay, false);
  assert.equal(toHex(loaded.lanes["1"].A.bits, N), "0002444281210125");
});

test("round-trip: unpatching after load restores the parked base", () => {
  const { lanes, routing } = patched();
  const doc = serializeProject(lanes, routing, N, VIEW);
  const loaded = deserializeProject(JSON.parse(stringifyProject(doc)));
  const route = loaded.routing.routes.find((r) => r.to.lane === "1" && r.to.frame === "a");
  assert.ok(route);
  removeRoute(loaded.routing, loaded.lanes, route.id);
  assert.equal(toHex(loaded.lanes["1"].A.bits, N), "8ADEFEDA85210125");
});

test("round-trip at 256 bits keeps the centre-pinned values", () => {
  const lanes = makeBootLanes(N);
  const routing = createRouting();
  resizeLanes(lanes, N, 256);
  addRoute(routing, lanes, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
  evaluateAll(routing, lanes, 256);

  const doc = serializeProject(lanes, routing, 256, VIEW);
  const loaded = deserializeProject(JSON.parse(stringifyProject(doc)));
  assert.equal(loaded.N, 256);
  assert.equal(toHex(loaded.lanes["1"].A.bits, 256), toHex(lanes["1"].A.bits, 256));
  assert.equal(toHex(loaded.lanes["1"].A.bits, 256), "00024442" + "0".repeat(48) + "81210125");
});

test("dataset survives the round-trip", () => {
  const { lanes, routing } = patched();
  const dataset = { cols: ["id", "payload"], rows: [["1", "DEAD"], ["2", "BEEF"]] };
  const loaded = parseProject(stringifyProject(serializeProject(lanes, routing, N, VIEW, dataset)));
  assert.deepEqual(loaded.dataset, dataset);
});

test("schema 1: an older document loads with the v2 defaults", () => {
  const { lanes, routing } = patched();
  // Serializing without extras writes no schema-2 field, i.e. the schema-1 shape.
  const v1 = { ...serializeProject(lanes, routing, N, VIEW, null, NOW), schema: 1 };
  const loaded = deserializeProject(v1);

  assert.deepEqual(loaded.extras.focus, { "1": "a", "2": "a", "3": "a" });
  assert.deepEqual(loaded.extras.frameVis, {
    "1": { a: true, b: true, z: true },
    "2": { a: true, b: true, z: true },
    "3": { a: true, b: true, z: true },
  });
  assert.equal(loaded.extras.lfoMode, "rotcw");
  assert.equal(loaded.extras.lfoRate, 4);
  assert.deepEqual(snapshot(loaded.lanes), snapshot(lanes));
});

test("v2 round-trip preserves focus, frameVis, lfoMode, lfoRate and dataset.index", () => {
  const { lanes, routing } = patched();
  const dataset = { cols: ["id", "payload"], rows: [["1", "DEAD"], ["2", "BEEF"]], index: 1 };
  const doc = serializeProject(lanes, routing, N, VIEW, dataset, NOW, EXTRAS);

  assert.equal(doc.lanes["1"].focus, "b");
  assert.deepEqual(doc.lanes["2"].frameVis, EXTRAS.frameVis!["2"]);
  assert.equal(doc.view.lfoMode, "slide");
  assert.equal(doc.view.lfoRate, 8);
  assert.equal(doc.dataset?.index, 1);

  const loaded = parseProject(stringifyProject(doc));
  assert.deepEqual(loaded.extras, {
    focus: { "1": "b", "2": "z", "3": "a" },
    frameVis: EXTRAS.frameVis,
    lfoMode: "slide",
    lfoRate: 8,
  });
  assert.equal(loaded.dataset?.index, 1);

  // A save of the loaded state is byte-identical to the document it came from.
  const again = serializeProject(
    loaded.lanes,
    loaded.routing,
    N,
    loaded.view,
    loaded.dataset,
    NOW,
    loaded.extras,
  );
  assert.equal(stringifyProject(again), stringifyProject(doc));
});

test("routes and parked bases round-trip byte-identically", () => {
  const { lanes, routing } = patched();
  const doc = serializeProject(lanes, routing, N, VIEW, null, NOW);
  const text = stringifyProject(doc);
  const loaded = parseProject(text);

  const parked: Record<string, string> = {};
  for (const [key, bits] of loaded.routing.parked) {
    parked[key.replace(":", ".")] = toHex(bits, N);
  }
  assert.deepEqual(parked, doc.parked);
  assert.deepEqual(
    loaded.routing.routes.map((r) => ({
      from: `${r.from.lane}.${r.from.frame}`,
      to: `${r.to.lane}.${r.to.frame}`,
      mix: r.mix,
    })),
    doc.routes,
  );

  const again = serializeProject(loaded.lanes, loaded.routing, N, loaded.view, loaded.dataset, NOW);
  assert.equal(stringifyProject(again), text);
});

test("schema-2 additive fields are lenient: bad values fall back, never throw", () => {
  const { lanes, routing } = patched();
  const base = serializeProject(lanes, routing, N, VIEW, null, NOW, EXTRAS);
  const loaded = deserializeProject({
    ...base,
    view: { ...base.view, lfoMode: "bogus", lfoRate: 0 },
    lanes: {
      ...base.lanes,
      "1": { ...base.lanes["1"], focus: "q", frameVis: { a: "yes", b: false, z: true } },
      "2": { ...base.lanes["2"], focus: 7, frameVis: "nope" },
    },
  });

  assert.equal(loaded.extras.focus["1"], "a");
  assert.equal(loaded.extras.focus["2"], "a");
  assert.deepEqual(loaded.extras.frameVis["1"], { a: true, b: false, z: true });
  assert.deepEqual(loaded.extras.frameVis["2"], { a: true, b: true, z: true });
  assert.equal(loaded.extras.lfoMode, "rotcw");
  assert.equal(loaded.extras.lfoRate, 4);
});

test("dataset.index: a valid cursor is kept, an absent/invalid one is omitted", () => {
  const { lanes, routing } = patched();
  const build = (dataset: { cols: string[]; rows: string[][]; index?: number }) =>
    parseProject(stringifyProject(serializeProject(lanes, routing, N, VIEW, dataset, NOW)));

  const kept = build({ cols: ["id"], rows: [["1"], ["2"]], index: 1 });
  assert.deepEqual(kept.dataset, { cols: ["id"], rows: [["1"], ["2"]], index: 1 });

  // Chosen policy: omit rather than zero, so schema-1 documents (and the
  // existing dataset deep-equality) survive unchanged; the app reads `?? 0`.
  const absent = build({ cols: ["id"], rows: [["1"]] });
  assert.ok(absent.dataset);
  assert.ok(!("index" in absent.dataset!), "an absent index stays absent");

  const invalid = build({ cols: ["id"], rows: [["1"]], index: -2 });
  assert.ok(invalid.dataset);
  assert.ok(!("index" in invalid.dataset!), "an invalid index is dropped");
});

test("malformed and future documents are rejected with distinct codes", () => {
  const { lanes, routing } = patched();
  const base = serializeProject(lanes, routing, N, VIEW);

  const newer = { ...base, schema: PROJECT_SCHEMA + 1 };
  assert.throws(
    () => deserializeProject(newer),
    (err: unknown) => err instanceof ProjectError && err.code === "newer-schema",
  );
  assert.throws(
    () => deserializeProject({ ...base, app: "other" }),
    (err: unknown) => err instanceof ProjectError && err.code === "unsupported-app",
  );
  assert.throws(
    () => deserializeProject({ ...base, lanes: { ...base.lanes, "1": { ...base.lanes["1"], a: "zz" } } }),
    (err: unknown) => err instanceof ProjectError && err.code === "malformed",
  );
  assert.throws(
    () =>
      deserializeProject({
        ...base,
        routes: [{ from: "3.z", to: "1.z", mix: "set" }],
      }),
    (err: unknown) => err instanceof ProjectError && err.code === "malformed",
  );
  assert.throws(
    () =>
      deserializeProject({
        ...base,
        routes: [
          { from: "3.z", to: "1.a", mix: "set" },
          { from: "2.z", to: "1.a", mix: "set" },
        ],
      }),
    (err: unknown) => err instanceof ProjectError && err.code === "malformed",
  );
});

test("stringify/parse are stable for a fixed document", () => {
  const { lanes, routing } = patched();
  const doc: ProjectDoc = serializeProject(lanes, routing, N, VIEW, null, NOW);
  const text = stringifyProject(doc);
  const loaded = parseProject(text);
  const again = serializeProject(loaded.lanes, loaded.routing, N, VIEW, null, NOW);
  assert.equal(stringifyProject(again), text);
});
