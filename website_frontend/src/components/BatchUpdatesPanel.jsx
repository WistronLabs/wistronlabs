import BatchScanStatus from "./BatchScanStatus.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { pdf } from "@react-pdf/renderer";
import useApi from "../hooks/useApi";
import BatchL11LogActions from "./BatchL11LogActions.jsx";
import { MRB_APPROVAL_ACCEPT } from "./MrbApprovalPanel.jsx";
import SystemRMALabel from "./SystemRMALabel.jsx";
import useL11ScanJobs, { isActiveScan } from "../hooks/useL11ScanJobs.js";
import { submitBatchUpdate } from "../utils/submitBatchUpdate.js";

const FLOWS = {
  l11: { from: "Pending L11 Logs", to: "RMA PID" },
  mrb: { from: "Pending MRB", to: "RMA CID" },
};
const button = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed";
const inputClass = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
const pillClass = "inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
const cellClass = "border-y border-gray-300 px-4 py-2 align-middle";
// The evidence badge and upload action already communicate these requirements.
const EVIDENCE_BADGE_MESSAGES = new Set([
  "L11 logs for the current rack must be uploaded after the latest Received event.",
  "Upload MRB approval after the latest Received event before moving to RMA CID.",
  "New evidence is required since the latest Received event.",
]);

export default function BatchUpdatesPanel({ token }) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [flow, setFlow] = useState("l11");
  const [rows, setRows] = useState([]);
  const [limits, setLimits] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "service_tag", ascending: true });
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [movedTags, setMovedTags] = useState([]);
  const [archivePreview, setArchivePreview] = useState(null);
  const [batchFile, setBatchFile] = useState(null);
  const [individualBusy, setIndividualBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [refresh, setRefresh] = useState(0);
  const scanJobs = useL11ScanJobs(null, !!token && flow === "l11", () => setRefresh((value) => value + 1));
  const scanStatuses = Object.fromEntries(scanJobs.jobs.map((job) => [job.service_tag, job]));
  const archiveInput = useRef(null);
  const approvalInput = useRef(null);
  const individualApprovalInput = useRef(null);
  const individualApprovalTag = useRef(null);
  const operationBusy = busy || individualBusy;
  const currentFlow = FLOWS[flow];
  const archiveTags = useMemo(() => new Set(batchFile
    ? (archivePreview || []).filter((item) => item.status === "matched").map((item) => item.service_tag)
    : []), [batchFile, archivePreview]);
  const isArchiveSelected = (row) => flow === "l11" && !!batchFile && archiveTags.has(row.service_tag) && selected.has(row.service_tag);
  const canSelect = (row) => flow !== "l11" || row.l11_found === true || archiveTags.has(row.service_tag);
  const missingEvidence = (row) => flow === "l11" ? !row.l11_found : !row.approval_found;
  const visible = rows
    .filter((row) => row.service_tag.includes(query.trim().toUpperCase()))
    .sort((a, b) => {
      const tagOrder = a.service_tag.localeCompare(b.service_tag);
      const comparison = sort.key === "evidence"
        ? Number(missingEvidence(a)) - Number(missingEvidence(b))
        : tagOrder;
      return comparison === 0 ? tagOrder : comparison * (sort.ascending ? 1 : -1);
    });
  const selectedRows = rows.filter((row) => selected.has(row.service_tag) && canSelect(row));
  const blockedCount = selectedRows.filter((row) => !row.eligible).length;
  const missingSelected = selectedRows.filter(missingEvidence);
  const overLimit = selectedRows.length > (limits.systems || Infinity);
  const alreadySelected = selectedRows.filter((row) => !missingEvidence(row));
  const willUpload = !!batchFile && missingSelected.length > 0;
  const willMove = !!note.trim();
  const uploadLabel = flow === "mrb" ? "Apply MRB Approval" : "Upload L11 Logs";
  const actionLabel = willUpload ? `${uploadLabel}${willMove ? " & Move" : ""}` : "Submit Bulk Movement";
  const canSubmit = !!token && !operationBusy && !loading && selectedRows.length > 0 && !overLimit
    && !selectedRows.some((row) => isActiveScan(scanStatuses[row.service_tag]))
    && (willUpload || (willMove && !blockedCount));
  const reload = () => setRefresh((value) => value + 1);
  const toggleSort = (key) => setSort((previous) => ({
    key,
    ascending: previous.key === key ? !previous.ascending : true,
  }));
  const sortDirection = (key) => sort.key === key
    ? (sort.ascending ? "ascending" : "descending")
    : "none";

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true); setError("");
    apiRef.current.getBatchUpdateSystems(flow).then((result) => {
      if (!active) return;
      setRows(result.data); setLimits(result.limits);
      setSelected((prev) => new Set([...prev].filter((tag) => result.data.some((row) => row.service_tag === tag))));
    }).catch((err) => {
      if (active) { setError(err.body?.error || err.message); setRows([]); setSelected(new Set()); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [flow, token, refresh]);

  useEffect(() => {
    const allowed = new Set(rows.filter((row) => flow !== "l11" || row.l11_found === true
      || archiveTags.has(row.service_tag)).map((row) => row.service_tag));
    setSelected((previous) => {
      const next = new Set([...previous].filter((tag) => allowed.has(tag)));
      return next.size === previous.size ? previous : next;
    });
  }, [rows, flow, archiveTags]);

  function toggleGroup(group) {
    group = group.filter((row) => canSelect(row) && !isArchiveSelected(row));
    const allSelected = group.length > 0 && group.every((row) => selected.has(row.service_tag));
    setSelected((prev) => {
      const next = new Set(prev);
      group.forEach((row) => allSelected ? next.delete(row.service_tag) : next.add(row.service_tag));
      return next;
    });

  }
  function groupButton(label, group) {
    group = group.filter((row) => canSelect(row) && !isArchiveSelected(row));
    const allSelected = group.length > 0 && group.every((row) => selected.has(row.service_tag));
    return <button type="button" className={button} disabled={operationBusy || loading || !group.length}
      onClick={() => toggleGroup(group)}>{allSelected ? "Deselect" : "Select"} {label} ({group.length})</button>;
  }
  function chooseIndividualApproval(tag) {
    if (operationBusy || batchFile || selected.has(tag)) return;
    individualApprovalTag.current = tag;
    individualApprovalInput.current?.click();
  }
  async function stageFile(file) {
    if (!file || operationBusy) return;
    const maxBytes = flow === "l11" ? limits.archive_bytes : limits.approval_bytes;
    if (file.size > maxBytes) { setError("File exceeds the configured upload limit."); return; }
    setError("");
    if (flow === "mrb") { setBatchFile(file); return; }
    setBatchFile(null); setArchivePreview(null); setSelected(new Set()); setMovedTags([]);
    setBusy(true); setProgress("Inspecting archive and matching service tags…");
    try {
      const preview = await apiRef.current.previewBatchL11Archive(file);
      const latest = await apiRef.current.getBatchUpdateSystems("l11");
      setRows(latest.data); setLimits(latest.limits);
      setArchivePreview(preview.results);
      setSelected(new Set(preview.results.filter((result) => result.status === "matched"
        && latest.data.some((row) => row.service_tag === result.service_tag && !row.l11_found))
        .map((result) => result.service_tag)));
      setQuery(""); setBatchFile(file);
    } catch (err) {
      setError(err.status === 404
        ? "Archive preview is unavailable on this backend. Deploy the updated backend and verify the website's API address."
        : err.body?.error || err.message);
    }
    finally { setBusy(false); setProgress(""); }

  }
  function reportFailures(results) {
    const failures = results.filter((row) => row.status === "failed" || row.status === "skipped");
    if (failures.length) setError(failures.map((row) => `${row.service_tag}: ${row.message}`).join(" "));
  }
  async function uploadIndividualApproval(file) {
    const tag = individualApprovalTag.current;
    if (!file || !tag || operationBusy || batchFile || selected.has(tag)) return;
    if (file.size > limits.approval_bytes) { setError("Document exceeds the configured upload limit."); return; }
    setBusy(true); setError(""); setProgress(`Uploading MRB approval for ${tag}…`);
    try {
      const response = await apiRef.current.uploadMrbApproval([tag], file);
      reportFailures(response.results);
    } catch (err) { setError(err.body?.error || err.message); }
    finally { reload(); setBusy(false); setProgress(""); }
  }
  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setError(""); setMovedTags([]);
    try {
      const response = await submitBatchUpdate({
        api: apiRef.current, flow, file: batchFile, note,
        serviceTags: selectedRows.map((row) => row.service_tag),
        uploadTags: missingSelected.map((row) => row.service_tag),
        onProgress: setProgress,
      });
      reportFailures(response.results);
      setMovedTags(response.movedTags);
      if (response.uploadCompleted) setBatchFile(null);
    } catch (err) {
      if (err.uploadCompleted) setBatchFile(null);
      setError(err.body?.error || err.message);
    } finally { reload(); setBusy(false); setProgress(""); }
  }
  async function rescanAll() {
    if (operationBusy || loading || flow !== "l11") return;
    setBusy(true); setError(""); setProgress("Queuing L11 scans…");
    try {
      const result = await apiRef.current.startBatchL11Scans();
      reportFailures(result.results.map((job) => ({...job,message:job.error})));
      scanJobs.refresh();
    } catch (err) { setError(err.body?.error || err.message); }
    finally { setBusy(false); setProgress(""); }
  }
  async function downloadLabels() {
    const preview = window.open("about:blank", "_blank");
    if (!preview) { setError("Allow pop-ups to open RMA labels."); return; }
    preview.opener = null;
    preview.document.title = "Preparing RMA labels";
    preview.document.body.textContent = "Preparing RMA labels…";
    setBusy(true); setError(""); setProgress("Preparing RMA labels…");
    try {
      const systems = [];
      for (const tag of movedTags) {
        const [system, pallet] = await Promise.all([apiRef.current.getSystem(tag), apiRef.current.getSystemPallet(tag)]);
        if (!pallet?.pallet_number) throw new Error(`Pallet information is unavailable for ${tag}. Retry the label download.`);
        systems.push({ ...system, ...pallet, service_tag: tag, location: "RMA", url: `${window.location.origin}/${tag}` });
      }
      const blob = await pdf(<SystemRMALabel systems={systems} />).toBlob();
      const url = URL.createObjectURL(blob);
      preview.location.replace(url);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { preview.close(); setError(err.body?.error || err.message); }
    finally { setBusy(false); setProgress(""); }
  }

  if (!token) return <p className="rounded-lg bg-gray-50 p-6 text-gray-600">Log in to upload evidence and move systems in batches.</p>;
  return <section className="space-y-5" aria-label="Batch Updates">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap gap-1 border-b border-gray-200" role="tablist" aria-label="Batch update queues">
        {Object.entries(FLOWS).map(([key, value]) => (
          <button key={key} type="button" role="tab" aria-selected={flow === key}
            disabled={operationBusy || loading}
            onClick={() => {
              if (flow === key) return;
              setFlow(key); setRows([]); setSelected(new Set());
              setBatchFile(null); setArchivePreview(null); setMovedTags([]); setNote("");
            }}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${flow === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"}`}>
            {value.from}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">

        <button type="button" className={button} disabled={operationBusy || loading} onClick={reload}>Refresh availability</button>
      </div>
    </div>
    <div className="w-full md:max-w-lg">
      <label className="text-sm font-medium text-gray-600">Search service tags<input value={query} disabled={operationBusy} onChange={(event) => setQuery(event.target.value)} className={`mt-1 block w-full ${inputClass}`} placeholder="Search service tags" /></label>
    </div>
    <div className="rounded border border-gray-300 bg-gray-100 p-4 shadow-sm" aria-busy={loading}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
        <div className="flex flex-wrap gap-2">
          {groupButton("All", visible)}
          {groupButton("Movable", visible.filter((row) => row.eligible))}
          {groupButton("Pending", visible.filter(missingEvidence))}
          <button type="button" disabled={operationBusy || !selectedRows.some((row) => !isArchiveSelected(row))}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { setSelected(new Set(selectedRows.filter(isArchiveSelected).map((row) => row.service_tag))); }}>Clear Selection</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${pillClass} bg-blue-100 text-blue-700`}>{selectedRows.length} selected</span>
          {blockedCount > 0 && <span className={`${pillClass} bg-yellow-100 text-yellow-800`}>{blockedCount} blocked</span>}
        {flow === "l11" && <button type="button" className={button}
          disabled={operationBusy || loading || !rows.some((row) => !row.l11_found && row.rack_service_tag)}
          title="Scan all units missing L11 logs with a rack service tag, regardless of selection or search."
          onClick={rescanAll}>Scan All Missing L11 Logs</button>}
        </div>
      </div>
      <div className="relative max-h-[55vh] min-h-[300px] overflow-auto">
        <table className={`w-full ${flow === "l11" ? "min-w-[960px]" : "min-w-[760px]"} table-fixed border-separate border-spacing-x-0 border-spacing-y-1 text-left text-sm`}>
          <colgroup>
            <col className="w-16" />
            <col className={flow === "l11" ? "w-1/5" : "w-1/4"} />
            <col />
            {flow === "l11" && <col className="w-64" />}
            <col className="w-80" />
          </colgroup>
          <caption className="sr-only">Systems available for {currentFlow.from} to {currentFlow.to}</caption>
          <thead className="sticky top-0 z-10 bg-gray-100 shadow-[0_-4px_0_0_#f3f4f6]">
            <tr className="bg-white text-gray-500">
              <th scope="col" className={`${cellClass} w-16 rounded-l border-l font-normal`}>Select</th>
              <th scope="col" aria-sort={sortDirection("service_tag")} className={`${cellClass} whitespace-nowrap font-normal`}>
                <button type="button" onClick={() => toggleSort("service_tag")}
                  className="cursor-pointer rounded text-left hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  Service Tag <span aria-hidden="true" className={`inline-block w-3 text-center ${sort.key === "service_tag" ? "" : "invisible"}`}>{sort.ascending ? "▲" : "▼"}</span>
                </button>
              </th>
              <th scope="col" aria-sort={sortDirection("evidence")} className={`${cellClass} whitespace-nowrap font-normal`}>
                <button type="button" onClick={() => toggleSort("evidence")}
                  className="cursor-pointer rounded text-left hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  {flow === "l11" ? "L11 Logs" : "MRB Approval"} <span aria-hidden="true" className={`inline-block w-3 text-center ${sort.key === "evidence" ? "" : "invisible"}`}>{sort.ascending ? "▲" : "▼"}</span>
                </button>
              </th>
              {flow === "l11" && <th scope="col" className={`${cellClass} font-normal`}>Last Scan Status</th>}
              <th scope="col" className={`${cellClass} rounded-r border-r text-right font-normal`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const additionalBlockers = (row.reasons || [])
                .filter((reason) => !EVIDENCE_BADGE_MESSAGES.has(reason))
                .join(" ");
              return (
              <tr key={row.service_tag}
                className={`${flow === "l11" ? "h-14" : ""} transition-colors hover:bg-blue-50 ${selected.has(row.service_tag) ? "bg-blue-50" : "bg-white"} ${row.eligible ? "text-gray-800" : "text-gray-500"}`}>
                <td className={`${cellClass} rounded-l border-l`}>
                  <input type="checkbox" aria-label={`Select ${row.service_tag}`} checked={selected.has(row.service_tag) && canSelect(row)} disabled={operationBusy || loading || !canSelect(row) || isArchiveSelected(row)}
                    title={isArchiveSelected(row) ? "Remove the L11 archive to deselect this unit." : !canSelect(row) ? "Upload L11 logs individually or choose an archive containing this unit to select it." : undefined}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-blue-600 focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed"
                    onChange={() => toggleGroup([row])} />
                </td>
                <td className={`${cellClass} whitespace-nowrap`}>
                  <Link className="font-medium text-blue-600 hover:underline" to={`/${row.service_tag}`}>{row.service_tag}</Link>
                </td>
                <td className={cellClass}>
                  <span className={`${pillClass} ${missingEvidence(row) ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"}`}>
                    {missingEvidence(row) ? "Missing" : "Found"}
                  </span>
                  {!row.eligible && additionalBlockers && <p className="mt-1 max-w-md text-xs leading-relaxed text-gray-500">{additionalBlockers}</p>}
                </td>
                {flow === "l11" && <td className={cellClass}>
                  {!row.l11_found && (scanStatuses[row.service_tag]
                    ? <BatchScanStatus key={scanStatuses[row.service_tag].job_id} job={scanStatuses[row.service_tag]} />
                    : <span className="text-gray-400">—</span>)}
                </td>}
                <td className={`${cellClass} rounded-r border-r text-right`}>
                  {missingEvidence(row) && (flow === "l11"
                    ? <BatchL11LogActions row={row} disabled={operationBusy || loading || !!batchFile || selected.has(row.service_tag) || isActiveScan(scanStatuses[row.service_tag])} onRefresh={reload} onBusyChange={setIndividualBusy} />
                    : <button type="button" className="whitespace-nowrap rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={operationBusy || loading || !!batchFile || selected.has(row.service_tag)}
                        title={batchFile ? "Remove the shared file to upload individually." : selected.has(row.service_tag) ? "Deselect this unit to upload individually." : undefined}
                        onClick={() => chooseIndividualApproval(row.service_tag)}>Upload MRB Approval</button>)}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {loading && !visible.length && <div role="status" className="flex min-h-[240px] items-center justify-center text-sm text-gray-500">Checking availability…</div>}
        {!loading && !visible.length && <div className="flex min-h-[240px] items-center justify-center text-sm text-gray-500">No matching systems.</div>}
      </div>
      {loading && visible.length > 0 && <p role="status" className="mt-2 text-sm text-gray-500">Checking availability…</p>}
    </div>
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4" aria-label="Shared evidence upload">
      <h3 className="font-semibold">{flow === "l11" ? "Batch upload L11 logs" : "Apply one MRB approval to multiple systems"}</h3>
      {flow === "l11" ? <>
        <details className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
          <summary className="cursor-pointer font-medium">Archive format guide and limits</summary>
          <p className="mt-3">Service-tag folders can be directly inside the archive or inside one parent folder (for example, collection/ABC1234/log1.txt). The layout is detected automatically.</p>
          <pre className="mt-3 overflow-x-auto text-xs">{"batch.zip\n  ABC1234/\n    log1.txt\n    log2.log\n  DEF5678/\n    log1.txt"}</pre>
          <p className="mt-3 text-xs">Upload: {Math.round((limits.archive_bytes || 0) / 1024 ** 2)} MB; expanded: {Math.round((limits.expanded_bytes || 0) / 1024 ** 2)} MB; {limits.archive_files} files; {limits.systems} systems.</p>
        </details>

      </> : <>
        <p className="text-sm text-gray-600">Image, PDF, Outlook .msg or .eml · Max {Math.round((limits.approval_bytes || 0) / 1024 ** 2)} MB</p>
      </>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} disabled={operationBusy || loading}
          onClick={() => (flow === "l11" ? archiveInput : approvalInput).current?.click()}>
          {batchFile ? "Change file" : flow === "l11" ? "Choose L11 archive" : "Choose MRB Approval Document"}
        </button>
        {batchFile && <>
          <span className="break-all text-sm font-medium text-gray-800">{batchFile.name}</span>
          <button type="button" disabled={operationBusy} className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50" onClick={() => {
            if (flow === "l11") setSelected((previous) => new Set([...previous].filter((tag) => !archiveTags.has(tag))));
            setBatchFile(null); setArchivePreview(null);
          }}>Remove file</button>
        </>}
      </div>
      {flow === "l11" && batchFile && archivePreview && <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm" aria-live="polite">
        <h4 className="font-semibold">Archive review</h4>
        <p className="mt-1 text-gray-600">{archivePreview.filter((item) => item.status === "matched").length} matched; {archivePreview.filter((item) => item.status === "skipped").length} skipped.</p>
        {!archivePreview.some((item) => item.status === "matched") && <p className="mt-2 text-amber-800">No matching systems need logs. Choose another archive.</p>}
        <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-gray-600">{archivePreview.map((item) => <li key={item.service_tag}><strong>{item.service_tag}</strong>{item.status === "skipped" && <> — Skipped: {item.message}</>}</li>)}</ul>
      </div>}
      {alreadySelected.length > 0 && <div aria-live="polite">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <h4 className="text-sm font-semibold text-blue-800">{flow === "mrb" ? (batchFile ? "Will receive approval" : "Needs approval") : (batchFile ? "Will receive logs" : "Needs logs")} ({missingSelected.length})</h4>
          <p className="mt-2 max-h-32 overflow-auto font-mono text-sm text-gray-800">{missingSelected.map((row) => row.service_tag).join(", ") || "No units selected that need evidence."}</p>
        </div>

      </div>}
    </section>
    <label className="block text-sm font-medium">Common movement note
      <textarea value={note} maxLength={4000} disabled={operationBusy} rows={3} onChange={(event) => setNote(event.target.value)}
        className={`mt-1 block w-full ${inputClass}`} placeholder="Add a note to move selected systems. Leave blank to upload evidence only." />
    </label>
    {blockedCount > 0 && willMove && <p className="text-sm text-amber-800">{willUpload
      ? "Units still blocked after upload will stay in this queue."
      : "Resolve blockers or deselect blocked units to move."}</p>}
    {selectedRows.some((row) => isActiveScan(scanStatuses[row.service_tag])) && <p className="text-sm text-amber-800">Selected units are still being scanned.</p>}
    {overLimit && <p className="text-sm text-amber-800">Select at most {limits.systems} systems per submission.</p>}
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
      {alreadySelected.length > 0 && <div aria-live="polite">
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <h4 className="text-sm font-semibold text-green-800">{flow === "mrb" ? "Approval on file" : "Logs on file"} ({alreadySelected.length})</h4>
          <p className="mt-2 max-h-32 overflow-auto font-mono text-sm text-gray-800">{alreadySelected.map((row) => row.service_tag).join(", ")}</p>
        </div>
      </div>}
      <p className="text-sm text-gray-700">{!selectedRows.length ? "Select systems above." : willMove
        ? `Move eligible selected units to ${currentFlow.to}${willUpload ? " after upload" : ""}.`
        : willUpload ? `Upload only · ${missingSelected.length} systems`
          : "Choose a file or add a movement note."}</p>
      <button type="button" disabled={!canSubmit} onClick={submit}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
        {actionLabel}
      </button>
    </div>
    {operationBusy && <p role="status" className="text-sm text-blue-700">{progress || "Processing individual L11 logs…"} Keep this tab open until processing finishes.</p>}
    {scanJobs.error && <p role="alert" className="text-sm text-red-700">{scanJobs.error}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!!movedTags.length && <button type="button" className={button} disabled={operationBusy} onClick={downloadLabels}>Download RMA labels ({movedTags.length})</button>}
    <input ref={archiveInput} type="file" accept=".zip,.tar,.tar.gz,.tgz" className="hidden" onChange={(event) => { stageFile(event.target.files?.[0]); event.target.value = ""; }} />
    <input ref={approvalInput} type="file" accept={MRB_APPROVAL_ACCEPT} className="hidden" onChange={(event) => { stageFile(event.target.files?.[0]); event.target.value = ""; }} />
    <input ref={individualApprovalInput} type="file" accept={MRB_APPROVAL_ACCEPT} className="hidden" onChange={(event) => { uploadIndividualApproval(event.target.files?.[0]); event.target.value = ""; }} />
  </section>;
}
