/**
 * CSV import + plot geometry — the two contracts that decide whether a cell
 * keeps its value and whether the curve sits over its bits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  alignBits,
  cellToRegister,
  columnGeometry,
  columnMode,
  columnWidth,
  infinityPoint,
  isCompact,
  isDataRow,
  nearestNibble,
  parseDataset,
  parseDelimited,
  plotRect,
  valueFromY,
  widestColumn,
  yOf,
  toHex,
} from "../src/core/index.ts";

test("CSV: quoted commas, doubled quotes, CRLF and tab detection", () => {
  const rows = parseDelimited('id,val\r\n1,"a,b"\r\n2,"say ""hi"""\r\n');
  assert.deepEqual(rows, [
    ["id", "val"],
    ["1", "a,b"],
    ["2", 'say "hi"'],
  ]);

  const tsv = parseDelimited("a\tb\n1\t2\n");
  assert.deepEqual(tsv, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("CSV: header detection and column naming", () => {
  const withHeader = parseDataset("id,payload\n1,DEAD\n2,BEEF\n");
  assert.ok(withHeader);
  assert.deepEqual(withHeader.cols, ["id", "payload"]);
  assert.equal(withHeader.rows.length, 2);

  const headerless = parseDataset("1,DEAD\n2,BEEF\n");
  assert.ok(headerless);
  assert.deepEqual(headerless.cols, ["col1", "col2"]);
  assert.equal(headerless.rows.length, 2);

  assert.equal(parseDataset("   \n\n"), null);
  assert.equal(parseDataset("id,payload\n"), null);
});

test("CSV: column type is decided per column, never per cell", () => {
  // `1011` is binary in an all-0/1 column and hex in a column with a real digit.
  assert.equal(columnMode([["1011"], ["0110"]], 0), "bin");
  assert.equal(columnMode([["1011"], ["DEAD"]], 0), "hex");
  // A header row is data for columnMode purposes here; the loader passes only
  // body rows, which is what this test mirrors.
  assert.ok(isDataRow(["1011", "0110"]));
  assert.ok(!isDataRow(["id", "1011"]));
});

test("CSV: values are right-aligned and overflow truncates high bits", () => {
  assert.equal(toHex(cellToRegister("DEAD", "hex", 64)!, 64), "000000000000DEAD");
  assert.equal(toHex(cellToRegister("0xDEAD", "hex", 64)!, 64), "000000000000DEAD");
  assert.equal(toHex(cellToRegister("1FFFFFFFFFFFFFFFF", "hex", 64)!, 64), "FFFFFFFFFFFFFFFF");
  assert.equal(toHex(cellToRegister("1011", "bin", 8)!, 8), "0B");
  assert.equal(cellToRegister("nope", "hex", 64), null);
  // alignBits expects MSB-first input and writes LSB-first bits, so go through
  // the hex view rather than comparing the raw array order.
  assert.equal(toHex(alignBits([1, 0, 1, 1], 8), 8), "0B");
});

test("CSV: widest token column wins over the first column", () => {
  const rows = [
    ["1", "DEADBEEF"],
    ["2", "CAFEBABE"],
  ];
  assert.equal(columnWidth(rows, 0), 4);
  assert.equal(columnWidth(rows, 1), 32);
  assert.equal(widestColumn(rows), 1);
});

test("geometry: plot rect insets match DESIGN §5", () => {
  assert.deepEqual(plotRect(1440, 800), { x0: 40, x1: 1400, y0: 34, y1: 774, pw: 1360, ph: 740 });
  assert.deepEqual(plotRect(420, 400), { x0: 16, x1: 404, y0: 34, y1: 374, pw: 388, ph: 340 });
});

test("geometry: 16 nibbles at 1440px -> gap 12, width 73.75, centred control points", () => {
  const rect = plotRect(1440, 800);
  const geo = columnGeometry(rect, 16);
  assert.equal(geo.gap, 12);
  assert.equal(geo.width, 73.75);
  assert.equal(geo.xs[0], 76.875);
  assert.equal(geo.xs[15], 1363.125);
  // Symmetric about the viewport centre, constant pitch, first point at w/2.
  assert.equal(geo.xs[0] + geo.xs[15], 1440);
  assert.equal(geo.xs[1] - geo.xs[0], geo.width + geo.gap);
  assert.equal(geo.xs[0] - rect.x0, geo.width / 2);
});

test("geometry: compact threshold is driven by available width, not nibble count", () => {
  assert.equal(isCompact(plotRect(1440, 800), 16), false); // 85.0px/nibble
  assert.equal(isCompact(plotRect(1440, 800), 64), true); // 21.25
  assert.equal(isCompact(plotRect(420, 400), 4), false); // 97
  assert.equal(isCompact(plotRect(420, 400), 16), true); // 24.25
});

test("geometry: nearest nibble and inverse vertical mapping", () => {
  const rect = plotRect(1440, 800);
  const geo = columnGeometry(rect, 16);
  for (const j of [0, 3, 8, 15]) assert.equal(nearestNibble(rect, geo, geo.xs[j]), j);
  assert.equal(nearestNibble(rect, geo, -500), 0);
  assert.equal(nearestNibble(rect, geo, 5000), 15);

  assert.equal(valueFromY(rect, rect.y1), 0);
  assert.equal(valueFromY(rect, rect.y0), 15);
  assert.equal(valueFromY(rect, rect.y1 + 200), 0);
  assert.equal(valueFromY(rect, rect.y0 - 200), 15);
  assert.equal(yOf(rect, 15), rect.y0);
  assert.deepEqual(infinityPoint(rect), { x: 720, y: 404 });
});
