import { DateTime } from "luxon";

const UNASSIGNED_CUSTOMER = "Unassigned";

export function computeActiveLocationsPerDay(
  snapshot,
  history,
  activeLocationNames,
  timezone,
  serverTime,
  chartStartDate,
  chartEndDate,
) {
  function normalize(entry) {
    return {
      tag: entry.service_tag,
      loc: entry.to_location ?? entry.location ?? null,
      customer: String(entry.dell_customer || "").trim() || UNASSIGNED_CUSTOMER,
      ts: entry.changed_at ?? entry.as_of ?? null,
    };
  }

  const parsedServerNow = DateTime.fromFormat(
    String(serverTime?.localtime || ""),
    "MM/dd/yyyy, hh:mm:ss a",
    { zone: timezone },
  );
  const today = (
    parsedServerNow.isValid ? parsedServerNow : DateTime.now().setZone(timezone)
  ).startOf("day");
  const selectedStart = DateTime.fromISO(String(chartStartDate || ""), {
    zone: timezone,
  }).startOf("day");
  const selectedEnd = DateTime.fromISO(String(chartEndDate || ""), {
    zone: timezone,
  }).startOf("day");
  const startDay = selectedStart.isValid ? selectedStart : today.minus({ days: 6 });
  const endDay = selectedEnd.isValid ? selectedEnd : today;
  const startKey = startDay.toISODate();
  const endKey = endDay.toISODate();
  const activeLocations = new Set(activeLocationNames);

  const historyByDay = new Map();
  history.forEach((rawEntry) => {
    const entry = normalize(rawEntry);
    if (!entry.ts) return;

    const dt = DateTime.fromISO(entry.ts, { zone: "utc" }).setZone(timezone);
    if (!dt.isValid) return;

    const dayKey = dt.startOf("day").toISODate();
    if (dayKey < startKey || dayKey > endKey) return;

    if (!historyByDay.has(dayKey)) historyByDay.set(dayKey, new Map());
    const tagMap = historyByDay.get(dayKey);
    if (!tagMap.has(entry.tag)) tagMap.set(entry.tag, []);
    tagMap.get(entry.tag).push(entry);
  });

  const currentState = new Map();
  const results = [];

  function applyChanges(changes) {
    if (!changes) return;
    for (const events of changes.values()) {
      events.sort((a, b) => DateTime.fromISO(a.ts) - DateTime.fromISO(b.ts));
      for (const { tag, loc, customer } of events) {
        if (activeLocations.has(loc)) currentState.set(tag, { loc, customer });
        else currentState.delete(tag);
      }
    }
  }

  function addDay(date) {
    const counts = Object.fromEntries(activeLocationNames.map((loc) => [loc, 0]));
    const customerCounts = {};
    for (const { loc, customer } of currentState.values()) {
      counts[loc]++;
      customerCounts[customer] = (customerCounts[customer] || 0) + 1;
    }
    results.push({ date, counts, customerCounts });
  }

  if (snapshot.length > 0) {
    snapshot.forEach((rawEntry) => {
      const { tag, loc, customer } = normalize(rawEntry);
      if (activeLocations.has(loc)) currentState.set(tag, { loc, customer });
    });
  } else {
    applyChanges(historyByDay.get(startKey));
  }
  addDay(startKey);

  let day = startDay.plus({ days: 1 });
  while (day <= endDay) {
    const dayKey = day.toISODate();
    applyChanges(historyByDay.get(dayKey));
    addDay(dayKey);
    day = day.plus({ days: 1 });
  }

  return results;
}
