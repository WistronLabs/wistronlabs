import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTerminalLayout, loadTerminalLayout, addTerminalGroup, placeTerminal,
  addSingle, removeTerminalGroup, closeTerminal, resizeTerminalGroup, changeTerminalMode, renameTerminalView,
} from "../src/utils/terminalLayout.js";
const stations = (layout) => layout.groups.flatMap((g) => g.slots).filter(Boolean);
const storage = (value) => ({ getItem: () => JSON.stringify(value) });

test("migrates the old ordered-tab layout without losing groups, selection or divider ratios", () => {
  const layout = normalizeTerminalLayout({ open: ["1", "2", "3", "4", "5", "6"], active: "6", mode: "grid", column: 60, row: 40 });
  assert.equal(layout.version, 2);
  assert.deepEqual(layout.groups.map((g) => g.slots), [["1", "2", "3", "4"], ["5", "6", null, null]]);
  assert.equal(layout.activeGroup, layout.groups[1].id);
  assert.equal(layout.groups[0].column, 60);
  assert.equal(layout.groups[0].row, 40);
  assert.deepEqual(normalizeTerminalLayout(layout), layout);
});

test("normalization validates ids, duplicate memberships, modes and divider bounds", () => {
  const layout = normalizeTerminalLayout({ groups: [
    { id: "same", mode: "columns", slots: [12, "../bad"], column: 1000 },
    { id: "same", mode: "grid", slots: ["12", "18", "18", "0"], row: -50 },
    { id: "bad/id", mode: "__proto__", slots: ["20"] }, null,
  ] });
  assert.deepEqual(layout.groups.map((g) => g.slots), [["12", null], [null, "18", null, null], ["20"]]);
  assert.equal(new Set(layout.groups.map((g) => g.id)).size, 3);
  assert.equal(layout.groups[0].column, 75);
  assert.equal(layout.groups[1].row, 25);
  assert.equal(layout.groups[2].mode, "single");
  assert.equal(stations(normalizeTerminalLayout({ open: Array.from({ length: 50 }, (_, i) => i + 1) })).length, 32);
  assert.deepEqual(normalizeTerminalLayout(null).groups, []);
});

test("restores saved layouts and tolerates unavailable or malformed storage", () => {
  for (const provider of [{ getItem: () => "{" }, { getItem() { throw new Error(); } }, storage(null)]) {
    assert.deepEqual(loadTerminalLayout("key", null, provider).groups, []);
  }
  const saved = { open: ["1", "2", "3", "4", "5"], mode: "grid" };
  const result = loadTerminalLayout("key", "5", storage(saved));
  assert.deepEqual(stations(result), saved.open);
  assert.equal(result.activeGroup, result.groups[1].id);
  const added = loadTerminalLayout("key", "6", storage(result));
  assert.equal(added.groups[2].mode, "single");
  assert.deepEqual(added.groups[0], result.groups[0]);
  assert.equal(added.activeGroup, added.groups[2].id);
});

test("mixed layouts retain empty slots and independently adjustable dividers", () => {
  let layout = normalizeTerminalLayout();
  for (const mode of ["single", "columns", "rows", "grid"]) layout = addTerminalGroup(layout, mode);
  assert.deepEqual(layout.groups.map((g) => g.slots.length), [1, 2, 2, 4]);
  layout = resizeTerminalGroup(layout, layout.groups[1].id, "column", 60);
  assert.deepEqual(layout.groups.map((g) => g.column), [50, 60, 50, 50]);
  assert.deepEqual(normalizeTerminalLayout(layout), layout);
});

test("moving from singles into empty slots and swapping occupied slots never duplicates stations", () => {
  let layout = normalizeTerminalLayout({ open: ["1", "2", "3"] });
  layout = addTerminalGroup(layout, "columns");
  const group = layout.activeGroup;
  layout = placeTerminal(layout, "1", group, 0);
  assert.equal(layout.groups.length, 3, "empty source single is removed");
  layout = placeTerminal(layout, "2", group, 1);
  layout = placeTerminal(layout, "3", group, 0);
  assert.deepEqual(layout.groups.find((g) => g.id === group).slots, ["3", "2"]);
  assert.deepEqual(layout.groups.find((g) => g.mode === "single").slots, ["1"]);
  layout = placeTerminal(layout, "3", group, 1);
  assert.deepEqual(layout.groups.find((g) => g.id === group).slots, ["2", "3"]);
  const before = layout;
  assert.equal(placeTerminal(layout, "99", group, 0), before, "new station cannot overwrite an occupied slot");
  assert.equal(placeTerminal(layout, "1", group, 99), before);
  assert.equal(placeTerminal(layout, "1", group, -1), before);
  assert.equal(placeTerminal(layout, "1", group, 0.5), before);
  assert.equal(placeTerminal(layout, "1", "missing", 0), before);
  assert.deepEqual(stations(layout).sort(), ["1", "2", "3"]);
});

test("moving the last station removes any emptied source view", () => {
  let layout = normalizeTerminalLayout({ groups: [
    { id: "source", mode: "grid", slots: ["1", null, null, null] },
    { id: "target", mode: "columns", slots: ["2", null] },
  ], activeGroup: "source" });
  layout = placeTerminal(layout, "1", "target", 1);
  assert.equal(layout.groups.length, 1);
  assert.equal(layout.activeGroup, "target");
  assert.deepEqual(layout.groups[0].slots, ["2", "1"]);
});

test("close view removes its stations; close terminal removes only its panel", () => {
  let layout = normalizeTerminalLayout({ open: ["1", "2", "3", "4", "5", "6"], mode: "grid" });
  const first = layout.activeGroup;
  layout = closeTerminal(layout, "2");
  assert.deepEqual(layout.groups[0].slots, ["1", null, "3", "4"]);
  layout = removeTerminalGroup(layout, first);
  assert.deepEqual(stations(layout), ["5", "6"]);
  assert.equal(layout.activeGroup, layout.groups[0].id);
  layout = closeTerminal(closeTerminal(layout, "5"), "6");
  assert.deepEqual(layout.groups, []);
});

test("growing a view adds empty slots; shrinking preserves overflow in adjacent tabs", () => {
  let layout = normalizeTerminalLayout({ open: ["1", "2", "3", "4", "5"], mode: "grid" });
  const id = layout.activeGroup;
  const other = layout.groups[1];
  layout = changeTerminalMode(layout, id, "columns");
  assert.deepEqual(layout.groups.map((g) => g.slots), [["1", "2"], ["3"], ["4"], ["5", null, null, null]]);
  assert.equal(layout.activeGroup, id);
  assert.deepEqual(layout.groups[3], other);
  layout = changeTerminalMode(layout, id, "grid");
  assert.deepEqual(layout.groups[0].slots, ["1", "2", null, null]);
  layout = changeTerminalMode(layout, id, "rows");
  assert.deepEqual(stations(layout), ["1", "2", "3", "4", "5"]);
  assert.equal(layout.groups.length, 4);
});

test("at the station limit, moving existing stations remains possible", () => {
  let layout = normalizeTerminalLayout({ open: Array.from({ length: 32 }, (_, i) => String(i + 1)), mode: "grid" });
  layout = addTerminalGroup(layout, "columns");
  assert.equal(placeTerminal(layout, "99", layout.activeGroup, 0), layout);
  layout = placeTerminal(layout, "1", layout.activeGroup, 0);
  assert.equal(stations(layout).length, 32);
  assert.equal(new Set(stations(layout)).size, 32);
  assert.equal(stations(addSingle(layout, "1")).length, 32);
});

test("view names persist through layout changes and reset to automatic titles", () => {
  let layout = normalizeTerminalLayout({ open: ["1", "2", "3", "4"], mode: "grid" });
  const id = layout.activeGroup;
  layout = renameTerminalView(layout, id, "  Debug rack  ");
  assert.equal(layout.groups[0].name, "Debug rack");
  assert.deepEqual(stations(layout), ["1", "2", "3", "4"]);
  assert.equal(loadTerminalLayout("key", null, storage(layout)).groups[0].name, "Debug rack");
  layout = changeTerminalMode(layout, id, "columns");
  assert.equal(layout.groups[0].name, "Debug rack");
  assert.equal(layout.groups[1].name, undefined);
  layout = renameTerminalView(layout, id, "");
  assert.equal(Object.hasOwn(layout.groups[0], "name"), false);
  assert.deepEqual(stations(layout), ["1", "2", "3", "4"]);
});
