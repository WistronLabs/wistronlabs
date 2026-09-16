import { useEffect, useRef, useState, useContext } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter,
  pointerWithin, useSensor, useSensors, useDroppable, useDraggable,
} from "@dnd-kit/core";
import Select from "react-select";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { AuthContext } from "../context/AuthContext";
import useTerminalApi from "../hooks/useTerminalApi";
import TerminalPanel from "./TerminalPanel";
import { button, TerminalIcon } from "./terminalControls";
import {
  loadTerminalLayout, normalizeTerminalLayout, terminalModes, addTerminalGroup,
  placeTerminal, addSingle, removeTerminalGroup, closeTerminal,
  resizeTerminalGroup, changeTerminalMode, renameTerminalView,
} from "../utils/terminalLayout";

const terminalSelectStyles = {
        control: (base, state) => ({ ...base, minHeight: 40, borderRadius: 8, borderColor: state.isFocused ? "#3b82f6" : "#d1d5db", boxShadow: state.isFocused ? "0 0 0 1px #3b82f6" : "0 1px 2px #0000000d", "&:hover": { borderColor: "#3b82f6" } }),
        menu: (base) => ({ ...base, borderRadius: 8, overflow: "hidden", zIndex: 30 }),
        option: (base, state) => ({ ...base, padding: "10px 12px", backgroundColor: state.isFocused ? "#eff6ff" : "white", color: "#374151", cursor: "pointer", ":active": { backgroundColor: "#dbeafe" } }),
        indicatorSeparator: () => ({ display: "none" }),
      };

const layoutOptions = Object.entries(terminalModes).map(([value, { label }]) => ({ value, label }));

function LayoutIcon({ mode }) {
  return <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="2.5" y="3" width="15" height="14" rx="2" />
    {(mode === "columns" || mode === "grid") && <path d="M10 3v14" />}
    {(mode === "rows" || mode === "grid") && <path d="M2.5 10h15" />}
  </svg>;
}

function viewLabel(view) {
  if (view.name) return view.name;
  const stations = view.slots.filter(Boolean);
  return stations.length === 0 ? "New view"
    : stations.length === 1 ? `Station ${stations[0]}`
      : stations.length === 2 ? `Stations ${stations.join(", ")}` : `${stations.length} stations`;
}

function ViewTab({ view, selected, previewed, onSelect, onClose, onNavigate, onRename }) {
  const { setNodeRef, isOver } = useDroppable({ id: `view:${view.id}`, data: { view: view.id } });
  const label = viewLabel(view);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const startRename = () => { setDraft(label); setEditing(true); };
  return <div ref={setNodeRef} className={`flex shrink-0 items-center rounded-t-md border-b-2 transition-colors ${isOver || previewed ? "border-blue-500 bg-blue-100 text-blue-700" : selected ? "border-blue-600 bg-blue-50 text-blue-700" : "border-transparent text-gray-500 hover:bg-gray-50"}`}>
    {editing ? <form className="flex items-center gap-1 px-2 py-1" onSubmit={(e) => { e.preventDefault(); onRename(draft); setEditing(false); }}>
      <input aria-label="View name" autoFocus maxLength={60} value={draft} onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(false); } }}
        className="w-40 rounded border border-blue-300 bg-white px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      <button type="submit" className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">Save</button>
      <button type="button" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" onClick={() => setEditing(false)}>Cancel</button>
      {view.name && <button type="button" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" onClick={() => { onRename(""); setEditing(false); }}>Reset to default</button>}
    </form> : <>
    <button role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1}
      aria-label={`View: ${label}`} title={`${terminalModes[view.mode].label}${view.slots.some(Boolean) ? ` · Stations ${view.slots.filter(Boolean).join(", ")}` : ""}`}
      className="flex items-center gap-2 rounded-tl-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
      onClick={onSelect} onDoubleClick={startRename} onKeyDown={onNavigate}>
      <LayoutIcon mode={view.mode} /><span className="max-w-56 truncate">{label}</span>
    </button>
    <button aria-label={`Rename view: ${label}`} title="Rename view" onClick={startRename}
      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 4 4 4M3 17l4-1L17 6a2.8 2.8 0 0 0-4-4L3 12v5Z" /></svg>
    </button>
    </>}
    <button aria-label={`Close view: ${label}`} title="Close view" onClick={onClose}
      className="mr-1 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <TerminalIcon kind="close" className="h-3.5 w-3.5" />
    </button>
  </div>;
}

function NewViewButton({ onClick, disabled }) {
  const { setNodeRef, isOver } = useDroppable({ id: "new-view", data: { newView: true }, disabled });
  return <button ref={setNodeRef} aria-label="Add terminal view" title="Add a view, or drop a terminal here" disabled={disabled} onClick={onClick}
    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 ${isOver ? "border-blue-500 bg-blue-100 text-blue-700" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`}>+</button>;
}

function EmptyPanel({ index, stations, layout, onChoose }) {
  const used = new Set(layout.groups.flatMap((g) => g.slots).filter(Boolean));
  return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6">
    <TerminalIcon className="h-6 w-6 text-gray-400" />
    <Select
      aria-label={`Panel ${index + 1} station`}
      instanceId={`terminal-station-${index}`}
      className="w-full max-w-sm text-sm"
      classNamePrefix="terminal-station-select"
      placeholder="Search stations…"
      value={null}
      isSearchable
      isDisabled={used.size >= 32}
      maxMenuHeight={240}
      menuPlacement="auto"
      noOptionsMessage={() => "No available stations"}
      options={stations.filter((s) => !used.has(String(s.station_name)))
        .sort((a, b) => String(a.station_name).localeCompare(String(b.station_name), undefined, { numeric: true }))
        .map((s) => ({ value: String(s.station_name), label: `Station ${s.station_name}${s.system_service_tag ? ` ${s.system_service_tag}` : ""}`, station: s }))}
      onChange={(option) => { if (option) onChoose(option.value); }}
      formatOptionLabel={({ station }) => <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Station {station.station_name}</span>
        <span className="truncate text-xs text-gray-500">{station.system_service_tag || "No System Attached"}</span>
      </div>}
      styles={terminalSelectStyles}
    />
  </div>;
}

function PanelSlot({ view, index, station, visible, columns, dragging, stations, layout, request, onClose, onChoose }) {
  const id = station ? `station:${station.station_name}` : `empty:${view.id}:${index}`;
  const data = { group: view.id, index, station: station ? String(station.station_name) : null };
  const draggable = useDraggable({ id, data, disabled: !station || !visible });
  const droppable = useDroppable({ id, data, disabled: !visible });
  // Keep drag registrations mounted while hovering another view. Hidden panels
  // disconnect; the drag overlay remains available until the user drops/cancels.
  return <div hidden={!visible} ref={(node) => { draggable.setNodeRef(node); droppable.setNodeRef(node); }}
    className={`min-h-0 min-w-0 rounded-lg ${dragging ? "pointer-events-none" : ""} ${draggable.isDragging ? "opacity-40" : ""} ${droppable.isOver ? "ring-2 ring-blue-400" : ""}`}
    style={{ gridColumn: columns ? index % 2 + 1 : 1, gridRow: columns ? Math.floor(index / 2) + 1 : index + 1 }}>
    {visible && (station ? <TerminalPanel station={station} request={request} onClose={onClose} dragHandle={draggable} singleView={view.mode === "single"} />
      : <EmptyPanel index={index} stations={stations} layout={layout} onChoose={onChoose} />)}
  </div>;
}

export default function TerminalWorkspace({ stations, initialStation, popout }) {
  const { user } = useContext(AuthContext);
  const request = useTerminalApi();
  const key = `terminal-layout:${import.meta.env.VITE_LOCATION}:${user?.id}${popout ? `:popout:${initialStation}` : ""}`;
  const [layout, setLayout] = useState(() => loadTerminalLayout(key, initialStation));
  const [draggedStation, setDraggedStation] = useState(null);
  const [previewView, setPreviewView] = useState(null);
  const hoverTimer = useRef(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState(false);
  const [workspaceFullScreen, setWorkspaceFullScreen] = useState(false);
  const [viewError, setViewError] = useState("");
  const container = useRef(null);
  const frame = useRef(null);
  const tabs = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* Storage may be disabled. */ }
  }, [key, layout]);
  useEffect(() => {
    const sync = () => setWorkspaceFullScreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", sync);
    return () => { document.removeEventListener("fullscreenchange", sync); clearTimeout(hoverTimer.current); };
  }, []);
  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [layout.activeGroup]);
  const known = new Map(stations.map((s) => [String(s.station_name), s]));
  const groups = layout.groups.map((g) => ({ ...g, slots: g.slots.map((id) => known.has(id) ? id : null) }));
  const current = groups.find((g) => g.id === (previewView || layout.activeGroup)) || groups[0];
  const columns = current?.mode === "columns" || current?.mode === "grid";
  const rows = current?.mode === "rows" || current?.mode === "grid";
  function change(operation) {
    setLayout((previous) => normalizeTerminalLayout(operation({ ...previous, groups: previous.groups.map((g) => ({ ...g, slots: g.slots.map((id) => known.has(id) ? id : null) })) })));
  }
  const selectView = (id) => change((state) => ({ ...state, activeGroup: id }));
  const place = (station, viewId, index) => change((state) => placeTerminal(state, station, viewId, index));
  function finishDrag() {
    clearTimeout(hoverTimer.current);
    setDraggedStation(null);
    setPreviewView(null);
  }
  function resize(event, axis) {
    event.preventDefault();
    const rect = container.current.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const groupId = current.id;
    const target = event.currentTarget;
    const move = (e) => {
      const value = axis === "column" ? ((e.clientX - rect.left) / rect.width) * 100 : ((e.clientY - rect.top) / rect.height) * 100;
      change((state) => resizeTerminalGroup(state, groupId, axis, value));
    };
    const end = () => {
      setDragging(false);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }
  return (
    <section ref={frame} className="space-y-3 bg-white [&:fullscreen]:overflow-y-auto [&:fullscreen]:p-4">
      <DndContext sensors={sensors}
        collisionDetection={(args) => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)}
        onDragStart={({ active }) => { setDraggedStation(active.data.current?.station); setPreviewView(null); }}
        onDragOver={({ over }) => {
          clearTimeout(hoverTimer.current);
          const targetView = over?.data.current?.view;
          if (targetView && targetView !== current?.id) hoverTimer.current = setTimeout(() => setPreviewView(targetView), 300);
        }}
        onDragCancel={finishDrag}
        onDragEnd={({ active, over }) => {
          const station = draggedStation || active.data.current?.station;
          const target = over?.data.current;
          finishDrag();
          if (!station || !over || active.id === over.id) return;
          if (target?.newView) change((state) => addSingle(state, station));
          else if (target?.group) place(station, target.group, target.index);
        }}>
        <div className="flex items-center gap-2 border-b border-gray-200 pb-1">
          <div ref={tabs} className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Terminal views">
            {groups.map((view, index) => <ViewTab key={view.id} view={view} selected={layout.activeGroup === view.id} previewed={previewView === view.id}
              onRename={(name) => change((state) => renameTerminalView(state, view.id, name))}
              onSelect={() => selectView(view.id)} onClose={() => change((state) => removeTerminalGroup(state, view.id))}
              onNavigate={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const next = e.key === "Home" ? 0 : e.key === "End" ? groups.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + groups.length) % groups.length;
                selectView(groups[next].id);
                tabs.current?.querySelectorAll('[role="tab"]')[next]?.focus({ preventScroll: true });
              }} />)}
          </div>
          <NewViewButton disabled={groups.length >= 32} onClick={() => change((state) => addTerminalGroup(state, "single"))} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="terminal-view-layout" className="flex items-center gap-2 text-sm font-medium text-gray-600">
            Layout
            <Select
              inputId="terminal-view-layout"
              instanceId="terminal-view-layout"
              aria-label="View layout"
              className="w-44 text-sm font-normal"
              classNamePrefix="terminal-layout-select"
              value={layoutOptions.find((option) => option.value === (current?.mode || "single"))}
              options={layoutOptions}
              formatOptionLabel={({ value, label }) => (
                <span className="flex items-center gap-2">
                  <LayoutIcon mode={value} />
                  <span>{label}</span>
                </span>
              )}
              isSearchable={false}
              isDisabled={!current || !!draggedStation}
              styles={terminalSelectStyles}
              onChange={(option) => { if (option && current) change((state) => changeTerminalMode(state, current.id, option.value)); }}
            />
          </label>
          <button className={`${button} inline-flex items-center gap-2`} onClick={async () => {
            setViewError("");
            try {
              if (workspaceFullScreen) await document.exitFullscreen();
              else {
                const target = current?.mode === "single"
                  ? frame.current.querySelector("[data-terminal-panel]") || frame.current
                  : frame.current;
                if (target.requestFullscreen) await target.requestFullscreen();
                else setViewError("Full screen is unavailable in this browser.");
              }
            } catch { setViewError("Could not enter full screen."); }
          }}><TerminalIcon kind="fullscreen" />{workspaceFullScreen ? "Exit full screen" : "Full screen"}</button>
        </div>
        {viewError && <p role="alert" className="text-sm text-red-700">{viewError}</p>}
        {!current ? <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-12 text-sm text-gray-500">
          <p>Add a view to open a terminal.</p>
          <button className={button} onClick={() => change((state) => addTerminalGroup(state, "single"))}>+ Add view</button>
        </div> : <div ref={container} className="relative grid gap-2" style={{
          height: rows ? "max(968px, calc(130vh + 8px))" : "max(480px, 65vh)",
          gridTemplateColumns: columns ? `minmax(0, ${current.column}fr) minmax(0, ${100 - current.column}fr)` : "minmax(0, 1fr)",
          gridTemplateRows: rows ? `minmax(0, ${current.row}fr) minmax(0, ${100 - current.row}fr)` : "minmax(0, 1fr)",
        }}>
          {/* Stable station keys and DOM order preserve visible iframe connections
              when swapping panels or changing a layout. Hidden views disconnect. */}
          {groups.flatMap((view) => view.slots.map((id, index) => ({ view, id, index, key: id || `empty-${view.id}-${index}` })))
            .sort((a, b) => a.key.localeCompare(b.key)).map(({ view, id, index, key: panelKey }) => (
              <PanelSlot key={panelKey} view={view} index={index} station={known.get(id)} visible={view.id === current.id}
                columns={columns} dragging={dragging || !!draggedStation} stations={stations} layout={layout} request={request}
                onClose={() => change((state) => closeTerminal(state, id))} onChoose={(station) => place(station, view.id, index)} />
            ))}
            {columns && <div role="separator" aria-label="Resize terminal columns" aria-orientation="vertical" aria-valuenow={current.column} aria-valuemin={25} aria-valuemax={75} tabIndex={0}
              onKeyDown={(e) => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); change((state) => resizeTerminalGroup(state, current.id, "column", current.column + (e.key === "ArrowRight" ? 2 : -2))); } }}
              onPointerDown={(e) => resize(e, "column")}
              className="absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none rounded outline-none before:absolute before:inset-y-2 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:rounded-full before:bg-gray-200 before:transition-colors hover:before:bg-blue-400 focus-visible:before:bg-blue-500 active:before:bg-blue-500"
              style={{ left: `calc(${current.column}% + ${4 - current.column * 0.08}px)` }} />}
            {rows && <div role="separator" aria-label="Resize terminal rows" aria-orientation="horizontal" aria-valuenow={current.row} aria-valuemin={25} aria-valuemax={75} tabIndex={0}
              onKeyDown={(e) => { if (["ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); change((state) => resizeTerminalGroup(state, current.id, "row", current.row + (e.key === "ArrowDown" ? 2 : -2))); } }}
              onPointerDown={(e) => resize(e, "row")}
              className="absolute inset-x-0 z-10 h-2 -translate-y-1/2 cursor-row-resize touch-none rounded outline-none before:absolute before:inset-x-2 before:top-1/2 before:h-0.5 before:-translate-y-1/2 before:rounded-full before:bg-gray-200 before:transition-colors hover:before:bg-blue-400 focus-visible:before:bg-blue-500 active:before:bg-blue-500"
              style={{ top: `calc(${current.row}% + ${4 - current.row * 0.08}px)` }} />}
        </div>}
        <DragOverlay dropAnimation={null}>{draggedStation && <div className="rounded-lg border border-blue-400 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 shadow-lg">Station {draggedStation}</div>}</DragOverlay>
      </DndContext>
    </section>
  );
}
