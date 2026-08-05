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
  AreaChart,
  Area,
  LabelList, // <-- added
  Legend, // <-- added
} from "recharts";

function shouldShowPointLabel(index, pointCount) {
  if (pointCount <= 14 || index === 0 || index === pointCount - 1) return true;
  return index % (pointCount <= 31 ? 2 : 7) === 0;
}

function AdaptivePointLabel({ index, pointCount, value, viewBox, offset = 4, style }) {
  if (!shouldShowPointLabel(index, pointCount) || !viewBox) return null;
  const x = viewBox.x + viewBox.width / 2;
  const y = viewBox.y - offset;
  return (
    <text x={x} y={y} textAnchor="middle" style={style}>
      {value}
    </text>
  );
}

function computeInOutCountsPerDay(
  history,
  activeLocationNames,
  timezone,
  locationID1Name,
  rmaLocationNames = [], // <-- NEW
  chartStartDate,
  chartEndDate,
  serverTime = null,
) {
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

  const dayMap = new Map();
  const rmaSet = new Set(rmaLocationNames);

  history.forEach((entry) => {
    const fromLoc = entry.from_location;
    const toLoc = entry.to_location;

    // 🔴 Skip RMA→RMA movements (VID/CID/PID to VID/CID/PID)
    // If you only wanted 6→6, 7→7, 8→8, you could add "&& fromLoc === toLoc".
    if (fromLoc && toLoc && rmaSet.has(fromLoc) && rmaSet.has(toLoc)) {
      return;
    }

    const dt = DateTime.fromISO(entry.changed_at, { zone: "utc" }).setZone(
      timezone
    );
    if (!dt.isValid) return;

    const dayKey = dt.startOf("day").toISODate();
    if (dayKey < startKey || dayKey > endKey) return;
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, []);
    dayMap.get(dayKey).push(entry);
  });

  const results = [];
  let day = startDay;

  while (day <= endDay) {
    const dayKey = day.toISODate();
    const entries = dayMap.get(dayKey) || [];

    const firsts = new Map();
    const lasts = new Map();

    entries.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

    for (const e of entries) {
      const tag = e.service_tag;
      const toLoc = e.to_location;
      if (!firsts.has(tag)) firsts.set(tag, toLoc);
      lasts.set(tag, toLoc);
    }

    let location1Firsts = 0;
    const inactiveLasts = {};

    for (const [, loc] of firsts.entries()) {
      if (loc === locationID1Name) location1Firsts++;
    }

    for (const [, loc] of lasts.entries()) {
      if (!activeLocationNames.includes(loc)) {
        inactiveLasts[loc] = (inactiveLasts[loc] || 0) + 1;
      }
    }

    results.push({
      date: day.toFormat("MM/dd/yy"),
      location1Firsts,
      inactiveLasts,
    });

    day = day.plus({ days: 1 });
  }

  return results;
}

function SystemInOutChart({
  history,
  locations,
  activeLocationIDs,
  serverTime,
  chartStartDate,
  chartEndDate,
  printFriendly = false, // <-- NEW
}) {
  const [hiddenSeries, setHiddenSeries] = useState({});
  const activeLocationNames = locations
    .filter((loc) => activeLocationIDs.includes(loc.id))
    .map((loc) => loc.name);

  const locationID1Name = locations.find((loc) => loc.id === 1)?.name;

  // RMA VID/CID/PID IDs
  const RMA_LOCATION_IDS = [6, 7, 8];

  const rmaLocationNames = useMemo(
    () =>
      locations
        .filter((loc) => RMA_LOCATION_IDS.includes(loc.id))
        .map((loc) => loc.name),
    [locations]
  );

  const inOutCounts = useMemo(() => {
    return computeInOutCountsPerDay(
      history,
      activeLocationNames,
      serverTime.zone,
      locationID1Name,
      rmaLocationNames, // <-- NEW
      chartStartDate,
      chartEndDate,
      serverTime,
    );
  }, [
    history,
    activeLocationNames,
    serverTime.zone,
    serverTime.localtime,
    locationID1Name,
    rmaLocationNames,
    chartStartDate,
    chartEndDate,
  ]);

  if (!inOutCounts || inOutCounts.length === 0) return <div>No data</div>;

  // get all unique inactive locations from results
  const allInactiveLocations = new Set();
  inOutCounts.forEach((day) => {
    Object.keys(day.inactiveLasts).forEach((loc) =>
      allInactiveLocations.add(loc)
    );
  });

  const chartData = inOutCounts.map((day) => {
    const row = { date: day.date, location1Firsts: day.location1Firsts };
    let totalResolved = 0;

    allInactiveLocations.forEach((loc) => {
      const count = day.inactiveLasts[loc] || 0;
      row[loc] = count;
      totalResolved += count;
    });

    row.TotalResolved = totalResolved;
    return row;
  });

  const ACTIVE_COLOR = "#e63946"; // red
  const TOTAL_COLOR = "#000000"; // black (dashed)
  const INACTIVE_COLORS = [
    "#1f77b4",
    "#2ca02c",
    "#ff7f0e",
    "#9467bd",
    "#8c564b",
    "#17becf",
    "#e377c2",
    "#bcbd22",
  ];

  // Reserve space for legend when printFriendly
  const chartMargin = printFriendly
    ? { top: 8, right: 12, left: 0, bottom: 4 }
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

  return (
    <div className="bg-white p-4">
      <h2 className="text-xl font-semibold mb-4">Daily Movements</h2>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={chartData} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis interval={0} allowDecimals={false} />
          <Tooltip />

          {printFriendly && (
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              height={36} // space between legend and plot
              wrapperStyle={{ fontSize: 11, lineHeight: "12px" }}
              onClick={handleLegendClick}
              formatter={legendFormatter}
            />
          )}

          {/* stacked inactive areas */}
          {Array.from(allInactiveLocations).map((loc, idx) => (
            <Area
              key={loc}
              type="monotone"
              dataKey={loc}
              name={loc}
              stroke={INACTIVE_COLORS[idx % INACTIVE_COLORS.length]}
              fill={INACTIVE_COLORS[idx % INACTIVE_COLORS.length]}
              stackId="1"
              isAnimationActive={false}
              hide={!!hiddenSeries[loc]}
            />
          ))}

          {/* Location 1 as a line */}
          <Line
            type="monotone"
            dataKey="location1Firsts"
            name={locationID1Name}
            stroke={ACTIVE_COLOR}
            strokeWidth={2}
            dot={{ r: 2 }}
            isAnimationActive={false}
            hide={!!hiddenSeries.location1Firsts}
          >
            {printFriendly && (
              <LabelList
                dataKey="location1Firsts"
                position="top"
                offset={4}
                content={(props) => (
                  <AdaptivePointLabel {...props} pointCount={chartData.length} />
                )}
                style={{
                  fontSize: 10,
                  fill: ACTIVE_COLOR,
                  fontFamily:
                    "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                }}
              />
            )}
          </Line>

          {/* Total Resolved as a line */}
          <Line
            type="monotone"
            dataKey="TotalResolved"
            name="Total Resolved"
            stroke={TOTAL_COLOR}
            strokeDasharray="4 2"
            strokeWidth={2}
            dot={{ r: 2 }}
            isAnimationActive={false}
            hide={!!hiddenSeries.TotalResolved}
          >
            {printFriendly && (
              <LabelList
                dataKey="TotalResolved"
                position="top"
                offset={4}
                content={(props) => (
                  <AdaptivePointLabel {...props} pointCount={chartData.length} />
                )}
                style={{
                  fontSize: 10,
                  fill: TOTAL_COLOR,
                  fontFamily:
                    "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                }}
              />
            )}
          </Line>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SystemInOutChart;
