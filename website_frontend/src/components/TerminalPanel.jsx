import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { button, iconButton, TerminalIcon } from "./terminalControls";

function focusTerminalFrame(frame, url) {
  if (!frame || !url) return;
  frame.focus({ preventScroll: true });
  const origin = new URL(url, window.location.href).origin;
  frame.contentWindow?.postMessage({ type: "wistron-terminal-focus" }, origin);
}

export default function TerminalPanel({ station, biosMac, biosServiceTag, biosPrompt, biosPromptServiceTag, onOpenBios, onDismissBios, request, onClose, dragHandle, singleView = false }) {
  const isBios = !!biosMac;
  const terminalName = isBios ? `BIOS ${biosServiceTag || biosMac.toUpperCase()}` : `Station ${station.station_name}`;
  const connectPath = isBios ? `/bios/${biosMac}/connect` : `/stations/${station.station_name}/connect`;
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
  const [connection, setConnection] = useState(null);
  useEffect(() => {
    if (!controlled) return;
    focusTerminalFrame(terminalFrame.current, connection?.url);
    const releaseOutside = (event) => {
      if (!terminalArea.current?.contains(event.target)) onControl(false);
    };
    document.addEventListener("pointerdown", releaseOutside);
    document.addEventListener("focusin", releaseOutside);
    return () => {
      document.removeEventListener("pointerdown", releaseOutside);
      document.removeEventListener("focusin", releaseOutside);
    };
  }, [controlled, connection?.url]);
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
    request(connectPath, "POST")
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
  }, [connectPath, request, attempt]);
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
          aria-label={!fullScreen && dragHandle ? `Move ${terminalName}` : undefined}
          title={!fullScreen && dragHandle ? "Drag to move terminal" : undefined}
          className={`min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${!fullScreen && dragHandle ? "touch-none cursor-grab active:cursor-grabbing" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-800"><TerminalIcon />{terminalName}</p>
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
          {!isBios && <p className="mt-1">
            {station.system_service_tag ? <Link
              to={`/${encodeURIComponent(station.system_service_tag)}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${station.system_service_tag} in a new tab`}
              onPointerDown={(event) => event.stopPropagation()}
              className="inline-block rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >{station.system_service_tag}</Link> : <span className="inline-block rounded bg-gray-50 px-2 py-0.5 text-xs text-gray-500">No System Attached</span>}
          </p>}
        </div>
        <div className="flex items-center gap-1">
          {fullScreen ? <button className={`${button} inline-flex items-center gap-2`} onClick={toggleFullscreen}><TerminalIcon kind="fullscreen" />Close full screen</button> : <>
          {isBios ? <button className={`${button} inline-flex items-center gap-2`} onClick={toggleFullscreen}>
            <TerminalIcon kind="fullscreen" />Full screen
          </button> : singleView ? <a
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
            aria-label={`Close ${terminalName}`}
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
            onLoad={() => { if (controlled) focusTerminalFrame(terminalFrame.current, connection.url); }}
            tabIndex={controlled ? 0 : -1}
            className={`min-h-0 w-full flex-1 border-0 ${controlled ? "" : "pointer-events-none"}`}
            title={`${terminalName} terminal`}
            src={connection.url}
            allow="clipboard-read; clipboard-write"
          />
          {!controlled && (
            <button
              className="absolute inset-0 flex items-end justify-center pb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
              aria-label={`Control ${terminalName} terminal`}
              onClick={() => onControl(true)}
            >
              <span className="rounded-md border border-gray-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm">Click to control terminal</span>
            </button>
          )}
          {biosPrompt && <div role="status" className="bios-serial-prompt absolute inset-y-0 right-0 z-20 flex w-44 max-w-full flex-col border-l border-blue-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-1 border-b border-blue-100 px-3 py-3">
              <p className="text-sm font-semibold leading-5 text-blue-800">BIOS serial is ready</p>
              <button type="button" aria-label="Dismiss BIOS serial prompt" onClick={onDismissBios} className="-mr-1 -mt-1 rounded-md px-2 py-1 text-lg leading-5 text-gray-500 hover:bg-blue-50 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">×</button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Station</p>
                <p className="mt-1 text-sm font-semibold text-gray-800">{station.station_name}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">BIOS serial</p>
                <p className="mt-1 break-words text-sm font-semibold text-gray-800">{biosPrompt.serviceTag || biosPromptServiceTag || biosPrompt.mac.toUpperCase()}</p>
                {(biosPrompt.serviceTag || biosPromptServiceTag) && <p className="mt-1 break-all font-mono text-xs text-gray-500">{biosPrompt.mac.toUpperCase()}</p>}
              </div>
            </div>
            <div className="border-t border-blue-100 p-3">
              <button type="button" onClick={onOpenBios} className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">Open beside station</button>
            </div>
          </div>}
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
