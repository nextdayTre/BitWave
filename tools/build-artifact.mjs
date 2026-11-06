#!/usr/bin/env node
/**
 * build-artifact.mjs — turn the Vite build into the shipping single file.
 *
 * Vite writes `dist/index.html` with the JS and CSS inlined by
 * vite-plugin-singlefile. This script verifies the result is truly
 * self-contained (no external `src`/`href`, no `assets/` references) and
 * copies it to the repo root as `bitwave-v2.html` — the exact path the README,
 * the browser check and every user already open.
 *
 * RUN: npm run build
 * EXIT: 0 copied · 1 the build is not a valid single-file artifact.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE = resolve(ROOT, "dist/index.html");
const TARGET = resolve(ROOT, "bitwave-v2.html");

const built = readFileSync(SOURCE, "utf8");

const external = [...built.matchAll(/\s(?:src|href)\s*=\s*"([^"]+)"/g)]
  .map((match) => match[1])
  .filter((url) => !url.startsWith("#") && !url.startsWith("data:"));

const problems = [];
if (external.length) problems.push(`external references: ${external.join(", ")}`);
if (!built.includes("<style")) problems.push("CSS was not inlined");
if (!built.includes("BitWave")) problems.push("app code missing (BitWave not found)");
if (/\bassets\//.test(built)) problems.push("reference to an assets/ path remains");
if (!/<script\b/.test(built)) problems.push("no script tag in the artifact");

if (problems.length) {
  console.error("✘ build is not a valid single-file artifact:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

writeFileSync(TARGET, built);
const kb = (Buffer.byteLength(built) / 1024).toFixed(1);
console.log(`✔ bitwave-v2.html — ${kb} KB, single file, no external references`);
