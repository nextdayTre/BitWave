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
  makeBootLanes,
  serializeProject,
  stringifyProject,
} from "../src/core/index.ts";

const N = 64;
const lanes = makeBootLanes(N);
const routing = createRouting();

// A worked patch from docs/analysis/routing.md §3.6: view 3's derived frame
// drives view 1's A, and view 1's resulting Z drives view 2's A.
addRoute(routing, lanes, { lane: "3", frame: "z" }, { lane: "1", frame: "a" });
addRoute(routing, lanes, { lane: "1", frame: "z" }, { lane: "2", frame: "a" });
evaluateAll(routing, lanes, N);

const dataset = {
  cols: ["id", "sine", "square"],
  rows: [
    ["1", "8ADEFEDA85210125", "FFFFFFFF00000000"],
    ["2", "852101258ADEFEDA", "FFFF0000FFFF0000"],
    ["3", "FEDA852101257ADE", "0F0F0F0F0F0F0F0F"],
  ],
  index: 1,
};

const doc = serializeProject(
  lanes,
  routing,
  N,
  { lane: "1", view3d: false, split3d: false, splitPair: ["1", "2"], activePane: 0 },
  dataset,
  "2026-11-05T00:00:00.000Z",
  {
    focus: { "1": "z", "2": "a", "3": "b" },
    frameVis: {
      "1": { a: true, b: true, z: true },
      "2": { a: true, b: true, z: true },
      "3": { a: true, b: false, z: true },
    },
    lfoMode: "rotcw",
    lfoRate: 4,
  },
);

const out = join(import.meta.dirname, "..", "examples", "demo.bitwave.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, stringifyProject(doc) + "\n", "utf8");
console.log(`wrote ${out} (${doc.routes.length} routes, ${doc.dataset?.rows.length ?? 0} dataset rows)`);
