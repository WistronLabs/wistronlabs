import { useMemo } from "react";
import { DateTime } from "luxon";
import {
  Area,
  AreaChart,
  CartesianGrid,
  LabelList,
  Legend,
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

const legendOrder = (item) => itemOrder(item, String(item.value));
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
  printFriendly = false,
}) {
  const activeLocationNames = useMemo(
    () => locations.filter((loc) => activeLocationIDs.includes(loc.id)).map((loc) => loc.name),
    [locations, activeLocationIDs],
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
  const legendHeight = Math.max(36, Math.ceil((customerKeys.length + 1) / 3) * 20);

  return (
    <div className="relative z-20 bg-white p-4">
      <h2 className="mb-4 text-xl font-semibold">Active Units Customer Breakdown</h2>
      {customerKeys.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">No active units in this date range.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(320, 250 + (printFriendly ? legendHeight : 0))}>
          <AreaChart data={chartData} margin={{ top: printFriendly ? 12 : 16, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} />
            <Tooltip itemSorter={tooltipOrder} />
            {printFriendly && <Legend verticalAlign="top" align="right" iconType="circle"
              height={legendHeight} itemSorter={legendOrder}
              wrapperStyle={{ fontSize: 11, lineHeight: "18px" }} />}
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
      )}
    </div>
  );
}

export default ActiveUnitsCustomerChart;
