import test from "node:test";
import assert from "node:assert/strict";
import { computeActiveLocationsPerDay } from "../src/utils/activeLocationChartData.js";

test("customer breakdown follows active location snapshots and daily movements", () => {
  const days = computeActiveLocationsPerDay(
    [
      { service_tag: "A", location: "Received", dell_customer: "Alpha" },
      { service_tag: "B", location: "Pending Parts", dell_customer: "Beta" },
    ],
    [
      { service_tag: "A", to_location: "In L10", dell_customer: "Alpha", changed_at: "2026-09-21T15:00:00Z" },
      { service_tag: "B", to_location: "RMA PID", dell_customer: "Beta", changed_at: "2026-09-21T16:00:00Z" },
      { service_tag: "C", to_location: "Received", dell_customer: "Alpha", changed_at: "2026-09-22T18:00:00Z" },
      { service_tag: "D", to_location: "Received", dell_customer: "", changed_at: "2026-09-23T02:00:00Z" },
    ],
    ["Received", "In L10", "Pending Parts"],
    "America/Chicago",
    { localtime: "09/22/2026, 09:00:00 PM" },
    "2026-09-20",
    "2026-09-22",
  );

  assert.deepEqual(days.map(({ date, customerCounts }) => ({ date, customerCounts })), [
    { date: "2026-09-20", customerCounts: { Alpha: 1, Beta: 1 } },
    { date: "2026-09-21", customerCounts: { Alpha: 1 } },
    { date: "2026-09-22", customerCounts: { Alpha: 2, Unassigned: 1 } },
  ]);
  days.forEach((day) => {
    const locationTotal = Object.values(day.counts).reduce((sum, count) => sum + count, 0);
    const customerTotal = Object.values(day.customerCounts).reduce((sum, count) => sum + count, 0);
    assert.equal(customerTotal, locationTotal);
  });
});
