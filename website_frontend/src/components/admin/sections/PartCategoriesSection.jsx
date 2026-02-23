import AdminActionBar from "../AdminActionBar";
import AdminTableCard from "../AdminTableCard";
import AdminToolbar from "../AdminToolbar";

function PartCategoriesSection({
  onPartCatSave,
  addBlankPartCatRow,
  partCatQ,
  setPartCatQ,
  partCatErr,
  partCatLoading,
  filteredPartCats,
  partCatBaselineMap,
  onPartCatCellChange,
  handleDeletePartCategory,
  deletingPartCatId,
  partCatSaving,
  onPartCatDiscard,
  partCatHasChanges,
}) {
  return (
    <form onSubmit={onPartCatSave} className="space-y-4">
      <AdminToolbar
        addLabel="+ Add row"
        onAdd={addBlankPartCatRow}
        query={partCatQ}
        onQueryChange={setPartCatQ}
        placeholder="Search category name"
        error={partCatErr}
      />

      <AdminTableCard>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Category Name</th>
              <th className="text-right font-medium px-3 py-2 w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {partCatLoading ? (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filteredPartCats.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-gray-500">
                  No matching categories
                </td>
              </tr>
            ) : (
              filteredPartCats.map((c) => {
                const isNew = typeof c.id !== "number";
                const base = isNew ? null : partCatBaselineMap.get(c.id);
                const changed = isNew || (base && base.name !== c.name);

                return (
                  <tr key={c.id} className={changed ? "bg-amber-50/40" : ""}>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={c.name ?? ""}
                        onChange={(e) => onPartCatCellChange(c.id, e.target.value)}
                        className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-300" : "border-gray-300"
                        }`}
                        placeholder="e.g. FANS"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDeletePartCategory(c)}
                          disabled={deletingPartCatId === c.id || partCatSaving}
                          className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          title="Delete Category"
                        >
                          {deletingPartCatId === c.id ? "Deleting…" : "Delete"}
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
        onDiscard={onPartCatDiscard}
        saving={partCatSaving}
        hasChanges={partCatHasChanges}
        saveLabel="Save Categories"
      />
    </form>
  );
}

export default PartCategoriesSection;
