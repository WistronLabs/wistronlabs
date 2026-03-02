import AdminActionBar from "../AdminActionBar";
import AdminTableCard from "../AdminTableCard";
import AdminToolbar from "../AdminToolbar";

function FactoriesSection({
  onFactorySave,
  addBlankFactoryRow,
  factoryQ,
  setFactoryQ,
  factoryErr,
  factoryLoading,
  filteredFactories,
  factoryBaselineMap,
  onFactoryCellChange,
  handleDeleteFactory,
  deletingFactoryId,
  factorySaving,
  onFactoryDiscard,
  factoryHasChanges,
}) {
  return (
    <form onSubmit={onFactorySave} className="space-y-4">
      <AdminToolbar
        addLabel="+ Add row"
        onAdd={addBlankFactoryRow}
        query={factoryQ}
        onQueryChange={setFactoryQ}
        placeholder="Search factory name/code"
        error={factoryErr}
      />

      <AdminTableCard>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Name</th>
              <th className="text-left font-medium px-3 py-2">Code</th>
              <th className="text-left font-medium px-3 py-2">PPID Code</th>
              <th className="text-right font-medium px-3 py-2 w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {factoryLoading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filteredFactories.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  No matching factories
                </td>
              </tr>
            ) : (
              filteredFactories.map((f) => {
                const isNew = typeof f.id !== "number";
                const base = isNew ? null : factoryBaselineMap.get(f.id);
                const changed =
                  isNew ||
                  (base &&
                    (base.name !== f.name ||
                      base.code !== f.code ||
                      (base.ppid_code ?? "") !== (f.ppid_code ?? "")));

                return (
                  <tr key={f.id} className={changed ? "bg-amber-50/40" : ""}>
                    {["name", "code", "ppid_code"].map((field) => (
                      <td key={field} className="px-3 py-2 align-middle">
                        <input
                          value={f[field] ?? ""}
                          onChange={(e) =>
                            onFactoryCellChange(f.id, field, e.target.value)
                          }
                          className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            changed ? "border-amber-300" : "border-gray-300"
                          }`}
                          placeholder={`e.g. ${
                            field === "name"
                              ? "Juarez"
                              : field === "code"
                                ? "MX"
                                : "WSJ00"
                          }`}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 align-middle">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDeleteFactory(f)}
                          disabled={deletingFactoryId === f.id || factorySaving}
                          className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingFactoryId === f.id ? "Deleting…" : "Delete"}
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
        onDiscard={onFactoryDiscard}
        saving={factorySaving}
        hasChanges={factoryHasChanges}
        saveLabel="Save Factories"
      />
    </form>
  );
}

export default FactoriesSection;
