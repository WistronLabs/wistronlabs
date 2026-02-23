import { useState, useCallback, useEffect, useMemo } from "react";
import { DateTime } from "luxon";
import useApi from "./useApi";

export default function useDetailsModal(showToast, onUpdated) {
  const [isOpen, setIsOpen] = useState(false);
  const [details, setDetails] = useState(null);
  const [ppidInput, setPpidInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  const [isEditing, setIsEditing] = useState(false);
  const [detailsFormError, setDetailsFormError] = useState(null);
  const [draft, setDraft] = useState({}); // { ppid, host_mac, bmc_mac, rack_id, ... }

  const {
    updateSystemPPID,
    updateHostMac,
    updateBmcMac,
    updateRackServiceTag, // rename to match your API hook
  } = useApi();

  // choose which fields are editable
  const editableKeys = useMemo(
    () => ["ppid", "host_mac", "bmc_mac", "rack_id"],
    [],
  );

  const openDetails = useCallback((data) => {
    setDetails(data);
    setIsOpen(true);
    setIsEditing(false);
    setCopiedKey(null);
    setDetailsFormError(null);
    setDraft({
      ppid: data?.ppid ?? "",
      host_mac: data?.host_mac ?? "",
      bmc_mac: data?.bmc_mac ?? "",
      rack_id: data?.rack_id ?? "",
    });
  }, []);

  const closeDetails = useCallback(() => {
    setIsOpen(false);
    setDetails(null);
    setPpidInput("");
    setCopiedKey(null);
    setIsEditing(false);
    setDraft({});
    setDetailsFormError(null);
  }, []);

  const isIncomplete = (d) => {
    if (!d) return true;
    const fields = ["dpn", "factory_name", "factory_code", "manufactured_date"];
    return fields.some((f) => !d[f]);
  };

  const handleCopy = async (key) => {
    const value = details?.[key];
    if (!value) return;

    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    } catch {}
  };

  // Esc closes modal
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDetails();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeDetails]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!ppidInput) return;
    setLoading(true);
    try {
      const res = await updateSystemPPID(details.service_tag, ppidInput);
      showToast?.(res.message, "success", 3000, "bottom-right");
      closeDetails();
      if (onUpdated) await onUpdated();
    } catch (err) {
      console.error("Failed to update PPID", err);
      let message = "Cannot update system, please make sure PPID is correct";
      if (err?.message?.includes("failed:")) {
        const parts = err.message.split(/failed:\s*\d+\s*/);
        if (parts.length > 1) message = parts[1];
      }
      showToast?.(message, "error", 5000, "bottom-right");
    } finally {
      setLoading(false);
    }
  };

  const setDraftValue = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const extractErrMsg = (err) =>
    err?.body?.error || err?.message || "Update failed";

  const saveField = async (key) => {
    if (!details?.service_tag) return;

    setDetailsFormError(null);
    setLoading(true);

    try {
      const st = details.service_tag;

      if (key === "ppid") {
        const next = String(draft.ppid ?? "")
          .trim()
          .toUpperCase();
        if (!next) throw new Error("PPID is required");
        await updateSystemPPID(st, next);
      }

      if (key === "host_mac") {
        const next = String(draft.host_mac ?? "")
          .trim()
          .toUpperCase();
        if (!/^[0-9A-F]{12}$/.test(next)) {
          throw new Error("HOST MAC must be 12 hex characters (A1B2C3D4E5F6)");
        }
        await updateHostMac(st, next);
      }

      if (key === "bmc_mac") {
        const next = String(draft.bmc_mac ?? "")
          .trim()
          .toUpperCase();
        if (!/^[0-9A-F]{12}$/.test(next)) {
          throw new Error("BMC MAC must be 12 hex characters (A1B2C3D4E5F6)");
        }
        await updateBmcMac(st, next);
      }

      if (key === "rack_id") {
        const next = String(draft.rack_id ?? "")
          .trim()
          .toUpperCase();
        if (!next) throw new Error("Rack Service Tag is required");
        await updateRackServiceTag(st, next);
      }

      showToast?.("Saved", "success", 1500, "bottom-right");
      if (onUpdated) await onUpdated();
    } catch (err) {
      console.error(err);
      setDetailsFormError(extractErrMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleEditOrCopy = () => {
    setDetailsFormError(null);

    if (!isEditing) {
      // enter edit mode (seed draft)
      setDraft({
        ppid: details?.ppid ?? "",
        host_mac: details?.host_mac ?? "",
        bmc_mac: details?.bmc_mac ?? "",
        rack_id: details?.rack_id ?? "",
      });
      setIsEditing(true);
      return;
    }

    // leave edit mode WITHOUT saving (go back to copy mode)
    setIsEditing(false);

    // discard draft changes
    setDraft({
      ppid: details?.ppid ?? "",
      host_mac: details?.host_mac ?? "",
      bmc_mac: details?.bmc_mac ?? "",
      rack_id: details?.rack_id ?? "",
    });
  };

  const modal = isOpen && (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      style={{ zIndex: 9999 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full sm:max-w-lg p-6 transform transition-all scale-100 animate-fadeIn mx-2">
        <h2 className="text-xl font-bold text-gray-900 mb-3 border-b border-gray-100 pb-2">
          System Details
        </h2>

        {details && !isIncomplete(details) ? (
          <>
            <div className="mb-4 space-y-3">
              <CopyBar
                label="PPID"
                value={isEditing ? draft.ppid : details?.ppid}
                isEditing={isEditing}
                editable={editableKeys.includes("ppid")}
                copied={copiedKey === "ppid"}
                onChange={(v) => setDraftValue("ppid", v)}
                onAction={() =>
                  isEditing ? saveField("ppid") : handleCopy("ppid")
                }
                loading={loading}
              />

              <CopyBar
                label="HOST MAC"
                value={isEditing ? draft.host_mac : details?.host_mac}
                isEditing={isEditing}
                editable={editableKeys.includes("host_mac")}
                copied={copiedKey === "host_mac"}
                onChange={(v) => setDraftValue("host_mac", v)}
                onAction={() =>
                  isEditing ? saveField("host_mac") : handleCopy("host_mac")
                }
                loading={loading}
              />

              <CopyBar
                label="BMC MAC"
                value={isEditing ? draft.bmc_mac : details?.bmc_mac}
                isEditing={isEditing}
                editable={editableKeys.includes("bmc_mac")}
                copied={copiedKey === "bmc_mac"}
                onChange={(v) => setDraftValue("bmc_mac", v)}
                onAction={() =>
                  isEditing ? saveField("bmc_mac") : handleCopy("bmc_mac")
                }
                loading={loading}
              />

              <CopyBar
                label="DPN"
                value={details?.dpn}
                isEditing={isEditing}
                editable={false}
                copied={copiedKey === "dpn"}
                onAction={() => (isEditing ? null : handleCopy("dpn"))}
                loading={loading}
              />

              <CopyBar
                label="Rack Service Tag"
                value={isEditing ? draft.rack_id : details?.rack_id}
                isEditing={isEditing}
                editable={editableKeys.includes("rack_id")}
                copied={copiedKey === "rack_id"}
                onChange={(v) => setDraftValue("rack_id", v)}
                onAction={() =>
                  isEditing ? saveField("rack_id") : handleCopy("rack_id")
                }
                loading={loading}
              />
            </div>

            {detailsFormError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-3">
                {detailsFormError}
              </div>
            )}

            <div className="text-gray-700 text-sm sm:text-base space-y-3">
              <div className="flex justify-between">
                <span className="font-medium">Origin Factory:</span>
                <span>{details.factory_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Manufacture Date:</span>
                <span>
                  {DateTime.fromISO(details.manufactured_date, {
                    zone: "utc",
                  }).toFormat("MM/dd/yyyy")}
                </span>
              </div>
            </div>
          </>
        ) : (
          <form
            className="text-gray-700 text-sm sm:text-base space-y-4"
            onSubmit={handleManualSubmit}
          >
            <p className="text-gray-600">
              System details are incomplete. To populate them:
            </p>
            <ul className="list-disc pl-5 text-gray-600">
              <li>
                Run{" "}
                <code className="bg-gray-100 px-1 rounded">l10_test.sh</code> or{" "}
                <code className="bg-gray-100 px-1 rounded">
                  system_details.sh
                </code>
              </li>
              <li>Or manually enter the unit PPID below</li>
            </ul>
            <input
              type="text"
              value={ppidInput}
              onChange={(e) => setPpidInput(e.target.value)}
              placeholder="Enter full PPID"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!ppidInput || loading}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg shadow disabled:opacity-50 transition"
            >
              {loading ? "Submitting…" : "Submit PPID"}
            </button>
          </form>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={toggleEditOrCopy}
            type="button"
            disabled={loading || !details}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white font-medium text-sm shadow hover:bg-blue-700 focus:outline-none transition disabled:opacity-50"
          >
            {isEditing ? "Copy" : "Edit"}
          </button>

          <button
            onClick={closeDetails}
            type="button"
            className="px-5 py-2 rounded-lg bg-gray-200 text-gray-800 font-medium text-sm shadow hover:bg-gray-300 focus:outline-none transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return { openDetails, closeDetails, modal };
}

function CopyBar({
  label,
  value,
  onAction,
  isEditing,
  editable,
  onChange,
  copied,
  loading,
}) {
  // Show when empty (placeholder + greyed-out Copy)
  const hasValue = !(
    value === undefined ||
    value === null ||
    String(value) === ""
  );

  const canEdit = isEditing && editable;
  const isLocked = isEditing && !editable;

  const buttonText = isEditing ? "Save" : copied ? "Copied!" : "Copy";

  // If empty:
  // - copy mode -> show disabled grey Copy
  // - edit mode editable -> allow Save (enabled/disabled handled elsewhere)
  // - edit mode non-editable -> disabled grey Save (locked)
  const disabled = loading || isLocked || (!hasValue && !canEdit) || !onAction; // empty + not editable => disabled

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="relative w-full">
        <span className="absolute -top-2 left-2 bg-white px-2 text-[10px] font-semibold text-gray-600 border border-gray-200 rounded">
          {label}
        </span>

        {canEdit ? (
          <input
            type="text"
            value={String(value ?? "")}
            onChange={(e) => onChange?.(e.target.value)}
            className="font-mono text-sm sm:text-base bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 w-full block"
            autoComplete="off"
          />
        ) : (
          <code
            className={`font-mono text-sm sm:text-base bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 w-full block break-all ${
              hasValue ? "text-gray-900" : "text-gray-400"
            }`}
          >
            {hasValue ? value : "Empty"}
          </code>
        )}
      </div>

      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium shadow
          ${
            disabled
              ? "bg-gray-200 text-gray-500 cursor-not-allowed"
              : canEdit
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-800 text-white hover:bg-gray-900"
          }`}
      >
        {loading && isEditing && canEdit ? "Saving..." : buttonText}
      </button>
    </div>
  );
}
