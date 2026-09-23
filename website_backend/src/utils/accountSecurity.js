const crypto = require('node:crypto');
const { promisify } = require('node:util');
const bcrypt = require('bcrypt');
const { zxcvbn, zxcvbnOptions } = require('@zxcvbn-ts/core');
const common = require('@zxcvbn-ts/language-common');
const scrypt = promisify(crypto.scrypt);

zxcvbnOptions.setOptions({ dictionary: { ...common.dictionary }, graphs: common.adjacencyGraphs });

function emailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function passwordError(password, email = '') {
  if (typeof password !== 'string' || [...password].length < 15 || [...password].length > 256) {
    return 'Use a password or passphrase between 15 and 256 characters.';
  }
  const userInputs = [email, email.split('@')[0], 'wistron', 'wistronlabs'].filter(Boolean);
  if (zxcvbn(password, userInputs).score < 3) {
    return 'Choose a less common password or a longer passphrase.';
  }
  return null;
}

function newCode() {
  const code = crypto.randomBytes(24).toString('base64url');
  return { code, codeHash: hashCode(code) };
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function codeStatus(row) {
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'redeemed';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(24);
  const hash = await scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt-v1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  if (!stored.startsWith('scrypt-v1$')) return bcrypt.compare(password, stored);
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  if (salt.length !== 24 || expected.length !== 32) return false;
  const actual = await scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { emailAddress, passwordError, newCode, hashCode, codeStatus, hashPassword, verifyPassword };
