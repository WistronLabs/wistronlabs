import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import useApi from "../hooks/useApi";

const AUTO_REFRESH_MS = 5 * 60_000;
const LAST_SITE_UPDATE_KEY = "wistronlabs:lastSiteUpdate";

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "just now";

  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 5) return "just now";
  if (totalSeconds < 60) return `${totalSeconds}s ago`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min${totalMinutes === 1 ? "" : "s"} ago`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  return `${totalHours} hr${totalHours === 1 ? "" : "s"} ago`;
}

function Footer({ className = "" }) {
  const { getServerTime } = useApi();
  const [serverZone, setServerZone] = useState(null);
  const [tick, setTick] = useState(0); // increments every second
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => {
    const stored = Number(sessionStorage.getItem(LAST_SITE_UPDATE_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;

    const now = Date.now();
    sessionStorage.setItem(LAST_SITE_UPDATE_KEY, String(now));
    return now;
  });
  const buildNumber =
    import.meta.env.VITE_BUILD_NUMBER ||
    import.meta.env.BUILD_NUMBER ||
    "unknown";

  // 1) Get server timezone once
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getServerTime();
        if (!alive) return;
        setServerZone(res?.zone || "UTC");
      } catch {
        setServerZone(
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        );
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Tick every second
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1e9), 1000);
    return () => clearInterval(id);
  }, []);

  // 3) Refresh the whole app every minute so all pages pick up current data.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      sessionStorage.setItem(LAST_SITE_UPDATE_KEY, String(now));
      setLastUpdatedAt(now);
      window.location.reload();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // 4) Compute display time from client's UTC -> server zone.
  // Reading tick keeps these values moving once per second.
  const nowMs = Date.now() + tick * 0;
  const displayTime = serverZone
    ? DateTime.fromMillis(nowMs)
        .toUTC()
        .setZone(serverZone)
        .toFormat("hh:mm:ss a")
    : "Loading...";
  const lastUpdatedText = formatElapsed(nowMs - lastUpdatedAt);

  return (
    <footer
      className={`bg-blue-900 text-white px-4 py-2 flex justify-between items-center text-sm min-h-[40px] gap-4 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        Local Time
        {/*too long for footer*/}
        {/* {serverZone ? ` (${serverZone})` : ""}:{" "} */}
        {": "}
        <span className="font-mono">{displayTime}</span>
        <span className="text-blue-100 text-xs">Updated {lastUpdatedText}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs">
          Build:
          <a
            href={`https://github.com/WistronLabs/wistronlabs/tree/${buildNumber}`}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-blue-200"
          >
            {buildNumber}
          </a>
        </span>
        <span>&copy; {new Date().getFullYear()} Wistron</span>
      </div>
    </footer>
  );
}

export default Footer;
