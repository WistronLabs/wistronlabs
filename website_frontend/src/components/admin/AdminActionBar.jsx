function AdminActionBar({
  onDiscard,
  onSave,
  saving,
  hasChanges,
  saveLabel,
}) {
  return (
    <div className="sticky bottom-0 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-t pt-3 pb-4 flex justify-end gap-3">
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
  );
}

export default AdminActionBar;
