// DownloadReportModal.jsx
import ReactDatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useEffect } from "react";
import useBodyScrollLock from "../hooks/useBodyScrollLock.jsx";

function parseLocalDateString(yyyyMmDd) {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default function DownloadReportModal({
  onClose,
  reportDate,
  setReportDate,
  reportStartDate,
  setReportStartDate,
  minReportDate,
  onDownload,
  onCopyForOutlook,
  copyingForOutlook,
  chartsLoading,
  reportMode,
  setReportMode,
  idiotProof,
  setIdiotProof,
}) {
  useBodyScrollLock(true);
  // ⬇️ Close on Esc
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.(); // unmounts modal; your scanner cleanup runs
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg p-8 relative space-y-6">
        <h2 className="text-lg font-semibold mb-2">Select {reportMode === "cumulative" ? "Date Range" : "Date"}</h2>

        {reportMode === "cumulative" && (
          <div className="mb-2 grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2">
            <label htmlFor="report-start-date">From:</label>
            <div className="min-w-0">
              <ReactDatePicker
                id="report-start-date"
                selected={reportStartDate ? parseLocalDateString(reportStartDate) : null}
                onChange={(date) => setReportStartDate(date ? date.toLocaleDateString("en-CA") : "")}
                minDate={minReportDate ? parseLocalDateString(minReportDate) : undefined}
                dateFormat="MM/dd/yyyy"
                fixedHeight
                wrapperClassName="w-full"
                className="w-full rounded border p-1"
                placeholderText="Select start date"
                popperPlacement="bottom-start"
                showPopperArrow={false}
              />
            </div>
          </div>
        )}

        <div className="mb-2 grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2">
          <label htmlFor="report-end-date">{reportMode === "cumulative" ? "To:" : "Date:"}</label>
          <div className="min-w-0">
            <ReactDatePicker
              id="report-end-date"
              selected={reportDate ? parseLocalDateString(reportDate) : null}
              onChange={(date) =>
                setReportDate(date ? date.toLocaleDateString("en-CA") : "")
              }
              dateFormat="MM/dd/yyyy"
              minDate={reportMode === "cumulative" && (reportStartDate || minReportDate)
                ? parseLocalDateString(reportStartDate || minReportDate)
                : undefined}
              fixedHeight
              wrapperClassName="w-full"
              className="w-full rounded border p-1"
              placeholderText="Select a date"
              isClearable
              popperPlacement="bottom-start"
              showPopperArrow={false}
            />
          </div>
        </div>

        <div className="mt-2">
          <div className="flex gap-6">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="reportMode"
                value="cumulative"
                checked={reportMode === "cumulative"}
                onChange={() => setReportMode("cumulative")}
                className="accent-blue-600"
              />
              Cumulative
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="reportMode"
                value="perday"
                checked={reportMode === "perday"}
                onChange={() => setReportMode("perday")}
                className="accent-blue-600"
              />
              Per Day
            </label>
          </div>

          {/* Subtle "Idiot Proof" toggle */}
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500 select-none">
            <input
              type="checkbox"
              checked={idiotProof}
              onChange={(e) => setIdiotProof(e.target.checked)}
              className="h-3 w-3 accent-blue-600"
            />
            Idiot Proof (simplify statuses)
          </label>

          <p className="text-sm text-gray-500 mt-3">
            {reportMode === "cumulative"
              ? "Cumulative includes completed items within the selected date range."
              : "Per Day includes items completed on the selected date."}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Copy for Outlook uses the {reportMode === "cumulative" ? "To date" : "selected date"}
            {" "}and includes charts from that date and the preceding seven days.
          </p>
        </div>

        <div className="flex justify-end space-x-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-gray-300 rounded hover:bg-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onDownload(); // reads idiotProof from parent
              onClose();
            }}
            disabled={!reportDate || (reportMode === "cumulative" && (!reportStartDate || reportStartDate > reportDate))}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Download Report
          </button>
          <button
            onClick={onCopyForOutlook}
            disabled={!reportDate || copyingForOutlook || chartsLoading}
            className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {chartsLoading
              ? "Loading Charts…"
              : copyingForOutlook
                ? "Copying…"
                : "Copy For Outlook"}
          </button>
        </div>
      </div>
    </div>
  );
}
