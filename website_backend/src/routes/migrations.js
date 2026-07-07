// website_backend/routes/migrations.js
//
// Minimal migrations API:
//  - GET    /api/v1/migrations
//  - POST   /api/v1/migrations
//  - DELETE /api/v1/migrations/:filename   (admin/emergency)
//
// Notes:
// - Assumes table: public.schema_migrations(version int, filename text, sha256 text, applied_at timestamptz default now())
// - Enforces: filename unique, tamper-detect (same filename cannot change sha256)
// - Keeps it simple: NO "verify" endpoint; deploy script compares local SHA256 vs GET response.

const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const router = express.Router();

// --- helpers ---
function isValidSha256(s) {
  return typeof s === "string" && /^[a-f0-9]{64}$/i.test(s.trim());
}

function normalizeFilename(s) {
  if (typeof s !== "string") return "";
  // normalize windows slashes, trim
  return s.trim().replace(/\\/g, "/");
}

// GET /api/v1/migrations
// Returns applied migrations ordered by version then filename
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT version, filename, sha256, applied_at
      FROM public.schema_migrations
      ORDER BY version ASC, filename ASC
      `,
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch migrations" });
  }
});

// POST /api/v1/migrations
// Body: { version: number, filename: string, sha256: string }
// Behavior:
// - If filename does not exist: insert it.
// - If filename exists with same sha256: return 200 (idempotent OK).
// - If filename exists with different sha256: 409 tamper signal.
router.post("/", authenticateToken, async (req, res) => {
  const { version, filename, sha256 } = req.body || {};

  const v = Number.parseInt(version, 10);
  const f = normalizeFilename(filename);
  const h = typeof sha256 === "string" ? sha256.trim().toLowerCase() : "";

  if (!Number.isFinite(v) || v <= 0) {
    return res
      .status(400)
      .json({ error: "version must be a positive integer" });
  }
  if (!f) {
    return res.status(400).json({ error: "filename is required" });
  }
  if (!isValidSha256(h)) {
    return res.status(400).json({ error: "sha256 must be a 64-hex string" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Lock the row if it exists so concurrent deploys don't race
    const { rows: existing } = await client.query(
      `
      SELECT version, filename, sha256, applied_at
      FROM public.schema_migrations
      WHERE filename = $1
      FOR UPDATE
      `,
      [f],
    );

    if (existing.length) {
      const cur = existing[0];
      if ((cur.sha256 || "").toLowerCase() !== h) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error:
            "Migration filename exists with different sha256 (tamper/mismatch).",
          filename: f,
          db_sha256: cur.sha256,
          requested_sha256: h,
        });
      }

      // idempotent: already recorded exactly
      await client.query("COMMIT");
      return res.status(200).json({
        message: "Migration already recorded",
        migration: cur,
      });
    }

    const { rows: inserted } = await client.query(
      `
      INSERT INTO public.schema_migrations (version, filename, sha256)
      VALUES ($1, $2, $3)
      RETURNING version, filename, sha256, applied_at
      `,
      [v, f, h],
    );

    await client.query("COMMIT");
    return res.status(201).json({
      message: "Migration recorded",
      migration: inserted[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");

    // If you have a unique index on filename, catch dup insert races
    // and re-check to decide if it's safe or tamper.
    if (err && err.code === "23505") {
      try {
        const { rows } = await db.query(
          `
          SELECT version, filename, sha256, applied_at
          FROM public.schema_migrations
          WHERE filename = $1
          `,
          [f],
        );
        if (rows.length && (rows[0].sha256 || "").toLowerCase() === h) {
          return res.status(200).json({
            message: "Migration already recorded",
            migration: rows[0],
          });
        }
      } catch (_) {
        // fall through
      }
      return res.status(409).json({ error: "Migration already exists" });
    }

    console.error(err);
    return res.status(500).json({ error: "Failed to record migration" });
  } finally {
    client.release();
  }
});

// DELETE /api/v1/migrations/:filename
// Emergency only. Keep it protected. (authenticateToken here; you can add an admin check later.)
router.delete("/:filename", authenticateToken, async (req, res) => {
  const filename = normalizeFilename(req.params.filename);

  if (!filename) {
    return res.status(400).json({ error: "filename is required" });
  }

  try {
    const del = await db.query(
      `
      DELETE FROM public.schema_migrations
      WHERE filename = $1
      RETURNING version, filename, sha256, applied_at
      `,
      [filename],
    );

    if (!del.rows.length) {
      return res.status(404).json({ error: "Migration not found" });
    }

    return res.json({ message: "Migration deleted", migration: del.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to delete migration" });
  }
});

module.exports = router;
