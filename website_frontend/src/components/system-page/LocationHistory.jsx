import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactPaginate from "react-paginate";
import { formatDateHumanReadable } from "../../utils/date_format";
import { locationColor } from "../../utils/locationHistoryStyles";

const PAGE_SIZE = 10;

function SkippedEntries({ count }) {
  if (!count) return null;
  return (
    <li className="relative pl-7 py-1 text-xs text-blue-700">
      <span aria-hidden="true" className="absolute left-0 top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-blue-200 bg-white font-bold text-blue-500">···</span>
      <span className="inline-block rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 font-medium">
        {count} {count === 1 ? "entry" : "entries"} skipped
      </span>
    </li>
  );
}

function HistoryEntry({ entry, serverTimeZone, isLatest, onRemoveLatest }) {
  const [expanded, setExpanded] = useState(false);
  const [isClipped, setIsClipped] = useState(false);
  const noteRef = useRef(null);
  const note = entry.note?.trim() || "";
  const moved = entry.from_location && entry.from_location !== entry.to_location;

  useLayoutEffect(() => {
    const element = noteRef.current;
    if (!element || expanded) return;
    const measure = () => setIsClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [note, expanded]);

  return (
    <li className="relative pl-7">
      <span aria-hidden="true" className="absolute left-0 top-5 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-blue-600 ring-2 ring-blue-200" />
      <article className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {moved ? "Location changed" : entry.from_location ? "Location note" : "Initial location"}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {moved && <>
                <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 font-semibold break-words ${locationColor(entry.from_location)}`}>{entry.from_location}</span>
                <span aria-hidden="true" className="text-gray-400">→</span>
              </>}
              <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 font-semibold break-words ${locationColor(entry.to_location)}`}>
                {entry.to_location || "Unknown location"}
              </span>
            </div>
          </div>
          <time dateTime={entry.changed_at} className="shrink-0 text-sm text-gray-500">
            {formatDateHumanReadable(entry.changed_at, serverTimeZone)}
          </time>
        </div>

        <div className="mt-3 min-w-0 border-l-2 border-gray-200 pl-3">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Note</p>
          <p ref={noteRef} className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 [overflow-wrap:anywhere] ${expanded ? "" : "line-clamp-3"}`}>
            {note || <span className="italic text-gray-500">No note provided</span>}
          </p>
          {(isClipped || expanded) && (
            <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-2 text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              {expanded ? "Show less" : "Show full note"}
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2 text-sm">
          <p className="min-w-0 break-words text-gray-500 [overflow-wrap:anywhere]">
            Moved by <span className="font-medium text-gray-700">{entry.moved_by === "deleted_user@example.com" ? "Unknown" : entry.moved_by || "Unknown"}</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link to={`/locationHistory/${entry.id}`} className="font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              View entry
            </Link>
            {isLatest && onRemoveLatest && (
              <button type="button" onClick={onRemoveLatest} className="font-medium text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                Delete latest entry
              </button>
            )}
          </div>
        </div>
      </article>
    </li>
  );
}

export default function LocationHistory({ history, serverTimeZone, onRemoveLatest }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const entries = useMemo(() => [...history].sort((a, b) =>
    new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime() || Number(b.id) - Number(a.id)
  ), [history]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => !term || [
      entry.from_location, entry.to_location, entry.note, entry.moved_by,
      formatDateHumanReadable(entry.changed_at, serverTimeZone),
    ].some((value) => String(value || "").toLowerCase().includes(term)));
  }, [entries, query, serverTimeZone]);

  useEffect(() => setPage(0), [query, history.length]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(pageCount - 1, 0));
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const searching = Boolean(query.trim());
  const firstVisibleIndex = safePage * PAGE_SIZE;
  const skippedBefore = searching && visible.length
    ? visible[0].index - (firstVisibleIndex ? filtered[firstVisibleIndex - 1].index : -1) - 1
    : 0;
  const skippedAfter = searching && visible.length && safePage === pageCount - 1
    ? entries.length - visible[visible.length - 1].index - 1
    : 0;

  return (
    <section aria-label="Location history" className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {searching ? `${filtered.length} of ${history.length}` : history.length} {history.length === 1 && !searching ? "entry" : "entries"}
          </p>
          <p className="text-xs text-gray-500">Most recent first</p>
        </div>
        <input
          type="search"
          aria-label="Search location history"
          placeholder="Search locations, notes, or people"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-80"
        />
      </div>

      {visible.length ? (
        <ol className="ml-2 space-y-3 border-l-2 border-blue-100">
          <SkippedEntries count={skippedBefore} />
          {visible.map(({ entry, index }, position) => (
            <Fragment key={entry.id}>
              {position > 0 && <SkippedEntries count={index - visible[position - 1].index - 1} />}
              <HistoryEntry
                entry={entry}
                serverTimeZone={serverTimeZone}
                isLatest={entry.id === entries[0]?.id}
                onRemoveLatest={onRemoveLatest}
              />
            </Fragment>
          ))}
          <SkippedEntries count={skippedAfter} />
        </ol>
      ) : <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
        {history.length ? "No history entries match your search." : "No location history yet."}
      </p>}

      {pageCount > 1 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
          <p className="text-xs text-gray-500">
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} entries
          </p>
          <ReactPaginate
            breakLabel="…"
            previousLabel="‹"
            nextLabel="›"
            pageCount={pageCount}
            pageRangeDisplayed={2}
            marginPagesDisplayed={1}
            forcePage={safePage}
            onPageChange={({ selected }) => setPage(selected)}
            containerClassName="flex flex-wrap items-center gap-1 text-sm"
            pageLinkClassName="block min-w-8 rounded-md border border-gray-300 bg-white px-2 py-1 text-center text-gray-700 hover:bg-blue-50"
            activeLinkClassName="!border-blue-600 !bg-blue-600 !text-white"
            previousLinkClassName="block rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-blue-50"
            nextLinkClassName="block rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-blue-50"
            breakLinkClassName="px-1 text-gray-400"
            disabledClassName="opacity-40 pointer-events-none"
          />
        </div>
      )}
    </section>
  );
}
