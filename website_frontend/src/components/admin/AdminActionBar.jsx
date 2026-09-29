function AdminActionBar({
  onDiscard,
  onSave,
  saving,
  hasChanges,
  saveLabel,
  error,
  message,
}) {
  return (
    <div className="sticky bottom-0 z-20 space-y-2 border-t bg-white/95 pt-3 pb-4 backdrop-blur">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving || !hasChanges}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Discard changes
        </button>
        <button
          type="submit"
          onClick={onSave}
          disabled={saving || !hasChanges}
          className={`px-4 py-2 rounded-lg text-white ${
            hasChanges
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-blue-300 cursor-not-allowed"
          }`}
        >
          {saving ? "Saving…" : saveLabel}
        </button>
      </div>
    </div>
  );
}

export default AdminActionBar;
