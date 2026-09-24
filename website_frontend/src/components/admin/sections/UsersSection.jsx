import AdminActionBar from "../AdminActionBar";
import AdminTableCard from "../AdminTableCard";

const hiddenAccounts = new Set(["deleted_user@example.com", "system"]);

function UsersSection({
  err,
  loading,
  users,
  baselineMap,
  terminalBaselineMap,
  statusBaselineMap,
  me,
  showToast,
  handleLocalToggle,
  handleTerminalToggle,
  handleStatusToggle,
  handleDiscard,
  handleSave,
  hasChanges,
  saving,
}) {
  const visibleUsers = users.filter((u) => !hiddenAccounts.has(u.username?.toLowerCase()));

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
          {err}
        </div>
      )}

      <AdminTableCard>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Username</th>
              <th className="text-left font-medium px-3 py-2">Created</th>
              <th className="text-center font-medium px-3 py-2">Status</th>
              <th className="text-center font-medium px-3 py-2 w-52">Privilege</th>
              <th className="text-right font-medium px-3 py-2">
                Terminal Access
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : visibleUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  No users.
                </td>
              </tr>
            ) : (
              visibleUsers.map((u) => {
                const checked = !!u.isAdmin;
                const original = baselineMap?.[u.username?.toLowerCase()];
                const changed =
                  (typeof original === "boolean" && original !== checked) ||
                  !!terminalBaselineMap?.[u.username.toLowerCase()] !==
                    !!u.terminalAccess ||
                  !!u.enabled !== !!statusBaselineMap?.[u.username.toLowerCase()];
                const isSelf =
                  me?.username?.toLowerCase() === u.username?.toLowerCase();

                return (
                  <tr
                    key={u.username}
                    className={changed ? "bg-amber-100/50" : ""}
                  >
                    <td className="px-3 py-2 align-middle">
                      <span className="font-medium text-gray-900">
                        {u.username}
                      </span>
                      {isSelf && (
                        <span className="ml-2 text-xs text-gray-500">
                          (you)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle text-gray-600">
                      {u.createdAt
                        ? new Date(u.createdAt).toLocaleString()
                        : ""}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {u.isSuperAdmin ? (
                        <span className="inline-block min-w-[72px] rounded-md border border-purple-300 bg-purple-100 px-3 py-1 text-center text-xs font-medium text-purple-900">
                          {u.enabled ? 'Active' : 'Inactive'}
                        </span>
                      ) : (
                        <button type="button" onClick={() => handleStatusToggle(u)}
                          disabled={!me?.isSuperAdmin || saving}
                          aria-label={`${u.enabled ? 'Deactivate' : 'Reactivate'} ${u.username}`}
                          className={`px-3 py-1 rounded-md text-xs font-medium border min-w-[72px] ${
                            u.enabled
                              ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                              : 'bg-gray-200 text-gray-800 border-gray-300 hover:bg-gray-300'
                          } disabled:opacity-50`}>
                          {u.enabled ? 'Active' : 'Inactive'}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex justify-center">
                        {u.isSuperAdmin ? (
                          <span className="inline-flex w-28 items-center justify-center rounded-md border border-purple-300 bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-900">
                            Super Admin
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const next = !checked;
                              if (isSelf && checked && !next) {
                                showToast(
                                  "You cannot remove your own Admin Role",
                                  "error",
                                  3000,
                                  "bottom-right",
                                );
                                return;
                              }
                              handleLocalToggle(u, next);
                            }}
                            disabled={!me?.isSuperAdmin}
                            className={`w-28 px-3 py-1 rounded-md text-xs font-medium border ${
                              checked
                                ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                                : "bg-gray-200 text-gray-800 border-gray-300 hover:bg-gray-300"
                            } disabled:opacity-50`}
                          >
                            {checked ? "Admin" : "User"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => handleTerminalToggle(u)}
                        disabled={!me?.isAdmin || saving}
                        aria-label={`${u.terminalAccess ? 'Remove' : 'Grant'} terminal access for ${u.username}`}
                        aria-pressed={!!u.terminalAccess}
                        className={`w-24 px-3 py-1 rounded-md text-center text-xs font-medium border ${
                          u.terminalAccess
                            ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                            : 'bg-gray-200 text-gray-800 border-gray-300 hover:bg-gray-300'
                        } disabled:opacity-50`}>
                        {u.terminalAccess ? "Allowed" : "No access"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableCard>

      <AdminActionBar
        onDiscard={handleDiscard}
        onSave={handleSave}
        saving={saving}
        hasChanges={hasChanges}
        saveLabel="Save Users"
      />
    </form>
  );
}

export default UsersSection;
