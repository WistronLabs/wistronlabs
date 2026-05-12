import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { useLocation } from "react-router-dom";
import useApi from "../hooks/useApi";

const AUTO_REFRESH_MS = 5 * 60_000;
const USER_IDLE_MS = 60_000;
const REFRESH_RETRY_MS = 15_000;
const LAST_SITE_UPDATE_KEY_PREFIX = "wistronlabs:lastSiteUpdate:";
const DATA_FETCH_EVENT_NAME = "wistronlabs:data-fetch-success";
const AUTO_REFRESH_DEBUG_LOGGING = false; // set to true to enable detailed logging of the auto-refresh system in the console. Logs are grouped under [auto-refresh] for easy filtering.
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "scroll",
  "touchstart",
];

function isEditableElement(element) {
  if (!element || !(element instanceof HTMLElement)) return false;

  const tagName = element.tagName;
  return (
    element.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

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

function logAutoRefresh(enabled, event, details = {}) {
  if (!enabled) return;
  console.debug(`[auto-refresh] ${event}`, details);
}

function buildLastUpdateStorageKey(pathname) {
  return `${LAST_SITE_UPDATE_KEY_PREFIX}${pathname || "/"}`;
}

function Footer({ className = "" }) {
  const { getServerTime } = useApi();
  const location = useLocation();
  const [serverZone, setServerZone] = useState(null);
  const [tick, setTick] = useState(0); // increments every second
  const [refreshPending, setRefreshPending] = useState(false);
  const lastActivityAtRef = useRef(Date.now());
  const refreshPendingRef = useRef(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => {
    if (typeof window === "undefined") return null;
    const stored = Number(
      sessionStorage.getItem(
        buildLastUpdateStorageKey(window.location.pathname),
      ),
    );
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  const buildNumber =
    import.meta.env.VITE_BUILD_NUMBER ||
    import.meta.env.BUILD_NUMBER ||
    "unknown";

  useEffect(() => {
    const storageKey = buildLastUpdateStorageKey(location.pathname);
    const stored = Number(sessionStorage.getItem(storageKey));
    setLastUpdatedAt(Number.isFinite(stored) && stored > 0 ? stored : null);
  }, [location.pathname]);

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

  useEffect(() => {
    const handleDataFetchSuccess = (event) => {
      const detail = event?.detail || {};
      const eventPathname = String(detail.pathname || "");
      if (eventPathname !== location.pathname) return;

      const timestamp = Number(detail.timestamp) || Date.now();
      sessionStorage.setItem(
        buildLastUpdateStorageKey(location.pathname),
        String(timestamp),
      );
      setLastUpdatedAt(timestamp);
      logAutoRefresh(AUTO_REFRESH_DEBUG_LOGGING, "page-data-updated", {
        pathname: location.pathname,
        endpoint: detail.endpoint || null,
        method: detail.method || "GET",
        timestamp: new Date(timestamp).toISOString(),
      });
    };

    window.addEventListener(DATA_FETCH_EVENT_NAME, handleDataFetchSuccess);
    return () => {
      window.removeEventListener(DATA_FETCH_EVENT_NAME, handleDataFetchSuccess);
    };
  }, [location.pathname]);

  // 3) Track activity so refreshes only happen after a quiet period.
  useEffect(() => {
    const markActivity = () => {
      const now = Date.now();
      lastActivityAtRef.current = now;
      logAutoRefresh(AUTO_REFRESH_DEBUG_LOGGING, "activity-detected", {
        timestamp: new Date(now).toISOString(),
        activeElement: document.activeElement?.tagName || null,
        hidden: document.hidden,
      });
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener("focus", markActivity);
    document.addEventListener("visibilitychange", markActivity);

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      window.removeEventListener("focus", markActivity);
      document.removeEventListener("visibilitychange", markActivity);
    };
  }, []);

  // 4) Refresh the app on a timer, but only once the user has been idle.
  useEffect(() => {
    const setPendingRefresh = (value) => {
      refreshPendingRef.current = value;
      setRefreshPending(value);
      logAutoRefresh(
        AUTO_REFRESH_DEBUG_LOGGING,
        value ? "refresh-queued" : "refresh-queue-cleared",
        {
          timestamp: new Date().toISOString(),
        },
      );
    };

    const refreshIfIdle = (source = "interval") => {
      const now = Date.now();
      const isIdle = now - lastActivityAtRef.current >= USER_IDLE_MS;
      const isEditing = isEditableElement(document.activeElement);
      const idleForMs = now - lastActivityAtRef.current;

      logAutoRefresh(AUTO_REFRESH_DEBUG_LOGGING, "refresh-check", {
        source,
        timestamp: new Date(now).toISOString(),
        idle_for_ms: idleForMs,
        is_idle: isIdle,
        is_editing: isEditing,
        hidden: document.hidden,
        activeElement: document.activeElement?.tagName || null,
        pending: refreshPendingRef.current,
      });

      if (!isIdle || isEditing || document.hidden) {
        logAutoRefresh(AUTO_REFRESH_DEBUG_LOGGING, "refresh-deferred", {
          source,
          reasons: {
            user_not_idle: !isIdle,
            editing: isEditing,
            tab_hidden: document.hidden,
          },
        });
        setPendingRefresh(true);
        return;
      }

      setPendingRefresh(false);
      logAutoRefresh(AUTO_REFRESH_DEBUG_LOGGING, "refresh-reloading", {
        source,
        timestamp: new Date(now).toISOString(),
      });
      window.location.reload();
    };

    logAutoRefresh(AUTO_REFRESH_DEBUG_LOGGING, "refresh-system-started", {
      auto_refresh_ms: AUTO_REFRESH_MS,
      user_idle_ms: USER_IDLE_MS,
      retry_ms: REFRESH_RETRY_MS,
    });

    const autoRefreshId = setInterval(
      () => refreshIfIdle("auto-interval"),
      AUTO_REFRESH_MS,
    );
    const retryId = setInterval(() => {
      if (refreshPendingRef.current) {
        refreshIfIdle("retry-interval");
      }
    }, REFRESH_RETRY_MS);

    return () => {
      clearInterval(autoRefreshId);
      clearInterval(retryId);
      logAutoRefresh(AUTO_REFRESH_DEBUG_LOGGING, "refresh-system-stopped", {
        timestamp: new Date().toISOString(),
      });
    };
  }, []);

  // 5) Compute display time from client's UTC -> server zone.
  // Reading tick keeps these values moving once per second.
  const nowMs = Date.now() + tick * 0;
  const displayTime = serverZone
    ? DateTime.fromMillis(nowMs)
        .toUTC()
        .setZone(serverZone)
        .toFormat("hh:mm:ss a")
    : "Loading...";
  const lastUpdatedText =
    Number.isFinite(lastUpdatedAt) && lastUpdatedAt > 0
      ? formatElapsed(nowMs - lastUpdatedAt)
      : "waiting for data";

  return (
    <footer
      className={`bg-blue-900 text-white px-4 py-2 flex flex-col items-start justify-between gap-3 text-sm sm:flex-row sm:items-center ${className}`}
    >
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <span className="text-blue-100 text-xs font-semibold uppercase tracking-[0.14em]">
          Local Time
        </span>
        <span className="rounded-full bg-white/12 px-3 py-1 font-mono text-sm leading-none">
          {displayTime}
        </span>
        <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs leading-none text-blue-100">
          Updated {lastUpdatedText}
        </span>
        {refreshPending ? (
          <span className="inline-flex w-fit rounded-full border border-yellow-200/25 bg-yellow-300/12 px-3 py-1 text-xs leading-none text-yellow-100">
            Refresh queued until user is idle
          </span>
        ) : null}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 text-xs sm:w-auto sm:justify-end">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 leading-none text-blue-100">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200">
            Build
          </span>
          <a
            href={`https://github.com/WistronLabs/wistronlabs/tree/${buildNumber}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-white underline decoration-white/35 underline-offset-2 hover:text-blue-200"
          >
            {buildNumber}
          </a>
        </span>
        <span className="inline-flex items-center rounded-full border border-white/15 bg-white/8 px-3 py-1 leading-none text-blue-100">
          &copy; {new Date().getFullYear()} Wistron
        </span>
      </div>
    </footer>
  );
}

export default Footer;
