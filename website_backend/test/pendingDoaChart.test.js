const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { getPendingDoaChart } = require('../src/services/pendingDoaChart');

test('Pending DOA counts open pallet members by their RMA location at local day end', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE location (id int PRIMARY KEY, name text);
      CREATE TABLE pallet (id int PRIMARY KEY, created_at timestamp, released_at timestamp);
      CREATE TABLE pallet_system (pallet_id int, system_id int, added_at timestamp, removed_at timestamp);
      CREATE TABLE system_location_history (id int PRIMARY KEY, system_id int, to_location_id int, changed_at timestamp);
      INSERT INTO location VALUES (6, 'RMA VID'), (7, 'RMA PID'), (8, 'RMA CID'), (1, 'Received');
      INSERT INTO pallet VALUES
        (1, '2026-09-20 10:00:00', '2026-09-22 17:00:00'),
        (2, '2026-09-22 18:00:00', NULL);
      INSERT INTO pallet_system VALUES
        (1, 101, '2026-09-20 12:00:00', '2026-09-22 17:00:00'),
        (1, 102, '2026-09-20 14:00:00', '2026-09-22 17:00:00'),
        (2, 103, '2026-09-22 19:00:00', NULL);
      INSERT INTO system_location_history VALUES
        (1, 101, 6, '2026-09-20 11:00:00'),
        (2, 102, 7, '2026-09-20 13:00:00'),
        (3, 101, 8, '2026-09-22 02:00:00'),
        (4, 103, 6, '2026-09-22 18:30:00'),
        (5, 103, 7, '2026-09-23 02:00:00');
    `);

    const days = await getPendingDoaChart(db, '2026-09-20', '2026-09-22', 'America/Chicago');
    assert.deepEqual(days, [
      { date: '2026-09-20', rma_vid: 1, rma_pid: 1, rma_cid: 0 },
      { date: '2026-09-21', rma_vid: 0, rma_pid: 1, rma_cid: 1 },
      { date: '2026-09-22', rma_vid: 0, rma_pid: 1, rma_cid: 0 },
    ]);
  } finally {
    await db.close();
  }
});
