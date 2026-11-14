/**
 * `.bitwave` project round-trip — the non-HTML carryable document.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_SCHEMA,
  ProjectError,
  addRoute,
  computeZ,
  createRouting,
  deserializeProject,
  evaluateAll,
  fromHex,
  makeBootLanes,
  makeLane,
  removeRoute,
  resizeLanes,
  serializeProject,
  stringifyProject,
  parseProject,
  toHex,
} from "../src/core/index.ts";
import { APP_LANE_CAP, laneDefs } from "../src/core/lanedefs.ts";
import { bootProjectDoc } from "../src/core/agent-defaults.ts";
import type { LaneMap } from "../src/core/types.ts";
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
  assert.equal(doc.schema, 4);
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
    expressions: { "1": {}, "2": {}, "3": {} },
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

test("schema 3: expression sources round-trip additively", () => {
  const { lanes, routing } = patched();
  const expressions = {
    "1": { a: "round(1.2599210498948732 * C)" },
    "3": { b: "E + log.E" },
  };
  const doc = serializeProject(lanes, routing, N, VIEW, null, NOW, { expressions });
  assert.equal(doc.schema, 4);
  assert.deepEqual(doc.lanes["1"].expressions, { a: "round(1.2599210498948732 * C)" });
  assert.deepEqual(doc.lanes["3"].expressions, { b: "E + log.E" });
  assert.ok(!("expressions" in doc.lanes["2"]), "empty expressions are omitted");

  const loaded = parseProject(stringifyProject(doc));
  assert.deepEqual(loaded.extras.expressions, {
    "1": { a: "round(1.2599210498948732 * C)" },
    "2": {},
    "3": { b: "E + log.E" },
  });

  // Schema-2 and schema-1 documents load with empty expression sources.
  const legacyLanes = Object.fromEntries(
    Object.entries(doc.lanes).map(([lane, data]) => {
      const { expressions: _expressions, ...rest } = data;
      return [lane, rest];
    }),
  );
  const older = deserializeProject({ ...doc, schema: 2, lanes: legacyLanes });
  assert.deepEqual(older.extras.expressions, { "1": {}, "2": {}, "3": {} });
});

test("schema 3: expression source values are lenient", () => {
  const { lanes, routing } = patched();
  const doc = serializeProject(lanes, routing, N, VIEW, null, NOW);
  const loaded = deserializeProject({
    ...doc,
    lanes: {
      ...doc.lanes,
      "1": { ...doc.lanes["1"], expressions: { a: "  C + 1  ", b: 42 } },
      "2": { ...doc.lanes["2"], expressions: "nope" },
      "3": { ...doc.lanes["3"], expressions: { a: "x".repeat(5000) } },
    },
  });
  assert.deepEqual(loaded.extras.expressions, {
    "1": { a: "C + 1" },
    "2": {},
    "3": {},
  });
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

/* ---------------------------------------------------------------------------
 * Schema 4 (D44): a lane map keyed by the stable lane key.
 * ------------------------------------------------------------------------- */

/** A lane map for the given stable keys, each with a distinct A and a shared B. */
function lanesForKeys(keys: readonly string[], n = 16): LaneMap {
  const lanes = {} as LaneMap;
  keys.forEach((key, index) => {
    const lane = makeLane(key, n);
    lane.A.bits = fromHex((index + 1).toString(16).toUpperCase().padStart(n / 4, "0"), n);
    lane.B.bits = fromHex("0F".padStart(n / 4, "0"), n);
    lane.binop = "xor";
    lanes[key] = lane;
  });
  return lanes;
}

test("schema 4: the boot three-lane document keeps its values in the new shape", () => {
  const doc = bootProjectDoc();
  assert.equal(doc.schema, 4);
  assert.deepEqual(Object.keys(doc.lanes), ["1", "2", "3"]);
  const boot = makeBootLanes(64);
  for (const key of ["1", "2", "3"] as LaneKey[]) {
    assert.equal(doc.lanes[key].a, toHex(boot[key].A.bits, 64), `lane ${key} A`);
    assert.equal(doc.lanes[key].b, toHex(boot[key].B.bits, 64), `lane ${key} B`);
    assert.ok(!("z" in doc.lanes[key]), "Z must never be persisted");
  }
  /* Loading the boot document reproduces the boot engine state. */
  const loaded = deserializeProject(doc);
  for (const key of ["1", "2", "3"] as LaneKey[]) {
    assert.equal(toHex(loaded.lanes[key].A.bits, 64), toHex(boot[key].A.bits, 64), `loaded lane ${key} A`);
    assert.equal(toHex(loaded.lanes[key].Z.bits, 64), toHex(boot[key].Z.bits, 64), `loaded lane ${key} Z`);
  }
});

test("schema 4: a full-cap document (8 lanes, A–P / Z1–Z8) loads, derives Z and routes", () => {
  const keys = laneDefs(APP_LANE_CAP).map((def) => def.key);
  const lanes = lanesForKeys(keys);
  const routing = createRouting();
  addRoute(routing, lanes, { lane: "8", frame: "z" }, { lane: "4", frame: "a" });
  evaluateAll(routing, lanes, 16);

  const doc = serializeProject(lanes, routing, 16, VIEW, null, NOW);
  assert.equal(doc.schema, 4);
  assert.equal(Object.keys(doc.lanes).length, APP_LANE_CAP);
  assert.deepEqual(Object.keys(doc.lanes), keys);

  /* Frame names derive from the stable key, not the array position (D43). */
  assert.deepEqual(
    laneDefs(APP_LANE_CAP).map((def) => `${def.key}:${def.a}${def.b}/${def.z}`),
    ["1:AB/Z1", "2:CD/Z2", "3:EF/Z3", "4:GH/Z4", "5:IJ/Z5", "6:KL/Z6", "7:MN/Z7", "8:OP/Z8"],
  );

  const loaded = deserializeProject(JSON.parse(stringifyProject(doc)));
  assert.deepEqual(Object.keys(loaded.lanes), keys);
  for (const key of keys) {
    const lane = loaded.lanes[key];
    assert.equal(lane.key, key);
    assert.equal(
      toHex(lane.Z.bits, 16),
      toHex(computeZ(lane.A.bits, lane.B.bits, 16, lane.binop), 16),
      `lane ${key} Z is derived`,
    );
  }
  /* The cross-lane route resolves on load: lane 4 A is lane 8 Z, and its base parked. */
  assert.equal(toHex(loaded.lanes["8"].Z.bits, 16), "0007");
  assert.equal(toHex(loaded.lanes["4"].A.bits, 16), "0007");
  assert.equal(loaded.routing.routes.length, 1);
  assert.equal(loaded.routing.routes[0].delay, false);
  assert.ok(loaded.routing.parked.has("4:a"), "the driven base is parked");
});

test("schema 4: lane maps may have gaps; canonical order is ascending numeric", () => {
  const lanes = lanesForKeys(["4", "1", "3"]);
  const view: ProjectViewState = {
    lane: "4",
    view3d: false,
    split3d: false,
    splitPair: ["3", "4"],
    activePane: 0,
  };
  const doc = serializeProject(lanes, createRouting(), 16, view, null, NOW);
  assert.deepEqual(Object.keys(doc.lanes), ["1", "3", "4"], "ascending numeric order, gaps kept");

  const text = stringifyProject(doc);
  assert.deepEqual(Object.keys(JSON.parse(text).lanes), ["1", "3", "4"]);

  const loaded = parseProject(text);
  assert.deepEqual(Object.keys(loaded.lanes), ["1", "3", "4"]);
  assert.equal(loaded.view.lane, "4");
  assert.deepEqual(loaded.view.splitPair, ["3", "4"], "view references survive for existing lanes");
  assert.equal(toHex(loaded.lanes["4"].A.bits, 16), toHex(lanes["4"].A.bits, 16));

  /* Canonical form is stable: load -> save is byte-identical. */
  const again = serializeProject(loaded.lanes, loaded.routing, loaded.N, loaded.view, loaded.dataset, NOW);
  assert.equal(stringifyProject(again), text);
});

test("schema 4: 9 lanes and invalid lane keys are refused with a clear error", () => {
  const tooMany = laneDefs(9).map((def) => def.key);
  assert.throws(
    () => serializeProject(lanesForKeys(tooMany), createRouting(), 16, VIEW, null, NOW),
    (err: unknown) =>
      err instanceof ProjectError && err.code === "malformed" && /at most 8 lanes; got 9/.test(err.message),
  );
  assert.throws(
    () => serializeProject(lanesForKeys(["0"]), createRouting(), 16, VIEW, null, NOW),
    (err: unknown) =>
      err instanceof ProjectError && err.code === "malformed" && /invalid lane key "0"/.test(err.message),
  );

  const three = serializeProject(makeBootLanes(16), createRouting(), 16, VIEW, null, NOW);
  const nineDoc = {
    ...three,
    lanes: {
      ...three.lanes,
      "4": three.lanes["1"],
      "5": three.lanes["2"],
      "6": three.lanes["3"],
      "7": three.lanes["1"],
      "8": three.lanes["2"],
      "9": three.lanes["3"],
    },
  };
  assert.throws(
    () => deserializeProject(nineDoc),
    (err: unknown) =>
      err instanceof ProjectError && err.code === "malformed" && /at most 8 lanes; got 9/.test(err.message),
  );
  for (const bad of ["0", "14", "abc", "01"]) {
    const doc = { ...three, schema: 4, lanes: { ...three.lanes, [bad]: three.lanes["1"] } };
    assert.throws(
      () => deserializeProject(doc),
      (err: unknown) =>
        err instanceof ProjectError && err.code === "malformed" && /invalid lane key/.test(err.message),
      `lane key ${JSON.stringify(bad)} must be refused`,
    );
  }
  /* A schema-5 document takes the existing newer-schema path. */
  assert.throws(
    () => deserializeProject({ ...three, schema: 5 }),
    (err: unknown) => err instanceof ProjectError && err.code === "newer-schema",
  );
});

/* ---------------------------------------------------------------------------
 * Migration fixtures: real schema 1/2/3 documents (three-lane object) -> 4.
 * ------------------------------------------------------------------------- */

const LEGACY_LANES: ProjectDoc["lanes"] = {
  "1": { a: "DEAD", b: "BEEF", showB: true, binop: "and", edit: "b", seededB: true, lfoB: "opp", colA: 0, colB: 2 },
  "2": { a: "0123", b: "4567", showB: false, binop: "xor", edit: "a", seededB: false, lfoB: "0", colA: -1, colB: -1 },
  "3": { a: "89AB", b: "CDEF", showB: true, binop: "add", edit: "a", seededB: true, lfoB: "q", colA: 1, colB: -1 },
};

const LEGACY_BASE = {
  app: "bitwave" as const,
  savedAt: NOW,
  N: 16,
  view: { lane: "2", view3d: false, split3d: false, splitPair: ["1", "2"] as [LaneKey, LaneKey], activePane: 0 as const },
  routes: [{ from: "1.z", to: "3.a", mix: "set" as const }],
  parked: { "3.a": "89AB" },
};

test("migration: a schema-1 document upgrades to schema 4 with the additive defaults", () => {
  const loaded = deserializeProject({ ...LEGACY_BASE, schema: 1, lanes: LEGACY_LANES });
  assert.deepEqual(Object.keys(loaded.lanes), ["1", "2", "3"]);
  assert.equal(toHex(loaded.lanes["1"].A.bits, 16), "DEAD");
  assert.equal(toHex(loaded.lanes["1"].B.bits, 16), "BEEF");
  assert.deepEqual(loaded.extras.focus, { "1": "a", "2": "a", "3": "a" });
  assert.equal(loaded.extras.lfoMode, "rotcw");
  assert.equal(loaded.extras.lfoRate, 4);
  assert.equal(toHex(loaded.lanes["3"].Z.bits, 16), toHex(computeZ(loaded.lanes["3"].A.bits, loaded.lanes["3"].B.bits, 16, "add"), 16));

  const saved = serializeProject(loaded.lanes, loaded.routing, loaded.N, loaded.view, loaded.dataset, NOW, loaded.extras);
  assert.equal(saved.schema, 4);
  assert.deepEqual(Object.keys(saved.lanes), ["1", "2", "3"]);
});

test("migration: schema-2 and schema-3 documents upgrade additively and keep their extras", () => {
  const v2 = {
    ...LEGACY_BASE,
    schema: 2,
    lanes: {
      "1": { ...LEGACY_LANES["1"], focus: "b", frameVis: { a: false, b: true, z: true } },
      "2": { ...LEGACY_LANES["2"], focus: "z" },
      "3": { ...LEGACY_LANES["3"] },
    },
    view: { ...LEGACY_BASE.view, lfoMode: "slide", lfoRate: 8 },
    dataset: { cols: ["x"], rows: [["1"], ["2"]], index: 1 },
  };
  const loaded2 = deserializeProject(v2);
  assert.equal(loaded2.extras.focus["1"], "b");
  assert.deepEqual(loaded2.extras.frameVis["1"], { a: false, b: true, z: true });
  assert.equal(loaded2.extras.lfoMode, "slide");
  assert.equal(loaded2.extras.lfoRate, 8);
  assert.equal(loaded2.dataset?.index, 1);
  assert.equal(serializeProject(loaded2.lanes, loaded2.routing, loaded2.N, loaded2.view, loaded2.dataset, NOW, loaded2.extras).schema, 4);

  const v3 = {
    ...v2,
    schema: 3,
    lanes: {
      ...v2.lanes,
      "1": { ...v2.lanes["1"], expressions: { a: "round(2 * C)" } },
      "3": { ...v2.lanes["3"], expressions: { b: "E + log.E" } },
    },
  };
  const loaded3 = deserializeProject(v3);
  assert.deepEqual(loaded3.extras.expressions, {
    "1": { a: "round(2 * C)" },
    "2": {},
    "3": { b: "E + log.E" },
  });
  const saved3 = serializeProject(loaded3.lanes, loaded3.routing, loaded3.N, loaded3.view, loaded3.dataset, NOW, loaded3.extras);
  assert.equal(saved3.schema, 4);
  assert.deepEqual(saved3.lanes["1"].expressions, { a: "round(2 * C)" });
  /* The upgraded document loads again byte-identically. */
  const reloaded = deserializeProject(JSON.parse(stringifyProject(saved3)));
  assert.deepEqual(reloaded.extras.expressions, loaded3.extras.expressions);
});

test("migration: schema 1-3 still require the closed three-lane object", () => {
  const twoLanes = { ...LEGACY_BASE, schema: 3, lanes: { "1": LEGACY_LANES["1"], "2": LEGACY_LANES["2"] } };
  assert.throws(
    () => deserializeProject(twoLanes),
    (err: unknown) =>
      err instanceof ProjectError && err.code === "malformed" && /must carry lanes 1, 2, 3/.test(err.message),
  );
  const gappedV3 = { ...LEGACY_BASE, schema: 3, lanes: { "1": LEGACY_LANES["1"], "3": LEGACY_LANES["3"] } };
  assert.throws(
    () => deserializeProject(gappedV3),
    (err: unknown) => err instanceof ProjectError && err.code === "malformed",
  );
});
