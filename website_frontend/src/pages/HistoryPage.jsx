import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import useApi from "../hooks/useApi";
import { formatDateHumanReadable } from "../utils/date_format";
import { locationColor } from "../utils/locationHistoryStyles";

export default function HistoryPage() {
  const { id } = useParams();
  const { getHistoryById, getServerTime } = useApi();
  const [entry, setEntry] = useState(null);
  const [serverTimeZone, setServerTimeZone] = useState("UTC");
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setEntry(null);

    Promise.allSettled([getHistoryById(id), getServerTime()]).then(([entryResult, timeResult]) => {
      if (!active) return;
      if (timeResult.status === "fulfilled") setServerTimeZone(timeResult.value.zone || "UTC");
      if (entryResult.status === "fulfilled" && entryResult.value) {
        setEntry(entryResult.value);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    });

    return () => { active = false; };
    // The API helpers are recreated on render; the entry only needs reloading when its ID changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const moved = entry?.from_location && entry.from_location !== entry.to_location;
  const unitPath = entry?.service_tag ? `/${encodeURIComponent(entry.service_tag)}` : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      {unitPath && (
        <Link to={unitPath} className="mb-5 inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <span aria-hidden="true">←</span> Back to {entry.service_tag}
        </Link>
      )}

      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">System history</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">Location history entry</h1>
        {entry?.service_tag && <p className="mt-1 text-sm text-gray-500">{entry.service_tag}</p>}
      </header>

      {status === "loading" && (
        <div role="status" className="rounded-xl border border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500 shadow-sm">
          Loading history entry…
        </div>
      )}
      {status === "error" && (
        <div role="alert" className="rounded-xl border border-red-200 bg-white px-5 py-10 text-center text-sm text-red-700 shadow-sm">
          This history entry could not be loaded.
        </div>
      )}
      {status === "ready" && entry && (
        <article className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {moved ? "Location changed" : entry.from_location ? "Location note" : "Initial location"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {moved && <>
                  <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 font-semibold break-words ${locationColor(entry.from_location)}`}>
                    {entry.from_location}
                  </span>
                  <span aria-hidden="true" className="text-gray-400">→</span>
                </>}
                <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 font-semibold break-words ${locationColor(entry.to_location)}`}>
                  {entry.to_location || "Unknown location"}
                </span>
              </div>
            </div>
            <time dateTime={entry.changed_at} className="text-sm text-gray-500">
              {formatDateHumanReadable(entry.changed_at, serverTimeZone)}
            </time>
          </div>

          <section aria-label="Note" className="mt-6 min-w-0 border-l-2 border-gray-200 pl-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Note</h2>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 [overflow-wrap:anywhere]">
              {entry.note?.trim() || <span className="italic text-gray-500">No note provided</span>}
            </p>
          </section>

          <div className="mt-6 border-t border-gray-100 pt-4 text-sm text-gray-500">
            Moved by <span className="font-medium text-gray-700 [overflow-wrap:anywhere]">{entry.moved_by === "deleted_user@example.com" ? "Unknown" : entry.moved_by || "Unknown"}</span>
          </div>
        </article>
      )}
    </main>
  );
}
