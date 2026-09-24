async function getPendingDoaChart(db, startDate, endDate, timezone) {
  const { rows } = await db.query(
    `WITH days AS (
       SELECT day::date AS day,
              ((day::date + INTERVAL '1 day') AT TIME ZONE $3) AT TIME ZONE 'UTC' AS end_utc
       FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS dates(day)
     ),
     pending AS (
       SELECT DISTINCT d.day, ps.system_id, l.name AS location
       FROM days d
       JOIN pallet p ON p.created_at < d.end_utc
         AND (p.released_at IS NULL OR p.released_at >= d.end_utc)
       JOIN pallet_system ps ON ps.pallet_id = p.id
         AND ps.added_at < d.end_utc
         AND (ps.removed_at IS NULL OR ps.removed_at >= d.end_utc)
       JOIN LATERAL (
         SELECT h.to_location_id
         FROM system_location_history h
         WHERE h.system_id = ps.system_id AND h.changed_at < d.end_utc
         ORDER BY h.changed_at DESC, h.id DESC
         LIMIT 1
       ) latest ON TRUE
       JOIN location l ON l.id = latest.to_location_id
       WHERE l.name IN ('RMA VID', 'RMA PID', 'RMA CID')
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
            COUNT(*) FILTER (WHERE pending.location = 'RMA VID')::int AS rma_vid,
            COUNT(*) FILTER (WHERE pending.location = 'RMA PID')::int AS rma_pid,
            COUNT(*) FILTER (WHERE pending.location = 'RMA CID')::int AS rma_cid
     FROM days d
     LEFT JOIN pending ON pending.day = d.day
     GROUP BY d.day
     ORDER BY d.day`,
    [startDate, endDate, timezone],
  );
  return rows;
}

module.exports = { getPendingDoaChart };
