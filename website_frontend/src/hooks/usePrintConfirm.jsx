import { useEffect, useRef, useState } from "react";
import useBodyScrollLock from "./useBodyScrollLock.jsx";

export default function usePrintConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const resolveRef = useRef(null);
  const resolvedRef = useRef(false);
  useBodyScrollLock(isOpen);

  const confirmPrint = () =>
    new Promise((resolve) => {
      setIsOpen(true);
      resolveRef.current = resolve;
      resolvedRef.current = false;
    });

  const finish = (val) => {
    setIsOpen(false);
    if (!resolvedRef.current && typeof resolveRef.current === "function") {
      resolvedRef.current = true;
      resolveRef.current(val); // 'id' | 'rma' | null
    }
    resolveRef.current = null;
  };

  const handleChoice = (type) => finish(type);
  const handleCancel = () => finish(null);

  // ESC to cancel
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const ConfirPrintmModal = () =>
    isOpen ? (
      <div
        className="fixed inset-0 flex items-center justify-center bg-black/40 z-[9999] px-2"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rma-label-title"
        onMouseDown={handleCancel} // backdrop click
      >
        <div
          className="relative bg-white p-6 rounded-xl shadow-xl w-full max-w-sm space-y-4"
          onMouseDown={(e) => e.stopPropagation()} // prevent backdrop close on inner clicks
        >
          {/* Small top-right X */}
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close"
            className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              &times;
            </span>
          </button>

          <h2
            id="rma-label-title"
            className="text-lg font-semibold text-gray-800"
          >
            Choose Label Type
          </h2>
          <p className="text-sm text-gray-600">
            This system is in an RMA location. Which label would you like to
            print?
          </p>

          <div className="flex flex-col sm:flex-row gap-2 sm:justify-between mt-4">
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              onClick={() => handleChoice("id")}
              autoFocus
            >
              System ID Label
            </button>
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              onClick={() => handleChoice("rma")}
            >
              System RMA Label
            </button>
          </div>
        </div>
      </div>
    ) : null;

  return { confirmPrint, ConfirPrintmModal };
}
