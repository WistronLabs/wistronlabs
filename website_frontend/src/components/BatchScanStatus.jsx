import { useLayoutEffect, useRef, useState } from "react";
import { getL11ScanDisplayStatus, getL11ScanSummary } from "../utils/l11ScanStatus.js";

export default function BatchScanStatus({ job }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const text = useRef(null);
  const message = job.error || getL11ScanSummary(job.stdout || job.stderr);
  useLayoutEffect(() => {
    if (expanded || !text.current) return;
    const measure = () => setOverflowing(text.current.scrollWidth > text.current.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text.current);
    return () => observer.disconnect();
  }, [message, expanded]);
  return <div className="w-full min-w-0 text-left text-xs">
    <div className="flex min-w-0 items-center gap-1">
      <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium whitespace-nowrap ${job.status === "failed" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
        Scan: {getL11ScanDisplayStatus(job.status)}
      </span>
      {!expanded && <span ref={text} className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-gray-600">{message}</span>}
      {(overflowing || expanded) && <button type="button" aria-expanded={expanded}
        aria-label={expanded ? "Collapse scan message" : "Expand scan message"}
        onClick={() => setExpanded((value) => !value)}
        className="ml-auto shrink-0 rounded px-1 text-sm font-semibold text-blue-600 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {expanded ? "−" : "…"}
      </button>}
    </div>
    {expanded && <p className="mt-1 whitespace-pre-wrap break-words text-gray-600 [overflow-wrap:anywhere]">{message}</p>}
  </div>;
}
