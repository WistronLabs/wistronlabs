export const terminalModes = {
  single: { label: "Single", size: 1 },
  columns: { label: "Side by side", size: 2 },
  rows: { label: "Stacked", size: 2 },
  grid: { label: "Four panels", size: 4 },
};
const stationId = (id) => /^[1-9]\d{0,5}$/.test(String(id)) ? String(id) : null;
const ratio = (value) => Number.isFinite(Number(value))
  ? Math.min(75, Math.max(25, Number(value))) : 50;
const newId = (groups) => {
  let index = 1;
  while (groups.some((group) => group.id === `group-${index}`)) index++;
  return `group-${index}`;
};
const makeGroup = (id, mode = "single", slots = []) => ({
  id, mode, slots: Array.from({ length: terminalModes[mode].size }, (_, i) => slots[i] || null),
  column: 50, row: 50,
});

export function normalizeTerminalLayout(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const seen = new Set();
  const groups = [];
  let input = value.groups;
  // Migrate the previous ordered-tab layout into explicit groups once.
  if (!Array.isArray(input)) {
    const open = [...new Set((Array.isArray(value.open) ? value.open : []).map(stationId).filter(Boolean))].slice(0, 32);
    const mode = Object.hasOwn(terminalModes, value.mode) ? value.mode : "single";
    const size = terminalModes[mode].size;
    input = Array.from({ length: Math.ceil(open.length / size) }, (_, i) => ({
      ...makeGroup(`group-${i + 1}`, mode, open.slice(i * size, (i + 1) * size)),
      column: value.column, row: value.row,
    }));
  }
  for (const item of input.slice(0, 32)) {
    if (!item || typeof item !== "object") continue;
    const mode = Object.hasOwn(terminalModes, item.mode) ? item.mode : "single";
    const id = typeof item.id === "string" && /^[\w-]{1,64}$/.test(item.id) && !groups.some((g) => g.id === item.id)
      ? item.id : newId(groups);
    const slots = Array.from({ length: terminalModes[mode].size }, (_, index) => {
      const station = stationId(item.slots?.[index]);
      if (!station || seen.has(station) || seen.size >= 32) return null;
      seen.add(station);
      return station;
    });
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 60) : "";
    groups.push({ id, mode, slots, column: ratio(item.column), row: ratio(item.row), ...(name ? { name } : {}) });
  }
  const active = groups.some((g) => g.id === value.activeGroup)
    ? value.activeGroup : groups.find((g) => g.slots.includes(String(value.active)))?.id || groups[0]?.id;
  return { version: 2, groups, activeGroup: active };
}

export function loadTerminalLayout(key, initialStation, storage = localStorage) {
  let saved;
  try { saved = normalizeTerminalLayout(JSON.parse(storage.getItem(key))); }
  catch { saved = normalizeTerminalLayout(); }
  const station = stationId(initialStation);
  if (station) {
    const existing = saved.groups.find((g) => g.slots.includes(station));
    if (existing) return { ...saved, activeGroup: existing.id };
    return addSingle(saved, station);
  }
  return saved;
}

export function addTerminalGroup(layout, mode) {
  if (layout.groups.length >= 32 || !Object.hasOwn(terminalModes, mode)) return layout;
  const group = makeGroup(newId(layout.groups), mode);
  return { ...layout, groups: [...layout.groups, group], activeGroup: group.id };
}

export function placeTerminal(layout, station, groupId, slot) {
  station = stationId(station);
  const target = layout.groups.find((g) => g.id === groupId);
  if (!station || !target || !Number.isInteger(slot) || slot < 0 || slot >= target.slots.length) return layout;
  const source = layout.groups.find((g) => g.slots.includes(station));
  if (!source && layout.groups.flatMap((g) => g.slots).filter(Boolean).length >= 32) return layout;
  const previous = target.slots[slot];
  if (previous === station) return layout;
  // A new station is only added to an empty slot. Dragging an existing one swaps.
  if (previous && !source) return layout;
  const groups = layout.groups.map((g) => ({ ...g, slots: [...g.slots] }));
  if (source) groups.find((g) => g.id === source.id).slots[source.slots.indexOf(station)] = previous;
  groups.find((g) => g.id === groupId).slots[slot] = station;
  return normalizeTerminalLayout({
    ...layout,
    groups: groups.filter((g) => !(source?.id === g.id && g.slots.every((id) => !id))),
    activeGroup: groupId,
  });
}

export function addSingle(layout, station) {
  const source = layout.groups.find((g) => g.slots.includes(String(station)));
  if (source?.mode === "single") return { ...layout, activeGroup: source.id };
  const added = addTerminalGroup(layout, "single");
  if (added === layout) return layout;
  return placeTerminal(added, station, added.activeGroup, 0);
}

// Closing a view disconnects its panels; it never creates replacement views.
export function removeTerminalGroup(layout, id) {
  const index = layout.groups.findIndex((g) => g.id === id);
  if (index < 0) return layout;
  const groups = layout.groups.filter((g) => g.id !== id);
  return normalizeTerminalLayout({ ...layout, groups,
    activeGroup: layout.activeGroup === id ? groups[Math.min(index, groups.length - 1)]?.id : layout.activeGroup });
}

export function closeTerminal(layout, station) {
  const source = layout.groups.find((g) => g.slots.includes(station));
  if (!source) return layout;
  const updated = { ...layout, groups: layout.groups.map((g) => ({ ...g, slots: g.slots.map((s) => s === station ? null : s) })) };
  if (updated.groups.find((g) => g.id === source.id).slots.every((s) => !s)) return removeTerminalGroup(updated, source.id);
  return normalizeTerminalLayout(updated);
}

export function changeTerminalMode(layout, id, mode) {
  const index = layout.groups.findIndex((g) => g.id === id);
  if (index < 0 || !Object.hasOwn(terminalModes, mode)) return layout;
  const source = layout.groups[index];
  if (source.mode === mode) return layout;
  const size = terminalModes[mode].size;
  const groups = layout.groups.map((g) => g.id === id ? { ...g, mode,
    slots: Array.from({ length: size }, (_, i) => source.slots[i] || null),
  } : g);
  const overflow = [];
  for (const station of source.slots.slice(size).filter(Boolean)) {
    overflow.push(makeGroup(newId([...groups, ...overflow]), "single", [station]));
  }
  // Preserve occupied views at the cap by removing unused empty ones first.
  while (groups.length + overflow.length > 32) {
    const empty = groups.findIndex((g) => g.id !== id && g.slots.every((s) => !s));
    if (empty < 0) return layout;
    groups.splice(empty, 1);
  }
  groups.splice(groups.findIndex((g) => g.id === id) + 1, 0, ...overflow);
  return normalizeTerminalLayout({ ...layout, groups });
}

export function resizeTerminalGroup(layout, id, axis, value) {
  if (!["column", "row"].includes(axis)) return layout;
  return { ...layout, groups: layout.groups.map((g) => g.id === id ? { ...g, [axis]: ratio(value) } : g) };
}

export function renameTerminalView(layout, id, name) {
  return normalizeTerminalLayout({ ...layout, groups: layout.groups.map((view) =>
    view.id === id ? { ...view, name } : view,
  ) });
}
