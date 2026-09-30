const test = require("node:test");
const assert = require("node:assert/strict");
const { BIOS_IDLE_MS, createBiosIdleTracker } = require("../../terminal_host/biosIdle.cjs");

test("BIOS cleanup waits 24 hours without viewers and ignores station sessions", () => {
  const tracker = createBiosIdleTracker();
  const detached = "bs_aabbccddeeff|$2|1234567890|0|0\nstn_12|$1|1234567890|0|0";
  assert.deepEqual(tracker.candidates(detached, 1000), []);
  assert.deepEqual(tracker.candidates(detached, 1000 + BIOS_IDLE_MS - 1), []);
  assert.deepEqual(tracker.candidates(detached, 1000 + BIOS_IDLE_MS).map((s) => s.name), ["bs_aabbccddeeff"]);
  assert.deepEqual(tracker.candidates("bs_aabbccddeeff|$2|1234567890|1|2", 1000 + BIOS_IDLE_MS + 1), []);
  assert.deepEqual(tracker.candidates(detached, 1000 + BIOS_IDLE_MS + 2), []);
  assert.deepEqual(tracker.candidates("bs_aabbccddeeff|$3|1234567891|0|0", 1000 + 2 * BIOS_IDLE_MS), [], "new session identity starts a new timer");
  assert.deepEqual(tracker.candidates("bs_aabbccddeeff|$3|1234567891|0|3", 1000 + 3 * BIOS_IDLE_MS), [], "an attachment between scans resets the timer");
});
