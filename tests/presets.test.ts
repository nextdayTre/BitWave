/**
 * Analytical & LFO modulation presets (D54).
 *
 * Proves that every preset in `src/core/presets.ts`:
 *  - produces a deterministic, valid schema-5 `.bitwave` document;
 *  - round-trips through the compact share codec;
 *  - applies cleanly via `applyProject` with zero expression errors (with Record
 *    primed for `log.<frame>` presets); and
 *  - satisfies its documented bit-level / DSP invariant.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { PATCH_PRESETS, findPatchPreset } from "../src/core/presets.ts";
import { deserializeProject } from "../src/core/project.ts";
import { decodeShare, decodeShareDocument, encodeCompactShare } from "../src/core/share.ts";
import { bitsToNibbles, regToBig, toHex } from "../src/core/registers.ts";
import { invert, rotateLeft } from "../src/core/ops.ts";
import { S, syncTarget } from "../src/state/instrument.ts";
import { applyProject, captureProject, rememberUnknownFields } from "../src/state/project-bridge.ts";
import { evaluate } from "../src/state/routing.ts";
import { clearRecording, recordSnapshot, startRecording } from "../src/state/record.ts";

const pristine = captureProject();
after(() => {
  applyProject(pristine);
  clearRecording();
  rememberUnknownFields({});
});

function popcount(x: bigint): number {
  let c = 0;
  let v = x;
  while (v > 0n) {
    v &= v - 1n;
    c += 1;
  }
  return c;
}

function loadAndPrime(id: string): void {
  const preset = findPatchPreset(id);
  assert.ok(preset, `missing preset: ${id}`);
  const result = applyProject(preset.build());
  assert.equal(result.ok, true, `${id}: ${result.message}`);
  if (preset.record) {
    startRecording();
    recordSnapshot();
    evaluate(true);
    recordSnapshot();
  }
  assert.deepEqual(S.expressionErrors, {}, `${id} had expression errors`);
}

test("PATCH_PRESETS metadata is unique, deterministic and schema-5 valid", () => {
  assert.equal(PATCH_PRESETS.length, 10);
  const ids = new Set<string>();
  for (const preset of PATCH_PRESETS) {
    assert.ok(!ids.has(preset.id), `duplicate id: ${preset.id}`);
    ids.add(preset.id);
    assert.ok(preset.name.trim().length > 0);
    assert.ok(preset.summary.trim().length > 0);
    assert.ok(preset.description.trim().length > 0);
    assert.ok([1, 2, 4, 8].includes(preset.amount));

    const a = preset.build();
    const b = preset.build();
    assert.deepEqual(a, b, `${preset.id} build() is not deterministic`);

    const loaded = deserializeProject(a);
    assert.equal(loaded.N, a.N);

    /* Compact share round-trip must succeed for every preset. */
    const token = encodeCompactShare(a);
    const decoded = decodeShareDocument(decodeShare(token));
    assert.equal(decoded.N, a.N);
  }
});

test("every built-in preset loads cleanly with zero expression errors", () => {
  for (const preset of PATCH_PRESETS) {
    loadAndPrime(preset.id);
    assert.equal(S.N, preset.build().N);
  }
});

test("xor-carrier-cancel recovers ~B identically across counter-rotating ticks", () => {
  loadAndPrime("xor-carrier-cancel");
  const l1 = S.lanes["1"];
  const l2 = S.lanes["2"];
  const aBase = l1.A.bits.slice();
  const bBase = l1.B.bits.slice();
  const dBase = l2.B.bits.slice();

  for (let t = 0; t < 5; t += 1) {
    const shift = t * 8;
    l1.A.bits = rotateLeft(aBase, S.N, shift);
    l1.B.bits = rotateLeft(bBase, S.N, -shift);
    l2.B.bits = rotateLeft(dBase, S.N, shift);
    evaluate(true);

    const invB = toHex(invert(l1.B.bits, S.N), S.N);
    assert.equal(toHex(l2.Z.bits, S.N), invB, `tick ${t}: Z2 should equal ~B`);
    assert.equal(popcount(regToBig(l2.Z.bits, S.N)), 128);
  }
});

test("carry-chain decomposes ADD into half-adder sum C and carry wave D with Z2 === Z1", () => {
  loadAndPrime("carry-chain");
  const l1 = S.lanes["1"];
  const l2 = S.lanes["2"];
  assert.equal(toHex(l2.Z.bits, S.N), toHex(l1.Z.bits, S.N));
  assert.ok(popcount(regToBig(l2.B.bits, S.N)) > 0, "carry wave should be non-zero");
});

test("swar-wavefolder computes carry-free nibble mod-16 add and isolates carry bleed", () => {
  loadAndPrime("swar-wavefolder");
  const aNibs = bitsToNibbles(S.lanes["1"].A.bits, S.N);
  const bNibs = bitsToNibbles(S.lanes["1"].B.bits, S.N);
  const dNibs = bitsToNibbles(S.lanes["2"].B.bits, S.N);
  for (let i = 0; i < aNibs.length; i += 1) {
    assert.equal(dNibs[i], (aNibs[i] + bNibs[i]) & 15, `nibble ${i} mod-16 mismatch`);
  }
  assert.ok(popcount(regToBig(S.lanes["2"].Z.bits, S.N)) > 0, "carry bleed diff should be non-zero");
});

test("takagi-fractal builds 3 carry-free octaves into F4 and focuses F4", () => {
  loadAndPrime("takagi-fractal");
  assert.equal(S.activeFree, "4");
  assert.equal(S.view3d, false);
  const f4 = toHex(S.freeFrames["4"].reg.bits, S.N);
  assert.equal(f4, "0000333355556666777788888888877777788888888877776666555533330000");
});

test("gray-code-diff round-trips SWAR Gray encode/decode back to exact A", () => {
  loadAndPrime("gray-code-diff");
  const aHex = toHex(S.lanes["1"].A.bits, S.N);
  const decodedHex = toHex(S.lanes["3"].B.bits, S.N);
  assert.equal(decodedHex, aHex);
  assert.ok(popcount(regToBig(S.lanes["2"].Z.bits, S.N)) > 0, "Word vs SWAR Gray diff should be non-zero");
});

test("avalanche-meter flips 1 input bit and diffuses ~50% of 64 output bits", () => {
  loadAndPrime("avalanche-meter");
  const a = regToBig(S.lanes["1"].A.bits, S.N);
  const z1 = regToBig(S.lanes["1"].Z.bits, S.N);
  assert.equal(popcount(a ^ z1), 1);
  const diffPop = popcount(regToBig(S.lanes["2"].Z.bits, S.N));
  assert.ok(diffPop >= 20 && diffPop <= 44, `unexpected avalanche popcount: ${diffPop}`);
});

test("rc-slew-radar detects Dirac edges and builds an exponential SWAR IIR tail", () => {
  loadAndPrime("rc-slew-radar");
  S.lanes["1"].A.bits = rotateLeft(S.lanes["1"].A.bits, S.N, 4);
  syncTarget(S.lanes["1"].A, true);
  evaluate(true);
  recordSnapshot();
  assert.equal(toHex(S.lanes["1"].B.bits, S.N), "0000000F0000000F");
  assert.equal(toHex(S.lanes["2"].B.bits, S.N), "FFFFFFF700000007");
});

test("rule-90-sierpinski evolves Gould-sequence fractal generations via log.A", () => {
  loadAndPrime("rule-90-sierpinski");
  assert.equal(toHex(S.lanes["1"].A.bits, S.N), "0000000280000000");
  evaluate(true);
  recordSnapshot();
  assert.equal(toHex(S.lanes["1"].A.bits, S.N), "0000000440000000");
  evaluate(true);
  recordSnapshot();
  assert.equal(toHex(S.lanes["1"].A.bits, S.N), "0000000AA0000000");
});

test("rule-30-110-ca advances Rule 30 and Rule 110 side-by-side cleanly", () => {
  loadAndPrime("rule-30-110-ca");
  assert.equal(toHex(S.lanes["1"].A.bits, S.N), "0000000380000000");
  assert.equal(toHex(S.lanes["2"].A.bits, S.N), "0000000300000000");
  evaluate(true);
  recordSnapshot();
  assert.equal(toHex(S.lanes["1"].A.bits, S.N), "0000000640000000");
  assert.equal(toHex(S.lanes["2"].A.bits, S.N), "0000000700000000");
});

test("bitcrush-tdm reconstructs exact A from 2-bit quantize + error and interleaves A/B", () => {
  loadAndPrime("bitcrush-tdm");
  const aHex = toHex(S.lanes["1"].A.bits, S.N);
  const bHex = toHex(S.lanes["1"].B.bits, S.N);
  assert.equal(toHex(S.lanes["2"].Z.bits, S.N), aHex);
  const z3 = regToBig(S.lanes["3"].Z.bits, S.N);
  assert.equal(z3, regToBig(S.lanes["1"].A.bits, S.N) ^ regToBig(S.lanes["1"].B.bits, S.N));
  assert.notEqual(toHex(S.lanes["3"].A.bits, S.N), aHex);
  assert.notEqual(toHex(S.lanes["3"].A.bits, S.N), bHex);
});
