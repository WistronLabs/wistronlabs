import { useEffect, useMemo, useState } from "react";
import Select, { components as SelectComponents } from "react-select";

const ADD_TAG_VALUE = "__ADD_TAG__";

function AddTagModal({
  onClose,
  serviceTag,
  existingSystemTags,
  getTags,
  addSystemTag,
  onAdded,
  showToast,
  selectStyles,
}) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  const sysTagCodes = useMemo(() => {
    const s = new Set();
    (existingSystemTags || []).forEach((t) =>
      s.add(
        String(t.code || "")
          .trim()
          .toLowerCase(),
      ),
    );
    return s;
  }, [existingSystemTags]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let alive = true;

    const handle = setTimeout(() => {
      (async () => {
        try {
          setLoading(true);
          const term = q.trim();
          const rows = await getTags({ q: term || undefined });
          if (!alive) return;

          const arr = Array.isArray(rows) ? rows : [];
          const mapped = arr
            .map((t) => {
              const code = String(t.code || "").trim();
              return { t, code, key: code.toLowerCase() };
            })
            .filter(({ key }) => !sysTagCodes.has(key))
            .map(({ t, code }) => ({
              value: String(t.tag_id),
              label: code.toUpperCase(),
              code,
              data: t,
            }));

          setOptions(mapped);
        } catch (e) {
          console.error("Tag search failed", e);
          if (!alive) return;
          setOptions([]);
        } finally {
          if (alive) setLoading(false);
        }
      })();
    }, 200);

    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [q, getTags, sysTagCodes]);

  const term = q.trim();
  const canAddNew = term.length > 0;

  const selectOptions =
    options.length > 0
      ? options
      : canAddNew
        ? [
            {
              value: ADD_TAG_VALUE,
              label: `Add Tag "${term}"`,
              data: { code: term },
            },
          ]
        : [];

  const handleSelect = async (opt) => {
    if (!opt) return;
    onClose?.();

    const fail = (e, fallback) => {
      const msg = e?.body?.error || e?.message || fallback;
      showToast?.(msg, "error", 3000, "bottom-right");
    };

    if (opt.value === ADD_TAG_VALUE) {
      const name = String(opt?.data?.code || "").trim();
      if (!name) return;

      try {
        await addSystemTag(serviceTag, name);
        showToast?.(`Created & added "${name}"`, "success", 2500, "bottom-right");
        await onAdded?.();
      } catch (e) {
        fail(e, "Failed to create tag");
      }
      return;
    }

    const code = String(opt?.code || "").trim();
    if (!code) return;

    try {
      await addSystemTag(serviceTag, code);
      showToast?.(`Added tag "${code}"`, "success", 2500, "bottom-right");
      await onAdded?.();
    } catch (e) {
      fail(e, "Failed to add tag");
    }
  };

  const TagOption = (props) => {
    const isAdd = props.data.value === ADD_TAG_VALUE;
    return (
      <SelectComponents.Option {...props}>
        <div className="flex items-center justify-between">
          <span className={`font-semibold ${isAdd ? "text-blue-600" : "text-gray-800"}`}>
            {props.label}
          </span>
          {props.isDisabled && (
            <span className="text-xs text-gray-500">Already added</span>
          )}
        </div>
      </SelectComponents.Option>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full sm:max-w-lg p-4 sm:p-8 mx-2 relative space-y-4 sm:space-y-6">
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Add Tag</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Search or create
          </label>

          <Select
            instanceId="add-tag"
            classNamePrefix="react-select"
            styles={selectStyles}
            isClearable
            isSearchable
            isLoading={loading}
            placeholder="Type to search tags..."
            inputValue={q}
            onInputChange={(val, meta) => {
              if (meta.action === "input-change") setQ(val);
            }}
            onChange={handleSelect}
            options={selectOptions}
            components={{ Option: TagOption }}
            noOptionsMessage={() =>
              term ? 'No matches — choose "Add Tag"' : "Type to search..."
            }
            value={null}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddTagModal;
