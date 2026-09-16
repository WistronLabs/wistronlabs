const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { recordEvidenceHistory, hasDownloadedArchive } = require('../src/services/evidenceHistory');
const { createL11Scans } = require('../src/services/l11Scans');

test('evidence history attribution, same-location notes, Received context, and exactly-once download entries', async (t) => {
  const pg = new PGlite();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-history-'));
  t.after(async () => { await pg.close(); await fs.rm(root, { recursive: true, force: true }); });
  await pg.exec(`CREATE TABLE users(id serial PRIMARY KEY,username text UNIQUE,password_hash text,admin boolean DEFAULT false);
    CREATE TABLE system(id serial PRIMARY KEY,service_tag text,rack_service_tag text,location_id int);
    CREATE TABLE system_location_history(id serial PRIMARY KEY,system_id int,from_location_id int,to_location_id int,note text,moved_by int,changed_at timestamptz DEFAULT now());
    INSERT INTO users(username) VALUES ('uploader@example.test');
    INSERT INTO system(service_tag,rack_service_tag,location_id) VALUES ('ABC1234','RACK123',1);
    INSERT INTO system_location_history(system_id,to_location_id,note,moved_by,changed_at) VALUES(1,1,'Received',1,'2026-01-01T00:00:00Z');`);
  for (const migration of ['0016-persistent-l11-scans.sql', '0017-evidence-history.sql']) {
    await pg.exec(await fs.readFile(path.join(__dirname, '../db_migrations', migration), 'utf8'));
  }
  const db = { query: (...args) => pg.query(...args), connect: async () => ({ query: (...args) => pg.query(...args), release() {} }) };
  await recordEvidenceHistory(db, 1, 'MRB approval uploaded.', 1);
  await recordEvidenceHistory(db, 1, 'L11 logs from rack RACK123 uploaded manually.', 1);
  const source = await fs.readFile(path.join(__dirname, '../src/routes/systems.js'), 'utf8');
  const helper = source.slice(source.indexOf('async function getLatestReceivedAt('), source.indexOf('function normalizePendingL11MoveRule('));
  const context = vm.createContext({ RECEIVED_LOCATION_ID: 1 }); vm.runInContext(helper, context);
  assert.equal((await context.getLatestReceivedAt(db, 1)).toISOString(), '2026-01-01T00:00:00.000Z');
  let output = 'nothing to collect';
  const scans = createL11Scans({ db, submit: async () => ({ job_id: 'runner' }), getJob: async () => ({ status: 'succeeded', stdout: output }),
    hasDownloaded: (job, stdout) => hasDownloadedArchive(root, job, stdout) });
  const empty = await scans.request('ABC1234', 1, 'manual');
  assert.equal(empty.received_event_id, 1, 'notes do not become Received events');
  await scans.tick(); await scans.tick();
  assert.equal((await db.query('SELECT * FROM system_location_history WHERE evidence_scan_job_id IS NOT NULL')).rows.length, 0);
  const job = await scans.request('ABC1234', 1, 'batch');
  await scans.tick();
  await fs.mkdir(path.join(root, 'ABC1234'));
  const file = path.join(root, 'ABC1234', 'L11_logs_ST_ABC1234_RT_RACK123.tgz');
  await fs.writeFile(file, 'archive');
  output = '[hook] Moving tar to destination';
  await db.query('UPDATE system SET location_id=3 WHERE id=1');
  await scans.tick(); await scans.tick();
  const notes = (await db.query(`SELECT h.*,u.username FROM system_location_history h JOIN users u ON u.id=h.moved_by ORDER BY h.id`)).rows;
  assert.equal(notes.length, 4);
  assert.equal(notes[1].username, 'uploader@example.test');
  assert.equal(notes[1].from_location_id, 1); assert.equal(notes[1].to_location_id, 1);
  assert.equal(notes.at(-1).username, 'System');
  assert.equal(notes.at(-1).from_location_id, 3); assert.equal(notes.at(-1).to_location_id, 3);
  assert.equal(notes.at(-1).note, 'L11 logs from rack RACK123 downloaded successfully.');
  await recordEvidenceHistory(db, 1, 'duplicate', null, job.id);
  assert.equal((await db.query('SELECT * FROM system_location_history WHERE evidence_scan_job_id=$1', [job.id])).rows.length, 1);
  assert.equal(await hasDownloadedArchive(root, { service_tag:'ABC1234', rack_service_tag:'OTHER', started_at: new Date(0) }, output), false);
  assert.equal(await hasDownloadedArchive(root, { service_tag:'ABC1234', rack_service_tag:'RACK123', started_at: new Date(0) }, 'nothing to collect'), false);
});

test('support-photo endpoint credits uploader and removes the photo if history fails', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = await fs.readFile(path.join(__dirname, '../src/routes/systems.js'), 'utf8');
  const start = source.indexOf('router.post(\n  "/:service_tag/photos",');
  const end = source.indexOf('\nrouter.post(', start + 1);
  let handler, failHistory = false;
  const notes = [], queries = [];
  const client = { release() {}, async query(sql) { queries.push(sql); return { rows: [{ id: 7 }] }; } };
  const context = vm.createContext({
    router: { post(_route, ...handlers) { handler = handlers.at(-1); } }, authenticateToken() {},
    db: { connect: async () => client }, fs, path, PHOTO_UPLOAD_ROOT: root,
    safeServiceTagSegment: (tag) => tag, ALLOWED_PHOTO_MIME: new Set(['image/jpeg']),
    extensionFromMime: () => '.jpg', sanitizeBaseName: (name) => name, timestampSuffix: () => 'time',
    recordEvidenceHistory: async (_client, id, note, userId) => {
      if (failHistory) throw new Error('History unavailable');
      notes.push({ id, note, userId });
    }, console: { error() {} },
  });
  vm.runInContext(source.slice(start, end), context);
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  const request = { params: { service_tag: 'ABC1234' }, user: { userId: 42 }, file: { mimetype: 'image/jpeg', originalname: 'photo', buffer: Buffer.from('photo') } };
  await handler(request, response);
  assert.equal(response.code, 201);
  assert.deepEqual(notes, [{ id: 7, note: 'Support photo uploaded.', userId: 42 }]);
  assert.equal(queries.at(-1), 'COMMIT');
  failHistory = true;
  await handler({ ...request, file: { ...request.file, originalname: 'failed' } }, response);
  assert.equal(response.code, 500);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.deepEqual(await fs.readdir(path.join(root, 'ABC1234', 'photos')), ['photo_time.jpg']);
});
