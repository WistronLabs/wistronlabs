const { recordEvidenceHistory } = require("./evidenceHistory");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const multer = require("multer");
const execFileAsync = promisify(execFile);

const FLOWS = {
  l11: { from: "Pending L11 Logs", to: "RMA PID" },
  mrb: { from: "Pending MRB", to: "RMA CID" },
};
const APPROVAL_FOLDER = "MRB Approvals";
const APPROVAL_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".pdf", ".msg", ".eml"]);
const positive = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const LIMITS = {
  archive_bytes: positive(process.env.BATCH_L11_MAX_ARCHIVE_BYTES, 1024 ** 3),
  expanded_bytes: positive(process.env.BATCH_L11_MAX_EXPANDED_BYTES, 5 * 1024 ** 3),
  archive_files: positive(process.env.BATCH_L11_MAX_FILES, 10000),
  systems: positive(process.env.BATCH_UPDATE_MAX_SYSTEMS, 500),
  approval_bytes: positive(process.env.MRB_APPROVAL_MAX_BYTES, 25 * 1024 ** 2),
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function parseTags(raw) {
  const values = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,;]+/);
  const tags = [...new Set(values.map((tag) => String(tag).trim().toUpperCase()).filter(Boolean))];
  if (!tags.length) throw fail("Select at least one system.");
  if (tags.length > LIMITS.systems) throw fail(`Select at most ${LIMITS.systems} systems.`);
  if (tags.some((tag) => !/^[A-Z0-9_-]+$/.test(tag))) throw fail("Invalid service tag.");
  return tags;
}

// Validate bytes as well as extensions; approval files are served as downloads.
function validApproval(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  if (!APPROVAL_EXTENSIONS.has(ext)) return false;
  if (ext === ".pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  if (ext === ".msg") return bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11e1", "hex"));
  if (ext === ".eml") {
    const headers = bytes.toString("utf8").split(/\r?\n\r?\n/)[0];
    return /^from:\s*\S/im.test(headers) && /^(date|subject|to):\s*\S/im.test(headers);
  }
  if ([".jpg", ".jpeg"].includes(ext)) return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (ext === ".png") return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (ext === ".webp") return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  return bytes.subarray(4, 8).toString() === "ftyp" && /heic|heix|hevc|hevx|mif1|msf1/.test(bytes.subarray(8, 32).toString());
}

function createBatchUpdates({ db, root, getLatestReceivedAt, hasL11ArchiveForServiceTagAndRack, hasAnyFileNewerThan, systemOnLockedPallet, runTar, moveSystemLocation }) {
  async function approvals(serviceTag, receivedAt) {
    const dir = path.join(root, serviceTag, APPROVAL_FOLDER);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err) => {
      if (err.code === "ENOENT") return [];
      throw err;
    });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !APPROVAL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(path.join(dir, entry.name));
      files.push({ name: entry.name, uploaded_at: stat.mtime.toISOString(), current: !!receivedAt && stat.size > 0 && stat.mtime > new Date(receivedAt) });
    }
    return { found: files.some((file) => file.current), files };
  }

  async function inspect(client, system, destination) {
    const receivedAt = await getLatestReceivedAt(client, system.id);
    const reasons = [];
    const rack = String(system.rack_service_tag || "").trim().toUpperCase();
    const l11 = !!receivedAt && !!rack && await hasL11ArchiveForServiceTagAndRack(root, system.service_tag, rack, receivedAt);
    const approval = await approvals(system.service_tag, receivedAt);
    if (!receivedAt) reasons.push("No Received event found.");
    if (system.location === FLOWS.l11.from && destination === FLOWS.l11.to) {
      if (!rack) reasons.push("Current rack service tag is missing.");
      if (!l11) reasons.push("L11 logs for the current rack must be uploaded after the latest Received event.");
    }
    if (destination === FLOWS.mrb.to) {
      if (!approval.found) reasons.push("Upload MRB approval after the latest Received event before moving to RMA CID.");
      if (!await hasAnyFileNewerThan(path.join(root, system.service_tag, "photos"), receivedAt)) {
        reasons.push("Damage photos must be uploaded after the latest Received event.");
      }
    }
    if (!await hasAnyFileNewerThan(path.join(root, system.service_tag), receivedAt)) reasons.push("New evidence is required since the latest Received event.");
    const missing = ["factory_id", "ppid", "dpn_id", "manufactured_date", "serial", "rev"].filter((key) => !system[key]);
    if (missing.length) reasons.push(`Update PPID: missing ${missing.join(", ")}.`);
    if (await systemOnLockedPallet(client, system.id)) reasons.push("System is on a locked pallet.");
    const good = await client.query(
      `SELECT 1 FROM part_list WHERE unit_id = $1 AND is_functional = true
       AND ($2::timestamptz IS NULL OR COALESCE(updated_at, created_at) > $2::timestamptz) LIMIT 1`,
      [system.id, receivedAt],
    );
    if (good.rows.length) reasons.push("Remove or return good parts added or updated since the latest Received event.");
    return { service_tag: system.service_tag, rack_service_tag: rack, location: system.location,
      l11_found: l11, approval_found: approval.found, reasons, eligible: reasons.length === 0 };
  }

  async function findSystem(client, tag, lock = false) {
    const { rows } = await client.query(
      `SELECT s.*, l.name AS location FROM system s JOIN location l ON l.id = s.location_id
       WHERE s.service_tag = $1${lock ? " FOR UPDATE OF s" : ""}`, [tag],
    );
    if (!rows.length) throw fail("Unknown service tag.", 404);
    return rows[0];
  }

  const wrap = (handler) => async (req, res) => {
    try { await handler(req, res); }
    catch (err) {
      console.error("Batch update:", err);
      res.status(err.status || 500).json({ error: err.status ? err.message : "Operation failed. Please retry." });
    }
  };
  // Spool archives to disk rather than keeping a large upload in Node's heap.
  function upload(field, limit, handler) {
    const middleware = multer({ dest: os.tmpdir(), limits: { fileSize: limit, files: 1, fields: 2, fieldSize: 65536 } }).single(field);
    return (req, res) => middleware(req, res, async (err) => {
      try {
        if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? `File exceeds the ${limit} byte upload limit.` : err.message });
        if (!req.file) return res.status(400).json({ error: "Choose a file." });
        await wrap(handler)(req, res);
      } finally {
        if (req.file?.path) await fs.rm(req.file.path, { force: true }).catch(() => {});
      }
    });
  }

  async function uploadApproval(req, res) {
    const tags = parseTags(req.params.service_tag || req.body.service_tags);
    const bytes = await fs.readFile(req.file.path);
    if (!validApproval(req.file.originalname, bytes)) throw fail("Upload a valid image, PDF, Outlook .msg, or .eml file.");
    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
    const name = `${Date.now()}_${randomUUID()}_${safeName}`;
    const results = [];
    for (const tag of tags) {
      const client = await db.connect();
      let written;
      try {
        await client.query("BEGIN");
        const system = await findSystem(client, tag, true);
        if (system.location !== FLOWS.mrb.from) throw fail("System is no longer in Pending MRB.");
        const receivedAt = await getLatestReceivedAt(client, system.id);
        if (!receivedAt) throw fail("No Received event found.");
        if ((await approvals(tag, receivedAt)).found) {
          await client.query("ROLLBACK");
          results.push({ service_tag: tag, status: "skipped", message: "Current approval already exists." });
          continue;
        }
        const dir = path.join(root, tag, APPROVAL_FOLDER);
        await fs.mkdir(dir, { recursive: true });
        written = path.join(dir, name);
        await fs.writeFile(written, bytes, { flag: "wx" });
        await recordEvidenceHistory(client, system.id, "MRB approval uploaded.", req.user.userId);
        await client.query("COMMIT");
        results.push({ service_tag: tag, status: "uploaded", message: "MRB approval uploaded." });
      } catch (err) {
        await client.query("ROLLBACK");
        if (written) await fs.rm(written, { force: true });
        results.push({ service_tag: tag, status: "failed", message: err.message });
      } finally { client.release(); }
    }
    res.json({ results });
  }

  async function processArchive(file, destination, inspectOnly = false) {
    if (!/\.(zip|tar|tar\.gz|tgz)$/i.test(file.originalname)) throw fail("Choose a ZIP, TAR, TAR.GZ, or TGZ archive.");
    // Use the same known tags for preview and submission, even after selection edits.
    const { rows } = await db.query("SELECT service_tag FROM system");
    const hints = path.join(destination, ".known-tags.json");
    await fs.writeFile(hints, JSON.stringify(rows.map((row) => row.service_tag)));
    try {
      const { stdout } = await execFileAsync(process.env.PYTHON_BIN || "python3", [
        path.join(__dirname, "../scripts/extract_batch_logs.py"), file.path, destination,
        String(LIMITS.expanded_bytes), String(LIMITS.archive_files), String(LIMITS.systems),
        `@${hints}`, ...(inspectOnly ? ["--inspect"] : []),
      ], { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (err) {
      if (err.code === "ENOENT") throw fail("Archive processing is unavailable: Python 3 is required on the backend.", 503);
      throw fail(String(err.stderr || "Unable to read archive within the configured limits.").trim().slice(-1000));
    } finally { await fs.rm(hints, { force: true }); }
  }

  async function previewArchive(req, res) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "batch-l11-preview-"));
    try {
      const tags = await processArchive(req.file, tempDir, true);
      const results = [];
      for (const tag of tags) {
        try {
          const system = await findSystem(db, tag);
          if (system.location !== FLOWS.l11.from) throw fail("System is not in Pending L11 Logs.");
          const rack = String(system.rack_service_tag || "").trim().toUpperCase();
          if (!/^[A-Z0-9_-]+$/.test(rack)) throw fail("Current rack service tag is missing or invalid.");
          const receivedAt = await getLatestReceivedAt(db, system.id);
          if (!receivedAt) throw fail("No Received event found.");
          if (await hasL11ArchiveForServiceTagAndRack(root, tag, rack, receivedAt)) throw fail("Current L11 logs already exist.");
          results.push({ service_tag: tag, status: "matched", message: "Matching log folder; ready for upload." });
        } catch (err) {
          if (!err.status) throw err;
          results.push({ service_tag: tag, status: "skipped", message: err.message });
        }
      }
      res.json({ results });
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  }

  async function uploadArchive(req, res) {
    const tags = parseTags(req.body.service_tags);
    if (!/\.(zip|tar|tar\.gz|tgz)$/i.test(req.file.originalname)) throw fail("Choose a ZIP, TAR, TAR.GZ, or TGZ archive.");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "batch-l11-"));
    try {
      await processArchive(req.file, tempDir);
      const archiveTags = new Set(await fs.readdir(tempDir));
      const results = [];
      for (const tag of tags) {
        const client = await db.connect();
        let publishedPath = null, backupPath = null;
        try {
          await client.query("BEGIN");
          const system = await findSystem(client, tag, true);
          if (system.location !== FLOWS.l11.from) throw fail("System is not in Pending L11 Logs.");
          const rack = String(system.rack_service_tag || "").trim().toUpperCase();
          if (!/^[A-Z0-9_-]+$/.test(rack)) throw fail("Current rack service tag is missing or invalid.");
          const receivedAt = await getLatestReceivedAt(client, system.id);
          if (!receivedAt) throw fail("No Received event found.");
          if (await hasL11ArchiveForServiceTagAndRack(root, tag, rack, receivedAt)) {
            results.push({ service_tag: tag, status: "skipped", message: "Current L11 logs already exist." });
          } else {
            if (!archiveTags.has(tag)) throw fail("No log folder found for this selected service tag in the archive.");
            const name = `L11_logs_ST_${tag}_RT_${rack}.tgz`;
            // Build outside the service folder, then publish the complete archive atomically.
            const staging = path.join(tempDir, `${tag}.tgz`);
            await runTar(["-czf", staging, "-C", tempDir, tag]);
            const dir = path.join(root, tag);
            await fs.mkdir(dir, { recursive: true });
            const pending = path.join(dir, `.${randomUUID()}.tmp`);
            try {
              await fs.copyFile(staging, pending);
              const target = path.join(dir, name);
              try {
                const previous = path.join(tempDir, `${tag}.previous.tgz`);
                await fs.copyFile(target, previous); backupPath = previous;
              } catch (error) { if (error.code !== "ENOENT") throw error; }
              publishedPath = target;
              await fs.rename(pending, target);
            } finally { await fs.rm(pending, { force: true }); }
            await recordEvidenceHistory(client, system.id, `L11 logs from rack ${rack} uploaded manually.`, req.user.userId);
            results.push({ service_tag: tag, status: "uploaded", message: "L11 logs archived." });
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          if (publishedPath) {
            if (backupPath) await fs.copyFile(backupPath, publishedPath);
            else await fs.rm(publishedPath, { force: true });
          }
          results.push({ service_tag: tag, status: "skipped", message: err.message });
        } finally { client.release(); }
      }
      res.json({ results });
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  }

  function register(router, authenticateToken) {
    router.get("/batch-updates", authenticateToken, wrap(async (req, res) => {
      const flow = Object.hasOwn(FLOWS, req.query.flow) ? FLOWS[req.query.flow] : null;
      if (!flow) throw fail("Choose the L11 or MRB workflow.");
      const { rows } = await db.query("SELECT s.*, l.name AS location FROM system s JOIN location l ON l.id = s.location_id WHERE l.name = $1 ORDER BY s.service_tag", [flow.from]);
      const data = [];
      for (const system of rows) {
        try { data.push(await inspect(db, system, flow.to)); }
        catch { data.push({ service_tag: system.service_tag, location: system.location, eligible: false, reasons: ["Unable to check this unit. Refresh and retry."] }); }
      }
      res.json({ data, limits: LIMITS });
    }));
    router.post("/batch-updates/move", authenticateToken, wrap(async (req, res) => {
      const flow = Object.hasOwn(FLOWS, req.body.flow) ? FLOWS[req.body.flow] : null;
      if (!flow) throw fail("Choose the L11 or MRB workflow.");
      const tags = parseTags(req.body.service_tags);
      const commonNote = String(req.body.note || "").trim();
      if (!commonNote || commonNote.length > 4000) throw fail("Enter a common note (up to 4000 characters).");
      const { rows } = await db.query("SELECT id FROM location WHERE name = $1", [flow.to]);
      if (!rows.length) throw fail("Destination location is unavailable.", 409);
      const results = [];
      for (const service_tag of tags) {
        try {
          const result = await moveSystemLocation({ service_tag, to_location_id: rows[0].id, expectedFrom: flow.from,
            note: commonNote, userId: req.user.userId });
          results.push({ service_tag, status: "moved", message: `Moved to ${flow.to}.`, ...result });
        } catch (err) { results.push({ service_tag, status: "failed", message: err.message }); }
      }
      res.json({ results });
    }));
    router.post("/batch-updates/l11-archive/preview", authenticateToken, upload("archive", LIMITS.archive_bytes, previewArchive));
    router.post("/batch-updates/l11-archive", authenticateToken, upload("archive", LIMITS.archive_bytes, uploadArchive));
    router.post("/batch-updates/mrb-approval", authenticateToken, upload("approval", LIMITS.approval_bytes, uploadApproval));
    router.post("/:service_tag/mrb-approvals", authenticateToken, upload("approval", LIMITS.approval_bytes, uploadApproval));
    router.get("/:service_tag/mrb-approvals", wrap(async (req, res) => {
      const [tag] = parseTags(req.params.service_tag);
      const system = await findSystem(db, tag);
      res.json(await approvals(tag, await getLatestReceivedAt(db, system.id)));
    }));
    router.get("/:service_tag/mrb-approvals/file", wrap(async (req, res) => {
      const [tag] = parseTags(req.params.service_tag);
      const name = String(req.query.name || "");
      if (!name || path.basename(name) !== name || name.includes("\\") || !APPROVAL_EXTENSIONS.has(path.extname(name).toLowerCase())) throw fail("Invalid approval filename.");
      const file = path.join(root, tag, APPROVAL_FOLDER, name);
      const stat = await fs.lstat(file).catch(() => null);
      if (!stat?.isFile()) throw fail("Approval not found.", 404);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.download(file, name);
    }));
  }
  return { inspect, approvals, register };
}
module.exports = { createBatchUpdates, validApproval, parseTags, LIMITS, FLOWS };
