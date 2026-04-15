import { useEffect, useState } from "react";
import useBodyScrollLock from "../hooks/useBodyScrollLock.jsx";

function formatTtl(ms) {
  if (ms == null) return "Not available";
  if (ms <= 0) return "Expired";

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "Size unavailable";
  if (size === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  if (value >= 100) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  if (value >= 10) {
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function StatusPill({ status }) {
  const normalized = String(status || "").toLowerCase();
  const classes =
    normalized === "ready"
      ? "bg-green-100 text-green-800"
      : normalized === "failed"
        ? "bg-red-100 text-red-800"
        : "bg-yellow-100 text-yellow-800";

  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${classes}`}>
      {normalized === "ready"
        ? "Ready"
        : normalized === "failed"
          ? "Failed"
          : normalized === "running"
            ? "Building"
            : "Queued"}
    </span>
  );
}

function ReviewStatusPill({ status }) {
  const normalized = String(status || "").toLowerCase();
  const classes =
    normalized === "will proceed"
      ? "bg-green-100 text-green-800"
      : normalized === "not found"
        ? "bg-yellow-100 text-yellow-800"
        : "bg-red-100 text-red-800";

  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${classes}`}>
      {status}
    </span>
  );
}

export default function BatchExportSystemFilesModal({
  onClose,
  canCreateBatchExport,
  csvText,
  setCsvText,
  onPreview,
  onBackToEdit,
  previewLoading,
  previewData,
  onStart,
  startLoading,
  jobs,
  jobsLoading,
  onDownload,
  activeJobId,
}) {
  useBodyScrollLock(true);
  const [openTooltipJobId, setOpenTooltipJobId] = useState(null);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const hasReview = !!previewData;
  const reviewRows = hasReview
    ? [
        ...previewData.review_rows
      ]
    : [];

  const toggleJobDetails = (jobId) => {
    setOpenTooltipJobId((prev) => (prev === jobId ? null : jobId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="flex h-[68vh] w-full max-w-4xl flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Batch Export System Files</h2>
            <p className="mt-1 text-sm text-gray-500">
              Paste one service tag per line. Batch files stay available for 24 hours.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300"
          >
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section
            className={`flex min-h-0 flex-col rounded-xl border p-4 ${
              canCreateBatchExport
                ? "border-gray-200 bg-gray-50"
                : "border-gray-200 bg-gray-100 opacity-60"
            }`}
          >
            {!hasReview ? (
              <>
                <div className="mb-2 text-sm font-semibold text-gray-800">New Batch Export</div>
                {!canCreateBatchExport && (
                  <div className="mb-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600">
                    Log in to create a new batch export.
                  </div>
                )}
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={"ABC1234\nDEF5678\nGHI9012"}
                  disabled={!canCreateBatchExport}
                  className="h-56 w-full resize-none overflow-y-auto rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onPreview}
                    disabled={!canCreateBatchExport || previewLoading || startLoading}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {previewLoading ? "Reviewing..." : "Submit Batch Export"}
                  </button>
                </div>
              </>
              ) : (
              <div className="mt-4 flex min-h-0 flex-1 flex-col space-y-3">
                <div className="text-sm font-semibold text-gray-800">Review Batch Export</div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                  {previewData.total_count} unique service tags reviewed.
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  {reviewRows.length ? (
                    <div className="divide-y divide-gray-200">
                      {reviewRows.map((row) => (
                        <div
                          key={`${row.service_tag}-${row.status}`}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 truncate font-mono text-gray-800">
                            {row.service_tag}
                          </span>
                          <ReviewStatusPill status={row.status} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 text-sm text-gray-500">
                      No service tags to review.
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onBackToEdit}
                    disabled={!canCreateBatchExport || startLoading}
                    className="rounded-md bg-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Back and Edit
                  </button>
                  <button
                    type="button"
                    onClick={onStart}
                    disabled={!canCreateBatchExport || !hasReview || startLoading || previewLoading}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {startLoading ? "Starting..." : "Proceed"}
                  </button>
                </div>
              </div>
              )}
          </section>

          <section className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-gray-800">Available Batch Downloads</div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {jobs.length ? (
                jobs.map((job) => {
                  const isActive = activeJobId && job.job_id === activeJobId;
                  const isExpanded = openTooltipJobId === job.job_id;
                  return (
                    <div
                      key={job.job_id}
                      className={`relative rounded-lg border p-3 ${isActive ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900">
                            {job.file_name || job.job_id}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {formatFileSize(job.file_size_bytes)} • Available for {formatTtl(job.ttl_ms_remaining)}
                          </div>
                        </div>
                        <StatusPill status={job.status} />
                      </div>

                      <div className="mt-2 text-xs text-gray-500">
                        {job.processed_count}/{job.total_count} systems archived
                      </div>

                      {!!job.error && (
                        <div className="mt-2 text-xs text-red-700">{job.error}</div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => toggleJobDetails(job.job_id)}
                          className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-300"
                        >
                          {isExpanded ? "Hide Details" : "Details"}
                        </button>
                        <button
                          type="button"
                          disabled={job.status !== "ready"}
                          onClick={() => onDownload(job)}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Download Batch Files
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="absolute left-3 top-[calc(100%-0.25rem)] z-20 w-72 rounded-lg border border-gray-300 bg-white p-3 shadow-xl">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Included Service Tags
                            </div>
                            <button
                              type="button"
                              onClick={() => setOpenTooltipJobId(null)}
                              className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                            >
                              Close
                            </button>
                          </div>
                          <div className="max-h-40 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2">
                            {job.service_tags?.length ? (
                              <div className="space-y-1 text-sm text-gray-700">
                                {job.service_tags.map((serviceTag) => (
                                  <div key={`${job.job_id}-${serviceTag}`} className="font-mono">
                                    {serviceTag}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-sm text-gray-500">
                                No service tags recorded for this batch.
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {isExpanded && (
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setOpenTooltipJobId(null)}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
                  No batch exports available yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
