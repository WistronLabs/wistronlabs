export default function Flowchart({
  currentLocation_id,
  locations,
  repairsAllowed,
}) {
  const locationsHiddenWhenRepairsDisabled = new Set([4]);
  const locationsHiddenWhenRepairsEnabled = new Set([10]);
  const arrowsHiddenWhenRepairsDisabled = new Set([4]);
  const arrowsHiddenWhenRepairsEnabled = new Set([]);
  const rectsHiddenWhenRepairsDisabled = new Set([2, 5, 12]);
  const rectsHiddenWhenRepairsEnabled = new Set([15, 16, 17, 18, 19, 20, 23]);

  const filterByRepairsAllowed = (
    items,
    hiddenWhenRepairsDisabled,
    hiddenWhenRepairsEnabled,
  ) =>
    items.filter((item) => {
      if (repairsAllowed === false) {
        return !hiddenWhenRepairsDisabled.has(item.id);
      }
      if (repairsAllowed === true) {
        return !hiddenWhenRepairsEnabled.has(item.id);
      }
      return true;
    });

  const layoutMap = filterByRepairsAllowed(
    [
      // Received
      { id: 1, x: 0, y: 150 },
      // In Debug - Wistron
      { id: 2, x: 200, y: 150 },
      // In L10
      { id: 5, x: 400, y: 150 },
      // Sent to L11
      { id: 9, x: 600, y: 100 },
      // RMA VID
      { id: 6, x: 600, y: 200 },
      // RMA PID
      { id: 8, x: 600, y: 0 },
      // RMA CID
      { id: 7, x: 600, y: 300 },
      // Pending Parts
      { id: 4, x: 100, y: 50 },
      // Pending L11 Logs
      { id: 3, x: 300, y: 50 },
      // Sent to Dell for Repair
      { id: 10, x: 100, y: 0 },
      // Pending MRB
      { id: 11, x: 200, y: 250 },
    ],
    locationsHiddenWhenRepairsDisabled,
    locationsHiddenWhenRepairsEnabled,
  );

  const states = locations
    .map((loc) => {
      const layout = layoutMap.find((l) => l.id === loc.id);
      if (!layout) return null;
      return {
        ...loc,
        x: layout.x,
        y: layout.y,
      };
    })
    .filter(Boolean);

  const arrows = filterByRepairsAllowed(
    [
      {
        id: 1,
        x: 155,
        y: 175,
        stemHeight: 20,
        totalLenth: 40,
        direction: "right",
        ids: [1],
      },
      // In L10 to In Debug - Wistron
      {
        id: 2,
        x: 375,
        y: 175,
        stemHeight: 20,
        totalLenth: 20,
        direction: "right",
        ids: [2],
      },

      // In Debug to Pending Parts
      {
        id: 3,
        x: 225,
        y: repairsAllowed ? 125 : 135,
        stemHeight: 20,
        totalLenth: repairsAllowed ? 20 : 80,
        direction: "up",
        ids: [2, 5],
      },
      // Pending Parts to In Debug
      {
        id: 4,
        x: 225,
        y: 125,
        stemHeight: 20,
        totalLenth: 20,
        direction: "down",
        ids: [4],
      },
      // MRB to In Debug
      {
        id: 5,
        x: 225,
        y: 225,
        stemHeight: 20,
        totalLenth: 20,
        direction: "up",
        ids: [11],
      },
      // In Debug to MRB
      {
        id: 6,
        x: 225,
        y: 225,
        stemHeight: 20,
        totalLenth: 20,
        direction: "down",
        ids: [2],
      },
      //Pending L11 Logs to In Debug
      {
        id: 7,
        x: 325,
        y: 125,
        stemHeight: 20,
        totalLenth: 20,
        direction: "down",
        ids: [3],
      },
      // In Debug to Pending L11 Logs
      {
        id: 8,
        x: 325,
        y: 125,
        stemHeight: 20,
        totalLenth: 20,
        direction: "up",
        ids: [2],
      },
      // Pending L11 Logs to RMA PID
      {
        id: 9,
        x: 555,
        y: 25,
        stemHeight: 20,
        totalLenth: 40,
        direction: "right",
        ids: [2, 5, 3],
      },
      // Sent to L11
      {
        id: 10,
        x: 555,
        y: 125,
        stemHeight: 20,
        totalLenth: 40,
        direction: "right",
        ids: [5],
      },
      // RMA VID
      {
        id: 11,
        x: 555,
        y: 225,
        stemHeight: 20,
        totalLenth: 40,
        direction: "right",
        ids: [2, 5],
      },
      // RMA CID
      {
        id: 12,
        x: 555,
        y: 325,
        stemHeight: 20,
        totalLenth: 40,
        direction: "right",
        ids: [11],
      },
      {
        id: 13,
        x: 375,
        y: 175,
        stemHeight: 20,
        totalLenth: 20,
        direction: "left",
        ids: [5],
      },
      // In L10 to Pending MRB
      {
        id: 14,
        x: 465,
        y: 275,
        stemHeight: 20,
        totalLenth: 110,
        direction: "left",
        ids: [5],
      },
      {
        id: 15,
        x: 475,
        y: 75,
        stemHeight: 20,
        totalLenth: 20,
        direction: "left",
        ids: [5],
      },
    ],
    arrowsHiddenWhenRepairsDisabled,
    arrowsHiddenWhenRepairsEnabled,
  );

  const rects = filterByRepairsAllowed(
    [
      // Pending L11 Logs to RMA PID
      {
        id: 3,
        x: 315,
        y: 15,
        width: 240,
        height: 20,
        direction: "horizontal",
        ids: [3],
      },
      // Horizontal line from Pending L11 Logs to RMA PID
      {
        id: 6,
        x: 315,
        y: 30,
        width: 15,
        height: 20,
        direction: "vertical",
        ids: [3],
      },
      // In Debug Wistron to RMA
      {
        id: 4,
        x: 315,
        y: 215,
        width: 240,
        height: 20,
        direction: "horizontal",
        ids: [2],
      },
      // Vertical line inbetween RMA PID, Sent to L11 and RMA VID
      {
        id: 7,
        x: 555,
        y: 35,
        width: 180,
        height: 18,
        direction: "vertical",
        ids: [2, 5],
      },
      // Vertical line inbetween RMA PID, Sent to L11 and RMA VID
      {
        id: 7,
        x: 465,
        y: 65,
        width: 80,
        height: 18,
        direction: "vertical",
        ids: [5],
      },
      {
        id: 8,
        x: 315,
        y: 205,
        width: 30,
        height: 20,
        direction: "vertical",
        ids: [2],
      },
      // Small horizonal nub to the right of In L10
      {
        id: 9,
        x: 552,
        y: 165,
        width: 4,
        height: 20,
        direction: "horizontal",
        ids: [5],
      },
      // Pending MRB to RMA CID
      {
        id: 13,
        x: 215,
        y: 305,
        width: 30,
        height: 20,
        direction: "vertical",
        ids: [11],
      },
      // Pending MRB to RMA CID
      {
        id: 14,
        x: 220,
        y: 315,
        width: 335,
        height: 20,
        direction: "horizontal",
        ids: [11],
      },
      {
        id: 17,
        x: 350,
        y: 115,
        width: 115,
        height: 20,
        direction: "horizontal",
        ids: [5],
      },
      {
        id: 20,
        x: 235,
        y: 115,
        width: 65,
        height: 20,
        direction: "horizontal",
        ids: [5],
      },
      //vertical line l10 to pending MRB part 1
      {
        id: 21,
        x: 465,
        y: 205,
        width: 5,
        height: 18,
        direction: "vertical",
        ids: [5],
      },
      //vertical line l10 to pending MRB part 2
      {
        id: 22,
        x: 465,
        y: 240,
        width: 45,
        height: 18,
        direction: "vertical",
        ids: [5],
      },
      {
        id: 23,
        x: 215,
        y: 135,
        width: 10,
        height: 20,
        direction: "vertical",
        ids: [2],
      },
    ],
    rectsHiddenWhenRepairsDisabled,
    rectsHiddenWhenRepairsEnabled,
  );

  const getFill = (id) => {
    if (id === currentLocation_id) return "url(#activeGradient)";
    return "#f9fafb";
  };

  const getTextColor = (id) => {
    if (id === currentLocation_id) return "#fff";
    return "#111827";
  };

  return (
    <svg
      viewBox="-1 -1 752 402"
      className="w-full h-auto"
      preserveAspectRatio="xMinYMin meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="activeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <filter id="boxShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="1"
            dy="1"
            stdDeviation="1"
            floodColor="#000"
            floodOpacity="0.2"
          />
        </filter>
      </defs>

      {/* Render states */}
      {states.map((state) => (
        <g key={state.id}>
          <rect
            x={state.x}
            y={state.y}
            width="150"
            height="50"
            fill={getFill(state.id)}
            stroke="#d1d5db"
            rx="8"
            ry="8"
            filter={state.id === currentLocation_id ? "url(#boxShadow)" : ""}
          />
          <text
            x={state.x + 75}
            y={state.y + 28}
            textAnchor="middle"
            fontSize="13"
            fill={getTextColor(state.id)}
            fontWeight="600"
          >
            {state.name}
          </text>
        </g>
      ))}

      {/* Render arrows */}
      {arrows.map((arrow, idx) => {
        const stemThickness = arrow.stemHeight ?? 20;
        const totalLength = arrow.totalLenth ?? 40;
        const direction = arrow.direction ?? "right";

        const headLengthFactor = 0.8;
        const headHeightFactor = 1.8;
        const headLength = stemThickness * headLengthFactor;
        const headHeight = stemThickness * headHeightFactor;
        const stemLength = Math.max(0, totalLength - headLength);

        const cx = arrow.x;
        const cy = arrow.y;

        const isActive = arrow.ids?.includes(currentLocation_id);
        const fill = isActive ? "#bfdbfe" : "#9ca3af";

        let stemX = cx;
        let stemY = cy;
        let stemWidth = 0;
        let stemHeight = 0;
        let points = "";

        if (direction === "right") {
          stemX = cx;
          stemY = cy - stemThickness / 2;
          stemWidth = stemLength;
          stemHeight = stemThickness;

          const headBaseX = cx + stemLength;

          points = `
            ${headBaseX},${cy - headHeight / 2}
            ${headBaseX + headLength},${cy}
            ${headBaseX},${cy + headHeight / 2}
          `;
        } else if (direction === "left") {
          stemX = cx - stemLength;
          stemY = cy - stemThickness / 2;
          stemWidth = stemLength;
          stemHeight = stemThickness;

          const headBaseX = cx - stemLength;

          points = `
            ${headBaseX},${cy - headHeight / 2}
            ${headBaseX - headLength},${cy}
            ${headBaseX},${cy + headHeight / 2}
          `;
        } else if (direction === "down") {
          stemX = cx - stemThickness / 2;
          stemY = cy;
          stemWidth = stemThickness;
          stemHeight = stemLength;

          const headBaseY = cy + stemLength;

          points = `
            ${cx - headHeight / 2},${headBaseY}
            ${cx},${headBaseY + headLength}
            ${cx + headHeight / 2},${headBaseY}
          `;
        } else if (direction === "up") {
          stemX = cx - stemThickness / 2;
          stemY = cy - stemLength;
          stemWidth = stemThickness;
          stemHeight = stemLength;

          const headBaseY = cy - stemLength;

          points = `
            ${cx - headHeight / 2},${headBaseY}
            ${cx},${headBaseY - headLength}
            ${cx + headHeight / 2},${headBaseY}
          `;
        }

        return (
          <g key={idx}>
            {stemWidth > 0 && stemHeight > 0 && (
              <rect
                x={stemX}
                y={stemY}
                width={stemWidth}
                height={stemHeight}
                fill={fill}
              />
            )}
            <polygon points={points} fill={fill} />
          </g>
        );
      })}

      {/* Render rects */}
      {rects.map((rect, idx) => {
        const baseX = rect.x;
        const baseY = rect.y;

        let w = rect.width ?? 50;
        let h = rect.height ?? 20;

        if (rect.direction === "vertical") {
          [w, h] = [h, w];
        }

        const isActive = rect.ids?.includes(currentLocation_id);
        const fill = isActive ? "#bfdbfe" : "#9ca3af";

        return (
          <rect
            key={idx}
            x={baseX}
            y={baseY}
            width={w}
            height={h}
            fill={fill}
          />
        );
      })}
    </svg>
  );
}
