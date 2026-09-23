const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const bcrypt = require('bcrypt');
const { emailAddress, passwordError, newCode, hashCode, codeStatus, hashPassword, verifyPassword } = require('../src/utils/accountSecurity');

test('public access migration locks existing accounts for password and passkey enrollment', async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users (id serial PRIMARY KEY, username varchar(50) UNIQUE NOT NULL,
    password_hash text NOT NULL, created_at timestamp DEFAULT now());
    INSERT INTO users (username, password_hash) VALUES ('legacy@example.com', 'old-hash');`);
  for (const name of ['0018-terminal-access.sql', '0019-public-access-auth.sql']) {
    await db.exec(await fs.readFile(path.join(__dirname, '../db_migrations', name), 'utf8'));
  }
  const { rows } = await db.query('SELECT admin, super_admin, terminal_access, must_change_password, enabled, session_version FROM users');
  assert.deepEqual(rows[0], { admin: false, super_admin: false, terminal_access: false,
    must_change_password: true, enabled: true, session_version: 1 });
  assert.equal((await db.query("SELECT to_regclass('refresh_sessions') AS table_name")).rows[0].table_name, 'refresh_sessions');
  const { code, codeHash } = newCode();
  assert.equal(code.length, 32);
  assert.equal(hashCode(code), codeHash);
  assert.equal(codeStatus({ expires_at: new Date(Date.now() + 1000) }), 'active');
  assert.equal(codeStatus({ expires_at: new Date(Date.now() - 1000) }), 'expired');
  await db.close();
});

test('new passwords require a long, uncommon passphrase', () => {
  assert.equal(emailAddress(' PERSON@Example.com '), 'person@example.com');
  assert.match(passwordError('password1234567', 'person@example.com'), /less common/);
  assert.equal(passwordError('Mossy satellite canyon otter basket 493!', 'person@example.com'), null);
});

test('long new passwords are fully hashed and legacy bcrypt hashes remain verifiable', async () => {
  const prefix = 'fourteen orange satellites over the old canyon';
  const stored = await hashPassword(`${prefix}A`.repeat(8));
  assert.equal(await verifyPassword(`${prefix}A`.repeat(8), stored), true);
  assert.equal(await verifyPassword(`${prefix}B`.repeat(8), stored), false);
  const legacy = await bcrypt.hash('legacy correct password', 4);
  assert.equal(await verifyPassword('legacy correct password', legacy), true);
  assert.equal(await verifyPassword('wrong password', legacy), false);
});
