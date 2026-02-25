// scripts/backfillOpenPalletShapes.js
const db = require("../db"); // your pooled client
const { allocateUniqueOpenPalletShape } = require("../utils/palletShapes");

async function main() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Lock only the rows we’ll edit, in a stable order
    const { rows: pallets } = await client.query(
      `
      SELECT id
      FROM pallet
      WHERE status = 'open' AND (shape IS NULL OR TRIM(shape) = '')
      ORDER BY created_at ASC
      FOR UPDATE
      `
    );

    for (const { id } of pallets) {
      const shape = await allocateUniqueOpenPalletShape(client);
      if (!shape) break;
      await client.query(`UPDATE pallet SET shape = $2 WHERE id = $1`, [
        id,
        shape,
      ]);
    }

    await client.query("COMMIT");
    console.log(`Backfilled ${pallets.length} open pallets with shapes.`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
