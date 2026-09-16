const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const vm = require("vm");
const { createBatchUpdates, parseTags, validApproval } = require("../src/services/batchUpdates");
const goodSystem = { id: 1, service_tag: "ABC1234", rack_service_tag: "RACK123", location: "Pending L11 Logs",
  location_id: 3, factory_id: 1, ppid: "PPID", dpn_id: 1, manufactured_date: "2025-01-01", serial: "SERIAL", rev: "A" };

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "batch-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const received = new Date(Date.now() - 60000);
  const deps = {
    root, db: { query: async () => ({ rows: [] }) }, getLatestReceivedAt: async () => received,
    hasL11ArchiveForServiceTagAndRack: async (_root, tag, rack, since) => tag === "ABC1234" && rack === "RACK123" && +since === +received,
    hasAnyFileNewerThan: async () => true, systemOnLockedPallet: async () => false, ...overrides,
  };
  return { service: createBatchUpdates(deps), deps, received, root };
}

test("L11 eligibility requires matching current rack logs even when other evidence exists", async (t) => {
  const { service, deps } = await fixture(t);
  assert.equal((await service.inspect(deps.db, goodSystem, "RMA PID")).eligible, true);
  for (const rack_service_tag of ["", "OTHER_RACK"]) {
    const result = await service.inspect(deps.db, { ...goodSystem, rack_service_tag }, "RMA PID");
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.some((reason) => reason.includes("L11 logs")));
  }
});

test("MRB approval must be a nonempty supported file newer than Received; photos are still required", async (t) => {
  const { service, deps, received, root } = await fixture(t);
  const unit = { ...goodSystem, location: "Pending MRB" };
  const dir = path.join(root, unit.service_tag, "MRB Approvals");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "approval.pdf");
  await fs.writeFile(file, "%PDF-1.4 approval");
  await fs.utimes(file, received, received);
  assert.equal((await service.inspect(deps.db, unit, "RMA CID")).approval_found, false);
  const fresh = new Date(+received + 1000);
  await fs.utimes(file, fresh, fresh);
  assert.equal((await service.inspect(deps.db, unit, "RMA CID")).eligible, true);
  const noPhotos = createBatchUpdates({ ...deps, hasAnyFileNewerThan: async (dir) => !dir.endsWith("photos") });
  assert.match((await noPhotos.inspect(deps.db, unit, "RMA CID")).reasons.join(" "), /Damage photos/);
});

test("locked pallets, incomplete PPID fields, and current good parts block otherwise eligible units", async (t) => {
  const { service, deps } = await fixture(t, { systemOnLockedPallet: async () => true, db: { query: async () => ({ rows: [{}] }) } });
  const result = await service.inspect(deps.db, { ...goodSystem, ppid: null }, "RMA PID");
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(" "), /locked pallet/);
  assert.match(result.reasons.join(" "), /good parts/);
  assert.match(result.reasons.join(" "), /ppid/);
});

test("tags normalize and deduplicate; supported document bytes are checked", () => {
  assert.deepEqual(parseTags("abc1234, ABC1234\nDEF5678"), ["ABC1234", "DEF5678"]);
  assert.throws(() => parseTags("../ABC1234"));
  assert.equal(validApproval("approval.pdf", Buffer.from("%PDF-1.4\n")), true);
  assert.equal(validApproval("approval.pdf", Buffer.from("<script>")), false);
  assert.equal(validApproval("approval.eml", Buffer.from("From: approver@example.test\r\nSubject: Approved\r\n\r\nApproved")), true);
  assert.equal(validApproval("approval.msg", Buffer.from("d0cf11e0a1b11e1", "hex")), true);
  assert.equal(validApproval("approval.exe", Buffer.from("%PDF-1.4")), false);
});

test("batch movement only processes selected tags and preserves common note and per-unit failures", async (t) => {
  const calls = [];
  const { service } = await fixture(t, {
    db: { query: async () => ({ rows: [{ id: 8 }] }) },
    moveSystemLocation: async (input) => {
      calls.push(input);
      if (input.service_tag === "FAIL123") throw new Error("Location changed since review.");
      return { pallet_number: "P123" };
    },
  });
  const handlers = {};
  service.register({ get() {}, post(route, ...middleware) { handlers[route] = middleware.at(-1); } }, () => {});
  let body;
  const response = { json(value) { body = value; }, status() { return this; } };
  await handlers["/batch-updates/move"]({ body: { flow: "l11", service_tags: ["ABC1234", "FAIL123"], note: "Customer approved return" }, user: { userId: 42 } }, response);
  assert.deepEqual(body.results.map((row) => row.status), ["moved", "failed"]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.note === "Customer approved return" && call.userId === 42 && call.expectedFrom === "Pending L11 Logs"));
});

// Exercise the actual shared transaction used by both the single-unit and batch endpoints.
async function loadMovement(readiness, currentLocation = "Pending L11 Logs") {
  const text = await fs.readFile(path.join(__dirname, "../src/routes/systems.js"), "utf8");
  const source = text.slice(text.indexOf("async function moveSystemLocation("), text.indexOf('router.patch("/:service_tag/location"'));
  const queries = [];
  const client = { release() {}, async query(sql, values) {
    queries.push({ sql, values });
    if (sql.includes("FROM system ")) return { rows: [goodSystem] };
    if (sql.includes("SELECT name FROM location")) return { rows: [{ name: values[0] === 8 ? "RMA PID" : currentLocation }] };
    if (sql.includes("SELECT changed_at")) return { rows: [{ changed_at: new Date(0) }] };
    return { rows: [] };
  } };
  const context = vm.createContext({
    l11Scans: { enqueue: async (_client, tag, userId, trigger) => queries.push({sql:"ENQUEUE_SCAN",values:[tag,userId,trigger]}) },
    db: { connect: async () => client }, batchUpdates: { inspect: async () => readiness },
    RMA_LOCATION_IDS: [6, 7, 8], RMA_CID_LOCATION_ID: 7, RESOLVED_LOCATION_IDS: [6, 7, 8, 9, 10],
    PENDING_L11_LOGS_LOCATION_ID: 3, RECEIVED_LOCATION_ID: 1, PENDING_MRB_LOCATION_NAME: "Pending MRB",
    PHOTO_UPLOAD_ROOT: "/tmp/logs", isPendingMrbLocationName: (name) => name === "Pending MRB",
    firstExistingDir: async () => "/tmp/logs", safeServiceTagSegment: (tag) => tag,
    hasAnyFileNewerThan: async () => true, systemOnLockedPallet: async () => false,
    assignSystemToPallet: async () => ({ pallet_number: "P123" }), path, process,
    console: { error() {} },
  });
  vm.runInContext(source, context);
  return { move: context.moveSystemLocation, queries };
}

test("moving into Received enqueues a scan before commit even with an unchanged rack", async () => {
  const { move, queries } = await loadMovement({ reasons: [] }, "RMA PID");
  await move({service_tag:"ABC1234",to_location_id:1,note:"Received again",userId:42});
  assert.deepEqual(queries.find(item=>item.sql==="ENQUEUE_SCAN").values,["ABC1234",42,"received"]);
  assert.equal(queries.at(-2).sql,"ENQUEUE_SCAN");
  assert.equal(queries.at(-1).sql,"COMMIT");
});

test("shared movement rejects stale selection and rolls back without updates", async () => {
  const { move, queries } = await loadMovement({ reasons: [] }, "In Debug - Wistron");
  await assert.rejects(move({ service_tag: "ABC1234", to_location_id: 8, note: "note", expectedFrom: "Pending L11 Logs", userId: 1 }), /Location changed/);
  assert.ok(queries.some((entry) => entry.sql === "ROLLBACK"));
  assert.ok(!queries.some((entry) => entry.sql.includes("UPDATE system")));
});

test("shared movement checks evidence and successful moves commit pallet and history", async () => {
  const blocked = await loadMovement({ reasons: ["L11 logs required."] });
  await assert.rejects(blocked.move({ service_tag: "ABC1234", to_location_id: 8, note: "note", userId: 1 }), /L11 logs required/);
  const ready = await loadMovement({ reasons: [] });
  const result = await ready.move({ service_tag: "ABC1234", to_location_id: 8, note: "Shared note", userId: 42 });
  assert.equal(result.pallet_number, "P123");
  const history = ready.queries.find((entry) => entry.sql.includes("INSERT INTO system_location_history"));
  assert.equal(history.values[3], "Shared note - added to P123");
  assert.equal(history.values[4], 42);
  assert.ok(ready.queries.some((entry) => entry.sql.includes("FOR UPDATE")));
  assert.equal(ready.queries.at(-1).sql, "COMMIT");
});

function multipartRequest(tags, fileName, bytes, field = "approval", extra = {}) {
  const { Readable } = require("stream");
  const boundary = "wistron-test-boundary";
  const fields = { service_tags: tags, ...extra };
  const chunks = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  chunks.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  const req = Readable.from([body]);
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length) };
  req.method = "POST"; req.params = {}; req.user = { userId: 42 };
  return req;
}
function invokeUpload(service, route, req) {
  const handlers = {};
  service.register({ get() {}, post(name, ...middleware) { handlers[name] = middleware.at(-1); } }, () => {});
  return new Promise((resolve, reject) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ code: this.statusCode, body }); } };
    try { handlers[route](req, response); } catch (err) { reject(err); }
  });
}

test("one approval document is copied only to selected Pending MRB units missing current approval", async (t) => {
  const received = new Date(Date.now() - 60000);
  const units = {
    ABC1234: { ...goodSystem, location: "Pending MRB" },
    DEF5678: { ...goodSystem, id: 2, service_tag: "DEF5678", location: "Pending MRB" },
    WRONG12: { ...goodSystem, id: 3, service_tag: "WRONG12", location: "In Debug - Wistron" },
  };
  const evidenceNotes = [];
  const client = { release() {}, async query(sql, values) {
    if (sql.includes("INSERT INTO system_location_history")) evidenceNotes.push(values);
    if (sql.includes("SELECT id, location_id FROM system")) return { rows: Object.values(units).filter(unit => unit.id === values[0]) };
    if (sql.includes("FROM system s")) return { rows: units[values[0]] ? [units[values[0]]] : [] };
    return { rows: [] };
  } };
  const { service, root } = await fixture(t, { db: { connect: async () => client }, getLatestReceivedAt: async () => received });
  const bytes = Buffer.from("%PDF-1.4\napproval fixture");
  const result = await invokeUpload(service, "/batch-updates/mrb-approval", multipartRequest("ABC1234,DEF5678,WRONG12,UNKNOWN", "approval.pdf", bytes));
  assert.equal(result.code, 200);
  assert.deepEqual(result.body.results.map((row) => row.status), ["uploaded", "uploaded", "failed", "failed"]);
  for (const tag of ["ABC1234", "DEF5678"]) {
    const dir = path.join(root, tag, "MRB Approvals");
    const files = await fs.readdir(dir);
    assert.equal(files.length, 1);
    assert.deepEqual(await fs.readFile(path.join(dir, files[0])), bytes);
  }
  await assert.rejects(fs.access(path.join(root, "WRONG12")));
  const again = await invokeUpload(service, "/batch-updates/mrb-approval", multipartRequest("ABC1234", "approval.pdf", bytes));
  assert.equal(again.body.results[0].status, "skipped");
  assert.equal(evidenceNotes.length, 2);
  assert.ok(evidenceNotes.every(values => values[2] === "MRB approval uploaded." && values[3] === 42));
});

test("batch archive writes matching L11 archives and reports unknown and missing-rack units", async (t) => {
  const { promisify } = require("util");
  const exec = promisify(require("child_process").execFile);
  const units = {
    ABC1234: goodSystem,
    NORACK1: { ...goodSystem, service_tag: "NORACK1", rack_service_tag: "" },
    EXTRA12: { ...goodSystem, service_tag: "EXTRA12" },
    HASLOGS: { ...goodSystem, service_tag: "HASLOGS" },
    WRONG12: { ...goodSystem, service_tag: "WRONG12", location: "Pending MRB" },
    NOEVENT: { ...goodSystem, id: 99, service_tag: "NOEVENT" },
    MISSING: { ...goodSystem, service_tag: "MISSING" },
  };
  const evidenceNotes = [];
  const client = { release() {}, async query(sql, values) {
    if (sql === "SELECT service_tag FROM system") return { rows: Object.values(units) };
    if (sql.includes("INSERT INTO system_location_history")) evidenceNotes.push(values);
    if (sql.includes("SELECT id, location_id FROM system")) return { rows: Object.values(units).filter(unit => unit.id === values[0]) };
    if (sql.includes("FROM system s")) return { rows: units[values[0]] ? [units[values[0]]] : [] };
    return { rows: [] };
  } };
  const { service, root } = await fixture(t, {
    db: { connect: async () => client, query: client.query }, hasL11ArchiveForServiceTagAndRack: async (_root, tag) => tag === "HASLOGS",
    getLatestReceivedAt: async (_client, id) => id === 99 ? null : new Date(Date.now() - 60000),
    runTar: async (args) => exec("tar", args),
  });
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "batch-archive-fixture-"));
  t.after(() => fs.rm(source, { recursive: true, force: true }));
  for (const tag of ["ABC1234", "NORACK1", "UNKNOWN", "EXTRA12", "HASLOGS", "WRONG12", "NOEVENT"]) {
    await fs.mkdir(path.join(source, tag)); await fs.writeFile(path.join(source, tag, "log.txt"), "log fixture");
  }
  const archive = path.join(source, "fixture.tgz");
  await exec("tar", ["-czf", archive, "-C", source, "ABC1234", "NORACK1", "UNKNOWN", "EXTRA12", "HASLOGS", "WRONG12", "NOEVENT"]);
  for (const wrapped of [false, true]) {
    const previewArchive = path.join(source, "preview.tgz");
    if (wrapped) {
      const wrapper = path.join(source, "collection");
      await fs.mkdir(wrapper);
      for (const tag of ["ABC1234", "NORACK1", "UNKNOWN", "EXTRA12", "HASLOGS", "WRONG12", "NOEVENT"]) await fs.cp(path.join(source, tag), path.join(wrapper, tag), { recursive: true });
      await exec("tar", ["-czf", previewArchive, "-C", source, "collection"]);
    } else await fs.copyFile(archive, previewArchive);
    const preview = await invokeUpload(service, "/batch-updates/l11-archive/preview", multipartRequest("", "batch.tgz", await fs.readFile(previewArchive), "archive"));
    assert.equal(preview.code, 200, JSON.stringify(preview.body));
    assert.deepEqual(preview.body.results.filter(row => row.status === "matched").map(row => row.service_tag), ["ABC1234", "EXTRA12"]);
    assert.match(preview.body.results.find(row => row.service_tag === "NORACK1").message, /rack service tag/);
    assert.match(preview.body.results.find(row => row.service_tag === "UNKNOWN").message, /Unknown/);
    assert.match(preview.body.results.find(row => row.service_tag === "HASLOGS").message, /already exist/);
    assert.match(preview.body.results.find(row => row.service_tag === "WRONG12").message, /not in Pending L11/);
    assert.match(preview.body.results.find(row => row.service_tag === "NOEVENT").message, /No Received/);
    assert.deepEqual(await fs.readdir(root), [], "Preview must not publish evidence or build system archives");
  }
  const result = await invokeUpload(service, "/batch-updates/l11-archive", multipartRequest("ABC1234,NORACK1,UNKNOWN,MISSING", "batch.tgz", await fs.readFile(archive), "archive"));
  assert.equal(result.code, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.results.map((row) => row.status), ["uploaded", "skipped", "skipped", "skipped"]);
  const output = path.join(root, "ABC1234/L11_logs_ST_ABC1234_RT_RACK123.tgz");
  const { stdout } = await exec("tar", ["-xOf", output, "ABC1234/log.txt"]);
  assert.equal(stdout, "log fixture");
  await assert.rejects(fs.access(path.join(root, "NORACK1")));
  await assert.rejects(fs.access(path.join(root, "EXTRA12")));
  assert.match(result.body.results.find((row) => row.service_tag === "MISSING").message, /No log folder found/);
  assert.ok(!result.body.results.some((row) => row.service_tag === "EXTRA12"));
  assert.equal(evidenceNotes.length, 1);
  assert.equal(evidenceNotes[0][2], "L11 logs from rack RACK123 uploaded manually.");
  assert.equal(evidenceNotes[0][3], 42);
});
