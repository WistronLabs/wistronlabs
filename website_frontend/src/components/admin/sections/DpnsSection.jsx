import { useState } from "react";
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
  onToggleDellCustomer,
  dellCustomers,
  handleDeleteDpn,
  deletingId,
  dpnSaving,
  onDpnDiscard,
  dpnHasChanges,
}) {
  const [customerQueryByRow, setCustomerQueryByRow] = useState({});
  const getRowQuery = (rowId) => customerQueryByRow[rowId] || "";
  const setRowQuery = (rowId, value) =>
    setCustomerQueryByRow((prev) => ({ ...prev, [rowId]: value }));

  return (
    <form onSubmit={onDpnSave} className="space-y-4">
      <AdminToolbar
        addLabel="+ Add DPN"
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
              <th className="text-left font-medium px-3 py-2">Allowed Dell Customers</th>
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
                      JSON.stringify(base.dell_customer_ids || []) !==
                        JSON.stringify(
                          (Array.isArray(d.dell_customer_ids)
                            ? d.dell_customer_ids
                            : []
                          ).slice().sort((a, b) => a - b),
                        )));

                return (
                  <tr key={d.id} className={changed ? "bg-amber-100/50" : ""}>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={d.name ?? ""}
                        onChange={(e) => onCellChange(d.id, "name", e.target.value)}
                        maxLength={5}
                        className={`w-[8ch] rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-400" : "border-gray-300"
                        }`}
                        placeholder="e.g. 7RC0V"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <input
                        value={d.config ?? ""}
                        onChange={(e) => onCellChange(d.id, "config", e.target.value)}
                        className={`w-24 rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          changed ? "border-amber-400" : "border-gray-300"
                        }`}
                        placeholder="e.g. B1"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="border border-gray-200 rounded-xl p-2 bg-gray-50 space-y-2">
                        {(dellCustomers || []).length === 0 ? (
                          <div className="text-xs text-gray-500 px-1 py-1">
                            No Dell customers available
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-1.5 min-h-[2.25rem] rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                              {(dellCustomers || [])
                                .filter((c) =>
                                  Array.isArray(d.dell_customer_ids)
                                    ? d.dell_customer_ids.includes(c.id)
                                    : false,
                                )
                                .map((c) => (
                                  <span
                                    key={`${d.id}-selected-${c.id}`}
                                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-800 text-xs font-medium pl-2 pr-1 py-1"
                                  >
                                    <span className="max-w-[150px] truncate" title={c.name}>
                                      {c.name}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => onToggleDellCustomer(d.id, c.id)}
                                      className="rounded-full w-4 h-4 leading-none text-[10px] bg-blue-200 hover:bg-blue-300 text-blue-900"
                                      aria-label={`Remove ${c.name}`}
                                      title={`Remove ${c.name}`}
                                    >
                                      x
                                    </button>
                                  </span>
                                ))}
                              <input
                                type="text"
                                value={getRowQuery(d.id)}
                                onChange={(e) => setRowQuery(d.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key !== "Enter") return;
                                  e.preventDefault();
                                  const q = getRowQuery(d.id).trim().toLowerCase();
                                  if (!q) return;
                                  const candidate = (dellCustomers || []).find(
                                    (c) =>
                                      String(c?.name || "").toLowerCase().includes(q) &&
                                      !(Array.isArray(d.dell_customer_ids)
                                        ? d.dell_customer_ids.includes(c.id)
                                        : false),
                                  );
                                  if (candidate) {
                                    onToggleDellCustomer(d.id, candidate.id);
                                    setRowQuery(d.id, "");
                                  }
                                }}
                                className="flex-1 min-w-[110px] text-xs bg-transparent border-0 focus:ring-0 focus:outline-none text-gray-700 placeholder:text-gray-400"
                                placeholder="Type to add..."
                              />
                            </div>

                            <div className="max-h-24 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1.5">
                              <div className="flex flex-wrap gap-1.5">
                                {(dellCustomers || [])
                                  .filter((c) =>
                                    Array.isArray(d.dell_customer_ids)
                                      ? !d.dell_customer_ids.includes(c.id)
                                      : true,
                                  )
                                  .filter((c) => {
                                    const q = getRowQuery(d.id).trim().toLowerCase();
                                    if (!q) return true;
                                    return String(c?.name || "").toLowerCase().includes(q);
                                  })
                                  .map((c) => (
                                    <button
                                      key={`${d.id}-available-${c.id}`}
                                      type="button"
                                      onClick={() => {
                                        onToggleDellCustomer(d.id, c.id);
                                        setRowQuery(d.id, "");
                                      }}
                                      className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 text-gray-700 text-xs px-2 py-1"
                                      title={`Add ${c.name}`}
                                    >
                                      <span className="max-w-[170px] truncate">{c.name}</span>
                                    </button>
                                  ))}
                                {(dellCustomers || [])
                                  .filter((c) =>
                                    Array.isArray(d.dell_customer_ids)
                                      ? !d.dell_customer_ids.includes(c.id)
                                      : true,
                                  )
                                  .filter((c) => {
                                    const q = getRowQuery(d.id).trim().toLowerCase();
                                    if (!q) return true;
                                    return String(c?.name || "").toLowerCase().includes(q);
                                  }).length === 0 && (
                                  <span className="text-[11px] text-gray-400 px-1 py-0.5">
                                    No matches
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
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
