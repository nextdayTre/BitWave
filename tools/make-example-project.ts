/**
 * Generate examples/demo.bitwave.json from the core engine.
 *
 * Run: node tools/make-example-project.ts
 *
 * This is a developer utility (Node-only), not part of the DOM-free core.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  addRoute,
  createRouting,
  evaluateAll,
  makeBootSlots,
  serializeProject,
  stringifyProject,
} from "../src/core/index.ts";

const N = 64;
const slots = makeBootSlots(N);
const routing = createRouting();

// A worked patch from docs/analysis/routing.md §3.6: view 3's derived frame
// drives view 1's A, and view 1's resulting Z drives view 2's A.
addRoute(routing, slots, { slot: "C", frame: "z" }, { slot: "A", frame: "a" });
addRoute(routing, slots, { slot: "A", frame: "z" }, { slot: "B", frame: "a" });
evaluateAll(routing, slots, N);

const dataset = {
  cols: ["id", "sine", "square"],
  rows: [
    ["1", "8ADEFEDA85210125", "FFFFFFFF00000000"],
    ["2", "852101258ADEFEDA", "FFFF0000FFFF0000"],
    ["3", "FEDA852101257ADE", "0F0F0F0F0F0F0F0F"],
  ],
};

const doc = serializeProject(
  slots,
  routing,
  N,
  { slot: "A", view3d: false, split3d: false, splitPair: ["A", "B"], activePane: 0 },
  dataset,
  "2026-11-05T00:00:00.000Z",
);

const out = join(import.meta.dirname, "..", "examples", "demo.bitwave.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, stringifyProject(doc) + "\n", "utf8");
console.log(`wrote ${out} (${doc.routes.length} routes, ${doc.dataset?.rows.length ?? 0} dataset rows)`);
