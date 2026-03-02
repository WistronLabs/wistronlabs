const SIMPLE_PALLET_SHAPES = [
  "star",
  "triangle_up",
  "triangle_right",
  "triangle_left",
  "triangle_down",
  "circle",
  "square",
  "diamond",
  "pentagon",
  "hexagon",
];

/**
 * Pick the first available simple shape among currently open pallets.
 * Returns null when exhausted.
 */
async function allocateUniqueOpenPalletShape(client) {
  const { rows } = await client.query(
    `SELECT shape FROM pallet WHERE status = 'open' AND shape IS NOT NULL`,
  );
  const inUse = new Set(rows.map((r) => String(r.shape || "").trim()));

  for (const s of SIMPLE_PALLET_SHAPES) {
    if (!inUse.has(s)) return s;
  }
  return null;
}

module.exports = {
  SIMPLE_PALLET_SHAPES,
  allocateUniqueOpenPalletShape,
};
