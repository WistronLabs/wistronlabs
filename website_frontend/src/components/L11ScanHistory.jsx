import { useEffect, useRef } from "react";
import { getL11ScanDisplayStatus, getL11ScanSummary } from "../utils/l11ScanStatus.js";
import { formatDateHumanReadable } from "../utils/date_format";

export function ScanEntry({ job, timeZone }) {
  const active = ["queued", "dispatching", "running"].includes(job.status);
  const output = useRef(null);
  const technical = useRef(null);
  const follow = useRef(true);
  useEffect(() => {
    if (technical.current?.open && follow.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [job.stdout, job.stderr]);
      const summary = getL11ScanSummary(job.error || job.stdout || job.stderr);
      const outcome = job.status === "succeeded"
        ? summary.includes("No matching") ? "No matching logs"
          : summary.includes("No L11 folder") ? "Rack folder not found"
            : summary.includes("found and processed") ? "Logs found" : "Complete"
        : job.status === "running" ? "L11 Log Scan Running" : getL11ScanDisplayStatus(job.status);
      return <div className="rounded border border-gray-200 bg-white p-3 text-sm">
        <div>
          <strong>{outcome}</strong> · <span className="text-gray-500">{formatDateHumanReadable(job.ended_at || job.created_at, timeZone)}</span>
          {job.current === false && <span className="ml-2 text-gray-500">Previous cycle/rack</span>}
        </div>
        <p className="mt-2 text-xs text-gray-600">{({received:"Received",rack_changed:"Rack changed",manual:"Manual rescan",batch:"Batch rescan"})[job.trigger] || job.trigger} · {job.requested_by_name || "Deleted user"} · Rack {job.rack_service_tag}</p>
        {!active && job.status !== "succeeded" && summary && <p className="mt-2 text-sm text-gray-600">{summary}</p>}
        <details ref={technical} className="mt-2 text-xs text-gray-500" onToggle={() => { if (technical.current?.open && follow.current && output.current) output.current.scrollTop = output.current.scrollHeight; }}>
          <summary className="cursor-pointer text-[13px] font-medium">Technical details</summary>
          <p className="mt-2">Started: {job.started_at ? formatDateHumanReadable(job.started_at, timeZone) : "Pending"}</p>
          <p className="mt-1 break-all">Job: {job.job_id}</p>
          <pre ref={output} aria-label="Scan terminal output" tabIndex={0} onScroll={(event) => { const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24; }} className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-300 bg-slate-100 p-4 font-mono text-xs leading-relaxed text-slate-800 shadow-inner [color-scheme:light] [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{job.stdout || (!job.stderr && active ? "Waiting for runner output…" : "")}{job.stderr ? `\n${job.stderr}` : ""}</pre>
        </details>
      </div>;

}

export default function L11ScanHistory({ jobs, timeZone }) {
  const completed = jobs.filter((job) => ["succeeded", "failed", "outdated"].includes(job.status));
  return <section className="mt-5 rounded border border-gray-200 bg-gray-50 p-4">
    {completed.length > 0 ? <details>
      <summary className="cursor-pointer font-semibold">L11 Log Scan History</summary>
      <div className="mt-3 max-h-96 space-y-2 overflow-auto">{completed.map((job) => <ScanEntry key={job.job_id} job={job} timeZone={timeZone} />)}</div>
    </details> : <>
      <h3 className="mb-3 font-semibold">L11 Log Scan History</h3>
      <p className="text-sm text-gray-500">No completed scans.</p>
    </>}
  </section>;
}
