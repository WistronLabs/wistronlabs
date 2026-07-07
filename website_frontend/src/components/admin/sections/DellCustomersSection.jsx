import AdminActionBar from "../AdminActionBar";
import AdminTableCard from "../AdminTableCard";
import AdminToolbar from "../AdminToolbar";

function DellCustomersSection({
  onSave,
  addBlankRow,
  query,
  setQuery,
  error,
  loading,
  rows,
  baselineMap,
  onCellChange,
  onDelete,
  deletingId,
  saving,
  onDiscard,
  hasChanges,
}) {
  return (
    <form onSubmit={onSave} className="space-y-4">
      <AdminToolbar
        addLabel="+ Add Dell Customer"
        onAdd={addBlankRow}
        query={query}
        onQueryChange={setQuery}
        placeholder="Search Dell customer"
        error={error}
      />

      <AdminTableCard>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Dell Customer</th>
              <th className="text-right font-medium px-3 py-2 w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-gray-500">
                  No matching Dell customers
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isNew = typeof row.id !== "number";
                const base = isNew ? null : baselineMap.get(row.id);
                const changed = isNew || (base && base.name !== row.name);
                return (
                  <tr key={row.id} className={changed ? "bg-amber-100/50" : ""}>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={row.name ?? ""}
                        onChange={(e) => onCellChange(row.id, e.target.value)}
                        className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-400" : "border-gray-300"
                        }`}
                        placeholder="e.g. NVIDIA"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => onDelete(row)}
                          disabled={deletingId === row.id || saving}
                          className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === row.id ? "Deleting..." : "Delete"}
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
        onDiscard={onDiscard}
        saving={saving}
        hasChanges={hasChanges}
        saveLabel="Save Dell Customers"
      />
    </form>
  );
}

export default DellCustomersSection;
