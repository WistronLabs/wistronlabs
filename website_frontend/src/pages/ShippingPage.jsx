import React, { useEffect, useState, useContext } from "react";
import useToast from "../hooks/useToast";
import useConfirm from "../hooks/useConfirm";
import { formatDateHumanReadable } from "../utils/date_format";
import { pdf } from "@react-pdf/renderer";
import SystemRMALabel from "../components/SystemRMALabel.jsx";
import { enrichPalletWithBarcodes } from "../utils/enrichPalletWithBarcodes";
import PalletPaper from "../components/PalletPaper";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import SearchContainerSS from "../components/SearchContainerSS.jsx";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { AuthContext } from "../context/AuthContext.jsx";

function SystemBox({ serviceTag, dpn, dellCustomer }) {
  return (
    <div className="w-full h-full rounded-lg text-sm transition bg-neutral-100 text-neutral-800 border border-neutral-300 shadow-sm hover:ring-2 hover:ring-neutral-300 hover:bg-neutral-200 cursor-move select-none px-2 py-1 overflow-hidden">
      <div className="font-semibold truncate">{serviceTag}</div>
      <div className="text-[11px] text-neutral-600 truncate">
        {dpn || "No DPN"}
        {dellCustomer ? ` - ${dellCustomer}` : ""}
      </div>
    </div>
  );
}

function DraggableSystem({ palletId, index, system }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `drag-${palletId}-${index}`,
      data: { palletId, index, system },
    });

  const style = {
    transform: transform
      ? `translate(${transform.x}px, ${transform.y}px)`
      : undefined,
    opacity: isDragging ? 0.5 : 1,
    pointerEvents: isDragging ? "none" : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className="w-full h-full flex items-center justify-center"
    >
      <Link to={`/${system.service_tag}`} className="w-full h-full">
        <SystemBox
          serviceTag={system.service_tag}
          dpn={system.dpn}
          dellCustomer={system.dell_customer}
        />
      </Link>
    </div>
  );
}

function DroppableSlot({ palletId, idx, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${palletId}-${idx}`,
    data: { palletId, idx },
  });

  return (
    <div
      ref={setNodeRef}
      className={`h-16 w-full flex items-center justify-center rounded-lg text-sm font-semibold transition-all duration-150 select-none ${
        children
          ? "bg-neutral-100 text-neutral-800 border border-neutral-300 shadow-sm hover:ring-2 hover:ring-neutral-300"
          : "bg-white text-neutral-400 border border-dashed border-neutral-300 italic"
      } ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {children || "Empty"}
    </div>
  );
}

function LockStateButton({ currentLocked, pending, onToggle }) {
  const hasPending = pending !== undefined;
  const effectiveLocked = hasPending ? pending : currentLocked;

  const styles = {
    LOCKED_CURRENT: "bg-red-50 text-red-700 border-red-200",
    UNLOCKED_CURRENT: "bg-green-50 text-green-700 border-green-200",
    LOCKED_PENDING: "bg-amber-50 text-amber-700 border-amber-200",
    UNLOCKED_PENDING: "bg-blue-50 text-blue-700 border-blue-200",
  };
  const labels = {
    LOCKED_CURRENT: "Locked",
    UNLOCKED_CURRENT: "Unlocked",
    LOCKED_PENDING: "Locked (pending)",
    UNLOCKED_PENDING: "Unlocked (pending)",
  };

  const stateKey = hasPending
    ? effectiveLocked
      ? "LOCKED_PENDING"
      : "UNLOCKED_PENDING"
    : currentLocked
    ? "LOCKED_CURRENT"
    : "UNLOCKED_CURRENT";

  // Longest label drives button width
  const longestLabel = Object.values(labels).reduce(
    (a, b) => (b.length > a.length ? b : a),
    ""
  );

  const title = hasPending
    ? "Click to clear the pending lock change"
    : `Click to stage a ${currentLocked ? "unlock" : "lock"} change`;

  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      className={`grid place-items-center whitespace-nowrap px-2 py-1 text-xs font-semibold rounded-md border ${styles[stateKey]} hover:opacity-90`}
      // grid + invisible longest label ensures fixed width
    >
      {/* Invisible width-reserver */}
      <span className="invisible col-start-1 row-start-1">{longestLabel}</span>
      {/* Visible label, overlaid in same grid cell */}
      <span className="col-start-1 row-start-1">{labels[stateKey]}</span>
    </button>
  );
}

const PalletGrid = ({
  pallet,
  releaseFlags,
  setReleaseFlags,
  lockFlags,
  setLockFlags,
}) => {
  // Use unified field so the grid also works for released pallets if reused
  const raw = pallet.systems ?? pallet.active_systems ?? [];
  const systems = raw.map((s) =>
    s && (s.service_tag || s.system_id) ? s : undefined
  );

  const isEmpty = systems.every((s) => !s || (!s.service_tag && !s.system_id));
  const isReleased = !!releaseFlags[pallet.id]?.released;

  useEffect(() => {
    if (isEmpty && releaseFlags[pallet.id]) {
      setReleaseFlags((prev) => {
        const copy = { ...prev };
        delete copy[pallet.id];
        return copy;
      });
    }
  }, [isEmpty, pallet.id, releaseFlags, setReleaseFlags]);

  const toggleRelease = () => {
    setReleaseFlags((prev) => {
      const existing = prev[pallet.id];
      if (existing?.released) {
        const copy = { ...prev };
        delete copy[pallet.id];
        return copy;
      }
      return {
        ...prev,
        [pallet.id]: { released: true },
      };
    });
  };

  // ---- STAGED LOCK TOGGLE ----
  const currentLocked = !!pallet.locked;
  const pending = lockFlags[pallet.id]; // undefined | boolean
  const hasPending = pending !== undefined;

  const toggleLockStaged = () => {
    setLockFlags((prev) => {
      const copy = { ...prev };
      if (hasPending) {
        // clear pending
        delete copy[pallet.id];
      } else {
        // stage opposite of current
        copy[pallet.id] = !currentLocked;
      }
      return copy;
    });
  };
  const effectiveLocked = hasPending ? pending : currentLocked;

  const stateKey = hasPending
    ? effectiveLocked
      ? "LOCKED_PENDING"
      : "UNLOCKED_PENDING"
    : currentLocked
    ? "LOCKED_CURRENT"
    : "UNLOCKED_CURRENT";

  const stateStyles = {
    LOCKED_CURRENT: "bg-red-50 text-red-700 border-red-200",
    UNLOCKED_CURRENT: "bg-green-50 text-green-700 border-green-200",
    LOCKED_PENDING: "bg-amber-50 text-amber-700 border-amber-200",
    UNLOCKED_PENDING: "bg-blue-50 text-blue-700 border-blue-200",
  };

  const stateLabel = {
    LOCKED_CURRENT: "Locked",
    UNLOCKED_CURRENT: "Unlocked",
    LOCKED_PENDING: "Locked (pending)",
    UNLOCKED_PENDING: "Unlocked (pending)",
  };

  return (
    <div className="border border-gray-300 rounded-2xl shadow-md hover:shadow-lg transition p-4 bg-white flex flex-col justify-between">
      <div className="mb-4 relative">
        <h2 className="text-md font-medium text-gray-700 pr-32">
          {pallet.pallet_number}
        </h2>
        <p className="text-xs pb-2 text-gray-500">
          Created on {formatDateHumanReadable(pallet.created_at)}
        </p>

        {/* Lock chip  stage/clear button */}
        <div className="absolute top-0 right-0 flex items-center gap-2">
          <div className="absolute top-0 right-0">
            <LockStateButton
              currentLocked={currentLocked}
              pending={pending}
              onToggle={toggleLockStaged}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 grid-rows-3 gap-2 mb-4">
          {Array.from({ length: 9 }).map((_, idx) => {
            const system = systems[idx];
            return (
              <DroppableSlot
                key={`${pallet.id}-${idx}`}
                palletId={pallet.id}
                idx={idx}
              >
                {system?.service_tag && (
                  <DraggableSystem
                    system={system}
                    index={idx}
                    palletId={pallet.id}
                  />
                )}
              </DroppableSlot>
            );
          })}
        </div>

        <button
          onClick={toggleRelease}
          disabled={isEmpty}
          className={`w-full mt-2 py-2 rounded-lg text-sm font-semibold text-white transition ${
            isEmpty
              ? "bg-gray-300 cursor-not-allowed"
              : isReleased
              ? "bg-yellow-600 hover:bg-yellow-700"
              : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {isReleased ? "Undo Release" : "Mark for Release"}
        </button>
      </div>
    </div>
  );
};

export default function ShippingPage() {
  const { showToast, Toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [pallets, setPallets] = useState([]);
  const [initialPallets, setInitialPallets] = useState([]);
  const [activeDragData, setActiveDragData] = useState(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPallet, setCreatingPallet] = useState(false);

  // staged lock changes
  const [lockFlags, setLockFlags] = useState({});
  const [releaseFlags, setReleaseFlags] = useState({});
  const [tab, setTab] = useState("active");

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'locked' | 'unlocked'

  const FRONTEND_URL = import.meta.env.VITE_URL;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  const {
    createPallet,
    getSystem,
    getPallets,
    moveSystemBetweenPallets,
    releasePallet,
    deletePallet,
    setPalletLock,
  } = useApi();

  const handleCreatePallet = async (e) => {
    e?.preventDefault?.();

    try {
      setCreatingPallet(true);
      const res = await createPallet();
      const pn =
        res?.pallet_number || res?.pallet?.pallet_number || "(pallet created)";
      showToast(`Created pallet ${pn}`, "info");
      setShowCreateModal(false);
      await reloadOpenPallets();
    } catch (err) {
      const msg =
        err?.body?.error ||
        err?.error ||
        err?.message ||
        "Failed to create pallet";
      showToast(msg, "error");
    } finally {
      setCreatingPallet(false);
    }
  };

  // ---- Released tab data fetcher ----
  const fetchReleasedPallets = async ({
    page,
    page_size,
    sort_by,
    sort_order,
    search,
  }) => {
    const res = await getPallets({
      page,
      page_size,
      sort_by,
      sort_order,
      search,
      filters: {
        conditions: [{ field: "status", op: "=", values: ["released"] }],
      },
    });

    const palletsWithLinks = await Promise.all(
      (res.data || []).map(async (pallet) => {
        try {
          const systemsWithDetails = await Promise.all(
            (
              pallet.systems ??
              pallet.released_systems ??
              pallet.active_systems ??
              []
            )
              .filter((s) => s?.service_tag)
              .map(async (sys) => {
                try {
                  const systemDetails = await getSystem(sys.service_tag);
                  return {
                    service_tag: systemDetails.service_tag || "UNKNOWN-ST",
                    ppid: systemDetails.ppid?.trim() || "MISSING-PPID",
                  };
                } catch {
                  return {
                    service_tag: sys.service_tag || "UNKNOWN-ST",
                    ppid: "MISSING-PPID",
                  };
                }
              })
          );

          const rawPallet = {
            pallet_number: pallet.pallet_number,
            doa_number: pallet.doa_number,
            date_released: pallet.released_at?.split("T")[0] || "",
            dpn: pallet.dpn || "MIXED",
            factory_id: pallet.factory_code || "N/A",
            systems: systemsWithDetails,
          };

          const enriched = enrichPalletWithBarcodes(rawPallet);
          const palletBlob = await pdf(
            <PalletPaper pallet={enriched} />
          ).toBlob();
          const pdfUrl = URL.createObjectURL(palletBlob);

          return {
            ...pallet,
            created_at: formatDateHumanReadable(pallet.created_at),
            released_at: formatDateHumanReadable(pallet.released_at),
            pallet_number_title: "Pallet Number",
            doa_number_title: "DOA Number",
            created_at_title: "Created On",
            released_at_title: "Released On",
            href: pdfUrl,
          };
        } catch (err) {
          console.error(
            `PDF generation failed for ${pallet.pallet_number}`,
            err
          );
          return { ...pallet, href: "#" };
        }
      })
    );

    return { data: palletsWithLinks, total_count: res.total_count };
  };

  // ---- Initial load (open pallets) ----
  useEffect(() => {
    const loadPallets = async () => {
      try {
        const data = await getPallets({
          filters: {
            conditions: [{ field: "status", op: "=", values: ["open"] }],
          },
        });

        const result = Array.isArray(data?.data) ? data.data : [];
        // Normalize both fields for DnD + unified reads
        const normalized = result.map((p) => ({
          ...p,
          active_systems: p.active_systems ?? p.systems ?? [],
          systems: p.systems ?? p.active_systems ?? [],
        }));

        setPallets(normalized);
        setInitialPallets(structuredClone(normalized));
      } catch (err) {
        console.error("Failed to load pallets:", err);
        showToast("Failed to load pallets", "error");
      }
    };

    loadPallets();
  }, []);

  const reloadOpenPallets = async () => {
    const data = await getPallets({
      filters: { conditions: [{ field: "status", op: "=", values: ["open"] }] },
    });
    const refreshed = Array.isArray(data?.data) ? data.data : [];
    const normalized = refreshed.map((p) => ({
      ...p,
      active_systems: p.active_systems ?? p.systems ?? [],
      systems: p.systems ?? p.active_systems ?? [],
    }));
    setPallets(normalized);
    setInitialPallets(structuredClone(normalized));
    setReleaseFlags({});
    setLockFlags({});
  };

  const handleDownloadReport = async () => {
    try {
      setReportGenerating(true);

      const filtered = (pallets || []).filter((p) => {
        return statusFilter === "all"
          ? true
          : statusFilter === "locked"
          ? !!p.locked
          : !p.locked;
      });

      if (filtered.length === 0) {
        showToast("No pallets match the selected filters.", "info");
        return;
      }

      // ...rest of your CSV code...

      const header = [
        "pallet_number",
        "service_tag",
        "ppid",
        "DPN",
        "Config",
        "Dell Customer",
        "issue",
        "location",
        "factory_code",
      ];
      const rows = [header];

      // For each pallet → each active system → fetch live system details
      for (const pallet of filtered) {
        const systems = (pallet.active_systems ?? pallet.systems ?? []).filter(
          Boolean
        );
        if (systems.length === 0) continue;

        const details = await Promise.all(
          systems.map(async (s) => {
            try {
              const d = await getSystem(s.service_tag);
              return {
                st: s.service_tag,
                ppid: (d?.ppid || "").trim(),
                dpn: d?.dpn || "",
                config: `Config ${d?.config}` || "",
                dell_customer: d?.dell_customer || "",
                issue: d?.issue ?? "",
                location: d?.location ?? "",
              };
            } catch {
              return {
                st: s.service_tag,
                ppid: "",
                dpn: "",
                config: "",
                dell_customer: "",
                issue: "",
                location: "",
              };
            }
          })
        );

        for (const d of details) {
          rows.push([
            pallet.pallet_number,
            d.st,
            d.ppid,
            d.dpn,
            d.config,
            d.dell_customer,
            d.issue,
            d.location,
            pallet.factory_code || "", // prefer from pallet payload
          ]);
        }
      }

      if (rows.length === 1) {
        showToast("No units found for the selected filters.", "info");
        return;
      }

      const csv = rows
        .map((r) =>
          r
            .map((cell) => {
              const v = String(cell ?? "");
              const needsQuotes = /[",\n]/.test(v);
              const escaped = v.replace(/"/g, '""');
              return needsQuotes ? `"${escaped}"` : escaped;
            })
            .join(",")
        )
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

      const statusPart = statusFilter === "all" ? "all_active" : statusFilter;
      a.href = url;
      a.download = `pallet-report-${statusPart}-${ts}.csv`;

      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast("Report downloaded.", "info");
      setShowReportModal(false);
    } catch (err) {
      console.error(err);
      showToast(`Failed to build report: ${err.message || err}`, "error");
    } finally {
      setReportGenerating(false);
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveDragData(null);
    if (!over) return;

    const [_, fromPalletIdStr, fromIdxStr] = active.id.split("-");
    const [__, toPalletIdStr, toIdxStr] = over.id.split("-");

    const fromId = Number(fromPalletIdStr);
    const fromIdx = Number(fromIdxStr);
    const toId = Number(toPalletIdStr);
    const toIdx = Number(toIdxStr);

    if (fromId === toId && fromIdx === toIdx) return;

    const system = active.data.current.system;

    // Client-side lock guard
    const fromPalletObj = pallets.find((p) => p.id === fromId);
    const toPalletObj = pallets.find((p) => p.id === toId);
    if (!fromPalletObj || !toPalletObj) return;
    if (fromPalletObj.locked || toPalletObj.locked) {
      showToast("Cannot move systems when either pallet is locked", "error");
      return;
    }

    setPallets((prev) => {
      const copy = structuredClone(prev);
      const fromPallet = copy.find((p) => p.id === fromId);
      const toPallet = copy.find((p) => p.id === toId);
      if (!fromPallet || !toPallet) return prev;

      if (toPallet.active_systems?.[toIdx]?.service_tag) {
        showToast("Target slot already occupied", "error");
        return prev;
      }

      // Mutate both views to keep state consistent
      if (Array.isArray(fromPallet.active_systems))
        fromPallet.active_systems[fromIdx] = undefined;
      if (Array.isArray(toPallet.active_systems))
        toPallet.active_systems[toIdx] = system;

      if (Array.isArray(fromPallet.systems))
        fromPallet.systems[fromIdx] = undefined;
      if (Array.isArray(toPallet.systems)) toPallet.systems[toIdx] = system;

      return [...copy];
    });
  };

  const palletsChanged = (() => {
    if (pallets.length !== initialPallets.length) return true;

    for (let i = 0; i < pallets.length; i++) {
      const current = pallets[i];
      const initial = initialPallets.find((p) => p.id === current.id);
      if (!initial) return true;

      const currentTags = (current.active_systems || [])
        .filter((s) => s?.service_tag)
        .map((s) => s.service_tag)
        .sort();
      const initialTags = (initial.active_systems || [])
        .filter((s) => s?.service_tag)
        .map((s) => s.service_tag)
        .sort();

      if (currentTags.length !== initialTags.length) return true;
      for (let j = 0; j < currentTags.length; j++) {
        if (currentTags[j] !== initialTags[j]) return true;
      }
    }

    const hasAnyRelease = Object.keys(releaseFlags).length > 0;
    if (hasAnyRelease) return true;

    const hasAnyLockChange = pallets.some((p) => {
      if (lockFlags[p.id] === undefined) return false;
      return lockFlags[p.id] !== !!p.locked;
    });
    if (hasAnyLockChange) return true;

    return false;
  })();

  const handleSubmit = async () => {
    const confirmed = await confirm({
      message: "Are you sure you want to submit changes?",
      title: "Confirm Submit",
      confirmText: "Yes, submit",
      cancelText: "Cancel",
      confirmClass: "bg-blue-600 text-white hover:bg-blue-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });

    if (!confirmed) return;

    const lockedCount = pallets.filter((p) => p.locked === true).length;
    const unlockedCount = pallets.filter((p) => p.locked === false).length;

    const moves = [];
    for (const initial of initialPallets) {
      const current = pallets.find((p) => p.id === initial.id);
      if (!current) continue;

      (initial.active_systems || [])
        .filter((system) => system && system.service_tag)
        .forEach((system) => {
          if (!system) return;

          const currentPallet = pallets.find((p) =>
            p.active_systems.some((s) => s?.service_tag === system.service_tag)
          );
          if (!currentPallet || currentPallet.id === initial.id) return;

          moves.push({
            service_tag: system.service_tag,
            from_pallet_number: initial.pallet_number,
            to_pallet_number: currentPallet.pallet_number,
          });
        });
    }

    const isSlotEmpty = (s) => !s || !s.service_tag; // treat placeholder as empty

    const emptyPallets = pallets
      .filter((p) => (p.active_systems || []).every(isSlotEmpty))
      .map((p) => ({ id: p.id, pallet_number: p.pallet_number }));

    const releaseList = Object.entries(releaseFlags)
      .filter(([_, val]) => val.released)
      .map(([palletId]) => {
        const pallet = pallets.find((p) => p.id === Number(palletId));
        return {
          pallet_number: pallet?.pallet_number,
        };
      });

    // STEP 1: Move systems
    for (const move of moves) {
      try {
        await moveSystemBetweenPallets({
          service_tag: move.service_tag,
          from_pallet_number: move.from_pallet_number,
          to_pallet_number: move.to_pallet_number,
        });
      } catch (err) {
        showToast(
          `Move failed for ${move.service_tag}: ${err.message}`,
          "error"
        );
        return;
      }
    }

    // Build fresh label payload for moved systems (ensures config/dpn are present)
    const systemRMALabelData = await Promise.all(
      moves.map(async (move) => {
        const toPallet = pallets.find(
          (p) => p.pallet_number === move.to_pallet_number
        );

        let systemDetails = null;
        try {
          systemDetails = await getSystem(move.service_tag);
        } catch {
          // best-effort; fallback values below
        }

        return {
          service_tag: move.service_tag,
          pallet_number: toPallet?.pallet_number || "UNKNOWN",
          shape: toPallet?.shape || null,
          dpn: systemDetails?.dpn || "UNKNOWN",
          config: systemDetails?.config || "",
          dell_customer: systemDetails?.dell_customer || "",
          ppid: systemDetails?.ppid || "",
          factory_code: toPallet?.factory_code || "N/A",
          url: `${FRONTEND_URL}${move.service_tag}`,
        };
      })
    );

    // STEP 2: Delete empty pallets
    for (const pallet of emptyPallets) {
      try {
        await deletePallet(pallet.pallet_number);
      } catch (err) {
        showToast(
          `Delete failed for ${pallet.pallet_number}: ${err.message}`,
          "error"
        );
        return;
      }
    }

    // STEP 3: Release pallets
    const releaseResults = [];
    for (const release of releaseList) {
      try {
        const released = await releasePallet(release.pallet_number);
        releaseResults.push({
          pallet_number: release.pallet_number,
          doa_number: released?.doa_number || "",
        });
      } catch (err) {
        showToast(
          `Release failed for pallet ${release.pallet_number}: ${err.message}`,
          "error"
        );
        return;
      }
    }

    // STEP 4: Print PDFs
    try {
      if (systemRMALabelData.length > 0) {
        const labelBlob = await pdf(
          <SystemRMALabel systems={systemRMALabelData} />
        ).toBlob();
        window.open(URL.createObjectURL(labelBlob));
      }

      for (const release of releaseResults) {
        const palletData = pallets.find(
          (p) => p.pallet_number === release.pallet_number
        );
        if (!palletData) continue;

        const systemsWithDetails = await Promise.all(
          (palletData.systems ?? palletData.active_systems ?? [])
            .filter((s) => s?.service_tag)
            .map(async (sys) => {
              try {
                const systemDetails = await getSystem(sys.service_tag);
                return {
                  service_tag: systemDetails.service_tag,
                  ppid: systemDetails.ppid || "UNKNOWN",
                };
              } catch (err) {
                console.error(
                  `Failed to fetch details for ${sys.service_tag}`,
                  err
                );
                return { service_tag: sys.service_tag, ppid: "" };
              }
            })
        );

        const rawPallet = {
          pallet_number: palletData.pallet_number,
          doa_number: release.doa_number,
          date_released: new Date().toISOString().split("T")[0],
          dpn: palletData.dpn || "MIXED",
          factory_id: palletData.factory_code || "N/A",
          systems: systemsWithDetails,
        };

        const enriched = enrichPalletWithBarcodes(rawPallet);
        const palletBlob = await pdf(
          <PalletPaper pallet={enriched} />
        ).toBlob();
        window.open(URL.createObjectURL(palletBlob));
      }
    } catch (err) {
      showToast(`Failed to generate PDF: ${err.message}`, "error");
      return;
    }

    // STEP 4.5: Apply staged lock changes
    const pendingLockUpdates = pallets
      .filter(
        (p) => lockFlags[p.id] !== undefined && lockFlags[p.id] !== !!p.locked
      )
      .map((p) => ({
        pallet_number: p.pallet_number,
        desired: lockFlags[p.id],
        id: p.id,
      }));

    for (const upd of pendingLockUpdates) {
      try {
        const res = await setPalletLock(upd.pallet_number, upd.desired);
        setPallets((prev) =>
          prev.map((p) =>
            p.id === upd.id
              ? { ...p, ...(res?.pallet || { locked: upd.desired }) }
              : p
          )
        );
      } catch (err) {
        showToast(
          `Failed to ${upd.desired ? "lock" : "unlock"} ${upd.pallet_number}: ${
            err.message
          }`,
          "error"
        );
        return;
      }
    }

    // STEP 5: Refetch pallets (normalize again)
    try {
      const data = await getPallets({
        filters: {
          conditions: [{ field: "status", op: "=", values: ["open"] }],
        },
      });
      const refreshed = Array.isArray(data?.data) ? data.data : [];
      const normalized = refreshed.map((p) => ({
        ...p,
        active_systems: p.active_systems ?? p.systems ?? [],
        systems: p.systems ?? p.active_systems ?? [],
      }));
      setPallets(normalized);
      setInitialPallets(structuredClone(normalized));
      setReleaseFlags({});
      setLockFlags({});
      const parts = [];
      if (moves.length > 0) parts.push(`Submitted ${moves.length} move(s)`);
      if (emptyPallets.length > 0)
        parts.push(`Deleted ${emptyPallets.length} empty pallet(s)`);
      if (lockedCount > 0 || unlockedCount > 0)
        parts.push(`Locks: ${lockedCount} locked / ${unlockedCount} unlocked`);
      showToast(parts.join(", "), "info");
    } catch (err) {
      showToast(`Failed to refresh pallets: ${err.message}`, "error");
    }
  };

  const { token } = useContext(AuthContext);

  useEffect(() => {
    if (!showCreateModal) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape" && !creatingPallet) {
        e.preventDefault();
        setShowCreateModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showCreateModal, creatingPallet]);

  useEffect(() => {
    if (!showReportModal) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape" && !reportGenerating) {
        e.preventDefault();
        setShowReportModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showReportModal, reportGenerating]);

  return (
    <>
      <Toast />
      <ConfirmDialog />
      {/* Create Pallet Modal */}
      {/* Download Report Modal */}
      {showReportModal && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => !reportGenerating && setShowReportModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3">Download Report</h3>

            <div className="space-y-5">
              <section>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  Pallet Lock Status
                </h4>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "all", label: "All" },
                    { value: "locked", label: "Locked only" },
                    { value: "unlocked", label: "Unlocked only" },
                  ].map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => setStatusFilter(opt.value)}
                      className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                        statusFilter === opt.value
                          ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-2 pt-6">
              <button
                type="button"
                disabled={reportGenerating}
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reportGenerating}
                onClick={handleDownloadReport}
                className={`px-4 py-2 rounded-md text-white text-sm font-semibold ${
                  reportGenerating
                    ? "bg-gray-400 cursor-wait"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {reportGenerating ? "Generating…" : "Download CSV"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => !creatingPallet && setShowCreateModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3">Create New Pallet</h3>
            <form onSubmit={handleCreatePallet} className="space-y-3">
              <p className="text-sm text-gray-600">
                This creates a new empty pallet. You can add any unit to it.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={creatingPallet}
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingPallet}
                  className={`px-4 py-2 rounded-md text-white text-sm font-semibold ${
                    creatingPallet
                      ? "bg-gray-400 cursor-wait"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {creatingPallet ? "Creating..." : "Create Pallet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <main className="md:max-w-10/12 mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <h1 className="text-3xl font-semibold text-gray-800">
          Shipping Manager
        </h1>

        {/* Tabs */}
        <div className="flex gap-4 mt-2 border-b border-gray-200">
          <button
            onClick={() => setTab("active")}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
              tab === "active"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Active Pallets
          </button>
          <button
            onClick={() => setTab("inactive")}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
              tab === "inactive"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Inactive Pallets
          </button>
        </div>

        {tab === "active" ? (
          <>
            <div className="flex justify-end mt-3 gap-2">
              <button
                onClick={() => setShowCreateModal(true)}
                className={`bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-s ${
                  !token ? "opacity-30 pointer-events-none" : ""
                }`}
                title="Create a new empty pallet"
              >
                Add Pallet
              </button>

              <button
                onClick={() => setShowReportModal(true)}
                disabled={reportGenerating}
                className={` px-2 py-2 rounded-lg shadow-s ${
                  reportGenerating
                    ? "bg-green-200 text-green-500 cursor-wait"
                    : "bg-green-600 hover:bg-green-700  text-white px-4 "
                }`}
                title="Download CSV of units from current open pallets"
              >
                {reportGenerating ? "Generating..." : "Download Report"}
              </button>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => setActiveDragData(e.active.data.current)}
              onDragEnd={handleDragEnd}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.isArray(pallets) &&
                  pallets.map((pallet) => (
                    <PalletGrid
                      key={`${pallet.id}-${!!releaseFlags[pallet.id]}-${
                        lockFlags[pallet.id] ?? "nc"
                      }`}
                      pallet={pallet}
                      releaseFlags={releaseFlags}
                      setReleaseFlags={setReleaseFlags}
                      lockFlags={lockFlags}
                      setLockFlags={setLockFlags}
                    />
                  ))}
              </div>

              <DragOverlay>
                {activeDragData?.system ? (
                  <SystemBox
                    serviceTag={activeDragData.system.service_tag}
                    dpn={activeDragData.system.dpn}
                    dellCustomer={activeDragData.system.dell_customer}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>

            <div className="w-full flex justify-end mt-6">
              <button
                onClick={handleSubmit}
                disabled={!palletsChanged}
                className={`px-6 py-2 rounded-lg font-semibold text-white transition ${
                  palletsChanged
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-gray-400 cursor-not-allowed"
                }`}
              >
                Submit Changes
              </button>
              <button
                onClick={() => {
                  setPallets(structuredClone(initialPallets));
                  setReleaseFlags({});
                  setLockFlags({});
                  showToast("Changes have been reverted.", "info");
                }}
                disabled={!palletsChanged}
                className={`ml-2 px-4 py-2 rounded font-semibold transition ${
                  palletsChanged
                    ? "bg-gray-500 text-white hover:bg-gray-600"
                    : "bg-gray-300 text-gray-400 cursor-not-allowed"
                }`}
              >
                Reset
              </button>
            </div>
          </>
        ) : (
          <SearchContainerSS
            title="Released Pallets"
            displayOrder={[
              "pallet_number",
              "doa_number",
              "created_at",
              "released_at",
            ]}
            visibleFields={[
              "pallet_number",
              "doa_number",
              "created_at",
              "released_at",
            ]}
            linkType="external"
            fetchData={fetchReleasedPallets}
            truncate={true}
            defaultSortBy="released_at"
            defaultSortAsc={false}
          />
        )}
      </main>
    </>
  );
}
