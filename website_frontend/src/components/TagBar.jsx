import React, { useEffect, useRef } from "react";

export default function TagBar({ 
  possibleTags, 
  tags, 
  handleChange, 
  handleClick,
  handleRemoval,
  isActive = false,
}) {
  const searchTags = tags;
  const availableTags = possibleTags;
  const tagsScrollerRef = useRef(null);

  const matchTag = (word, tag) => `${tag.field}: ${tag.value}`.toLowerCase().includes(word.toLowerCase());
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

  useEffect(() => {
    const el = tagsScrollerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [searchTags.length]);

  return (
    <div
      className={
        "rounded px-2 py-2 text-sm w-64 md:w-96 lg:w-[32rem] bg-white " +
        (isActive
          ? "border-2 border-blue-500 shadow-sm ring-1 ring-blue-200"
          : "border-2 border-gray-300")
      }
      onClick={handleClick}
    >
      {searchTags.length < 1 && (
        <div className="my-1 px-2 h-5 flex items-center justify-between text-gray-500">
          <span>Empty Group</span>
          <span
            className="relative w-5 h-5 rounded-full flex items-center justify-center hover:bg-black/10 hover:cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoval();
            }}
          >
            <span
              className="relative w-2.5 h-2.5 flex items-center justify-center before:content-['']
                before:absolute before:w-0.5 before:h-2.5 before:bg-[#888] before:rounded-full
                before:rotate-45 after:content-[''] after:absolute after:w-0.5 after:h-2.5 after:bg-[#888]
                after:rounded-full after:-rotate-45"
            ></span>
          </span>
        </div>
      )}

      <div
        ref={tagsScrollerRef}
        className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-2"
        style={{ scrollbarGutter: "stable" }}
      >
        {searchTags.map((t, i) => (
          <React.Fragment key={`tag-${i}`}>
            {i > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                AND
              </span>
            )}
            <span
              className="inline-flex items-center my-1 px-2 py-1 rounded-full text-xs font-medium mx-1 caret-transparent bg-slate-100 border border-slate-200 text-slate-800 shrink-0"
            >
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-semibold uppercase tracking-wide mr-1.5">
                {prettyField(t.field)}
              </span>
              <span className="font-medium text-slate-800">
                {prettyValue(t.field, t.value)}
              </span>
              <span
                className="relative w-5 h-5 rounded-full flex items-center justify-center hover:bg-black/10 hover:cursor-pointer"
                onClick={() => {
                  handleChange(
                    searchTags.filter(
                      (st) => !matchTag(`${t.field}: ${t.value}`, st),
                    ),
                    [...availableTags, t],
                  );
                }}
              >
                <span
                  className="relative w-2.5 h-2.5 flex items-center justify-center before:content-['']
                    before:absolute before:w-0.5 before:h-2.5 before:bg-[#888] before:rounded-full
                    before:rotate-45 after:content-[''] after:absolute after:w-0.5 after:h-2.5 after:bg-[#888]
                    after:rounded-full after:-rotate-45"
                ></span>
              </span>
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
