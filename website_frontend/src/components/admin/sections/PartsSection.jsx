import Select from "react-select";
import AdminActionBar from "../AdminActionBar";
import AdminTableCard from "../AdminTableCard";
import AdminToolbar from "../AdminToolbar";

function PartsSection({
  onPartSave,
  addBlankPartRow,
  partQ,
  setPartQ,
  partErr,
  partLoading,
  filteredParts,
  partBaselineMap,
  onPartCellNameChange,
  onPartCellDPNChange,
  setParts,
  partCategories,
  handleDeletePart,
  deletingPartId,
  partSaving,
  onPartDiscard,
  partHasChanges,
}) {
  return (
    <form onSubmit={onPartSave} className="space-y-4">
      <AdminToolbar
        addLabel="+ Add Part"
        onAdd={addBlankPartRow}
        query={partQ}
        onQueryChange={setPartQ}
        placeholder="Search part name"
        error={partErr}
      />

      <AdminTableCard>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Part</th>
              <th className="text-left font-medium px-3 py-2">DPN</th>
              <th className="text-left font-medium px-3 py-2">Category</th>
              <th className="text-right font-medium px-3 py-2 w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {partLoading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filteredParts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  No matching parts
                </td>
              </tr>
            ) : (
              filteredParts.map((p) => {
                const isNew = typeof p.id !== "number";
                const base = isNew ? null : partBaselineMap.get(p.id);
                const changed = isNew || (base && base.name !== p.name);

                return (
                  <tr key={p.id} className={changed ? "bg-amber-100/50" : ""}>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={p.name ?? ""}
                        onChange={(e) =>
                          onPartCellNameChange(p.id, e.target.value)
                        }
                        className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-400" : "border-gray-300"
                        }`}
                        placeholder="e.g. FAN MODULE"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={p.dpn ?? ""}
                        onChange={(e) => onPartCellDPNChange(p.id, e.target.value)}
                        className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-400" : "border-gray-300"
                        }`}
                        placeholder="e.g. A1B2C3"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Select
                        value={
                          p.part_category_id == null
                            ? { value: null, label: "None" }
                            : (() => {
                                const found = (partCategories || []).find(
                                  (c) => Number(c.id) === Number(p.part_category_id),
                                );
                                return found
                                  ? { value: found.id, label: found.name }
                                  : { value: p.part_category_id, label: String(p.part_category_id) };
                              })()
                        }
                        onChange={(option) =>
                          setParts((cur) =>
                            cur.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    part_category_id:
                                      option?.value == null
                                        ? null
                                        : Number(option.value),
                                  }
                                : x,
                            ),
                          )
                        }
                        options={[
                          { value: null, label: "None" },
                          ...(partCategories || []).map((c) => ({
                            value: c.id,
                            label: c.name,
                          })),
                        ]}
                        isSearchable
                        classNamePrefix="parts-category-select"
                        menuPortalTarget={
                          typeof document !== "undefined" ? document.body : undefined
                        }
                        menuPosition="fixed"
                        styles={{
                          control: (base, state) => ({
                            ...base,
                            minHeight: 34,
                            borderRadius: 6,
                            borderColor: state.isFocused ? "#3b82f6" : changed ? "#fcd34d" : "#d1d5db",
                            boxShadow: state.isFocused
                              ? "0 0 0 2px rgba(59,130,246,0.2)"
                              : base.boxShadow,
                            fontSize: 14,
                          }),
                          menuPortal: (base) => ({ ...base, zIndex: 10050 }),
                        }}
                      />
                    </td>

                    <td className="px-3 py-2 align-middle">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDeletePart(p)}
                          disabled={deletingPartId === p.id || partSaving}
                          className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          title="Delete Part"
                        >
                          {deletingPartId === p.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableCard>

      <AdminActionBar
        onDiscard={onPartDiscard}
        saving={partSaving}
        hasChanges={partHasChanges}
        saveLabel="Save Parts"
      />
    </form>
  );
}

export default PartsSection;
