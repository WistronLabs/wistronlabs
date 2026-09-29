import test from "node:test";
import assert from "node:assert/strict";
import { matchPrintMedia } from "../src/utils/matchPrintMedia.js";

test("matches the configured label and paper sizes to a queue's media names", () => {
  assert.equal(matchPrintMedia("Custom.2x1in", ["A4", "w144h72", "w288h360"]), "w144h72");
  assert.equal(matchPrintMedia("Letter", ["iso_a4_210x297mm", "na_letter_8.5x11in"]), "na_letter_8.5x11in");
  assert.equal(matchPrintMedia("w144h72", ["w144h72"]), "w144h72");
  assert.equal(matchPrintMedia("Custom.2x1in", ["w288h360"]), null);
});
