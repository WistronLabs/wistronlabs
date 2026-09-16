import test from "node:test";
import assert from "node:assert/strict";
import { submitBatchUpdate } from "../src/utils/submitBatchUpdate.js";

const selection = { flow: "mrb", serviceTags: ["READY12", "NEEDS12", "FAIL123"], uploadTags: ["NEEDS12", "FAIL123"],
  file: { name: "approval.pdf" }, note: "Approved return" };

test("MRB combined action only uploads to missing units and moves freshly eligible selected units", async () => {
  const calls = [];
  const response = await submitBatchUpdate({ ...selection, api: {
    uploadMrbApproval: async (tags, file) => {
      calls.push(["upload", tags, file.name]);
      return { results: [{ service_tag: "NEEDS12", status: "uploaded" }, { service_tag: "FAIL123", status: "failed" }] };
    },
    getBatchUpdateSystems: async () => {
      calls.push(["refresh"]);
      return { data: [{ service_tag: "READY12", eligible: true }, { service_tag: "NEEDS12", eligible: true },
        { service_tag: "FAIL123", eligible: true }, { service_tag: "EXTRA12", eligible: true }] };
    },
    moveBatchSystems: async (payload) => {
      calls.push(["move", payload]);
      return { results: payload.service_tags.map((service_tag) => ({ service_tag, status: "moved" })) };
    },
  } });
  assert.deepEqual(calls, [["upload", ["NEEDS12", "FAIL123"], "approval.pdf"], ["refresh"],
    ["move", { flow: "mrb", service_tags: ["READY12", "NEEDS12"], note: "Approved return" }]]);
  assert.deepEqual(response.movedTags, ["READY12", "NEEDS12"]);
  assert.equal(response.results.find((row) => row.service_tag === "FAIL123" && row.stage === "movement").status, "failed");
});

test("approval without a note uploads only and never moves units", async () => {
  const response = await submitBatchUpdate({ ...selection, note: "   ", api: {
    uploadMrbApproval: async () => ({ results: [{ service_tag: "NEEDS12", status: "uploaded" }] }),
    getBatchUpdateSystems: async () => assert.fail("Upload-only must not start movement revalidation"),
    moveBatchSystems: async () => assert.fail("Upload-only must not move units"),
  } });
  assert.equal(response.uploadCompleted, true);
  assert.deepEqual(response.movedTags, []);
});

test("movement without a document does not upload, preserves note, and rechecks stale selections", async () => {
  const response = await submitBatchUpdate({ ...selection, file: null, api: {
    uploadMrbApproval: async () => assert.fail("No file was selected"),
    getBatchUpdateSystems: async () => ({ data: [{ service_tag: "READY12", eligible: true }, { service_tag: "FAIL123", eligible: false, reasons: ["Locked pallet"] }] }),
    moveBatchSystems: async (payload) => {
      assert.deepEqual(payload.service_tags, ["READY12"]);
      assert.equal(payload.note, "Approved return");
      return { results: [{ service_tag: "READY12", status: "moved" }] };
    },
  } });
  assert.equal(response.uploadCompleted, false);
  assert.equal(response.results.filter((row) => row.status === "failed").length, 2);
});

test("L11 combined action passes selected missing tags to the archive endpoint and keeps missing-folder units pending", async () => {
  const response = await submitBatchUpdate({ ...selection, flow: "l11", api: {
    uploadBatchL11Archive: async (file, tags) => {
      assert.equal(file, selection.file);
      assert.deepEqual(tags, ["NEEDS12", "FAIL123"]);
      return { results: [{ service_tag: "NEEDS12", status: "uploaded" }, { service_tag: "FAIL123", status: "skipped", message: "Missing archive folder" }] };
    },
    getBatchUpdateSystems: async () => ({ data: [{ service_tag: "READY12", eligible: true }, { service_tag: "NEEDS12", eligible: true }, { service_tag: "FAIL123", eligible: false, reasons: ["Missing L11 logs"] }] }),
    moveBatchSystems: async ({ service_tags }) => ({ results: service_tags.map((service_tag) => ({ service_tag, status: "moved" })) }),
  } });
  assert.deepEqual(response.movedTags, ["READY12", "NEEDS12"]);
});

test("completed uploads remain reportable when a later movement request fails", async () => {
  await assert.rejects(submitBatchUpdate({ ...selection, api: {
    uploadMrbApproval: async () => ({ results: [{ service_tag: "NEEDS12", status: "uploaded" }] }),
    getBatchUpdateSystems: async () => ({ data: [{ service_tag: "NEEDS12", eligible: true }] }),
    moveBatchSystems: async () => { throw new Error("Connection lost"); },
  } }), (error) => {
    assert.equal(error.uploadCompleted, true);
    assert.ok(error.batchResults.some((row) => row.stage === "upload" && row.status === "uploaded"));
    return true;
  });
});

test("a rejected upload does not start movement", async () => {
  await assert.rejects(submitBatchUpdate({ ...selection, api: {
    uploadMrbApproval: async () => { throw new Error("Invalid file"); },
    getBatchUpdateSystems: async () => assert.fail("Must stop after rejected upload"),
    moveBatchSystems: async () => assert.fail("Must stop after rejected upload"),
  } }), /Invalid file/);
});
