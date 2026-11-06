import { test } from "node:test";
import assert from "node:assert/strict";

import {
  availableSources,
  bindData,
  bindFrame,
  bindNone,
  describeInput,
  driverName,
  inputLabel,
  isFocusDriven,
  isInputDriven,
  listInputs,
  resetBindings,
} from "../src/state/bindings.ts";
import { DEMO } from "../src/state/dataset.ts";
import { S, bigToReg, regToBig } from "../src/state/instrument.ts";
import { evaluate } from "../src/state/routing.ts";

const setup = () => {
  resetBindings();
  DEMO.cols = ["id", "sine", "payload"];
  DEMO.rows = [["1", "05", "FEDCBA9876543210"]];
  DEMO.i = 0;
};

test("bindings: six inputs, one per lane/operand, default unbound", () => {
  setup();
  const inputs = listInputs();
  assert.equal(inputs.length, 6);
  assert.deepEqual(
    inputs.map((row) => `${row.lane}${row.operand}`),
    ["Aa", "Ab", "Ba", "Bb", "Ca", "Cb"]
  );
  assert.deepEqual(
    inputs.map((row) => row.frame),
    ["A", "B", "C", "D", "E", "F"]
  );
  for (const row of inputs) assert.equal(row.state, "—");
});

test("bindings: a CSV column names the frame label (B)", () => {
  setup();
  bindData(S.slots.A, "a", 1);
  const row = describeInput(S.slots.A, "a");
  assert.equal(row.state, "data");
  assert.equal(row.source.kind, "data");
  assert.equal(inputLabel(row), "A · sine");
  assert.equal(DEMO.cols[1], "sine");
});

test("bindings: frame sources report 1:1 and z⁻¹", () => {
  setup();
  bindFrame(S.slots.A, "a", { lane: "3", frame: "z" });
  const feed = describeInput(S.slots.A, "a");
  assert.equal(feed.state, "1:1");
  assert.equal(feed.driven, true);
  assert.equal(driverName(S.slots.A, "a"), "Z3");
  assert.equal(inputLabel(feed), "A · Z3");

  bindFrame(S.slots.B, "a", { lane: "2", frame: "z" });
  const feedback = describeInput(S.slots.B, "a");
  assert.equal(feedback.state, "z⁻¹", "same-lane Z is one evaluation late");
});

test("bindings: switching source kinds clears the other", () => {
  setup();
  bindData(S.slots.A, "b", 2);
  assert.equal(S.slots.A.colB, 2);
  bindFrame(S.slots.A, "b", { lane: "3", frame: "b" });
  assert.equal(S.slots.A.colB, -1);
  assert.equal(isInputDriven(S.slots.A, "b"), true);

  bindData(S.slots.A, "b", 0);
  assert.equal(isInputDriven(S.slots.A, "b"), false, "data binding drops the route");
  assert.equal(S.slots.A.colB, 0);
});

test("bindings: frame driving and unroute restore the parked base", () => {
  setup();
  bigToReg(0x5n, S.slots.A.A);
  bigToReg(0x7n, S.slots.C.A);
  bigToReg(0x9n, S.slots.C.B);
  evaluate(true);
  const z3 = regToBig(S.slots.C.Z);

  bindFrame(S.slots.A, "a", { lane: "3", frame: "z" });
  assert.equal(isFocusDriven(S.slots.A), true, "focused A is driven");
  evaluate(true);
  assert.equal(regToBig(S.slots.A.A), z3, "Z3 drives lane 1 A");

  bindNone(S.slots.A, "a");
  evaluate(true);
  assert.equal(regToBig(S.slots.A.A), 0x5n, "unroute restores the parked base");
  assert.equal(isInputDriven(S.slots.A, "a"), false);
});

test("bindings: source options exclude the input's own frame", () => {
  setup();
  const options = availableSources(S.slots.A, "a");
  assert.equal(options.length, 9);
  assert.equal(options.filter((option) => option.disabled).length, 1);
  assert.equal(options.find((option) => option.disabled)?.name, "A");
});
