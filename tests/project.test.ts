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
import type { ProjectDoc, ProjectViewState } from "../src/core/project.ts";
import type { LaneKey } from "../src/core/types.ts";

const N = 64;
const VIEW: ProjectViewState = {
  lane: "1",
  view3d: false,
  split3d: false,
  splitPair: ["1", "2"],
  activePane: 0,
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

test("serialize: format, derived Z is never stored, routes and parked bases persist", () => {
  const { lanes, routing } = patched();
  const doc = serializeProject(lanes, routing, N, VIEW, null, "2026-11-05T00:00:00.000Z");

  assert.equal(doc.schema, PROJECT_SCHEMA);
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
});

test("stringify/parse are stable for a fixed document", () => {
  const { lanes, routing } = patched();
  const doc: ProjectDoc = serializeProject(lanes, routing, N, VIEW, null, "2026-11-05T00:00:00.000Z");
  const text = stringifyProject(doc);
  const loaded = parseProject(text);
  const again = serializeProject(loaded.lanes, loaded.routing, N, VIEW, null, "2026-11-05T00:00:00.000Z");
  assert.equal(stringifyProject(again), text);
});
