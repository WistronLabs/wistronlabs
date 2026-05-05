import { useMemo, useState } from "react";
import AdminActionBar from "../AdminActionBar";
import AdminTableCard from "../AdminTableCard";
import AdminToolbar from "../AdminToolbar";

function DpnsSection({
  onDpnSave,
  addBlankRow,
  addBlankConfigRow,
  dpnQ,
  setDpnQ,
  dpnErr,
  dpnLoading,
  filteredDpns,
  allDpns,
  dpnBaselineMap,
  onCellChange,
  onFamilyNameChange,
  onToggleDellCustomer,
  dellCustomers,
  handleDeleteDpn,
  handleDeleteDpnFamily,
  deletingId,
  dpnSaving,
  onDpnDiscard,
  dpnHasChanges,
}) {
  const [customerQueryByRow, setCustomerQueryByRow] = useState({});
  const [expandedFamilies, setExpandedFamilies] = useState({});

  const normalizeName = (value) => String(value || "").trim().toUpperCase();
  const getRowQuery = (rowId) => customerQueryByRow[rowId] || "";
  const setRowQuery = (rowId, value) =>
    setCustomerQueryByRow((prev) => ({ ...prev, [rowId]: value }));

  const groupedDpns = useMemo(() => {
    const getFamilyKeyForRow = (row) =>
      normalizeName(row?.name) || `row:${row.id}`;
    const groups = [];
    const seen = new Map();

    for (const row of filteredDpns || []) {
      const key = getFamilyKeyForRow(row);
      if (!seen.has(key)) {
        const group = { key, name: row?.name || "", rows: [] };
        seen.set(key, group);
        groups.push(group);
      }
      seen.get(key).rows.push(row);
    }

    return groups.map((group) => ({
      ...group,
      rows: group.rows.slice().sort((a, b) =>
        String(a?.config || "").localeCompare(String(b?.config || "")),
      ),
    }));
  }, [filteredDpns]);

  const getFamilyAssignedCustomerIds = (row) => {
    const familyKey = normalizeName(row?.name);
    if (!familyKey) return new Set();

    return new Set(
      (allDpns || [])
        .filter((candidate) => normalizeName(candidate?.name) === familyKey)
        .flatMap((candidate) =>
          Array.isArray(candidate?.dell_customer_ids)
            ? candidate.dell_customer_ids
            : [],
        ),
    );
  };

  const hasRowChanged = (row) => {
    const isNew = typeof row.id !== "number";
    const base = isNew ? null : dpnBaselineMap.get(row.id);
    return (
      isNew ||
      (base &&
        (base.name !== row.name ||
          (base.config ?? "") !== (row.config ?? "") ||
          JSON.stringify(base.dell_customer_ids || []) !==
            JSON.stringify(
              (Array.isArray(row.dell_customer_ids) ? row.dell_customer_ids : [])
                .slice()
                .sort((a, b) => a - b),
            )))
    );
  };

  const toggleFamilyExpanded = (familyKey) => {
    setExpandedFamilies((prev) => ({
      ...prev,
      [familyKey]: prev[familyKey] === false,
    }));
  };

  const isFamilyExpanded = (familyKey) => expandedFamilies[familyKey] !== false;

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
        <div className="space-y-4 p-3">
          {dpnLoading ? (
            <div className="px-3 py-6 text-center text-gray-500">Loading…</div>
          ) : groupedDpns.length === 0 ? (
            <div className="px-3 py-6 text-center text-gray-500">
              No matching DPNs
            </div>
          ) : (
            groupedDpns.map((group) => {
              const familyRowIds = group.rows.map((row) => row.id);
              const familyChanged = group.rows.some(hasRowChanged);
              const familyDeletingKey = `family:${normalizeName(group.name) || group.key}`;
              const showSubrowDelete = group.rows.length > 1;

              return (
                <section
                  key={group.key}
                  className={`rounded-2xl border p-4 ${
                    familyChanged
                      ? "border-amber-300 bg-amber-50/50"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleFamilyExpanded(group.key)}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
                        aria-label={
                          isFamilyExpanded(group.key)
                            ? "Collapse configs"
                            : "Expand configs"
                        }
                        title={
                          isFamilyExpanded(group.key)
                            ? "Collapse configs"
                            : "Expand configs"
                        }
                      >
                        {isFamilyExpanded(group.key) ? "−" : "+"}
                      </button>
                      <input
                        value={group.name ?? ""}
                        onChange={(e) =>
                          onFamilyNameChange(familyRowIds, e.target.value)
                        }
                        maxLength={5}
                        className={`w-[10ch] rounded-xl border px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          familyChanged ? "border-amber-400" : "border-gray-300"
                        }`}
                        placeholder="e.g. 7RC0V"
                      />
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                        {group.rows.length} config{group.rows.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => addBlankConfigRow(group.name)}
                        disabled={dpnSaving}
                        className="rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        + Add Config
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDpnFamily(group.rows)}
                        disabled={deletingId === familyDeletingKey || dpnSaving}
                        className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {deletingId === familyDeletingKey ? "Deleting…" : "Delete DPN"}
                      </button>
                    </div>
                  </div>

                  {isFamilyExpanded(group.key) && (
                    <div className="mt-4 space-y-3">
                      {group.rows.map((row) => {
                        const rowChanged = hasRowChanged(row);
                        const familyAssignedCustomerIds =
                          getFamilyAssignedCustomerIds(row);

                        return (
                          <div
                            key={row.id}
                            className={`rounded-2xl border p-3 ${
                              rowChanged
                                ? "border-amber-300 bg-amber-100/40"
                                : "border-gray-200 bg-gray-50/70"
                            }`}
                          >
                            <div className="grid gap-3 xl:grid-cols-[120px_minmax(0,1fr)_110px] xl:items-start">
                              <div>
                                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                                  Config
                                </div>
                                <input
                                  value={row.config ?? ""}
                                  onChange={(e) =>
                                    onCellChange(row.id, "config", e.target.value)
                                  }
                                  className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    rowChanged ? "border-amber-400" : "border-gray-300"
                                  }`}
                                  placeholder="e.g. B1"
                                />
                              </div>

                              <div>
                                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                                  Allowed Dell Customers
                                </div>
                                <div className="rounded-2xl border border-gray-200 bg-white p-2 space-y-2">
                                  {(dellCustomers || []).length === 0 ? (
                                    <div className="px-1 py-1 text-xs text-gray-500">
                                      No Dell customers available
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5">
                                        {(dellCustomers || [])
                                          .filter((customer) =>
                                            Array.isArray(row.dell_customer_ids)
                                              ? row.dell_customer_ids.includes(customer.id)
                                              : false,
                                          )
                                          .map((customer) => (
                                            <span
                                              key={`${row.id}-selected-${customer.id}`}
                                              className="inline-flex items-center gap-1 rounded-full bg-blue-100 py-1 pl-2 pr-1 text-xs font-medium text-blue-800"
                                            >
                                              <span
                                                className="max-w-[170px] truncate"
                                                title={customer.name}
                                              >
                                                {customer.name}
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  onToggleDellCustomer(
                                                    row.id,
                                                    customer.id,
                                                  )
                                                }
                                                className="h-4 w-4 rounded-full bg-blue-200 text-[10px] leading-none text-blue-900 hover:bg-blue-300"
                                                aria-label={`Remove ${customer.name}`}
                                                title={`Remove ${customer.name}`}
                                              >
                                                x
                                              </button>
                                            </span>
                                          ))}
                                        <input
                                          type="text"
                                          value={getRowQuery(row.id)}
                                          onChange={(e) =>
                                            setRowQuery(row.id, e.target.value)
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key !== "Enter") return;
                                            e.preventDefault();
                                            const q = getRowQuery(row.id)
                                              .trim()
                                              .toLowerCase();
                                            if (!q) return;
                                            const candidate = (dellCustomers || []).find(
                                              (customer) =>
                                                String(customer?.name || "")
                                                  .toLowerCase()
                                                  .includes(q) &&
                                                !familyAssignedCustomerIds.has(
                                                  customer.id,
                                                ),
                                            );
                                            if (candidate) {
                                              onToggleDellCustomer(row.id, candidate.id);
                                              setRowQuery(row.id, "");
                                            }
                                          }}
                                          className="min-w-[110px] flex-1 border-0 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                                          placeholder="Type to add..."
                                        />
                                      </div>

                                      <div className="max-h-28 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-1.5">
                                        <div className="flex flex-wrap gap-1.5">
                                          {(dellCustomers || [])
                                            .filter(
                                              (customer) =>
                                                !familyAssignedCustomerIds.has(
                                                  customer.id,
                                                ),
                                            )
                                            .filter((customer) => {
                                              const q = getRowQuery(row.id)
                                                .trim()
                                                .toLowerCase();
                                              if (!q) return true;
                                              return String(customer?.name || "")
                                                .toLowerCase()
                                                .includes(q);
                                            })
                                            .map((customer) => (
                                              <button
                                                key={`${row.id}-available-${customer.id}`}
                                                type="button"
                                                onClick={() => {
                                                  onToggleDellCustomer(
                                                    row.id,
                                                    customer.id,
                                                  );
                                                  setRowQuery(row.id, "");
                                                }}
                                                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:border-blue-200 hover:bg-blue-50"
                                                title={`Add ${customer.name}`}
                                              >
                                                <span className="max-w-[180px] truncate">
                                                  {customer.name}
                                                </span>
                                              </button>
                                            ))}
                                          {(dellCustomers || [])
                                            .filter(
                                              (customer) =>
                                                !familyAssignedCustomerIds.has(
                                                  customer.id,
                                                ),
                                            )
                                            .filter((customer) => {
                                              const q = getRowQuery(row.id)
                                                .trim()
                                                .toLowerCase();
                                              if (!q) return true;
                                              return String(customer?.name || "")
                                                .toLowerCase()
                                                .includes(q);
                                            }).length === 0 && (
                                            <span className="px-1 py-0.5 text-[11px] text-gray-400">
                                              No matches
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-end justify-end xl:h-full">
                                {showSubrowDelete ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteDpn(row)}
                                    disabled={deletingId === row.id || dpnSaving}
                                    className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                    title="Delete config"
                                  >
                                    {deletingId === row.id ? "Deleting…" : "Delete"}
                                  </button>
                                ) : (
                                  <div className="px-2 py-2 text-xs text-gray-400">
                                    Delete from parent row
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
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
