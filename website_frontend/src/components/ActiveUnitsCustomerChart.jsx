import { useMemo } from "react";
import { DateTime } from "luxon";
import {
  Area,
  AreaChart,
  CartesianGrid,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { computeActiveLocationsPerDay } from "../utils/activeLocationChartData";
import { customerChartColors } from "../utils/customerChartColors";

function itemOrder(item, label) {
  if (item.dataKey === "totalActive") return "2";
  if (label === "Unassigned") return "1";
  return `0${label}`;
}

const tooltipOrder = (item) => itemOrder(item, String(item.name));

function totalPointLabel({ index, value, viewBox, pointCount }) {
  if (!viewBox || (pointCount > 14 && index !== 0 && index !== pointCount - 1 &&
    index % (pointCount <= 31 ? 2 : 7) !== 0)) return null;
  return (
    <text x={viewBox.x + viewBox.width / 2} y={viewBox.y - 4}
      textAnchor="middle" fill="#374151" fontSize={10}>
      {value}
    </text>
  );
}

function ActiveUnitsCustomerChart({
  snapshot = [],
  history = [],
  locations,
  activeLocationIDs,
  serverTime,
  chartStartDate,
  chartEndDate,
  customerNames = [],
  selectedLocationIDs = [],
  onLocationSelectionChange,
  printFriendly = false,
}) {
  const locationOptions = useMemo(
    () => locations.filter((loc) => activeLocationIDs.includes(loc.id))
      .map((loc) => ({ value: loc.id, label: loc.name })),
    [locations, activeLocationIDs],
  );
  const selectedLocations = useMemo(
    () => locationOptions.filter((option) => selectedLocationIDs.includes(option.value)),
    [locationOptions, selectedLocationIDs],
  );
  const activeLocationNames = useMemo(
    () => (selectedLocations.length ? selectedLocations : locationOptions).map((option) => option.label),
    [selectedLocations, locationOptions],
  );
  const dailyData = useMemo(
    () => computeActiveLocationsPerDay(
      snapshot, history, activeLocationNames, serverTime.zone, serverTime,
      chartStartDate, chartEndDate,
    ),
    [snapshot, history, activeLocationNames, serverTime, chartStartDate, chartEndDate],
  );
  const customerKeys = useMemo(
    () => [...new Set(dailyData.flatMap((day) => Object.keys(day.customerCounts)))].sort((a, b) => {
      if (a === b) return 0;
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    }),
    [dailyData],
  );
  const colors = useMemo(
    () => customerChartColors([...customerNames, ...customerKeys]),
    [customerNames, customerKeys],
  );
  const chartData = useMemo(
    () => dailyData.map((day) => {
      const row = {
        date: DateTime.fromISO(day.date).toFormat("MM/dd/yy"),
        totalActive: Object.values(day.counts).reduce((sum, count) => sum + count, 0),
      };
      customerKeys.forEach((customer, index) => {
        row[`customer_${index}`] = day.customerCounts[customer] || 0;
      });
      return row;
    }),
    [dailyData, customerKeys],
  );
  function toggleLocation(id) {
    const current = selectedLocations.map((option) => option.value);
    onLocationSelectionChange(current.length === 0 ? [id]
      : current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  return (
    <div className="relative z-20 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Active Units Customer Breakdown</h2>
        <div className="inline-flex max-w-full flex-wrap justify-end gap-1 rounded-2xl bg-gray-100 p-1"
          role="group" aria-label="Active locations in customer breakdown">
          <button type="button" onClick={() => onLocationSelectionChange([])}
            aria-pressed={selectedLocations.length === 0}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${selectedLocations.length === 0
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-700 hover:bg-gray-200"}`}>
            All
          </button>
          {locationOptions.map((option) => {
            const selected = selectedLocations.some((location) => location.value === option.value);
            return <button key={option.value} type="button" onClick={() => toggleLocation(option.value)}
              aria-pressed={selected}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${selected
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-700 hover:bg-gray-200"}`}>
              {option.label}
            </button>;
          })}
        </div>
      </div>
      {customerKeys.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">No active units in this date range.</p>
      ) : (
        <>
          {printFriendly && <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 pl-[60px] pr-3 text-[11px] text-gray-700"
            aria-label="Chart legend">
            {customerKeys.map((customer) => <span key={customer} className="inline-flex max-w-full items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors[customer] }} aria-hidden="true" />
              <span className="min-w-0 break-words">{customer}</span>
            </span>)}
            <span className="inline-flex max-w-full items-center gap-1">
              <span className="w-3 shrink-0 border-t-2 border-dashed border-gray-700" aria-hidden="true" />
              Total Active
            </span>
          </div>}
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: printFriendly ? 12 : 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} width={60} />
              <Tooltip itemSorter={tooltipOrder} />
              {customerKeys.map((customer, index) => (
                <Area key={customer} type="monotone" dataKey={`customer_${index}`} name={customer}
                  stroke={colors[customer]}
                  fill={colors[customer]}
                  stackId="customers" isAnimationActive={false} />
              ))}
              <Line type="monotone" dataKey="totalActive" name="Total Active"
                stroke="#374151" strokeDasharray="4 2" strokeWidth={2} dot={{ r: 2 }}
                isAnimationActive={false}>
                {printFriendly && <LabelList dataKey="totalActive" position="top"
                  content={(props) => totalPointLabel({ ...props, pointCount: chartData.length })} />}
              </Line>
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

export default ActiveUnitsCustomerChart;
