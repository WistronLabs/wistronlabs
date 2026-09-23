// Run once on each site's backend container after migration 0019.
// Example: docker compose exec app node src/scripts/bootstrapSuperAdmin.js person@example.com
const crypto = require('node:crypto');
const db = require('../db');
const { emailAddress, newCode } = require('../utils/accountSecurity');

async function main() {
  const email = emailAddress(process.argv[2]);
  if (!email) throw new Error('Provide an existing user email');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE super_admin = true LIMIT 1');
    if (existing.rows.length) throw new Error('A super admin already exists; use the Admin page');
    const user = await client.query(
      'UPDATE users SET admin = true, super_admin = true, enabled = true WHERE username = $1 RETURNING id',
      [email]);
    if (!user.rows.length) throw new Error('Existing account not found');
    const { code, codeHash } = newCode();
    await client.query(
      `INSERT INTO account_codes (id, kind, code_hash, email, user_id, expires_at)
       VALUES ($1, 'enrollment', $2, $3, $4, $5)`,
      [crypto.randomUUID(), codeHash, email, user.rows[0].id,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]);
    await client.query('COMMIT');
    process.stdout.write(`Enrollment code for ${email}: ${code}\n`);
    process.stdout.write('This code is displayed once. Enroll before it expires.\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); await db.end(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
