import React, { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import Select from "react-select";
import ReactPaginate from "react-paginate";
import TagBar from "./TagBar.jsx";
import { useDebounce } from "../hooks/useDebounce.jsx";

export default function SearchContainerSS({
  title,
  displayOrder,
  defaultSortBy,
  defaultSortAsc,
  fieldStyles,
  visibleFields,
  linkType,
  truncate,
  onAction = null,
  actionButtonClass,
  actionButtonVisibleIf,
  fetchData,
  allowSearch = true,
  itemsPerPage = 10,
  page: externalPage,
  onPageChange,
  possibleSearchTags = [],
}) {
  const [internalPage, setInternalPage] = useState(1);
  const [sortBy, setSortBy] = useState(defaultSortBy || displayOrder[0]);
  const [sortAsc, setSortAsc] = useState(defaultSortAsc ?? true);
  const [searchTerm, setSearchTerm] = useState("");

  const [data, setData] = useState([]);
  const [displayedData, setDisplayedData] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(itemsPerPage);

  const [open, setOpen] = useState(false);
  const [searchTags, setSearchTags] = useState([]);
  const [availableTags, setAvailableTags] = useState(possibleSearchTags);
  const [tagGroups, setTagGroups] = useState([]);
  const [currentGroup, setCurrentGroup] = useState(0);

  const searchRef = useRef(null);
  const tagGroupsScrollRef = useRef(null);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const page = externalPage ?? internalPage;
  const pageSizes = [10, 20, 50];

  const handlePageChange = (newPage) => {
    if (onPageChange) onPageChange(newPage);
    else setInternalPage(newPage);
  };

  useEffect(() => {
    setLoading(true);

    const hasNonTagGroupFilters = tagGroups.some(
      (tg) =>
        tg.searchTags.length > 0 &&
        tg.searchTags.some((st) => st.field !== "tags"),
    );
    const normalizedSearch = String(debouncedSearchTerm || "").trim();
    const includeSearchInFilters = normalizedSearch.length > 0;

    const searchOrConditions = includeSearchInFilters
      ? [
          { field: "location", values: [normalizedSearch], op: "ILIKE" },
          { field: "service_tag", values: [normalizedSearch], op: "ILIKE" },
          { field: "issue", values: [normalizedSearch], op: "ILIKE" },
        ]
      : [];

    fetchData({
      page,
      page_size: pageSize,
      sort_by: sortBy,
      sort_order: sortAsc ? "asc" : "desc",
      search: debouncedSearchTerm || undefined,
      filters: hasNonTagGroupFilters
        ? {
            op: "AND",
            conditions: [
              {
                op: "OR",
                conditions: tagGroups
                  .filter((tg) => tg.searchTags.length > 0 && tg.searchTags.some((st) => st.field !== "tags"))
                  .map((tg) => ({
                    op: "AND",
                    conditions: tg.searchTags.filter((t) => t.field !== "tags").map((t) => (
                      {
                        field: t.field,
                        values: [t.value],
                        op: "=",
                      }
                    )),
                  })),
              },
              ...(includeSearchInFilters
                ? [{ op: "OR", conditions: searchOrConditions }]
                : []),
            ],
          }
        : null,
      tags: tagGroups.some((tg) => tg.searchTags.length > 0)
        ? tagGroups.map((tg) => tg.searchTags.filter((st) => st.field === "tags").map((st) => st.value))
          .reduce((acc, e) => [...acc, ...e], [])
        : null,
    })
      .then((res) => {
        setData(res.data);
        setTotalCount(res.total_count);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [
    debouncedSearchTerm,
    page,
    sortBy,
    sortAsc,
    pageSize,
    fetchData,
    searchTags,
  ]);

  useEffect(() => {
    if (!loading) setDisplayedData(data);
  }, [loading, data]);

  const pageCount = Math.ceil(totalCount / pageSize);

  const filteredDisplayOrder = visibleFields
    ? displayOrder.filter((field) => visibleFields.includes(field))
    : displayOrder;

  const hasActionColumn =
    !!onAction &&
    (actionButtonVisibleIf === null ||
      displayedData.some(
        (item) =>
          item &&
          item[actionButtonVisibleIf.field] === actionButtonVisibleIf.equals,
      ));

  const matchTag = (word, tag) =>
    `${tag.field}: ${tag.value}`.toLowerCase().includes(word.toLowerCase());
  const prettyField = (field) => {
    const raw = String(field || "").trim().toLowerCase();
    const known = {
      dpn: "DPN",
      ppid: "PPID",
      host_mac: "Host MAC",
      bmc_mac: "BMC MAC",
      service_tag: "Service Tag",
    };
    if (known[raw]) return known[raw];
    return raw
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  };
  const prettyValue = (field, value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const f = String(field || "").trim().toLowerCase();
    if (
      (f === "location" || f === "from_location" || f === "to_location") &&
      raw.includes(" - ")
    ) {
      const [main, ...rest] = raw.split(" - ");
      const suffix = rest.join(" - ").trim();
      return suffix ? `${main} (${suffix})` : main;
    }

    return raw;
  };

  const getHeaderLabel = (data, field) => {
    const titleField = `${field}_title`;
    return data?.[0]?.[titleField] || field;
  };

  const syncCurrentGroupView = (groups, idx) => {
    if (!groups.length) {
      setCurrentGroup(0);
      setSearchTags([]);
      setAvailableTags(possibleSearchTags);
      return;
    }
    const safeIdx = Math.max(0, Math.min(idx, groups.length - 1));
    setCurrentGroup(safeIdx);
    setSearchTags(groups[safeIdx].searchTags);
    setAvailableTags(groups[safeIdx].availableTags);
  };

  useEffect(() => {
    const el = tagGroupsScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [tagGroups.length]);

  return (
    <div className="flex flex-col pt-2 space-y-2">
      <div className="flex justify-between items-center mb-6 gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {allowSearch && (
          <div className={"relative"}>
            {tagGroups.length > 0 && (
              <div className="mb-2 space-y-1">
                <div
                  ref={tagGroupsScrollRef}
                  className={`flex flex-col gap-1 overflow-y-auto pr-1 ${
                    tagGroups.length >= 2 ? "h-44 max-h-44" : "max-h-44"
                  }`}
                  style={{ scrollbarGutter: "stable" }}
                >
                  {tagGroups.map((tg, i) => (
                    <React.Fragment key={`group-${i}`}>
                      {i > 0 && (
                        <div className="flex justify-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                            OR
                          </span>
                        </div>
                      )}
                      <TagBar
                        possibleTags={tg.availableTags}
                        tags={tg.searchTags}
                        isActive={i === currentGroup && open}
                        handleChange={(st, at) => {
                          // Auto-remove groups that became empty
                          if (!st.length) {
                            const filtered = tagGroups.filter((_, j) => j !== i);
                            setTagGroups(filtered);
                            syncCurrentGroupView(filtered, i - 1);
                            return;
                          }
                          const next = [...tagGroups];
                          next[i] = { searchTags: st, availableTags: at };
                          setTagGroups(next);
                          syncCurrentGroupView(next, i);
                        }}
                        handleClick={() => {
                          setCurrentGroup(i);
                          setSearchTags(tagGroups[i].searchTags);
                          setAvailableTags(tagGroups[i].availableTags);
                          searchRef.current.focus();
                        }}
                        handleRemoval={() => {
                          const filteredTagGroups = tagGroups.filter(
                            (t, j) => j !== i,
                          );
                          setTagGroups(filteredTagGroups);
                          syncCurrentGroupView(filteredTagGroups, i - 1);
                        }}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
            <input
              type="text"
              placeholder="Search…"
              className="w-64 md:w-96 lg:w-[32rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={searchTerm}
              ref={searchRef}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                // setOpen(e.target.value.length > 0 && availableTags.length > 0);
                handlePageChange(1);
              }}
              onFocus={() => {
                setOpen(possibleSearchTags.length > 0);
              }}
              onBlur={() => {
                setOpen(false);
              }}
            />

            {open && (
              <div
                className="absolute z-20 mt-2 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto"
                style={{ scrollbarGutter: "stable" }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {availableTags.some((t) => matchTag(searchTerm, t)) &&
                  searchTerm.length > 0 &&
                  availableTags
                    .filter((t) => matchTag(searchTerm, t))
                    .map((t, i) => (
                      <div
                        key={`tag-${i}`}
                        onClick={() => {
                          const nextAvailableTags = availableTags.filter(
                            (at) => !matchTag(`${at.field}: ${at.value}`, t),
                          );
                          const nextSearchTags = [...searchTags, t];

                          setAvailableTags(
                            nextAvailableTags,
                          );
                          setSearchTags(nextSearchTags);

                          const nextGroups = [...tagGroups];
                          if (!nextGroups[currentGroup]) {
                            nextGroups[currentGroup] = {
                              searchTags: [],
                              availableTags: possibleSearchTags,
                            };
                          }
                          nextGroups[currentGroup] = {
                            searchTags: nextSearchTags,
                            availableTags: nextAvailableTags,
                          };
                          setTagGroups(nextGroups);
                          setSearchTerm("");
                          searchRef.current.blur();
                          setOpen(false);
                        }}
                        className="block px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        <div className="inline-flex items-center gap-2 max-w-full">
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-semibold uppercase tracking-wide shrink-0">
                            {prettyField(t.field)}
                          </span>
                          <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-800 truncate">
                            {prettyValue(t.field, t.value)}
                          </span>
                        </div>
                      </div>
                    ))}
                <div
                  className="mx-2 my-2 px-3 py-2 text-sm rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 cursor-pointer"
                  onClick={() => {
                    //Set the current focused group to the new group
                    setCurrentGroup(tagGroups.length);
                    const next = [
                      ...tagGroups,
                      {
                        searchTags: [],
                        availableTags: possibleSearchTags,
                      },
                    ];
                    setTagGroups(next);
                    setSearchTags([]);
                    setAvailableTags(possibleSearchTags);
                    setTimeout(() => {
                      const el = tagGroupsScrollRef.current;
                      if (el) el.scrollTop = el.scrollHeight;
                    }, 0);
                    // setOpen(false);
                  }}
                >
                  Create new Group of Tags
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className=" bg-gray-100 rounded border border-gray-300 shadow-sm p-4">
        <div className="relative min-h-[300px]">
          {loading && displayedData.length === 0 && (
            <div className="absolute inset-0 flex justify-center items-center bg-gray-50 bg-opacity-50 z-10">
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          )}

          {!loading && displayedData.length === 0 && (
            <div className="flex justify-center items-center h-full">
              <p className="text-sm text-gray-500">No Data Available</p>
            </div>
          )}

          {displayedData.length > 0 && (
            <>
              {/* Header */}
              <div className="flex items-center bg-white border border-gray-300 rounded px-4 py-2 mb-2">
                {filteredDisplayOrder.map((field, fieldIndex) => {
                  const isFirst = fieldIndex === 0;
                  const isLast = fieldIndex === filteredDisplayOrder.length - 1;
                  const alignment = isFirst
                    ? "text-left"
                    : isLast
                      ? "text-right"
                      : "text-left";

                  return (
                    <button
                      key={field}
                      className={`cursor-pointer text-gray-500 text-sm flex-1 ${alignment}`}
                      onClick={() => {
                        if (sortBy === field) setSortAsc(!sortAsc);
                        else {
                          setSortBy(field);
                          setSortAsc(true);
                        }
                        setPage(1);
                      }}
                    >
                      {getHeaderLabel(displayedData, field)}{" "}
                      {sortBy === field && (sortAsc ? "▲" : "▼")}
                    </button>
                  );
                })}
                {hasActionColumn && <span className="w-4" />}
              </div>

              {/* Rows */}
              {displayedData.map((item, rowIndex) => {
                const commonClasses =
                  "flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 my-1";

                const RowContent = filteredDisplayOrder.map(
                  (field, fieldIndex) => {
                    const isFirst = fieldIndex === 0;
                    const isLast =
                      fieldIndex === filteredDisplayOrder.length - 1;
                    const alignment = isFirst
                      ? "text-left"
                      : isLast
                        ? "text-right"
                        : "text-left";

                    const value = item[field];
                    let content = value ?? "";
                    let classes = "text-sm";

                    if (typeof fieldStyles?.[field] === "function") {
                      const styleResult = fieldStyles[field](value);
                      if (styleResult?.type === "pill") {
                        content = (
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              styleResult.color || "bg-gray-200 text-gray-700"
                            }`}
                          >
                            {value}
                          </span>
                        );
                        classes = "";
                      } else {
                        classes = styleResult || "text-sm";
                      }
                    } else if (fieldStyles?.[field]) {
                      classes = fieldStyles[field];
                    }

                    const truncateClasses = truncate
                      ? "truncate overflow-hidden text-ellipsis whitespace-nowrap"
                      : "";

                    return (
                      <span
                        key={field}
                        className={`flex-1 ${alignment} ${classes} ${truncateClasses}`}
                      >
                        {content}
                      </span>
                    );
                  },
                );

                const isButtonVisible =
                  onAction &&
                  (!actionButtonVisibleIf ||
                    item[actionButtonVisibleIf.field] ===
                      actionButtonVisibleIf.equals);

                const ActionButton = hasActionColumn ? (
                  <button
                    type="button"
                    className={`${actionButtonClass} ${
                      isButtonVisible ? "" : "invisible"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isButtonVisible) onAction?.(item);
                    }}
                  >
                    ×
                  </button>
                ) : null;

                const Wrapper = ({ children }) => {
                  if (linkType === "internal") {
                    return (
                      <Link
                        to={`/${item.link || ""}`}
                        className={commonClasses + " hover:bg-blue-50"}
                      >
                        {children}
                      </Link>
                    );
                  }
                  if (linkType === "external") {
                    return (
                      <a
                        href={item.href || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={commonClasses + " hover:bg-blue-50"}
                      >
                        {children}
                      </a>
                    );
                  }
                  return <div className={commonClasses}>{children}</div>;
                };

                const rowKey =
                  item.id ??
                  item.service_tag ??
                  item.pallet_number ??
                  item.link ??
                  item.href ??
                  `row-${rowIndex}`;

                return (
                  <Wrapper key={rowKey}>
                    {RowContent}
                    {ActionButton}
                  </Wrapper>
                );
              })}

              {/* Fill empty rows */}
              {Array.from({ length: pageSize - displayedData.length }).map(
                (_, idx) => (
                  <div
                    key={`empty-${idx}`}
                    className="flex items-center gap-x-4 bg-transparent px-4 py-2 my-1"
                    style={{ minHeight: "42px" }} // same height as a row
                  />
                ),
              )}

              {/* Pagination */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="mx-auto sm:mx-0">
                  <ReactPaginate
                    breakLabel="…"
                    nextLabel="›"
                    previousLabel="‹"
                    pageRangeDisplayed={1}
                    marginPagesDisplayed={1}
                    pageCount={pageCount}
                    onPageChange={({ selected }) =>
                      handlePageChange(selected + 1)
                    }
                    forcePage={page - 1}
                    containerClassName="flex flex-wrap justify-center items-center gap-1 mt-4 text-xs sm:text-sm"
                    pageLinkClassName="cursor-pointer select-none px-2 sm:px-3 py-1 rounded-md border border-gray-300"
                    activeLinkClassName="cursor-pointer select-none bg-blue-600 text-white border-blue-600"
                    previousLinkClassName="cursor-pointer select-none px-2 sm:px-3 py-1 rounded-md border border-gray-300"
                    nextLinkClassName="cursor-pointer select-none px-2 sm:px-3 py-1 rounded-md border border-gray-300"
                    breakLinkClassName="select-none px-2 sm:px-3 py-1 text-gray-400"
                  />
                </div>
                <div className="flex items-center gap-2 ml-3 mt-4 sm:mt-0">
                  <span className="text-xs sm:text-sm text-gray-600 whitespace-nowrap">
                    Rows:
                  </span>

                  <Select
                    className="react-select-container"
                    classNamePrefix="rs"
                    isSearchable={false}
                    menuPlacement="auto"
                    value={{ value: pageSize, label: String(pageSize) }}
                    onChange={(option) => {
                      setPageSize(option ? option.value : itemsPerPage);
                      handlePageChange(1);
                    }}
                    options={pageSizes.map((s) => ({
                      value: s,
                      label: String(s),
                    }))}
                    styles={{
                      container: (base) => ({
                        ...base,
                        width: 84, // compact width
                        minWidth: 84,
                      }),
                      control: (base, state) => ({
                        ...base,
                        minHeight: 30,
                        height: 30,
                        borderRadius: 8,
                        borderColor: state.isFocused
                          ? "#93c5fd"
                          : base.borderColor,
                        boxShadow: state.isFocused
                          ? "0 0 0 2px rgba(59,130,246,0.15)"
                          : "none",
                      }),
                      valueContainer: (base) => ({
                        ...base,
                        height: 30,
                        padding: "0 8px",
                      }),
                      singleValue: (base) => ({
                        ...base,
                        fontSize: 13,
                      }),
                      input: (base) => ({
                        ...base,
                        margin: 0,
                        padding: 0,
                      }),
                      indicatorsContainer: (base) => ({
                        ...base,
                        height: 30,
                      }),
                      dropdownIndicator: (base) => ({
                        ...base,
                        padding: 6,
                      }),
                      clearIndicator: (base) => ({
                        ...base,
                        padding: 6,
                      }),
                      menu: (base) => ({
                        ...base,
                        zIndex: 50,
                      }),
                      option: (base, state) => ({
                        ...base,
                        fontSize: 13,
                        paddingTop: 6,
                        paddingBottom: 6,
                        backgroundColor: state.isSelected
                          ? "rgba(59,130,246,0.10)"
                          : state.isFocused
                            ? "rgba(0,0,0,0.04)"
                            : "white",
                        color: "black",
                      }),
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
