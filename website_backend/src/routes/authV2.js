const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const db = require('../db');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { emailAddress, passwordError, newCode, hashCode, codeStatus, hashPassword, verifyPassword } = require('../utils/accountSecurity');

if (!process.env.JWT_SECRET || !process.env.FRONTEND_URL) throw new Error('JWT_SECRET and FRONTEND_URL are required');
const router = express.Router();
const origin = new URL(process.env.FRONTEND_URL).origin;
const rpID = new URL(process.env.FRONTEND_URL).hostname;
const flows = new Map();
const attempts = new Map();
const MINUTE = 60000;
const nonInteractiveUsers = new Set(['deleted_user@example.com', 'system']);
const invalid = (res, status = 401, error = 'Invalid credentials') => res.status(status).json({ error });
const sign = (data, lifetime) => jwt.sign(data, process.env.JWT_SECRET, { expiresIn: lifetime });
const claim = (user, type) => ({ type, userId: user.id, username: user.username, version: user.session_version });
const cookieOptions = () => ({ httpOnly: true, secure: true, sameSite: origin.includes('localhost') ? 'none' : 'strict', path: '/api/v1/auth' });

setInterval(() => {
  const now = Date.now();
  for (const [id, flow] of flows) if (flow.expires <= now) flows.delete(id);
  for (const [key, times] of attempts) {
    const recent = times.filter((time) => now - time < 15 * MINUTE);
    if (recent.length) attempts.set(key, recent);
    else attempts.delete(key);
  }
}, 15 * MINUTE).unref();

function remember(kind, data) {
  const id = crypto.randomUUID();
  flows.set(id, { kind, ...data, expires: Date.now() + 5 * MINUTE });
  return id;
}
function consume(id, kind) {
  const data = flows.get(id);
  flows.delete(id);
  return data?.kind === kind && data.expires > Date.now() ? data : null;
}
function throttle(req, email) {
  const key = `${req.path}:${req.socket.remoteAddress}:${email}`;
  const now = Date.now();
  const times = (attempts.get(key) || []).filter((time) => now - time < 15 * MINUTE);
  times.push(now);
  attempts.set(key, times);
  return times.length > 10;
}
function machineAllowed(req) {
  if (req.method === 'GET' && /^\/stations(?:\/[A-Za-z0-9_-]+)?$/.test(req.path)) return true;
  if (req.method === 'GET' && req.path === '/systems') return true;
  if (req.method === 'GET' && /^\/systems\/(?:dpn|[A-Za-z0-9_-]+)$/.test(req.path)) return true;
  if (req.method === 'POST' && req.path === '/stations') return true;
  if (req.method === 'PATCH' && /^\/stations\/[A-Za-z0-9_-]+$/.test(req.path)) return true;
  if (req.method === 'PATCH' && /^\/systems\/[A-Za-z0-9_-]+\/(ppid|host_mac|bmc_mac|location|issue|rack|doa)$/.test(req.path)) return true;
  return false;
}
async function authenticateToken(req, res, next) {
  if (req.user) return next();
  const bearer = /^Bearer (.+)$/i.exec(req.get('authorization') || '')?.[1];
  const raw = bearer || req.cookies?.accessToken;
  if (!raw) return invalid(res, 401, 'Authentication required');
  if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      ![origin, `https://${req.get('host')}`].includes(req.get('origin'))) {
    return invalid(res, 403, 'Invalid request origin');
  }
  if (process.env.INTERNAL_API_KEY && raw === process.env.INTERNAL_API_KEY) {
    if (!machineAllowed(req)) return invalid(res, 403, 'Machine credential cannot access this route');
    req.user = { userId: -1, username: 'internal_script', machine: true };
    return next();
  }
  try {
    const payload = jwt.verify(raw, process.env.JWT_SECRET);
    if (payload.type !== 'access') return invalid(res, 401, 'Full login required');
    const { rows } = await db.query(
      `SELECT u.*, EXISTS(SELECT 1 FROM user_passkeys p WHERE p.user_id = u.id) AS has_passkey
       FROM users u WHERE u.id = $1`, [payload.userId]);
    const user = rows[0];
    if (!user?.enabled || user.must_change_password || !user.has_passkey ||
        user.session_version !== payload.version) return invalid(res, 401, 'Session expired');
    req.user = { userId: user.id, username: user.username, admin: user.admin,
      superAdmin: user.super_admin, terminalAccess: user.terminal_access };
    return next();
  } catch { return invalid(res, 401, 'Invalid or expired session'); }
}
function requireAdmin(req, res, next) {
  return req.user?.admin || req.user?.superAdmin ? next() : invalid(res, 403, 'Admin required');
}
function requireSuperAdmin(req, res, next) {
  return req.user?.superAdmin ? next() : invalid(res, 403, 'Super admin required');
}
async function flowUser(raw, purpose) {
  const data = jwt.verify(String(raw || ''), process.env.JWT_SECRET);
  if (data.type !== 'flow' || data.purpose !== purpose) throw new Error('Invalid flow');
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1 AND enabled = true', [data.userId]);
  if (!rows[0] || rows[0].session_version !== data.version) throw new Error('Expired flow');
  return rows[0];
}
async function activeCode(code, kind, email, userId = null) {
  const { rows } = await db.query(
    `SELECT * FROM account_codes WHERE code_hash = $1 AND kind = $2 AND email = $3
     AND ($4::integer IS NULL OR user_id = $4)`,
    [hashCode(code), kind, email, userId]);
  return rows[0] && codeStatus(rows[0]) === 'active' ? rows[0] : null;
}
async function registrationOptions(email, userID, excludeCredentials = []) {
  return generateRegistrationOptions({ rpName: 'Wistron Labs', rpID, userName: email,
    userID, attestationType: 'none', excludeCredentials,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' } });
}
async function verifyRegistration(response, challenge) {
  const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge,
    expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!result.verified || !result.registrationInfo) throw new Error('Passkey verification failed');
  return result.registrationInfo;
}
async function insertPasskey(client, userId, info) {
  const { credential, credentialDeviceType, credentialBackedUp } = info;
  await client.query(
    `INSERT INTO user_passkeys (id, user_id, public_key, counter, transports, device_type, backed_up)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [credential.id, userId, Buffer.from(credential.publicKey), credential.counter,
      JSON.stringify(credential.transports || []), credentialDeviceType, credentialBackedUp]);
}
function setAccessCookie(res, accessToken) {
  res.cookie('accessToken', accessToken, { ...cookieOptions(), domain: rpID, path: '/', maxAge: 15 * MINUTE });
}
async function issueSession(res, user) {
  const accessToken = sign(claim(user, 'access'), '15m');
  const sessionId = crypto.randomUUID();
  const refreshToken = sign({ ...claim(user, 'refresh'), jti: sessionId }, '7d');
  await db.query('INSERT INTO refresh_sessions (id, user_id, session_version, expires_at) VALUES ($1,$2,$3,$4)',
    [sessionId, user.id, user.session_version, new Date(Date.now() + 7 * 24 * 60 * MINUTE)]);
  res.cookie('refreshToken', refreshToken, { ...cookieOptions(), maxAge: 7 * 24 * 60 * MINUTE });
  setAccessCookie(res, accessToken);
  return res.json({ token: accessToken });
}

router.post('/codes', authenticateToken, requireSuperAdmin, async (req, res) => {
  const kind = req.body?.kind;
  const email = emailAddress(req.body?.email);
  const name = String(req.body?.displayName || '').trim();
  if (!email || !['invite', 'enrollment', 'recovery'].includes(kind) || name.length > 120 ||
      (kind === 'invite' && !name))
    return invalid(res, 400, 'Valid email, type, and invitee name required');
  if (nonInteractiveUsers.has(email)) return invalid(res, 409, 'This account cannot receive access codes');
  try {
    const { rows: users } = await db.query(
      `SELECT u.id, u.enabled,
              EXISTS(SELECT 1 FROM user_passkeys p WHERE p.user_id = u.id) AS has_passkey
       FROM users u WHERE u.username = $1`, [email]);
    if ((kind === 'invite' && users.length) || (kind !== 'invite' && !users.length))
      return invalid(res, 409, 'Recipient account does not match code type');
    if (kind !== 'invite' && !users[0].enabled)
      return invalid(res, 409, 'Reactivate this account before issuing an access code');
    if (kind === 'enrollment' && (!users[0].enabled || users[0].has_passkey))
      return invalid(res, 409, 'This account does not need initial enrollment; use recovery if its passkey was lost');
    const { code, codeHash } = newCode();
    const client = await db.connect();
    let rows;
    try {
      await client.query('BEGIN');
      ({ rows } = await client.query(
        `INSERT INTO account_codes (id, kind, code_hash, email, display_name, user_id, created_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, kind, email, display_name, expires_at`,
        [crypto.randomUUID(), kind, codeHash, email, name || null, users[0]?.id || null,
          req.user.userId, new Date(Date.now() + 7 * 24 * 60 * MINUTE)]));
      if (kind === 'recovery') await client.query(
        'UPDATE users SET must_change_password = true, session_version = session_version + 1 WHERE id = $1',
        [users[0].id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return res.status(201).json({ ...rows[0], code });
  } catch (error) { console.error(error); return invalid(res, 500, 'Unable to create code'); }
});
router.get('/codes', authenticateToken, requireSuperAdmin, async (_req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.kind, c.email, c.display_name, c.created_at, c.expires_at,
            c.used_at, c.revoked_at, u.username AS created_by_name
     FROM account_codes c LEFT JOIN users u ON u.id = c.created_by
     WHERE c.created_at >= now() - interval '90 days' ORDER BY c.created_at DESC LIMIT 500`);
  return res.json(rows.map((row) => ({ ...row, status: codeStatus(row) })));
});
router.post('/codes/:id/revoke', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { rowCount } = await db.query(
    'UPDATE account_codes SET revoked_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL',
    [req.params.id]);
  return rowCount ? res.sendStatus(204) : invalid(res, 404, 'Active code not found');
});

router.post('/register/options', async (req, res) => {
  const email = emailAddress(req.body?.email);
  if (email && throttle(req, email)) return invalid(res, 429, 'Too many attempts; try again later');
  const error = passwordError(req.body?.password, email || '');
  if (!email || error) return invalid(res, 400, error || 'Valid email required');
  try {
    const invite = await activeCode(req.body?.code, 'invite', email);
    if (!invite) return invalid(res, 400, 'Invalid or expired invitation');
    const options = await registrationOptions(email, crypto.randomBytes(32));
    const flowId = remember('invite', { email, codeHash: invite.code_hash,
      passwordHash: await hashPassword(req.body.password), challenge: options.challenge });
    return res.json({ flowId, options });
  } catch (error) { console.error(error); return invalid(res, 500, 'Unable to start registration'); }
});
router.post('/register/verify', async (req, res) => {
  const state = consume(req.body?.flowId, 'invite');
  if (!state) return invalid(res, 400, 'Registration expired');
  try {
    const info = await verifyRegistration(req.body?.response, state.challenge);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM account_codes WHERE code_hash = $1 FOR UPDATE', [state.codeHash]);
      const invite = rows[0];
      if (!invite || invite.kind !== 'invite' || invite.email !== state.email || codeStatus(invite) !== 'active') {
        await client.query('ROLLBACK'); return invalid(res, 400, 'Invitation no longer valid');
      }
      const created = await client.query(
        `INSERT INTO users (username, display_name, password_hash, admin, super_admin,
          enabled, must_change_password, mfa_enrolled_at)
         VALUES ($1,$2,$3,false,false,true,false,now()) RETURNING id`,
        [state.email, invite.display_name, state.passwordHash]);
      await insertPasskey(client, created.rows[0].id, info);
      await client.query('UPDATE account_codes SET used_at = now(), user_id = $1 WHERE id = $2',
        [created.rows[0].id, invite.id]);
      await client.query('COMMIT');
      return res.status(201).json({ message: 'Account created. Sign in to continue.' });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } catch (error) { console.error(error); return invalid(res, 400, 'Unable to complete registration'); }
});

router.post('/login', async (req, res) => {
  const email = emailAddress(req.body?.username);
  if (!email) return invalid(res);
  if (throttle(req, email)) return invalid(res, 429, 'Too many attempts; try again later');
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE username = $1 AND enabled = true', [email]);
    const user = rows[0];
    if (!user?.password_hash || !(await verifyPassword(String(req.body?.password || ''), user.password_hash)))
      return invalid(res);
    if (user.temp_password_expires_at && new Date(user.temp_password_expires_at).getTime() <= Date.now())
      return invalid(res, 403, 'Temporary password expired; contact a super admin');
    const keys = await db.query('SELECT id FROM user_passkeys WHERE user_id = $1', [user.id]);
    if (user.temp_password_expires_at && keys.rows.length)
      return res.json({ next: 'temporary-password', flowToken: sign({ ...claim(user, 'flow'), purpose: 'temporary' }, '5m') });
    if (user.must_change_password || !keys.rows.length)
      return res.json({ next: 'enroll', flowToken: sign({ ...claim(user, 'flow'), purpose: 'onboard' }, '5m') });
    return res.json({ next: 'passkey', flowToken: sign({ ...claim(user, 'flow'), purpose: 'login' }, '5m') });
  } catch (error) { console.error(error); return invalid(res, 500, 'Unable to sign in'); }
});
router.post('/temporary-password', async (req, res) => {
  try {
    const user = await flowUser(req.body?.flowToken, 'temporary');
    if (!user.temp_password_expires_at || new Date(user.temp_password_expires_at).getTime() <= Date.now())
      return invalid(res, 403, 'Temporary password expired');
    const error = passwordError(req.body?.newPassword, user.username);
    if (error) return invalid(res, 400, error);
    await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = false,
        temp_password_expires_at = NULL, session_version = session_version + 1 WHERE id = $2`,
      [await hashPassword(req.body.newPassword), user.id]);
    return res.json({ message: 'Password changed. Sign in with your new password and passkey.' });
  } catch { return invalid(res, 401, 'Temporary password session expired'); }
});
router.post('/enroll/options', async (req, res) => {
  try {
    const user = await flowUser(req.body?.flowToken, 'onboard');
    if (throttle(req, user.username)) return invalid(res, 429, 'Too many attempts; try again later');
    const code = await activeCode(req.body?.code, 'recovery', user.username, user.id) ||
      await activeCode(req.body?.code, 'enrollment', user.username, user.id);
    const error = passwordError(req.body?.newPassword, user.username);
    if (!code || error) return invalid(res, 400, error || 'Invalid or expired enrollment code');
    const options = await registrationOptions(user.username, Buffer.from(String(user.id)));
    const flowId = remember('enroll', { userId: user.id, version: user.session_version,
      codeHash: code.code_hash, passwordHash: await hashPassword(req.body.newPassword),
      challenge: options.challenge });
    return res.json({ flowId, options });
  } catch { return invalid(res, 401, 'Enrollment session expired'); }
});
router.post('/enroll/verify', async (req, res) => {
  const state = consume(req.body?.flowId, 'enroll');
  if (!state) return invalid(res, 400, 'Enrollment expired');
  try {
    const info = await verifyRegistration(req.body?.response, state.challenge);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [state.userId]);
      const user = current.rows[0];
      const codes = await client.query('SELECT * FROM account_codes WHERE code_hash = $1 FOR UPDATE', [state.codeHash]);
      const code = codes.rows[0];
      if (!user?.enabled || user.session_version !== state.version || !code ||
          !['recovery', 'enrollment'].includes(code.kind) || code.email !== user.username ||
          codeStatus(code) !== 'active' || code.user_id !== user.id) {
        await client.query('ROLLBACK'); return invalid(res, 400, 'Enrollment no longer valid');
      }
      if (code.kind === 'recovery') await client.query('DELETE FROM user_passkeys WHERE user_id = $1', [user.id]);
      await insertPasskey(client, user.id, info);
      await client.query(
        `UPDATE users SET password_hash = $1, must_change_password = false,
          temp_password_expires_at = NULL, mfa_enrolled_at = now(),
          session_version = session_version + 1 WHERE id = $2`, [state.passwordHash, user.id]);
      await client.query('UPDATE account_codes SET used_at = now() WHERE id = $1', [code.id]);
      await client.query('COMMIT');
      return res.json({ message: 'Enrollment complete. Sign in with your new password.' });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } catch (error) { console.error(error); return invalid(res, 400, 'Unable to complete enrollment'); }
});

router.post('/passkey/options', async (req, res) => {
  try {
    const user = await flowUser(req.body?.flowToken, 'login');
    const { rows } = await db.query('SELECT id, transports FROM user_passkeys WHERE user_id = $1', [user.id]);
    if (!rows.length) return invalid(res, 403, 'Passkey not enrolled');
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required',
      allowCredentials: rows.map((key) => ({ id: key.id, transports: key.transports })) });
    return res.json({ flowId: remember('login', { userId: user.id,
      version: user.session_version, challenge: options.challenge }), options });
  } catch { return invalid(res, 401, 'Login session expired'); }
});
router.post('/passkey/verify', async (req, res) => {
  const state = consume(req.body?.flowId, 'login');
  if (!state) return invalid(res, 401, 'Login expired');
  try {
    const { rows } = await db.query(
      `SELECT p.*, u.username, u.enabled, u.must_change_password, u.session_version
       FROM user_passkeys p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND p.user_id = $2`,
      [req.body?.response?.id, state.userId]);
    const key = rows[0];
    if (!key?.enabled || key.must_change_password || key.session_version !== state.version) return invalid(res);
    const result = await verifyAuthenticationResponse({ response: req.body.response,
      expectedChallenge: state.challenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true, credential: { id: key.id,
        publicKey: new Uint8Array(key.public_key), counter: Number(key.counter), transports: key.transports } });
    if (!result.verified) return invalid(res);
    await db.query('UPDATE user_passkeys SET counter = $1, last_used_at = now() WHERE id = $2',
      [result.authenticationInfo.newCounter, key.id]);
    return await issueSession(res, { id: key.user_id, username: key.username, session_version: key.session_version });
  } catch (error) { console.error(error); return invalid(res, 401, 'Passkey verification failed'); }
});

router.post('/refresh', async (req, res) => {
  try {
    if (![origin, `https://${req.get('host')}`].includes(req.get('origin'))) return invalid(res, 403, 'Invalid request origin');
    const payload = jwt.verify(req.cookies?.refreshToken || '', process.env.JWT_SECRET);
    if (payload.type !== 'refresh') return invalid(res);
    if (!payload.jti) return invalid(res);
    const client = await db.connect();
    let user;
    let refreshToken;
    try {
      await client.query('BEGIN');
      const sessions = await client.query('SELECT * FROM refresh_sessions WHERE id = $1 FOR UPDATE', [payload.jti]);
      const prior = sessions.rows[0];
      const { rows } = await client.query(
        `SELECT u.*, EXISTS(SELECT 1 FROM user_passkeys p WHERE p.user_id = u.id) AS has_passkey
         FROM users u WHERE u.id = $1`, [payload.userId]);
      user = rows[0];
      if (!prior || prior.revoked_at || prior.user_id !== payload.userId ||
          new Date(prior.expires_at).getTime() <= Date.now() || !user?.enabled ||
          user.must_change_password || !user.has_passkey ||
          user.session_version !== payload.version || prior.session_version !== payload.version) {
        await client.query('ROLLBACK'); return invalid(res);
      }
      const sessionId = crypto.randomUUID();
      refreshToken = sign({ ...claim(user, 'refresh'), jti: sessionId }, '7d');
      await client.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [prior.id]);
      await client.query('INSERT INTO refresh_sessions (id, user_id, session_version, expires_at) VALUES ($1,$2,$3,$4)',
        [sessionId, user.id, user.session_version, new Date(Date.now() + 7 * 24 * 60 * MINUTE)]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    const accessToken = sign(claim(user, 'access'), '15m');
    res.cookie('refreshToken', refreshToken, { ...cookieOptions(), maxAge: 7 * 24 * 60 * MINUTE });
    setAccessCookie(res, accessToken);
    return res.json({ token: accessToken });
  } catch { return invalid(res); }
});
router.post('/logout', async (req, res) => {
  if (req.get('origin') && ![origin, `https://${req.get('host')}`].includes(req.get('origin')))
    return invalid(res, 403, 'Invalid request origin');
  try {
    const payload = jwt.verify(req.cookies?.refreshToken || '', process.env.JWT_SECRET);
    if (payload.type === 'refresh' && payload.jti)
      await db.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2',
        [payload.jti, payload.userId]);
  } catch { /* Expired cookies can still be cleared. */ }
  res.clearCookie('refreshToken', cookieOptions());
  res.clearCookie('accessToken', { ...cookieOptions(), domain: rpID, path: '/' });
  return res.json({ message: 'Signed out' });
});
router.get('/check', authenticateToken, (_req, res) => res.sendStatus(204));
router.get('/super-admin-contacts', async (_req, res) => {
  const { rows } = await db.query(
    'SELECT username FROM users WHERE super_admin = true AND enabled = true ORDER BY username');
  return res.json({ emails: rows.map((user) => user.username) });
});
router.post('/change-password', authenticateToken, async (req, res) => {
  const error = passwordError(req.body?.newPassword, req.user.username);
  if (error) return invalid(res, 400, error);
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
  if (!rows[0] || !(await verifyPassword(String(req.body?.currentPassword || ''), rows[0].password_hash))) return invalid(res);
  await db.query('UPDATE users SET password_hash = $1, session_version = session_version + 1 WHERE id = $2',
    [await hashPassword(req.body.newPassword), req.user.userId]);
  res.clearCookie('refreshToken', cookieOptions());
  res.clearCookie('accessToken', { ...cookieOptions(), domain: rpID, path: '/' });
  return res.json({ message: 'Password changed. Sign in again.' });
});
router.get('/me', authenticateToken, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, username, display_name, admin, super_admin, terminal_access FROM users WHERE id = $1',
    [req.user.userId]);
  if (!rows.length) return invalid(res);
  const user = rows[0];
  return res.json({ user: { userId: user.id, username: user.username, displayName: user.display_name,
    isAdmin: user.admin || user.super_admin, isSuperAdmin: user.super_admin,
    terminalAccess: user.terminal_access } });
});
router.get('/users', authenticateToken, requireAdmin, async (_req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.display_name, u.admin, u.super_admin,
            u.terminal_access, u.enabled, u.created_at,
            (u.enabled AND NOT EXISTS(
              SELECT 1 FROM user_passkeys p WHERE p.user_id = u.id
            )) AS needs_enrollment
     FROM users u ORDER BY u.created_at DESC LIMIT 500`);
  return res.json({ users: rows.map((user) => ({ id: user.id, username: user.username,
    displayName: user.display_name, isAdmin: user.admin || user.super_admin,
    isSuperAdmin: user.super_admin, terminalAccess: user.terminal_access,
    enabled: user.enabled, needsEnrollment: user.needs_enrollment,
    createdAt: user.created_at })) });
});
router.patch('/users/:username/admin', authenticateToken, requireSuperAdmin, async (req, res) => {
  const email = emailAddress(req.params.username);
  if (!email || typeof req.body?.admin !== 'boolean') return invalid(res, 400, 'Invalid role');
  if (email === req.user.username && !req.body.admin) return invalid(res, 400, 'Cannot remove own admin role');
  const { rowCount } = await db.query('UPDATE users SET admin = $1 WHERE username = $2 AND super_admin = false',
    [req.body.admin, email]);
  return rowCount ? res.json({ username: email, isAdmin: req.body.admin }) : invalid(res, 404, 'User not found');
});
router.patch('/users/:username/terminal-access', authenticateToken, requireAdmin, async (req, res) => {
  const email = emailAddress(req.params.username);
  if (!email || typeof req.body?.terminalAccess !== 'boolean') return invalid(res, 400, 'Invalid permission');
  const { rowCount } = await db.query('UPDATE users SET terminal_access = $1 WHERE username = $2',
    [req.body.terminalAccess, email]);
  return rowCount ? res.json({ terminalAccess: req.body.terminalAccess }) : invalid(res, 404, 'User not found');
});
router.post('/users/:username/reset-password', authenticateToken, requireSuperAdmin, async (req, res) => {
  const email = emailAddress(req.params.username);
  if (!email) return invalid(res, 400, 'Invalid email');
  if (nonInteractiveUsers.has(email)) return invalid(res, 409, 'This account cannot receive a temporary password');
  const temporaryPassword = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 48 * 60 * MINUTE);
  const { rowCount } = await db.query(
    `UPDATE users SET password_hash = $1, must_change_password = true,
      temp_password_expires_at = $2, session_version = session_version + 1
     WHERE username = $3 AND enabled = true`,
    [await hashPassword(temporaryPassword), expiresAt, email]);
  return rowCount ? res.json({ temporaryPassword, expiresAt }) : invalid(res, 404, 'User not found');
});
router.patch('/users/:username/enabled', authenticateToken, requireSuperAdmin, async (req, res) => {
  const email = emailAddress(req.params.username);
  if (!email || typeof req.body?.enabled !== 'boolean') return invalid(res, 400, 'Invalid status');
  if (nonInteractiveUsers.has(email)) return invalid(res, 409, 'This account cannot be changed here');
  if (email === req.user.username && !req.body.enabled) return invalid(res, 400, 'Cannot disable own account');
  const { rowCount } = await db.query(
    'UPDATE users SET enabled = $1, session_version = session_version + 1 WHERE username = $2 AND super_admin = false',
    [req.body.enabled, email]);
  return rowCount ? res.json({ enabled: req.body.enabled }) : invalid(res, 404, 'User not found');
});

module.exports = { router, authenticateToken, requireAdmin, requireSuperAdmin };
