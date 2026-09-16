import { useEffect, useRef, useState } from "react";
import useApi from "../hooks/useApi";

export default function BatchL11LogActions({ row, disabled, onRefresh, onBusyChange }) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [message, setMessage] = useState("");
  const input = useRef(null);
  const actionsDisabled = disabled || busy || !row.rack_service_tag || row.l11_found;
  const actionTitle = !row.rack_service_tag ? "Set the rack service tag on the unit page first." : undefined;
  const actionClass = "whitespace-nowrap rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50";

  useEffect(() => {
    onBusyChange?.(busy);
    return () => { if (busy) onBusyChange?.(false); };
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!job) return;
    let canceled = false;
    let timer;
    async function poll() {
      try {
        const result = await apiRef.current.getSystemL11ScanStatus(row.service_tag, job);
        if (canceled) return;
        const status = String(result.status || "").toLowerCase();
        if (["succeeded", "failed", "unknown", "outdated"].includes(status)) {
          setMessage(status !== "succeeded" ? (result.error || "Scan needs review. See Scan History on the unit page.") : "Scan complete. Availability refreshed.");
          setJob(null);
          setBusy(false);
          refreshRef.current();
        } else { setMessage(`Scan ${status || "running"}…`); timer = setTimeout(poll, 2500); }
      } catch (err) {
        if (!canceled) { setMessage(err.body?.error || err.message); setJob(null); setBusy(false); }
      }
    }
    poll();
    return () => { canceled = true; clearTimeout(timer); };
  }, [job, row.service_tag]);

  async function upload(files) {
    if (!files.length || actionsDisabled) return;
    setBusy(true); setMessage("Archiving…");
    try {
      await apiRef.current.uploadSystemL11LogArchive(row.service_tag, files);
      setMessage("L11 logs uploaded."); refreshRef.current();
    } catch (err) { setMessage(err.body?.error || err.message); }
    finally { setBusy(false); }
  }
  async function scan() {
    if (actionsDisabled) return;
    setBusy(true); setMessage("Starting scan…");
    try {
      const result = await apiRef.current.startSystemL11Scan(row.service_tag);
      if (!result.job_id) throw new Error("Scan returned no job ID. Refresh to check log availability.");
      setJob(result.job_id);
    } catch (err) { setMessage(err.body?.error || err.message); setBusy(false); }
  }
  return <div className="flex flex-col items-end gap-1">
    <div className="flex justify-end gap-2">
      <button type="button" disabled={actionsDisabled} title={actionTitle} onClick={() => input.current?.click()} className={actionClass}>Upload L11 Logs</button>
      <button type="button" disabled={actionsDisabled} title={actionTitle} onClick={scan} className={actionClass}>Scan L11 Logs</button>
    </div>
    {message && <p role="status" className="max-w-xs text-xs text-gray-600">{message}</p>}
    <input type="file" multiple ref={input} className="hidden" onChange={(event) => {
      upload(Array.from(event.target.files || [])); event.target.value = "";
    }} />
  </div>;
}
