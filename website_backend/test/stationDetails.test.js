const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizedDetails } = require("../src/utils/stationDetails");

test("station details compare equally when stored as JSON text", () => {
  assert.equal(normalizedDetails({ OK: ["a"], FAILED: [] }),
    normalizedDetails('{ "OK": ["a"], "FAILED": [] }'));
  assert.equal(normalizedDetails(null), normalizedDetails(""));
  assert.equal(normalizedDetails("plain text"), '"plain text"');
});
