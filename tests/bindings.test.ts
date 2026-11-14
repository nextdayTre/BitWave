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
    ["1a", "1b", "2a", "2b", "3a", "3b"]
  );
  assert.deepEqual(
    inputs.map((row) => row.frame),
    ["A", "B", "C", "D", "E", "F"]
  );
  for (const row of inputs) assert.equal(row.state, "—");
});

test("bindings: a CSV column names the frame label (B)", () => {
  setup();
  bindData(S.lanes["1"], "a", 1);
  const row = describeInput(S.lanes["1"], "a");
  assert.equal(row.state, "data");
  assert.equal(row.source.kind, "data");
  assert.equal(inputLabel(row), "A · sine");
  assert.equal(DEMO.cols[1], "sine");
});

test("bindings: frame sources report 1:1 and z⁻¹", () => {
  setup();
  bindFrame(S.lanes["1"], "a", { lane: "3", frame: "z" });
  const feed = describeInput(S.lanes["1"], "a");
  assert.equal(feed.state, "1:1");
  assert.equal(feed.driven, true);
  assert.equal(driverName(S.lanes["1"], "a"), "Z3");
  assert.equal(inputLabel(feed), "A · Z3");

  bindFrame(S.lanes["2"], "a", { lane: "2", frame: "z" });
  const feedback = describeInput(S.lanes["2"], "a");
  assert.equal(feedback.state, "z⁻¹", "same-lane Z is one evaluation late");
});

test("bindings: switching source kinds clears the other", () => {
  setup();
  bindData(S.lanes["1"], "b", 2);
  assert.equal(S.lanes["1"].colB, 2);
  bindFrame(S.lanes["1"], "b", { lane: "3", frame: "b" });
  assert.equal(S.lanes["1"].colB, -1);
  assert.equal(isInputDriven(S.lanes["1"], "b"), true);

  bindData(S.lanes["1"], "b", 0);
  assert.equal(isInputDriven(S.lanes["1"], "b"), false, "data binding drops the route");
  assert.equal(S.lanes["1"].colB, 0);
});

test("bindings: frame driving and unroute restore the parked base", () => {
  setup();
  bigToReg(0x5n, S.lanes["1"].A);
  bigToReg(0x7n, S.lanes["3"].A);
  bigToReg(0x9n, S.lanes["3"].B);
  evaluate(true);
  const z3 = regToBig(S.lanes["3"].Z);

  bindFrame(S.lanes["1"], "a", { lane: "3", frame: "z" });
  assert.equal(isFocusDriven(S.lanes["1"]), true, "focused A is driven");
  evaluate(true);
  assert.equal(regToBig(S.lanes["1"].A), z3, "Z3 drives lane 1 A");

  bindNone(S.lanes["1"], "a");
  evaluate(true);
  assert.equal(regToBig(S.lanes["1"].A), 0x5n, "unroute restores the parked base");
  assert.equal(isInputDriven(S.lanes["1"], "a"), false);
});

test("bindings: source options exclude the input's own frame", () => {
  setup();
  const options = availableSources(S.lanes["1"], "a");
  assert.equal(options.length, 9);
  assert.equal(options.filter((option) => option.disabled).length, 1);
  assert.equal(options.find((option) => option.disabled)?.name, "A");
});
