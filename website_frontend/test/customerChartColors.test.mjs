import test from "node:test";
import assert from "node:assert/strict";
import { customerChartColors } from "../src/utils/customerChartColors.js";

const names = [
  "Coreweave Denton",
  "Coreweave North Dakota 1",
  "Coreweave North Dakota 2",
  "Acme Dallas",
  "Unassigned",
];

function hue(color) {
  return Number(/^hsl\((\d+)/.exec(color)?.[1]);
}

function hueDistance(a, b) {
  const difference = Math.abs(hue(a) - hue(b));
  return Math.min(difference, 360 - difference);
}

test("customer colors reflect name families and numbered variants", () => {
  const colors = customerChartColors(names);
  const numberedDistance = hueDistance(
    colors["Coreweave North Dakota 1"], colors["Coreweave North Dakota 2"],
  );
  const familyDistance = hueDistance(
    colors["Coreweave Denton"], colors["Coreweave North Dakota 1"],
  );
  const unrelatedDistance = hueDistance(colors["Acme Dallas"], colors["Coreweave Denton"]);

  assert.ok(numberedDistance < familyDistance);
  assert.ok(familyDistance < unrelatedDistance);
  assert.notEqual(colors["Coreweave North Dakota 1"], colors["Coreweave North Dakota 2"]);
  assert.equal(colors.Unassigned, "#9ca3af");
  assert.deepEqual(customerChartColors([...names].reverse()), colors);
});
