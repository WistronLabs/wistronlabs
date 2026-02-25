const { getServerTimeZone } = require("./serverTimeZone");

/**
 * Generate a pallet number in the format:
 * PALLET-YYYYMMDD-###
 * Serial resets each server-local day.
 *
 * @param {object} client - a pg client inside an open transaction
 * @returns {Promise<string>}
 */
async function generatePalletNumber(client) {
  const tz = getServerTimeZone();

  const {
    rows: [dayRow],
  } = await client.query(
    `SELECT to_char(now() AT TIME ZONE $1, 'YYYYMMDD') AS ymd`,
    [tz],
  );
  const ymd = dayRow.ymd;
  const prefix = `PALLET-${ymd}-`;

  const { rows } = await client.query(
    `
    SELECT COALESCE(
      MAX(
        CASE
          WHEN pallet_number ~ ('^' || $1 || '[0-9]+$')
          THEN substring(pallet_number from length($1) + 1)::int
          ELSE NULL
        END
      ),
      0
    ) AS max_serial
    FROM pallet
    WHERE pallet_number LIKE ($1 || '%')
    `,
    [prefix],
  );

  const nextSerial = Number(rows[0]?.max_serial || 0) + 1;
  return `${prefix}${String(nextSerial).padStart(3, "0")}`;
}

module.exports = { generatePalletNumber };
