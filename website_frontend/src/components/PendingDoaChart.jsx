import { useMemo } from "react";
import { DateTime } from "luxon";
import {
  Area, AreaChart, CartesianGrid, LabelList, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const SERIES = [
  { key: "rma_vid", label: "RMA VID", color: "#1f77b4" },
  { key: "rma_pid", label: "RMA PID", color: "#ff7f0e" },
  { key: "rma_cid", label: "RMA CID", color: "#2ca02c" },
];
const SERIES_ORDER = Object.fromEntries(SERIES.map((series, index) => [series.key, index]));
const itemOrder = (item) => SERIES_ORDER[item.dataKey] ?? SERIES.length;

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

function PendingDoaChart({ days = [], printFriendly = false }) {
  const chartData = useMemo(() => days.map((day) => {
    const row = { date: DateTime.fromISO(day.date).toFormat("MM/dd/yy") };
    SERIES.forEach(({ key }) => { row[key] = Number(day[key] || 0); });
    row.totalPendingDoa = SERIES.reduce((sum, { key }) => sum + row[key], 0);
    return row;
  }), [days]);

  return (
    <div className="relative z-10 bg-white p-4">
      <h2 className="mb-4 text-xl font-semibold">Pending DOA by RMA Type</h2>
      {chartData.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">No chart data for this date range.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} />
            <Tooltip itemSorter={itemOrder} />
            {printFriendly && <Legend verticalAlign="top" align="right" iconType="circle"
              height={36} itemSorter={itemOrder}
              wrapperStyle={{ fontSize: 11, lineHeight: "18px" }} />}
            {SERIES.map(({ key, label, color }) => (
              <Area key={key} type="monotone" dataKey={key} name={label}
                stroke={color} fill={color} stackId="rma" isAnimationActive={false} />
            ))}
            <Line type="monotone" dataKey="totalPendingDoa" name="Total Pending DOA"
              stroke="#374151" strokeDasharray="4 2" strokeWidth={2} dot={{ r: 2 }}
              isAnimationActive={false}>
              {printFriendly && <LabelList dataKey="totalPendingDoa" position="top"
                content={(props) => totalPointLabel({ ...props, pointCount: chartData.length })} />}
            </Line>
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default PendingDoaChart;
