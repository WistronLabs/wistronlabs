import { useSearchParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import useTerminalApi from "../hooks/useTerminalApi";
import TerminalWorkspace from "../components/TerminalWorkspace";
import React, { useEffect, useState, useContext } from "react";
import SearchContainer from "../components/SearchContainer.jsx";

import useIsMobile from "../hooks/useIsMobile.jsx";
import useApi from "../hooks/useApi.jsx";

import Rack from "../components/Rack.jsx";
import Table from "../components/Table.jsx";

import { formatDateHumanReadable } from "../utils/date_format.js";

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

function StationPage() {
  const { token, user } = useContext(AuthContext);
  const terminalRequest = useTerminalApi();
  const [params, setParams] = useSearchParams();
  const terminalStation = params.get("terminal");
  const terminalTab = params.get("tab") === "terminals" || !!terminalStation;
  const [terminalAccess, setTerminalAccess] = useState(false);
  const [terminalEnabled, setTerminalEnabled] = useState(false);
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
  const openTerminal = terminalAccess
    ? (station) => setParams({ terminal: String(station) })
    : undefined;
  const FRONTEND_URL = import.meta.env.VITE_URL;
  const LOCATION = import.meta.env.VITE_LOCATION;

  const { getStations } = useApi();
  const [stations, setStations] = useState([]);
  const [error, setError] = useState("");
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(false);

  const isMobile = useIsMobile();

  const baseUrl =
    import.meta.env.MODE === "development"
      ? FRONTEND_URL // is "/l10_logs/" in development
      : FRONTEND_URL; // is "/l10_logs/" in production

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

  useEffect(() => {
    // fetch downloads once
    const fetchDownloads = async () => {
      try {
        const link = `${baseUrl}/l10_logs/`;
        const res = await fetch(link);
        const text = await res.text();
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(text, "text/html");
        const rows = htmlDoc.querySelectorAll("tr");
        const entries = [];
        rows.forEach((row, rowIndex) => {
          if (rowIndex >= 3 && rowIndex < rows.length - 1) {
            let rawDate = "";
            let name = "";
            let href = "";
            const cols = row.querySelectorAll("td");
            cols.forEach((col, colIndex) => {
              // get folder name and href
              if (colIndex == 1) {
                name = Array.from(col.querySelectorAll("a"))[0]
                  .textContent.trim()
                  .replace(/\/$/, "");
                href = Array.from(col.querySelectorAll("a"))[0].getAttribute(
                  "href",
                );
              }

              // get raw date data
              if (colIndex == 2) {
                rawDate = col.textContent.trim();
              }
            });

            const formattedDate = formatDateHumanReadable(
              new Date(rawDate + "Z"),
            );

            //push entry
            entries.push({
              name,
              href: link + href,
              name_title: "File Name",
              date: formattedDate,
              date_title: "Date Modified",
            });
          }
        });
        setDownloads(entries);
      } catch (err) {
        console.error("Failed to fetch downloads:", err);
      }
    };
    fetchDownloads();
  }, []);

  return (
    <>
      {/* Testing Stations */}
      <main className="md:max-w-10/12  mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <h1 className="text-3xl font-semibold text-gray-800">Testing Stations</h1>
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
        )}
      </main>
      {/* Available Downloads */}
      {/* <section className="md:max-w-10/12 mx-auto mt-8 bg-white rounded shadow-md p-4">
        <SearchContainer
          data={downloads}
          title={"Available Logs"}
          displayOrder={["name", "date"]}
          defaultSortBy={"date"}
          defaultSortAsc={false}
          fieldStyles={{
            name: "text-blue-600 font-medium",
            date: "text-gray-500 text-sm",
          }}
          linkType="external"
          visibleFields={isMobile ? ["name", "date"] : ["name", "date"]}
        />
      </section> */}
    </>
  );
}

export default StationPage;
