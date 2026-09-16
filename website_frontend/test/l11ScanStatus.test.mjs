import test from "node:test";
import assert from "node:assert/strict";
import { getL11ScanDisplayStatus, getL11ScanSummary } from "../src/utils/l11ScanStatus.js";

test("scan summaries translate runner output and omit hook prefixes", () => {
  assert.equal(getL11ScanSummary("[hook] Rack folder in MFT not found: dell-mft:/L11/626PSH4.1/"), "No L11 folder was found on MFT for this rack.");
  assert.match(getL11ScanSummary("Nothing to collect"), /No matching/);
  assert.match(getL11ScanSummary("Moving tar to destination"), /found and processed/);
  assert.equal(getL11ScanSummary("[hook] Connecting"), "Connecting");
  assert.equal(getL11ScanDisplayStatus("unknown"), "Needs review");
  assert.equal(getL11ScanDisplayStatus("outdated"), "Outdated");
});
