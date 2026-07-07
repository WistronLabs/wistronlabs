import AdminActionBar from "../AdminActionBar";
import AdminTableCard from "../AdminTableCard";

function UsersSection({
  err,
  loading,
  users,
  baselineMap,
  me,
  showToast,
  handleLocalToggle,
  handleDiscard,
  handleSave,
  hasChanges,
  saving,
}) {
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
              <th className="text-right font-medium px-3 py-2 w-52">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                  No users.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const checked = !!u.isAdmin;
                const original = baselineMap?.[u.username?.toLowerCase()];
                const changed = typeof original === "boolean" && original !== checked;
                const isSelf =
                  me?.username?.toLowerCase() === u.username?.toLowerCase();

                return (
                  <tr key={u.username} className={changed ? "bg-amber-100/50" : ""}>
                    <td className="px-3 py-2 align-middle">
                      <span className="font-medium text-gray-900">{u.username}</span>
                      {isSelf && (
                        <span className="ml-2 text-xs text-gray-500">(you)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle text-gray-600">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString() : ""}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex justify-end">
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
                          disabled={!me?.isAdmin}
                          className={`px-3 py-1 rounded-md text-xs font-medium border min-w-[72px] ${
                            checked
                              ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                              : "bg-gray-200 text-gray-800 border-gray-300 hover:bg-gray-300"
                          } disabled:opacity-50`}
                        >
                          {checked ? "Admin" : "User"}
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
