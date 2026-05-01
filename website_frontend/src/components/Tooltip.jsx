import React, { useEffect, useRef, useState } from "react";

export default function Tooltip({
  children,
  text,
  position = "top",
  show = false,
  maxWidthClassName = "max-w-xs",
  zIndexClassName = "z-0",
  autoFlip = true,
  topViewportOffset = 0,
  bottomViewportOffset = 0,
}) {
  const posClasses = {
    top: {
      bubble: "bottom-full left-1/2 -translate-x-1/2 mb-3",
      arrow:
        "top-full left-1/2 -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-slate-900/95",
    },
    bottom: {
      bubble: "top-full left-1/2 -translate-x-1/2 mt-3",
      arrow:
        "bottom-full left-1/2 -translate-x-1/2 border-x-8 border-b-8 border-x-transparent border-b-slate-900/95",
    },
    left: {
      bubble: "right-full top-1/2 -translate-y-1/2 mr-3",
      arrow:
        "left-full top-1/2 -translate-y-1/2 border-y-8 border-l-8 border-y-transparent border-l-slate-900/95",
    },
    right: {
      bubble: "left-full top-1/2 -translate-y-1/2 ml-3",
      arrow:
        "right-full top-1/2 -translate-y-1/2 border-y-8 border-r-8 border-y-transparent border-r-slate-900/95",
    },
  };

  const [open, setOpen] = useState(false);
  const [resolvedPosition, setResolvedPosition] = useState(position);
  const triggerRef = useRef(null);
  const bubbleRef = useRef(null);

  if (!show || !text) {
    return <>{children}</>;
  }

  const activePos = posClasses[resolvedPosition] || posClasses.top;
  const openTooltip = () => setOpen(true);
  const closeTooltip = () => setOpen(false);
  const toggleTooltip = () => setOpen((prev) => !prev);

  useEffect(() => {
    setResolvedPosition(position);
  }, [position]);

  useEffect(() => {
    if (!open) return;
    if (!autoFlip) return;
    if (position !== "top" && position !== "bottom") return;

    const updatePosition = () => {
      const triggerEl = triggerRef.current;
      const bubbleEl = bubbleRef.current;
      if (!triggerEl || !bubbleEl) return;

      const triggerRect = triggerEl.getBoundingClientRect();
      const bubbleRect = bubbleEl.getBoundingClientRect();
      const margin = 12;

      const spaceAbove = triggerRect.top - topViewportOffset;
      const spaceBelow =
        window.innerHeight - bottomViewportOffset - triggerRect.bottom;
      const fitsAbove = spaceAbove >= bubbleRect.height + margin;
      const fitsBelow = spaceBelow >= bubbleRect.height + margin;

      if (position === "top") {
        if (fitsAbove) setResolvedPosition("top");
        else if (fitsBelow) setResolvedPosition("bottom");
        else setResolvedPosition(spaceAbove >= spaceBelow ? "top" : "bottom");
        return;
      }

      if (fitsBelow) setResolvedPosition("bottom");
      else if (fitsAbove) setResolvedPosition("top");
      else setResolvedPosition(spaceBelow >= spaceAbove ? "bottom" : "top");
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [autoFlip, bottomViewportOffset, open, position, topViewportOffset]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex align-middle"
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
      onFocus={openTooltip}
      onBlur={closeTooltip}
      onClick={toggleTooltip}
    >
      {children}
      <span
        ref={bubbleRef}
        className={`pointer-events-none absolute ${zIndexClassName} ${
          activePos.bubble
        } transition-all duration-150 ease-out ${
          open
            ? "translate-y-0 opacity-100 scale-100"
            : "translate-y-1 opacity-0 scale-95"
        }`}
        role="tooltip"
        aria-hidden={!open}
      >
        <span
          className={`relative block ${maxWidthClassName} rounded-xl border border-slate-700/80 bg-slate-900/95 px-3 py-2 text-xs font-medium leading-5 text-slate-100 shadow-2xl backdrop-blur-sm whitespace-normal`}
        >
          {text}
          <span className={`absolute h-0 w-0 ${activePos.arrow}`} />
        </span>
      </span>
    </span>
  );
}
