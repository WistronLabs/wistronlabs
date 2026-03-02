import AdminActionBar from "../AdminActionBar";
import AdminTableCard from "../AdminTableCard";
import AdminToolbar from "../AdminToolbar";

function DpnsSection({
  onDpnSave,
  addBlankRow,
  dpnQ,
  setDpnQ,
  dpnErr,
  dpnLoading,
  filteredDpns,
  dpnBaselineMap,
  onCellChange,
  handleDeleteDpn,
  deletingId,
  dpnSaving,
  onDpnDiscard,
  dpnHasChanges,
}) {
  return (
    <form onSubmit={onDpnSave} className="space-y-4">
      <AdminToolbar
        addLabel="+ Add row"
        onAdd={addBlankRow}
        query={dpnQ}
        onQueryChange={setDpnQ}
        placeholder="Search DPN, config, customer"
        error={dpnErr}
      />

      <AdminTableCard>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">DPN</th>
              <th className="text-left font-medium px-3 py-2">Config</th>
              <th className="text-left font-medium px-3 py-2">Dell Customer</th>
              <th className="text-right font-medium px-3 py-2 w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dpnLoading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filteredDpns.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  No matching DPNs
                </td>
              </tr>
            ) : (
              filteredDpns.map((d) => {
                const isNew = typeof d.id !== "number";
                const base = isNew ? null : dpnBaselineMap.get(d.id);
                const changed =
                  isNew ||
                  (base &&
                    (base.name !== d.name ||
                      (base.config ?? "") !== (d.config ?? "") ||
                      (base.dell_customer ?? "") !== (d.dell_customer ?? "")));

                return (
                  <tr key={d.id} className={changed ? "bg-amber-50/40" : ""}>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={d.name ?? ""}
                        onChange={(e) => onCellChange(d.id, "name", e.target.value)}
                        className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-300" : "border-gray-300"
                        }`}
                        placeholder="e.g. 7RC0V"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={d.config ?? ""}
                        onChange={(e) => onCellChange(d.id, "config", e.target.value)}
                        className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-300" : "border-gray-300"
                        }`}
                        placeholder="e.g. B1"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={d.dell_customer ?? ""}
                        onChange={(e) =>
                          onCellChange(d.id, "dell_customer", e.target.value)
                        }
                        className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-300" : "border-gray-300"
                        }`}
                        placeholder="e.g. META / NVIDIA"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDeleteDpn(d)}
                          disabled={deletingId === d.id || dpnSaving}
                          className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          title="Delete DPN"
                        >
                          {deletingId === d.id ? "Deleting…" : "Delete"}
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
        onDiscard={onDpnDiscard}
        saving={dpnSaving}
        hasChanges={dpnHasChanges}
        saveLabel="Save DPNs"
      />
    </form>
  );
}

export default DpnsSection;
