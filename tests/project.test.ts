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
  makeBootSlots,
  removeRoute,
  resizeSlots,
  serializeProject,
  stringifyProject,
  parseProject,
  toHex,
} from "../src/core/index.ts";
import type { ProjectDoc, ProjectViewState } from "../src/core/project.ts";
import type { SlotKey } from "../src/core/types.ts";

const N = 64;
const VIEW: ProjectViewState = {
  slot: "A",
  view3d: false,
  split3d: false,
  splitPair: ["A", "B"],
  activePane: 0,
};

const snapshot = (slots: ReturnType<typeof makeBootSlots>, n = N): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of ["A", "B", "C"] as SlotKey[]) {
    out[`${key}.a`] = toHex(slots[key].A.bits, n);
    out[`${key}.b`] = toHex(slots[key].B.bits, n);
    out[`${key}.z`] = toHex(slots[key].Z.bits, n);
  }
  return out;
};

function patched(): { slots: ReturnType<typeof makeBootSlots>; routing: ReturnType<typeof createRouting> } {
  const slots = makeBootSlots(N);
  const routing = createRouting();
  addRoute(routing, slots, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });
  addRoute(routing, slots, { slot: "A", frame: "z" }, { slot: "B", frame: "b" });
  evaluateAll(routing, slots, N);
  return { slots, routing };
}

test("serialize: format, derived Z is never stored, routes and parked bases persist", () => {
  const { slots, routing } = patched();
  const doc = serializeProject(slots, routing, N, VIEW, null, "2026-11-05T00:00:00.000Z");

  assert.equal(doc.schema, PROJECT_SCHEMA);
  assert.equal(doc.app, "bitwave");
  assert.equal(doc.N, N);
  assert.equal(doc.slots.A.a, "0002444281210125");
  assert.equal(doc.slots.A.b, "FFFFFFFF00000000");
  assert.ok(!("z" in doc.slots.A), "Z must never be persisted");
  assert.deepEqual(doc.routes, [
    { from: "C.z", to: "A.a", mix: "set" },
    { from: "A.z", to: "B.b", mix: "set" },
  ]);
  assert.deepEqual(Object.keys(doc.parked).sort(), ["A.a", "B.b"]);
  assert.equal(doc.parked["A.a"], "8ADEFEDA85210125");
  assert.equal(doc.view.slot, "A");
});

test("round-trip: slots, routes and view state survive JSON", () => {
  const { slots, routing } = patched();
  const before = snapshot(slots);
  const doc = serializeProject(slots, routing, N, VIEW);
  const loaded = deserializeProject(JSON.parse(stringifyProject(doc)));

  assert.equal(loaded.N, N);
  assert.deepEqual(loaded.view, VIEW);
  assert.deepEqual(snapshot(loaded.slots), before);
  assert.equal(loaded.routing.routes.length, 2);
  assert.equal(loaded.routing.routes[0].delay, false);
  assert.equal(toHex(loaded.slots.A.A.bits, N), "0002444281210125");
});

test("round-trip: unpatching after load restores the parked base", () => {
  const { slots, routing } = patched();
  const doc = serializeProject(slots, routing, N, VIEW);
  const loaded = deserializeProject(JSON.parse(stringifyProject(doc)));
  const route = loaded.routing.routes.find((r) => r.to.slot === "A" && r.to.frame === "a");
  assert.ok(route);
  removeRoute(loaded.routing, loaded.slots, route.id);
  assert.equal(toHex(loaded.slots.A.A.bits, N), "8ADEFEDA85210125");
});

test("round-trip at 256 bits keeps the centre-pinned values", () => {
  const slots = makeBootSlots(N);
  const routing = createRouting();
  resizeSlots(slots, N, 256);
  addRoute(routing, slots, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });
  evaluateAll(routing, slots, 256);

  const doc = serializeProject(slots, routing, 256, VIEW);
  const loaded = deserializeProject(JSON.parse(stringifyProject(doc)));
  assert.equal(loaded.N, 256);
  assert.equal(toHex(loaded.slots.A.A.bits, 256), toHex(slots.A.A.bits, 256));
  assert.equal(toHex(loaded.slots.A.A.bits, 256), "00024442" + "0".repeat(48) + "81210125");
});

test("dataset survives the round-trip", () => {
  const { slots, routing } = patched();
  const dataset = { cols: ["id", "payload"], rows: [["1", "DEAD"], ["2", "BEEF"]] };
  const loaded = parseProject(stringifyProject(serializeProject(slots, routing, N, VIEW, dataset)));
  assert.deepEqual(loaded.dataset, dataset);
});

test("malformed and future documents are rejected with distinct codes", () => {
  const { slots, routing } = patched();
  const base = serializeProject(slots, routing, N, VIEW);

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
    () => deserializeProject({ ...base, slots: { ...base.slots, A: { ...base.slots.A, a: "zz" } } }),
    (err: unknown) => err instanceof ProjectError && err.code === "malformed",
  );
  assert.throws(
    () =>
      deserializeProject({
        ...base,
        routes: [{ from: "C.z", to: "A.z", mix: "set" }],
      }),
    (err: unknown) => err instanceof ProjectError && err.code === "malformed",
  );
});

test("stringify/parse are stable for a fixed document", () => {
  const { slots, routing } = patched();
  const doc: ProjectDoc = serializeProject(slots, routing, N, VIEW, null, "2026-11-05T00:00:00.000Z");
  const text = stringifyProject(doc);
  const loaded = parseProject(text);
  const again = serializeProject(loaded.slots, loaded.routing, N, VIEW, null, "2026-11-05T00:00:00.000Z");
  assert.equal(stringifyProject(again), text);
});
