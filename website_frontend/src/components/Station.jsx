import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import Tooltip from "./Tooltip.jsx";
import { TerminalIcon } from "./terminalControls.jsx";
import useTerminalApi from "../hooks/useTerminalApi.js";
import TerminalSessionContext from "../context/TerminalSessionContext.jsx";

function Station({
  stationInfo,
  onOpenTerminal,
  link = false,
}) {
  const [now, setNow] = useState(DateTime.now());
  const terminalSessions = useContext(TerminalSessionContext);
  const terminalRequest = useTerminalApi();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewOutput, setPreviewOutput] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewOutputRef = useRef(null);
  const canPreview = !!onOpenTerminal && terminalSessions.has(String(stationInfo.station_name));
  const previewVisible = previewOpen && canPreview;

  const togglePreview = () => {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    setPreviewOutput("");
    setPreviewError("");
    setPreviewLoading(true);
    setPreviewOpen(true);
  };

  useLayoutEffect(() => {
    if (!previewOpen || previewLoading || !previewOutputRef.current) return;
    previewOutputRef.current.scrollTop = previewOutputRef.current.scrollHeight;
  }, [previewOpen, previewLoading, previewOutput, previewError]);

  useEffect(() => {
    if (!previewOpen || !canPreview) return undefined;
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const data = await terminalRequest(`/stations/${stationInfo.station_name}/preview`);
        if (active) {
          setPreviewOutput(data.output);
          setPreviewError("");
        }
      } catch (error) {
        if (active) setPreviewError(error.message);
      } finally {
        if (active) setPreviewLoading(false);
        busy = false;
      }
    };
    setPreviewLoading(true);
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [previewOpen, canPreview, stationInfo.station_name, terminalRequest]);

  // Tick every 30s so the bar/tooltip update without page reloads
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const lastUpdatedISO = stationInfo?.last_updated;
  const then = useMemo(
    () => (lastUpdatedISO ? DateTime.fromISO(lastUpdatedISO) : null),
    [lastUpdatedISO],
  );

  const diff = useMemo(() => {
    if (!then) return null;
    return now.diff(then, ["days", "hours", "minutes", "seconds"]);
  }, [now, then]);

  const details = stationInfo.details;
  const progress = details?.PROGRESS;
  const hasProgress = stationInfo.status === 1 &&
    Number.isInteger(progress?.completed) &&
    Number.isInteger(progress?.total) &&
    progress.total > 0;
  const progressPct = hasProgress
    ? Math.min(100, Math.max(0, (progress.completed / progress.total) * 100))
    : null;
  const failedTests = [...(details?.FAILED || []), ...(details?.TIMEOUT || [])];
  const failedIndices = hasProgress && Array.isArray(progress.failedIndices)
    ? progress.failedIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < progress.total)
    : [];

  const humanAgo = useMemo(() => {
    if (!diff) return "";
    const d = Math.floor(diff.days);
    const h = Math.floor(diff.hours);
    const m = Math.floor(diff.minutes);
    if (d > 0) return `${d} day${d > 1 ? "s" : ""} ago`;
    if (h > 0) return `${h} hour${h > 1 ? "s" : ""} ago`;
    if (m > 0) return `${m} minute${m > 1 ? "s" : ""} ago`;
    return "just now";
  }, [diff]);

  const tooltip = stationInfo.status === 1 ? (
    <div className="space-y-0.5">
      <div className="font-semibold">
        {hasProgress ? `${progress.completed}/${progress.total} modules · ${Math.round(progressPct)}%` : "L10 running · progress unavailable"}
      </div>
      {details?.["CURRENT TEST"] && (
        <div className="truncate text-slate-300">Now: {details["CURRENT TEST"]}</div>
      )}
      {failedTests.length > 0 && (
        <div className="truncate text-red-300">
          {failedTests.length} failed: {failedTests.slice(0, 2).join(", ")}
          {failedTests.length > 2 ? ` +${failedTests.length - 2}` : ""}
        </div>
      )}
      {then && <div className="text-slate-400">Updated {humanAgo}</div>}
    </div>
  ) : undefined;

  const renderStatus = (status, message) => {
    const base =
      "relative inline-flex items-center justify-center min-w-24 max-w-[12rem] px-2 py-1 rounded-md md:rounded-full text-xs font-medium text-center";
    const textClass = "block truncate whitespace-nowrap";
    const withTooltip = (statusBadge) => (
      <Tooltip
        show={!!tooltip && !previewOpen}
        text={tooltip}
        maxWidthClassName="w-60 max-w-[calc(100vw-2rem)]"
        topViewportOffset={110}
      >
        {statusBadge}
      </Tooltip>
    );

    if (status === 3)
      return withTooltip(
        <span className={`${base} bg-gray-200 text-gray-700`}>
          <span className={textClass}>{message}</span>
        </span>,
      );

    if (status === 0)
      return withTooltip(
        <span className={`${base} bg-yellow-100 text-yellow-800`}>
          <span className={textClass}>{message}</span>
        </span>,
      );

    if (status === 1) {
      // “loading bar” background with status text on top
      return withTooltip(
        <span
          className={`${base} bg-green-100 text-green-900 overflow-hidden ${canPreview ? "cursor-pointer" : "cursor-default"} select-none`}
          aria-label={hasProgress
            ? `${progress.completed} of ${progress.total} L10 modules complete; ${failedIndices.length} failed or timed out`
            : "L10 running; progress unavailable"}
          role={hasProgress ? "progressbar" : "status"}
          aria-valuenow={hasProgress ? Math.round(progressPct) : undefined}
          aria-valuemin={hasProgress ? 0 : undefined}
          aria-valuemax={hasProgress ? 100 : undefined}
        >
          {/* progress fill */}
          <span
            className="absolute left-0 top-0 h-full bg-green-300/70"
            style={{
              width: `${progressPct ?? 0}%`,
              transition: "width 0.6s linear",
            }}
            aria-hidden="true"
          />
          {failedIndices.map((index) => (
            <span
              key={index}
              className="absolute top-0 h-full min-w-[2px] bg-red-500"
              style={{ left: `${(index / progress.total) * 100}%`, width: `${100 / progress.total}%` }}
              aria-hidden="true"
            />
          ))}
          {/* text stays readable above the fill without competing with sticky headers */}
          <span className={`relative z-[1] ${textClass}`}>{message}</span>
        </span>,
      );
    }

    if (status === 4)
      return withTooltip(
        <span className={`${base} bg-green-100 text-green-800`}>
          <span className={textClass}>{message}</span>
        </span>,
      );

    if (status === 5)
      return withTooltip(
        <span className={`${base} bg-red-100 text-red-800`}>
          <span className={textClass}>{message}</span>
        </span>,
      );

    return withTooltip(
      <span className={`${base} bg-red-100 text-red-800`}>
        <span className={textClass}>{message}</span>
      </span>,
    );
  };

  return (
    <>
    <tr key={stationInfo.station}>
      <td className="p-3 border-b border-gray-200 text-left">
        <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
          <span
            className={onOpenTerminal ? "inline-flex min-w-0 items-center tabular-nums" : "min-w-0 truncate"}
            title={`Station ${stationInfo.station_name}`}
          >
            {onOpenTerminal ? (
              <><span className="truncate">Station</span><span className="ml-1 w-7 shrink-0 text-right">{stationInfo.station_name}</span></>
            ) : `Station ${stationInfo.station_name}`}
          </span>
          {onOpenTerminal && !previewVisible && (
            <button
              type="button"
              onClick={() => onOpenTerminal(stationInfo.station_name)}
              aria-label={`Open terminal for Station ${stationInfo.station_name}`}
              title={`Open terminal for Station ${stationInfo.station_name}`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <TerminalIcon />
            </button>
          )}
          {previewVisible && <span className="h-7 w-7 shrink-0" aria-hidden="true" />}
        </div>
      </td>

      <td className="relative overflow-visible p-3 border-b border-gray-200 text-center">
        {canPreview ? (
          <button
            type="button"
            aria-label={`${previewOpen ? "Hide" : "Show"} read-only terminal preview for Station ${stationInfo.station_name}`}
            aria-expanded={previewOpen}
            aria-controls={previewOpen ? `station-preview-${stationInfo.station_name}` : undefined}
            onClick={togglePreview}
            className="cursor-pointer rounded-full hover:ring-2 hover:ring-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            title={previewOpen ? "Hide read-only terminal preview" : "Show read-only terminal preview"}
          >
            {renderStatus(stationInfo.status, stationInfo.message)}
          </button>
        ) : renderStatus(stationInfo.status, stationInfo.message)}
      </td>

      <td className="p-3 border-b border-gray-200 text-right">
        {stationInfo.system_service_tag === null ? (
          <p className="text-gray-800 text-right">Available</p>
        ) : link ? (
          <Link
            to={`/${stationInfo.system_service_tag}`}
            className="inline-block max-w-full truncate align-middle text-blue-600 hover:underline text-right"
          >
            {stationInfo.system_service_tag}
          </Link>
        ) : (
          <p className="truncate text-gray-500 text-right">
            {stationInfo.system_service_tag}
          </p>
        )}
      </td>
    </tr>
    {previewVisible && (
      <tr id={`station-preview-${stationInfo.station_name}`}>
        <td colSpan={3} className="overflow-hidden border-b border-gray-200 bg-slate-50 px-3 pb-4 pt-2">
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Terminal Preview</span>
            <button
              type="button"
              onClick={() => onOpenTerminal(stationInfo.station_name)}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <TerminalIcon />
              Open Interactive Terminal
            </button>
          </div>
          <div className="h-72 w-full min-w-0 max-w-full overflow-hidden rounded-lg bg-slate-800">
            {previewLoading ? (
              <div role="status" aria-label="Loading terminal output" className="h-full animate-pulse space-y-3 p-3">
                {["w-3/4", "w-11/12", "w-2/3", "w-5/6", "w-1/2", "w-4/5"].map((width, index) => (
                  <div key={index} aria-hidden="true" className={`h-3 rounded bg-slate-600/70 ${width}`} />
                ))}
              </div>
            ) : (
              <pre
                ref={previewOutputRef}
                role="log"
                aria-label={`Station ${stationInfo.station_name} terminal output`}
                aria-live="off"
                className="h-full w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto overscroll-contain whitespace-pre p-3 font-mono text-xs leading-5 text-slate-100"
              >
                {previewError || previewOutput || "No visible output yet."}
              </pre>
            )}
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

export default Station;
