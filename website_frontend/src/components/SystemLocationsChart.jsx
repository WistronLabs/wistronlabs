import React, { useCallback, useMemo, useState } from "react";

import { DateTime } from "luxon";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
  Legend,
} from "recharts";

const REPAIR_ONLY_ZERO_SERIES = new Set(["Pending L11 Logs", "Pending Parts"]);

function computeActiveLocationsPerDay(
  snapshot,
  history,
  activeLocationNames,
  timezone,
  serverTime,
  chartDays = 7,
) {
  function normalize(entry) {
    return {
      tag: entry.service_tag,
      loc: entry.to_location ?? entry.location ?? null,
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
  const startDay = today.minus({ days: Math.max(1, Number(chartDays) || 7) - 1 });
  const startKey = startDay.toISODate();
  const endKey = today.toISODate();

  const historyByDay = new Map();

  history.forEach((rawEntry) => {
    const { tag, loc, ts } = normalize(rawEntry);
    if (!ts) return;

    const dt = DateTime.fromISO(ts, { zone: "utc" }).setZone(timezone);
    if (!dt.isValid) return;

    const dayKey = dt.startOf("day").toISODate();
    if (dayKey < startKey || dayKey > endKey) return;

    if (!historyByDay.has(dayKey)) historyByDay.set(dayKey, new Map());
    const tagMap = historyByDay.get(dayKey);

    if (!tagMap.has(tag)) {
      tagMap.set(tag, []);
    }
    tagMap.get(tag).push({ tag, loc, ts });
  });

  const results = [];

  let currentState = new Map();

  if (snapshot.length > 0) {
    snapshot.forEach((entry) => {
      const { tag, loc } = normalize(entry);
      if (activeLocationNames.includes(loc)) {
        currentState.set(tag, loc);
      }
    });

    results.push({
      date: startKey,
      counts: countState(currentState, activeLocationNames),
    });
  } else {
    const startDayChanges = historyByDay.get(startKey);
    if (startDayChanges) {
      for (const events of startDayChanges.values()) {
        events.sort((a, b) => DateTime.fromISO(a.ts) - DateTime.fromISO(b.ts));
        for (const { tag, loc } of events) {
          if (!activeLocationNames.includes(loc)) {
            currentState.delete(tag);
          } else {
            currentState.set(tag, loc);
          }
        }
      }
    }
    results.push({
      date: startKey,
      counts: countState(currentState, activeLocationNames),
    });
  }

  let day = startDay.plus({ days: 1 });

  while (day <= today) {
    const dayKey = day.toISODate();

    if (historyByDay.has(dayKey)) {
      const changes = historyByDay.get(dayKey);
      for (const events of changes.values()) {
        events.sort((a, b) => DateTime.fromISO(a.ts) - DateTime.fromISO(b.ts));
        for (const { tag, loc } of events) {
          if (!activeLocationNames.includes(loc)) {
            currentState.delete(tag);
          } else {
            currentState.set(tag, loc);
          }
        }
      }
    }

    results.push({
      date: dayKey,
      counts: countState(currentState, activeLocationNames),
    });

    day = day.plus({ days: 1 });
  }

  return results;

  function countState(stateMap, allLocations) {
    const counts = {};
    allLocations.forEach((loc) => {
      counts[loc] = 0;
    });
    for (const loc of stateMap.values()) {
      if (Object.prototype.hasOwnProperty.call(counts, loc)) {
        counts[loc]++;
      }
    }
    return counts;
  }
}

function SystemLocationsChart({
  snapshot = [],
  history = [],
  locations,
  activeLocationIDs,
  serverTime,
  chartDays = 7,
  printFriendly = false,
  repairsAllowed = null,
}) {
  const [hiddenSeries, setHiddenSeries] = useState({});
  const activeLocationNames = useMemo(
    () =>
      locations
        .filter((loc) => activeLocationIDs.includes(loc.id))
        .map((loc) => loc.name),
    [locations, activeLocationIDs],
  );

  const historyByDay = useMemo(() => {
    return computeActiveLocationsPerDay(
      snapshot,
      history,
      activeLocationNames,
      serverTime.zone,
      serverTime,
      chartDays,
    );
  }, [
    snapshot,
    history,
    activeLocationNames,
    serverTime,
    chartDays,
  ]);

  const chartData = useMemo(() => {
    return historyByDay.map((day) => {
      const row = { date: DateTime.fromISO(day.date).toFormat("MM/dd/yy") };
      activeLocationNames.forEach((loc) => (row[loc] = day.counts[loc] || 0));
      return row;
    });
  }, [activeLocationNames, historyByDay]);

  const locationKeys = useMemo(() => {
    return activeLocationNames.filter((loc) => {
      if (repairsAllowed !== false || !REPAIR_ONLY_ZERO_SERIES.has(loc)) {
        return true;
      }

      return chartData.some((day) => Number(day[loc] || 0) !== 0);
    });
  }, [activeLocationNames, chartData, repairsAllowed]);
  const CHART_COLORS = ["#1f77b4", "#9467bd", "#ff7f0e", "#2ca02c", "#d62728"];

  // Give the legend some headroom when printFriendly
  const chartMargin = printFriendly
    ? { top: 28, right: 12, left: 0, bottom: 4 }
    : { top: 16, right: 12, left: 0, bottom: 4 };

  const handleLegendClick = useCallback((entry) => {
    const key = entry?.dataKey;
    if (!key) return;
    setHiddenSeries((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const legendFormatter = useCallback(
    (value, entry) => {
      const key = entry?.dataKey;
      const hidden = key ? !!hiddenSeries[key] : false;
      return (
        <span className={hidden ? "text-gray-400 line-through" : "text-gray-700"}>
          {value}
        </span>
      );
    },
    [hiddenSeries],
  );

  if (!historyByDay || historyByDay.length === 0) return <div>No data</div>;

  return (
    <div className="bg-white p-4">
      <h2 className="text-xl font-semibold mb-4">Active Locations Per Day</h2>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis interval={0} allowDecimals={false} />
          <Tooltip />

          {/* Show legend only for print-friendly */}
          {printFriendly && (
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ fontSize: 11, lineHeight: "12px" }}
              height={36} // <-- this reserves space (add padding)
              onClick={handleLegendClick}
              formatter={legendFormatter}
            />
          )}

          {locationKeys.map((loc, idx) => (
            <Line
              key={loc}
              type="monotone"
              dataKey={loc}
              name={loc}
              strokeWidth={2}
              dot={{ r: 2 }}
              stroke={CHART_COLORS[idx % CHART_COLORS.length]}
              isAnimationActive={false}
              hide={!!hiddenSeries[loc]}
            >
              {printFriendly && (
                <LabelList
                  dataKey={loc}
                  position="top"
                  offset={4}
                  style={{
                    fontSize: 10,
                    fill: CHART_COLORS[idx % CHART_COLORS.length],
                    fontFamily:
                      "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                  }}
                />
              )}
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SystemLocationsChart;
