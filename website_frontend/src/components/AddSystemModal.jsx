import React, { useEffect, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import Select from "react-select";
import useIsMobile from "../hooks/useIsMobile.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.jsx";

export default function AddSystemModal({
  onClose,
  bulkMode,
  setBulkMode,
  onSubmit,
  addSystemFormError,
  hidden = false,
  showBulkReview = false,
  bulkReviewRows = [],
  bulkReviewStoppedTag = null,
  bulkReviewProcessing = false,
  bulkRetryWarning = null,
  onBulkReviewToggleTag,
  onBulkReviewToggleAll,
  onBulkReviewCustomerChange,
  onBulkReviewBack,
  onBulkReviewSubmit,
}) {
  const [showScanner, setShowScanner] = useState(false);
  const isMobile = useIsMobile();
  useBodyScrollLock(!hidden);

  useEffect(() => {
    let scanner;
    if (showScanner) {
      scanner = new Html5QrcodeScanner("scanner", {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      });
      scanner.render(
        (decodedText) => {
          const input = document.querySelector("input[name='service_tag']");
          if (input) input.value = decodedText.toUpperCase();
          scanner.clear();
          setShowScanner(false);
        },
        (err) => console.warn(err),
      );
    }
    return () => {
      if (scanner) scanner.clear();
    };
  }, [showScanner]);

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

  const inactiveRows = bulkReviewRows.filter((r) => r.row_type === "inactive");
  const confirmedInactiveCount = inactiveRows.filter((r) => r.confirmed).length;
  const allInactiveConfirmed =
    inactiveRows.length > 0 &&
    inactiveRows.every((r) => r.confirmed);
  const processableCount =
    bulkReviewRows.filter((r) => r.row_type === "new").length +
    confirmedInactiveCount;
  const isSingleReviewUnit = bulkReviewRows.length === 1;
  const hasIncompleteDellCustomer = bulkReviewRows.some((row) => {
    if (row.row_type === "active" || row.row_type === "skip") return false;
    if (row.row_type === "inactive" && !row.confirmed) return false;
    const opts = Array.isArray(row.dell_customer_options)
      ? row.dell_customer_options
      : [];
    return opts.length > 1 && !String(row.selected_dell_customer || "").trim();
  });
  const reviewLocked = !!bulkReviewStoppedTag;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm ${
        hidden ? "opacity-0 pointer-events-none" : ""
      }`}
      aria-hidden={hidden ? "true" : "false"}
    >
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full sm:max-w-lg p-4 sm:p-8 mx-2 relative space-y-4 sm:space-y-6">
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">
          {showBulkReview ? "Review Units" : "Add System"}
        </h2>

        {!showBulkReview && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setBulkMode(false)}
              className={`px-3 py-1 rounded-lg text-sm shadow-sm ${
                !bulkMode
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => setBulkMode(true)}
              className={`px-3 py-1 rounded-lg text-sm shadow-sm ${
                bulkMode
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Bulk CSV
            </button>
          </div>
        )}

        {showBulkReview ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Input Order preserved
            </p>
            <div className="border border-gray-200 rounded-xl bg-gray-50 overflow-hidden min-h-0">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
                <div className="text-xs sm:text-sm text-gray-600">
                  {confirmedInactiveCount} of {inactiveRows.length} inactive confirmed
                </div>
                {inactiveRows.length > 1 && (
                  <button
                    type="button"
                    disabled={inactiveRows.length === 0 || bulkReviewProcessing || reviewLocked}
                    onClick={onBulkReviewToggleAll}
                    className={`px-3 py-1 text-sm rounded-lg shadow-sm ${
                      allInactiveConfirmed
                        ? "bg-yellow-200 text-yellow-900 hover:bg-yellow-300"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {allInactiveConfirmed ? "Unconfirm All" : "Confirm All"}
                  </button>
                )}
              </div>
              <div
                className={`divide-y divide-gray-200 bg-white ${
                  bulkReviewRows.length === 1
                    ? "overflow-visible max-h-none"
                    : bulkReviewRows.length > 10
                      ? "overflow-y-auto max-h-[42vh]"
                      : "overflow-y-auto max-h-72"
                }`}
              >
                {bulkReviewRows.map((row) => {
                  const isStopped = bulkReviewStoppedTag === row.service_tag;
                  const rowClass = isStopped
                    ? "bg-red-50"
                    : row.row_type === "active"
                      ? "bg-gray-50"
                      : "";
                  return (
                    <div
                      key={`${row.service_tag}-${row.host12}-${row.bmc12}`}
                      className={`flex items-center justify-between px-3 py-2 ${rowClass}`}
                    >
                      <div className="flex flex-col flex-1 min-w-0 pr-3">
                        <span className="font-mono text-sm text-gray-800">
                          {row.service_tag}
                        </span>
                        <span className="text-xs text-gray-500 truncate" title={
                          isStopped
                            ? "Stopped here"
                            : row.row_type === "active"
                              ? "Already in system - skipped"
                              : row.row_type === "skip"
                                ? row.skip_reason || "Skipped"
                              : row.row_type === "inactive"
                                ? "Inactive - can re-receive"
                                : "New unit - will be added"
                        }>
                          {isStopped
                            ? "Stopped here"
                            : row.row_type === "active"
                              ? "Already in system - skipped"
                              : row.row_type === "skip"
                                ? row.skip_reason || "Skipped"
                              : row.row_type === "inactive"
                                ? "Inactive - can re-receive"
                                : "New unit - will be added"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {Array.isArray(row.dell_customer_options) &&
                        row.dell_customer_options.length > 1 &&
                        row.row_type !== "active" &&
                        row.row_type !== "skip" ? (
                          <div className="w-52">
                            <Select
                              isSearchable={false}
                              isDisabled={bulkReviewProcessing || reviewLocked}
                              options={row.dell_customer_options.map((opt) => ({
                                value: opt,
                                label: opt,
                              }))}
                              value={
                                String(row.selected_dell_customer || "").trim()
                                  ? {
                                      value: row.selected_dell_customer,
                                      label: row.selected_dell_customer,
                                    }
                                  : null
                              }
                              onChange={(option) =>
                                onBulkReviewCustomerChange?.(
                                  row.service_tag,
                                  option?.value || "",
                                )
                              }
                              placeholder="Select Dell Customer"
                              classNamePrefix="review-dell-select"
                              menuPortalTarget={
                                typeof document !== "undefined"
                                  ? document.body
                                  : undefined
                              }
                              menuPosition="fixed"
                              formatOptionLabel={(option) => (
                                <span className="block truncate" title={option.label}>
                                  {option.label}
                                </span>
                              )}
                              styles={{
                                control: (base, state) => ({
                                  ...base,
                                  minHeight: 34,
                                  borderRadius: 10,
                                  borderColor: String(row.selected_dell_customer || "").trim()
                                    ? "#93c5fd"
                                    : "#facc15",
                                  boxShadow: state.isFocused
                                    ? String(row.selected_dell_customer || "").trim()
                                      ? "0 0 0 2px rgba(59,130,246,0.28)"
                                      : "0 0 0 2px rgba(234,179,8,0.28)"
                                    : base.boxShadow,
                                  backgroundColor: "white",
                                  fontSize: 12,
                                  fontWeight: 500,
                                }),
                                valueContainer: (base) => ({
                                  ...base,
                                  paddingTop: 0,
                                  paddingBottom: 0,
                                }),
                                input: (base) => ({
                                  ...base,
                                  margin: 0,
                                  padding: 0,
                                }),
                                placeholder: (base) => ({
                                  ...base,
                                  color: "#92400e",
                                }),
                                singleValue: (base) => ({
                                  ...base,
                                  color: "#1e293b",
                                  maxWidth: "100%",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }),
                                option: (base) => ({
                                  ...base,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }),
                                menu: (base) => ({
                                  ...base,
                                  zIndex: 60,
                                }),
                                menuPortal: (base) => ({
                                  ...base,
                                  zIndex: 10050,
                                }),
                              }}
                            />
                          </div>
                        ) : row.selected_dell_customer ? (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700">
                            {row.selected_dell_customer}
                          </span>
                        ) : null}

                        {row.row_type === "inactive" ? (
                          <button
                            type="button"
                            disabled={bulkReviewProcessing || reviewLocked}
                            onClick={() => onBulkReviewToggleTag?.(row.service_tag)}
                            className={`w-24 px-3 py-1 rounded-lg text-xs text-center shadow-sm ${
                              row.confirmed
                                ? "bg-green-100 text-green-800 hover:bg-green-200"
                                : "bg-blue-600 text-white hover:bg-blue-700"
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                          >
                            {row.confirmed ? "Unconfirm" : "Confirm"}
                          </button>
                        ) : (
                          <span
                            className={`inline-flex w-24 justify-center px-2 py-1 rounded text-xs font-medium ${
                              row.row_type === "active" || row.row_type === "skip"
                                ? "bg-gray-200 text-gray-700"
                                : Array.isArray(row.dell_customer_options) &&
                                    row.dell_customer_options.length > 1 &&
                                    !String(row.selected_dell_customer || "").trim()
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {row.row_type === "active" || row.row_type === "skip"
                              ? "Skipped"
                              : Array.isArray(row.dell_customer_options) &&
                                  row.dell_customer_options.length > 1 &&
                                  !String(row.selected_dell_customer || "").trim()
                                ? "Incomplete"
                                : "Ready"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {addSystemFormError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
                {addSystemFormError}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={bulkReviewProcessing}
                onClick={onBulkReviewBack}
                className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {reviewLocked ? "Re-enter CSV" : "Back"}
              </button>
              <button
                type="button"
                disabled={bulkReviewProcessing || (!reviewLocked && hasIncompleteDellCustomer)}
                onClick={onBulkReviewSubmit}
                className={`px-4 py-2 text-sm rounded-lg text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                  processableCount > 0
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {bulkReviewProcessing
                  ? "Receiving..."
                  : reviewLocked
                    ? "Done"
                    : processableCount > 0
                    ? isSingleReviewUnit
                      ? "Receive Unit"
                      : "Receive Units"
                    : isSingleReviewUnit
                      ? "Skip"
                      : "Skip All"}
              </button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {!bulkMode ? (
            <>
              <div
                className={`${isMobile && "flex justify-between items-center"}`}
              >
                <InputField
                  label="Service Tag"
                  name="service_tag"
                  required
                  autoUpper
                />
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => setShowScanner(!showScanner)}
                    className={`ml-2 mt-6 inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-sm shadow-sm border 
                      ${
                        showScanner
                          ? "bg-red-100 text-red-700 border-red-300 hover:bg-red-200"
                          : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
                      }`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M4 4h2v16H4V4zm14 0h2v16h-2V4zM9 4h2v16H9V4zm4 0h2v16h-2V4z" />
                    </svg>
                    {showScanner ? "Stop Scanner" : "Scan Barcode"}
                  </button>
                )}
              </div>

              {showScanner && (
                <div id="scanner" className="my-2 rounded border" />
              )}

              <InputField label="Issue" name="issue" required />

              <InputField
                label="PPID"
                name="ppid"
                required
                autoUpper
                pattern="^[A-Z0-9]{23}$"
                title="PPID must be exactly 23 uppercase alphanumeric characters"
                maxLength={23}
              />
              <InputField
                label="Host MAC"
                name="host_mac"
                required
                autoUpper
                pattern="^[0-9A-F]{12}$"
                title="Host MAC must be exactly 12 hex characters (A1B2C3D4E5F6)"
                maxLength={12}
              />

              <InputField
                label="BMC MAC"
                name="bmc_mac"
                required
                autoUpper
                pattern="^[0-9A-F]{12}$"
                title="BMC MAC must be exactly 12 hex characters (A1B2C3D4E5F6)"
                maxLength={12}
              />
              <InputField
                label="Rack Service Tag"
                name="rack_service_tag"
                required
                autoUpper
              />

              {addSystemFormError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
                  {addSystemFormError}
                </div>
              )}
            </>
          ) : (
            <>
              {bulkRetryWarning && (
                <div className="bg-yellow-50 border border-yellow-300 text-yellow-900 px-4 py-2 rounded">
                  {bulkRetryWarning}
                </div>
              )}
              <TextAreaField
                label="Bulk CSV Input"
                helperText="Format: service_tag, issue, ppid, host_mac, bmc_mac, rack_tag (all required)"
                name="bulk_csv"
                placeholder={`ABCDE64,Post fail,MX0JJ3MGWSJ0057200JMA00,DEFGHI4,A1B2C3D4E5F6,A1B2C3D4E5F7
ABCDE65,No power,MX0JJ3MGWSJ0057200JMA00,DEFGHI4,A1B2C3D4E5F8,A1B2C3D4E5F9`}
                rows={5}
                required
              />
              {addSystemFormError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
                  {addSystemFormError}
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
            >
              {bulkMode ? "Review Units" : "Add"}
            </button>
          </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------- Inputs ---------- */

const InputField = ({
  label,
  name,
  required = false,
  autoUpper = false,
  pattern,
  title,
  maxLength,
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <input
      type="text"
      name={name}
      required={required}
      pattern={pattern}
      title={title}
      maxLength={maxLength}
      autoComplete="off"
      inputMode="text"
      onChange={
        autoUpper
          ? (e) => (e.target.value = e.target.value.toUpperCase())
          : undefined
      }
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
);

const TextAreaField = ({
  label,
  helperText = "",
  name,
  placeholder = "",
  rows = 3,
  required = false,
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    {helperText && (
      <p className="text-xs text-gray-500 mb-2">{helperText}</p>
    )}
    <textarea
      name={name}
      rows={rows}
      required={required}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      placeholder={placeholder}
    />
  </div>
);
