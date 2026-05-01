const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");
const { ensureAdmin } = require("../utils/ensureAdmin");
const { getServerTimeZone } = require("../utils/serverTimeZone");
const router = express.Router();

const REPAIRS_ALLOWED_KEY = "repairs_allowed";
const L11_LOG_RECONCILIATION_MODE_KEY = "l11_log_reconciliation_mode";

async function getBooleanSettingValue(key, defaultValue) {
  const { rows } = await db.query(
    `SELECT value_json FROM global_settings WHERE key = $1 LIMIT 1`,
    [key],
  );
  if (!rows.length) return defaultValue;
  const raw = rows[0].value_json;
  if (typeof raw === "boolean") return raw;
  if (raw && typeof raw === "object" && "value" in raw) return !!raw.value;
  return !!raw;
}

async function upsertBooleanSettingValue(key, value) {
  const { rows } = await db.query(
    `
    INSERT INTO global_settings (key, value_json, updated_at)
    VALUES ($1, to_jsonb($2::boolean), NOW())
    ON CONFLICT (key)
    DO UPDATE SET
      value_json = EXCLUDED.value_json,
      updated_at = NOW()
    RETURNING value_json
    `,
    [key, value],
  );

  return typeof rows[0]?.value_json === "boolean"
    ? rows[0].value_json
    : !!rows[0]?.value_json;
}

async function getRepairsAllowedValue() {
  return getBooleanSettingValue(REPAIRS_ALLOWED_KEY, true);
}

async function getL11LogReconciliationModeValue() {
  return getBooleanSettingValue(L11_LOG_RECONCILIATION_MODE_KEY, false);
}

// API route for server time and CST/CDT
router.get("/time", (req, res) => {
  const now = new Date();

  const timeZone = getServerTimeZone();

  // Format explicitly to America/Chicago
  const cstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const cstTime = cstFormatter.format(now);

  const response = {
    timestamp: now.getTime(), // epoch ms
    isoTime: now.toISOString(), // ISO in UTC
    localtime: cstTime, // human-readable CST/CDT
    zone: timeZone, // time zone name
  };

  res.json(response);
});

router.get(
  "/repairs_allowed",
  async (_req, res) => {
    try {
      const repairs_allowed = await getRepairsAllowedValue();
      return res.json({ repairs_allowed });
    } catch (err) {
      console.error("Failed to fetch repairs_allowed:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch repairs_allowed" });
    }
  },
);

router.patch(
  "/repairs_allowed",
  authenticateToken,
  ensureAdmin,
  async (req, res) => {
    const repairs_allowed = req.body?.repairs_allowed;
    if (typeof repairs_allowed !== "boolean") {
      return res
        .status(400)
        .json({ error: "repairs_allowed must be a boolean" });
    }

    try {
      const value = await upsertBooleanSettingValue(
        REPAIRS_ALLOWED_KEY,
        repairs_allowed,
      );
      return res.json({ repairs_allowed: value });
    } catch (err) {
      console.error("Failed to update repairs_allowed:", err);
      return res
        .status(500)
        .json({ error: "Failed to update repairs_allowed" });
    }
  },
);

router.get(
  "/l11_log_reconciliation_mode",
  async (_req, res) => {
    try {
      const l11_log_reconciliation_mode =
        await getL11LogReconciliationModeValue();
      return res.json({ l11_log_reconciliation_mode });
    } catch (err) {
      console.error("Failed to fetch l11_log_reconciliation_mode:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch l11_log_reconciliation_mode" });
    }
  },
);

router.patch(
  "/l11_log_reconciliation_mode",
  authenticateToken,
  ensureAdmin,
  async (req, res) => {
    const l11_log_reconciliation_mode =
      req.body?.l11_log_reconciliation_mode;
    if (typeof l11_log_reconciliation_mode !== "boolean") {
      return res.status(400).json({
        error: "l11_log_reconciliation_mode must be a boolean",
      });
    }

    try {
      const value = await upsertBooleanSettingValue(
        L11_LOG_RECONCILIATION_MODE_KEY,
        l11_log_reconciliation_mode,
      );
      return res.json({ l11_log_reconciliation_mode: value });
    } catch (err) {
      console.error("Failed to update l11_log_reconciliation_mode:", err);
      return res
        .status(500)
        .json({ error: "Failed to update l11_log_reconciliation_mode" });
    }
  },
);

module.exports = router;
