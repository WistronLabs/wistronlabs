import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { mediaSizePoints, preparePrintPdf } from "../src/utils/preparePrintPdf.js";

test("media names map to the physical page size", () => {
  assert.deepEqual(mediaSizePoints("w144h72"), [144, 72]);
  assert.deepEqual(mediaSizePoints("Custom.2x1in"), [144, 72]);
  assert.deepEqual(mediaSizePoints("Letter"), [612, 792]);
  assert.deepEqual(mediaSizePoints("iso_a4_210x297mm").map(Math.round), [595, 842]);
});

test("prepared PDF uses the selected media and shows the fit factor", async () => {
  const source = await PDFDocument.create();
  source.addPage([144, 72]).drawRectangle({ x: 10, y: 10, width: 30, height: 20 });
  const blob = new Blob([await source.save()], { type: "application/pdf" });

  const portrait = await preparePrintPdf(blob, { media: "w144h72", orientation: "portrait", scaling: "fit" });
  const landscape = await preparePrintPdf(blob, { media: "w144h72", orientation: "landscape", scaling: "fit" });
  const actual = await preparePrintPdf(blob, { media: "w144h72", orientation: "landscape", scaling: "none" });

  assert.equal(portrait.firstPageScale, 1);
  assert.equal(landscape.firstPageScale, 0.5);
  assert.equal(actual.firstPageScale, 1);
  assert.deepEqual((await PDFDocument.load(await landscape.blob.arrayBuffer())).getPage(0).getSize(), { width: 144, height: 72 });
  assert.notDeepEqual(await landscape.blob.arrayBuffer(), await portrait.blob.arrayBuffer());
});
