import { useEffect, useRef, useState } from "react";
import { button, iconButton, TerminalIcon } from "./terminalControls";

export default function TerminalPanel({ station, request, onClose, dragHandle, singleView = false }) {
  const [controlled, onControl] = useState(false);
  const panel = useRef(null);
  const viewMenu = useRef(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [viewError, setViewError] = useState("");
  useEffect(() => {
    const syncFullscreen = () => setFullScreen(document.fullscreenElement === panel.current);
    const dismiss = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "keydown" || !viewMenu.current?.contains(event.target)) {
        if (viewMenu.current?.open) {
          if (viewMenu.current) viewMenu.current.open = false;
          if (event.type === "keydown") viewMenu.current.querySelector("summary")?.focus();
        }
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
  async function toggleFullscreen() {
    if (viewMenu.current) viewMenu.current.open = false;
    setViewError("");
    try {
      if (fullScreen) await document.exitFullscreen();
      else if (panel.current.requestFullscreen) await panel.current.requestFullscreen();
      else setViewError("Full screen is unavailable in this browser. Use Open in new tab.");
    } catch {
      setViewError(fullScreen ? "Could not close full screen. Press Escape to exit." : "Could not enter full screen. Try Open in new tab.");
    }
  }
  const terminalArea = useRef(null);
  const terminalFrame = useRef(null);
  useEffect(() => {
    if (!controlled) return;
    terminalFrame.current?.focus({ preventScroll: true });
    const releaseOutside = (event) => {
      if (!terminalArea.current?.contains(event.target)) onControl(false);
    };
    document.addEventListener("pointerdown", releaseOutside);
    document.addEventListener("focusin", releaseOutside);
    return () => {
      document.removeEventListener("pointerdown", releaseOutside);
      document.removeEventListener("focusin", releaseOutside);
    };
  }, [controlled, onControl]);
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let lease;
    let timer;
    let busy = false;
    const release = () =>
      lease && request(`/leases/${lease}`, "DELETE").catch(() => {});
    setConnection(null);
    setError("");
    setUsers([]);
    setConnected(false);
    request(`/stations/${station.station_name}/connect`, "POST")
      .then((result) => {
        lease = result.id;
        if (disposed) {
          release();
          return;
        }
        setConnection(result);
        const started = Date.now();
        let wasConnected = false;
        const heartbeat = async () => {
          if (busy || disposed) return;
          busy = true;
          try {
            const status = await request(`/leases/${lease}`, "POST");
            if (disposed) return;
            if (
              !status.connected &&
              (wasConnected || Date.now() - started > 20000)
            ) {
              throw new Error("Terminal disconnected. Reconnect to continue.");
            }
            wasConnected ||= status.connected;
            setConnected(status.connected);
            setUsers(status.users);
          } catch (e) {
            if (!disposed) {
              onControl(false);
              setError(e.message);
              setConnection(null);
              setConnected(false);
              clearInterval(timer);
              release();
            }
          } finally {
            busy = false;
          }
        };
        timer = setInterval(heartbeat, 5000);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      clearInterval(timer);
      release();
    };
  }, [station.station_name, request, attempt]);
  const status = error
      ? { label: "Failed", style: "bg-red-100 text-red-700" }
      : connected
        ? { label: "Connected", style: "bg-green-100 text-green-700" }
        : { label: "Connecting…", style: "bg-amber-100 text-amber-800" };

  return (
    <section
      ref={panel}
      data-terminal-panel
      className={`[&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:rounded-none flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-gray-50 shadow-sm transition-colors ${controlled ? "border-blue-400 ring-1 ring-inset ring-blue-400" : "border-gray-200"}`}
    >
      <header
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3"
      >
        <div
          {...(!fullScreen ? dragHandle?.attributes : {})}
          {...(!fullScreen ? dragHandle?.listeners : {})}
          ref={dragHandle?.setActivatorNodeRef}
          aria-label={!fullScreen ? `Move Station ${station.station_name}` : undefined}
          title={!fullScreen ? "Drag to move terminal" : undefined}
          className={`min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${!fullScreen ? "touch-none cursor-grab active:cursor-grabbing" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-800"><TerminalIcon />Station {station.station_name}</p>
            <span
              role="status"
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${status.style}`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full bg-current ${!error && !connected ? "motion-safe:animate-pulse" : ""}`}
              />
              {status.label}
            </span>
            {connection?.newSession && !error && (
              <span className="text-xs text-gray-500">New session</span>
            )}
          </div>
          <p className="mt-1">
            <span
              className={`inline-block rounded px-2 py-0.5 text-xs ${
                station.system_service_tag
                  ? "bg-blue-50 font-medium text-blue-700"
                  : "bg-gray-50 text-gray-500"
              }`}
            >
              {station.system_service_tag || "No System Attached"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          {fullScreen ? <button className={`${button} inline-flex items-center gap-2`} onClick={toggleFullscreen}><TerminalIcon kind="fullscreen" />Close full screen</button> : <>
          {singleView ? <a
            className={`${button} inline-flex items-center gap-2`}
            href={`/stations?terminal=${station.station_name}&popout=1`}
            target="_blank" rel="noopener noreferrer"
          ><TerminalIcon kind="external" />Open in new tab</a> : <details ref={viewMenu} className="relative">
            <summary
              aria-label={`Station ${station.station_name} view options`}
              title="Terminal view options"
              className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden"
            >
              <TerminalIcon kind="fullscreen" />
              View
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </summary>
            <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
              <button
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                onClick={toggleFullscreen}
              >
                <TerminalIcon kind="fullscreen" />
                {fullScreen ? "Exit full screen" : "Full screen"}
              </button>
              <a
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                href={`/stations?terminal=${station.station_name}&popout=1`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { viewMenu.current.open = false; }}
              >
                <TerminalIcon kind="external" />
                Open in new tab
              </a>
            </div>
          </details>}
          <button
            aria-label={`Close Station ${station.station_name}`}
            className={iconButton}
            title="Close terminal"
            onClick={onClose}
          >
            <TerminalIcon kind="close" />
          </button>
          </>}
        </div>
      </header>
      {viewError && <p role="alert" className="shrink-0 px-4 py-2 text-xs text-red-700">{viewError}</p>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-sm">
            <p role="alert" className="mb-3 text-red-700">
              {error}
            </p>
            <button className={button} onClick={() => setAttempt((v) => v + 1)}>
              Reconnect
            </button>
          </div>
        ) : connection ? (
          <div ref={terminalArea} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <iframe
            ref={terminalFrame}
            tabIndex={controlled ? 0 : -1}
            className={`min-h-0 w-full flex-1 border-0 ${controlled ? "" : "pointer-events-none"}`}
            title={`Station ${station.station_name} terminal`}
            src={connection.url}
            allow="clipboard-read; clipboard-write"
          />
          {!controlled && (
            <button
              className="absolute inset-0 flex items-end justify-center pb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
              aria-label={`Control Station ${station.station_name} terminal`}
              onClick={() => onControl(true)}
            >
              <span className="rounded-md border border-gray-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm">Click to control terminal</span>
            </button>
          )}
          </div>
        ) : (
          <p className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">Connecting…</p>
        )}
      </div>
      <footer
        className="flex h-6 shrink-0 items-center border-t border-gray-200 bg-gray-50 px-4 text-xs text-gray-500"
      >
        <span
          className="truncate"
          title={!error ? users.join(", ") : undefined}
        >
          {!!users.length && !error
            ? `${users.join(", ")} connected`
            : "\u00a0"}
        </span>
      </footer>
    </section>
  );
}

