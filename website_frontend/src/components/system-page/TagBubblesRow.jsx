import { useState } from "react";

function TagBubblesRow({
  tags,
  token,
  focusedTagId,
  setFocusedTagId,
  showTopUntruncated,
  setShowTopUntruncated,
  onOpenAll,
  onOpenAdd,
  onDeleteTag,
}) {
  const canEdit = !!token;
  const list = Array.isArray(tags) ? tags : [];
  const total = list.length;

  const [deleteHoverId, setDeleteHoverId] = useState(null);
  const [expandHoverId, setExpandHoverId] = useState(null);

  const truncate10 = (s) => {
    const v = String(s || "");
    return v.length > 10 ? v.slice(0, 10) + "..." : v;
  };

  const isTruncated = (s) => String(s || "").length > 10;
  const dangerClass = "bg-red-100 text-red-800 hover:bg-red-200";
  const normalClass = "bg-gray-100 text-gray-800 hover:bg-gray-200";

  const tagKey = (t) =>
    String(t?.code || "")
      .trim()
      .toLowerCase();

  const StableExpandText = ({ showExpand, children }) => (
    <span className="relative inline-block">
      <span className={showExpand ? "invisible" : "visible"}>{children}</span>
      <span
        className={`absolute inset-0 flex items-center justify-center transition-opacity ${
          showExpand ? "opacity-100" : "opacity-0"
        }`}
      >
        EXPAND
      </span>
    </span>
  );

  const StableDeleteText = ({ showDelete, children }) => (
    <span className="relative inline-block">
      <span className={showDelete ? "invisible" : "visible"}>{children}</span>
      <span
        className={`absolute inset-0 flex items-center justify-center transition-opacity ${
          showDelete ? "opacity-100" : "opacity-0"
        }`}
      >
        DELETE
      </span>
    </span>
  );

  if (focusedTagId) {
    const t = list.find((x) => tagKey(x) === String(focusedTagId));
    if (!t) {
      setFocusedTagId(null);
      return null;
    }

    const id = tagKey(t);
    const hoveringDelete = String(deleteHoverId) === id;

    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onMouseEnter={() => canEdit && setDeleteHoverId(id)}
          onMouseLeave={() => canEdit && setDeleteHoverId(null)}
          onClick={() => {
            if (!canEdit) return;
            setDeleteHoverId(null);
            onDeleteTag?.(t);
          }}
          className={`inline-block px-2 py-1 text-xs sm:text-sm font-bold rounded-full uppercase ${
            canEdit && hoveringDelete ? dangerClass : normalClass
          }`}
          title={t.code}
        >
          {canEdit ? (
            <StableDeleteText showDelete={hoveringDelete}>
              {t.code}
            </StableDeleteText>
          ) : (
            t.code
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setFocusedTagId(null);
            setShowTopUntruncated(false);
            setDeleteHoverId(null);
          }}
          className="inline-block px-2 py-1 bg-gray-200 text-gray-800 text-xs sm:text-sm font-bold rounded-full uppercase hover:bg-gray-300"
          title="Show tags"
        >
          ...
        </button>
        {token && (
          <button
            type="button"
            onClick={onOpenAdd}
            className="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs sm:text-sm font-bold rounded-full uppercase hover:bg-green-200"
          >
            + Add Tag
          </button>
        )}
      </div>
    );
  }

  const top = list.slice(0, 3);
  const showAllBubble = total > 3;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {top.map((t) => {
        const id = tagKey(t);
        const raw = t.code;
        const label = showTopUntruncated ? raw : truncate10(raw);
        const truncated = isTruncated(raw);

        if (truncated && !showTopUntruncated) {
          const hoveringExpand = String(expandHoverId) === id;

          return (
            <button
              key={id}
              type="button"
              onMouseEnter={() => setExpandHoverId(id)}
              onMouseLeave={() => setExpandHoverId(null)}
              onClick={() => {
                setFocusedTagId(id);
                setShowTopUntruncated(false);
                setDeleteHoverId(null);
                setExpandHoverId(null);
              }}
              className={`inline-block px-2 py-1 text-xs sm:text-sm font-bold rounded-full uppercase transition-colors ${
                hoveringExpand
                  ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                  : "bg-gray-100 text-gray-800"
              }`}
              title={raw}
            >
              <StableExpandText showExpand={hoveringExpand}>
                {label}
              </StableExpandText>
            </button>
          );
        }

        const hoveringDelete = canEdit && String(deleteHoverId) === id;

        return (
          <button
            key={id}
            type="button"
            onMouseEnter={() => canEdit && setDeleteHoverId(id)}
            onMouseLeave={() => canEdit && setDeleteHoverId(null)}
            onClick={() => {
              if (!canEdit) return;
              setDeleteHoverId(null);
              setExpandHoverId(null);
              onDeleteTag?.(t);
            }}
            className={`inline-block px-2 py-1 text-xs sm:text-sm font-bold rounded-full uppercase ${
              hoveringDelete ? dangerClass : "bg-gray-100 text-gray-800"
            }`}
            title={raw}
          >
            {canEdit ? (
              <StableDeleteText showDelete={hoveringDelete}>
                {label}
              </StableDeleteText>
            ) : (
              label
            )}
          </button>
        );
      })}

      {showAllBubble && (
        <button
          type="button"
          onClick={onOpenAll}
          className="inline-block px-2 py-1 bg-gray-200 text-gray-800 text-xs sm:text-sm font-bold rounded-full uppercase hover:bg-gray-300"
          title="Show all tags"
        >
          ...
        </button>
      )}
      {token && (
        <button
          type="button"
          onClick={onOpenAdd}
          className="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs sm:text-sm font-bold rounded-full uppercase hover:bg-green-200"
        >
          + Add Tag
        </button>
      )}
    </div>
  );
}

export default TagBubblesRow;
