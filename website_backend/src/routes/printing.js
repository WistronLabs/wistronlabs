const express = require("express");
const multer = require("multer");
const db = require("../db");
const { ensureAdmin } = require("../utils/ensureAdmin");
const { SETTING_KEY, DOCUMENTS, DEFAULT_PRINTERS, DEFAULT_PROFILES, validatePrinters, validateProfiles, listQueues, listQueueDevices, listQueueMedia, submitPdf } = require("../services/printing");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const recentJobs = new Map();
function limitPrintJobs(req, res, next) {
  const userId = String(req.user?.userId || "");
  const now = Date.now();
  const recent = (recentJobs.get(userId) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 10) return res.status(429).json({ error: "Too many print jobs. Try again in a minute." });
  recent.push(now);
  recentJobs.set(userId, recent);
  return next();
}
const receivePdf = (req, res, next) => upload.single("pdf")(req, res, (error) => {
  if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "PDF upload failed or exceeded 15 MB" });
  return next();
});

async function getSettings() {
  const { rows } = await db.query("SELECT value_json FROM global_settings WHERE key = $1", [SETTING_KEY]);
  const saved = rows[0]?.value_json || {};
  return {
    printers: Array.isArray(saved.printers) ? saved.printers : DEFAULT_PRINTERS,
    profiles: Object.fromEntries(Object.entries(DEFAULT_PROFILES).map(([kind, defaults]) => {
      const stored = saved.profiles?.[kind] || {};
      return [kind, {
        printer: stored.printer ?? defaults.printer,
        media: stored.media ?? defaults.media,
        copies: stored.copies ?? defaults.copies,
        orientation: stored.orientation ?? defaults.orientation,
        scaling: stored.scaling ?? defaults.scaling,
      }];
    })),
  };
}

router.get("/settings", async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json({ documents: DOCUMENTS, ...settings });
  } catch (error) {
    console.error("Failed to load printing settings", error);
    res.status(500).json({ error: "Failed to load printing settings" });
  }
});

router.get("/queues", ensureAdmin, async (_req, res) => {
  try {
    const queues = await listQueues();
    const [devices, mediaResults] = await Promise.all([
      listQueueDevices(),
      Promise.all(queues.map(async (queue) => {
        try { return { queue, sizes: await listQueueMedia(queue) }; }
        catch (error) { return { queue, sizes: [], error: error.message }; }
      })),
    ]);
    res.json({
      queues,
      devices,
      media: Object.fromEntries(mediaResults.map(({ queue, sizes }) => [queue, sizes])),
      mediaErrors: Object.fromEntries(mediaResults.filter(({ error }) => error).map(({ queue, error }) => [queue, error])),
    });
  }
  catch (error) { res.status(503).json({ error: `CUPS is unavailable: ${error.message}` }); }
});

router.put("/settings", ensureAdmin, async (req, res) => {
  let available;
  try { available = await listQueues(); }
  catch (error) { return res.status(503).json({ error: `CUPS is unavailable: ${error.message}` }); }
  try {
    const printers = validatePrinters(req.body?.printers, available);
    const profiles = validateProfiles(req.body.profiles, printers);
    let mediaByQueue;
    try {
      mediaByQueue = Object.fromEntries(await Promise.all(printers.filter((printer) => printer.queue)
        .map(async (printer) => [printer.queue, await listQueueMedia(printer.queue)])));
    } catch (error) {
      return res.status(503).json({ error: `Could not read printer sizes from CUPS: ${error.message}` });
    }
    for (const [kind, profile] of Object.entries(profiles)) {
      const queue = printers.find((printer) => printer.id === profile.printer)?.queue;
      const supported = mediaByQueue[queue];
      if (supported?.length && !supported.includes(profile.media)) {
        return res.status(400).json({ error: `${profile.media} is not a supported size for ${DOCUMENTS[kind].name} on ${queue}` });
      }
    }
    const settings = { printers, profiles };
    await db.query(`INSERT INTO global_settings (key, value_json, updated_at) VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [SETTING_KEY, JSON.stringify(settings)]);
    res.json({ documents: DOCUMENTS, ...settings });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/jobs", limitPrintJobs, receivePdf, async (req, res) => {
  try {
    if (!Object.hasOwn(DOCUMENTS, req.body?.kind)) return res.status(400).json({ error: "Unknown document type" });
    const bytes = req.file?.buffer;
    if (!bytes || bytes.length < 8 || bytes.subarray(0, 5).toString() !== "%PDF-") {
      return res.status(400).json({ error: "A valid PDF is required" });
    }
    const settings = await getSettings();
    let overrides = {};
    try { overrides = JSON.parse(req.body.options || "{}"); }
    catch { return res.status(400).json({ error: "Invalid print options" }); }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return res.status(400).json({ error: "Invalid print options" });
    const allowed = ["copies", "orientation", "scaling", "prepared"];
    if (Object.keys(overrides).some((key) => !allowed.includes(key))) return res.status(400).json({ error: "Unsupported print option" });
    if (Object.hasOwn(overrides, "prepared") && overrides.prepared !== true) return res.status(400).json({ error: "Invalid prepared print option" });
    const { prepared = false, ...profileOverrides } = overrides;
    const configured = settings.profiles[req.body.kind];
    let profile;
    try { profile = validateProfiles({ ...settings.profiles, [req.body.kind]: { ...configured, ...profileOverrides } }, settings.printers)[req.body.kind]; }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const queue = settings.printers.find((printer) => printer.id === profile.printer)?.queue;
    if (!queue) return res.status(409).json({ error: "This document type has no configured printer queue" });
    const result = await submitPdf({ pdf: bytes, profile, queue, prepared });
    console.info("Print job submitted", { userId: req.user?.userId, kind: req.body.kind, queue, result });
    res.status(202).json({ message: result, queue });
  } catch (error) {
    console.error("Print job failed", error);
    res.status(503).json({ error: "Printer did not accept the job. Check its queue and connection." });
  }
});

module.exports = router;
