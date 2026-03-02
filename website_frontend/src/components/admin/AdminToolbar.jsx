function AdminToolbar({
  addLabel,
  onAdd,
  query,
  onQueryChange,
  placeholder,
  error,
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {addLabel}
        </button>
        <div className="relative">
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            className="rounded-lg border border-gray-300 px-3 py-2 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="absolute left-3 top-2.5 text-gray-400">🔎</span>
        </div>
      </div>
      <div className="flex-1" />
      {error && <div className="text-red-600 text-sm">{error}</div>}
    </div>
  );
}

export default AdminToolbar;
