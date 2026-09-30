import { useSearchParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import useTerminalApi from "../hooks/useTerminalApi";
import TerminalWorkspace from "../components/TerminalWorkspace";
import TerminalSessionContext from "../context/TerminalSessionContext";
import React, { useEffect, useState, useContext, useRef } from "react";
import useApi from "../hooks/useApi.jsx";

import Rack from "../components/Rack.jsx";
import Table from "../components/Table.jsx";


function StationTableSkeleton({ rows }) {
  return (
    <section className="animate-pulse pb-4" aria-hidden="true">
      <div className="mb-4 h-7 w-36 rounded bg-gray-200" />
      <div className="overflow-hidden rounded border border-gray-200 shadow-sm">
        <div className="grid grid-cols-3 gap-3 bg-gray-50 p-3">
          <div className="h-3 rounded bg-gray-200" />
          <div className="h-3 rounded bg-gray-200" />
          <div className="h-3 rounded bg-gray-200" />
        </div>
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-3 gap-3 border-t border-gray-100 p-3"
          >
            <div className="h-4 rounded bg-gray-100" />
            <div className="h-4 rounded bg-gray-100" />
            <div className="h-4 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </section>
  );
}

function StationStatusSkeleton({ isTss }) {
  const leftColumnRows = isTss ? [2, 19] : [2, 2, 2, 4, 2];
  const rightColumnRows = isTss ? [2, 19] : [2, 2, 4, 2];

  return (
    <div
      className="flex flex-col md:flex-row justify-between gap-8 mt-8 w-full"
      aria-label="Loading station status"
    >
      <div className="flex flex-col w-full">
        {leftColumnRows.map((rows, index) => (
          <StationTableSkeleton key={index} rows={rows} />
        ))}
      </div>
      <div className="flex flex-col w-full">
        {rightColumnRows.map((rows, index) => (
          <StationTableSkeleton key={index} rows={rows} />
        ))}
      </div>
    </div>
  );
}

function TerminalHelp() {
  const help = useRef(null);
  useEffect(() => {
    const dismiss = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (help.current && (event.type === "keydown" || !help.current.contains(event.target))) help.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);

  return (
    <details ref={help} className="relative z-30 shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-bold">?</span>
        Terminal help
      </summary>
      <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-lg">
        <h2 className="font-semibold text-gray-900">Copy from a terminal</h2>
        <p className="mt-2"><strong>Mac:</strong> Hold Option and drag across the text. Release to copy.</p>
        <p className="mt-2"><strong>Windows / Linux:</strong> Hold Shift and drag across the text. Release to copy.</p>
        <p className="mt-3 border-t border-gray-100 pt-3 text-gray-600">A yellow highlight is tmux copy mode. Press Esc, then select again with the modifier key above. To paste, focus the terminal and use your browser’s paste shortcut.</p>
      </div>
    </details>
  );
}

function StationPage() {
  const { token, user } = useContext(AuthContext);
  const terminalRequest = useTerminalApi();
  const [params, setParams] = useSearchParams();
  const terminalStation = params.get("terminal");
  const terminalTab = params.get("tab") === "terminals" || !!terminalStation;
  const [terminalAccess, setTerminalAccess] = useState(false);
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [terminalSessions, setTerminalSessions] = useState(new Set());
  useEffect(() => {
    let active = true;
    if (!token) {
      setTerminalAccess(false);
      return;
    }
    const check = () =>
      terminalRequest("/access")
        .then((data) => {
          if (active) {
            setTerminalAccess(data.allowed);
            setTerminalEnabled(data.enabled);
          }
        })
        .catch(() => {
          if (active) setTerminalAccess(false);
        });
    check();
    const timer = setInterval(check, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, terminalRequest]);
  useEffect(() => {
    if (!token || !terminalAccess || !terminalEnabled) {
      setTerminalSessions(new Set());
      return;
    }
    let active = true;
    const refresh = () => terminalRequest("/sessions")
      .then((data) => {
        if (active) setTerminalSessions(new Set((data.stations || []).map(String)));
      })
      .catch(() => {
        if (active) setTerminalSessions(new Set());
      });
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, terminalAccess, terminalEnabled, terminalRequest]);
  const openTerminal = terminalAccess
    ? (station) => setParams({ terminal: String(station) })
    : undefined;
  const LOCATION = import.meta.env.VITE_LOCATION;

  const { getStations } = useApi();
  const [stations, setStations] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchStations = async () => {
    try {
      const data = await getStations();
      setStations(data);
      setError("");
    } catch (err) {
      console.error("Failed to fetch stations:", err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stationData] = await Promise.all([getStations()]);
      setStations(stationData);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // fetch stations every 1s
    fetchData();
    const interval = setInterval(fetchStations, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {/* Testing Stations */}
      <main className="md:max-w-10/12  mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold text-gray-800">Testing Stations</h1>
          {terminalAccess && <TerminalHelp />}
        </div>
        <div className="flex gap-2 border-b border-gray-200 pb-3">
          <button
            className={`rounded-md px-4 py-2 text-sm font-medium ${!terminalTab ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
            onClick={() => setParams({})}
          >
            Overview
          </button>
          {terminalAccess && (
            <button
              className={`rounded-md px-4 py-2 text-sm font-medium ${terminalTab ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
              onClick={() => setParams({ tab: "terminals" })}
            >
              Terminals
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {terminalTab ? (
          !token ? (
            <p className="text-sm text-gray-600">
              Sign in to access station terminals.
            </p>
          ) : !terminalAccess ? (
            <p className="text-sm text-gray-600">
              Terminal access is required.
            </p>
          ) : !terminalEnabled ? (
            <p className="text-sm text-gray-600">
              Terminal service is not configured on this server.
            </p>
          ) : loading ? (
            <p>Loading stations…</p>
          ) : (
            <TerminalWorkspace
              key={`${user?.id}:${terminalStation || "saved"}`}
              stations={stations}
              initialStation={terminalStation}
              popout={params.get("popout") === "1"}
            />
          )
        ) : loading ? (
          <StationStatusSkeleton isTss={LOCATION === "TSS"} />
        ) : (
          <TerminalSessionContext.Provider value={terminalSessions}>
          <div className="flex flex-col md:flex-row justify-between gap-8 mt-8 w-full">
            {LOCATION === "TSS" ? (
              <>
                <div className="flex flex-col w-full">
                  <Table
                    stations={stations}
                    stationNumbers={[3, 4]}
                    tableNumber={2}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Rack
                    stations={stations}
                    rackNumber={2}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                </div>

                {/* Right Column */}
                <div className="flex flex-col w-full">
                  <Table
                    stations={stations}
                    stationNumbers={[1, 2]}
                    tableNumber={1}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Rack
                    stations={stations}
                    rackNumber={1}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col w-full">
                  <Table
                    stations={stations}
                    stationNumbers={[1, 2]}
                    tableNumber={1}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Table
                    stations={stations}
                    stationNumbers={[5, 6]}
                    tableNumber={3}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Table
                    stations={stations}
                    stationNumbers={[9, 10]}
                    tableNumber={5}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Table
                    stations={stations}
                    stationNumbers={[11, 12, 13, 14]}
                    tableNumber={7}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Table
                    stations={stations}
                    stationNumbers={[21, 22]}
                    tableNumber={9}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                </div>

                {/* Right Column */}
                <div className="flex flex-col w-full">
                  <Table
                    stations={stations}
                    stationNumbers={[3, 4]}
                    tableNumber={2}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Table
                    stations={stations}
                    stationNumbers={[7, 8]}
                    tableNumber={4}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Table
                    stations={stations}
                    stationNumbers={[15, 16, 17, 18]}
                    tableNumber={6}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                  <Table
                    stations={stations}
                    stationNumbers={[23, 24]}
                    tableNumber={8}
                    link={true}
                    onOpenTerminal={openTerminal}
                  />
                </div>
              </>
            )}
          </div>
          </TerminalSessionContext.Provider>
        )}
      </main>
    </>
  );
}

export default StationPage;
