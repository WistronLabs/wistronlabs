import { useEffect } from "react";

function AllTagsModal({ tags, onClose }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const list = Array.isArray(tags) ? tags : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full sm:max-w-lg p-4 sm:p-8 mx-2 relative space-y-4 sm:space-y-6">
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Tags</h2>

        {list.length === 0 ? (
          <div className="text-sm text-gray-600">No tags.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {list.map((t) => (
              <span
                key={String(t.code || "")
                  .trim()
                  .toLowerCase()}
                className="inline-block px-2 py-1 bg-gray-100 text-gray-800 text-xs sm:text-sm font-bold rounded-full uppercase"
              >
                {t.code}
              </span>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default AllTagsModal;
