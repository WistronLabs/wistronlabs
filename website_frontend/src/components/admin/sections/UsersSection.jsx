function UsersSection({
  err,
  loading,
  users,
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
      {err && <div className="text-red-600">{err}</div>}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <>
          <ul className="divide-y">
            {users.map((u) => {
              const checked = !!u.isAdmin;
              const isSelf =
                me?.username?.toLowerCase() === u.username?.toLowerCase();

              return (
                <li
                  key={u.username}
                  className="py-2 flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{u.username}</div>
                    <div className="text-xs text-gray-500">
                      {checked ? "Admin" : "User"} ·{" "}
                      {u.createdAt ? new Date(u.createdAt).toLocaleString() : ""}
                      {isSelf ? " · you" : ""}
                    </div>
                  </div>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked;
                        if (isSelf && checked && !next) {
                          showToast(
                            "You cannot remove your own Admin Role",
                            "error",
                            3000,
                            "bottom-right",
                          );
                          e.preventDefault();
                          return;
                        }
                        handleLocalToggle(u, next);
                      }}
                      disabled={!me?.isAdmin}
                      aria-label={`Make ${u.username} an admin`}
                    />
                    <span className="text-sm">Admin</span>
                  </label>
                </li>
              );
            })}
            {users.length === 0 && (
              <li className="py-2 text-gray-500">No users.</li>
            )}
          </ul>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving || !hasChanges}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Discard changes
            </button>
            <button
              type="submit"
              disabled={saving || !hasChanges}
              className={`px-4 py-2 rounded-lg text-white ${
                hasChanges
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-blue-300 cursor-not-allowed"
              }`}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

export default UsersSection;
