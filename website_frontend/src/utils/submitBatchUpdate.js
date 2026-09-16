// Keep the user's submitted selection fixed across upload, revalidation, and movement.
export async function submitBatchUpdate({ api, flow, serviceTags, uploadTags, file, note, onProgress = () => {} }) {
  const results = [];
  let uploadCompleted = false;
  try {
    if (file && uploadTags.length) {
      onProgress(flow === "mrb" ? "Uploading MRB approval…" : "Uploading L11 logs…");
      const response = flow === "mrb"
        ? await api.uploadMrbApproval(uploadTags, file)
        : await api.uploadBatchL11Archive(file, uploadTags);
      results.push(...response.results.map((row) => ({ ...row, stage: "upload" })));
      uploadCompleted = true;
    }
    if (note.trim()) {
      onProgress("Checking selected systems before movement…");
      const latest = await api.getBatchUpdateSystems(flow);
      const byTag = new Map(latest.data.map((row) => [row.service_tag, row]));
      const failedUploads = new Set(results.filter((row) => row.status === "failed").map((row) => row.service_tag));
      const moveTags = [];
      for (const service_tag of serviceTags) {
        const row = byTag.get(service_tag);
        if (row?.eligible && !failedUploads.has(service_tag)) {
          moveTags.push(service_tag);
        } else {
          results.push({ service_tag, stage: "movement", status: "failed", message:
            failedUploads.has(service_tag) ? "Not moved because its evidence upload failed."
              : !row ? "No longer in this pending queue. Refresh to check its location."
                : row.reasons?.join(" ") || "Movement requirements are not met." });
        }
      }
      if (moveTags.length) {
        onProgress(`Moving ${moveTags.length} systems…`);
        const response = await api.moveBatchSystems({ flow, service_tags: moveTags, note: note.trim() });
        results.push(...response.results.map((row) => ({ ...row, stage: "movement" })));
      }
    }
    return { results, uploadCompleted, movedTags: results.filter((row) => row.status === "moved").map((row) => row.service_tag) };
  } catch (error) {
    // A later request failure must not hide uploads that already succeeded.
    error.batchResults = results;
    error.uploadCompleted = uploadCompleted;
    throw error;
  }
}
