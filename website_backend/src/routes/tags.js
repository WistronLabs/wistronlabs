const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const router = express.Router();

function isPgUniqueViolation(err) {
  return err && err.code === "23505";
}

function normalizeTagCode(codeRaw) {
  const code = String(codeRaw || "").trim();
  if (!code) throw new Error("code is required");
  if (code.length > 32) throw new Error("code must be <= 32 characters");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(code)) {
    throw new Error(
      "code must match: ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$ (no spaces)",
    );
  }
  return code;
}

/// GET /api/v1/tags?q=doa   (NO AUTH)
router.get("/", async (req, res) => {
  const { q } = req.query;

  try {
    const term = q && String(q).trim() ? `%${String(q).trim()}%` : null;

    const { rows } = await db.query(
      `
      SELECT
        t.id,
        t.code,
        t.description,
        t.created_at,
        COALESCE(
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'system_id', s.id,
              'service_tag', s.service_tag
            )
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::jsonb
        ) AS units
      FROM tag t
      LEFT JOIN system_tag st ON st.tag_id = t.id
      LEFT JOIN system s ON s.id = st.system_id
      WHERE
        ($1::text IS NULL)
        OR (t.code ILIKE $1 OR COALESCE(t.description, '') ILIKE $1)
      GROUP BY t.id
      ORDER BY t.code ASC
      `,
      [term],
    );

    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list tags" });
  }
});

// GET /api/v1/tags/:id   (NO AUTH)
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT
        t.id,
        t.code,
        t.description,
        t.created_at,
        COALESCE(
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'system_id', s.id,
              'service_tag', s.service_tag
            )
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::jsonb
        ) AS units
      FROM tag t
      LEFT JOIN system_tag st ON st.tag_id = t.id
      LEFT JOIN system s ON s.id = st.system_id
      WHERE t.id = $1
      GROUP BY t.id
      `,
      [req.params.id],
    );

    if (!rows.length) return res.status(404).json({ error: "Tag not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch tag" });
  }
});

// POST /api/v1/tags   (AUTH)
router.post("/", authenticateToken, async (req, res) => {
  const { code, description } = req.body || {};
  let norm;
  try {
    norm = normalizeTagCode(code);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const { rows } = await db.query(
      `
      INSERT INTO tag (code, description)
      VALUES ($1, $2)
      RETURNING id, code, description, created_at
      `,
      [norm, description ?? null],
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res.status(409).json({ error: "Tag code already exists" });
    }
    return res.status(500).json({ error: "Failed to create tag" });
  }
});

// PATCH /api/v1/tags/:id   (AUTH)
router.patch("/:id", authenticateToken, async (req, res) => {
  const { code, description } = req.body || {};
  if (typeof code === "undefined" && typeof description === "undefined") {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const fields = [];
  const vals = [];

  if (typeof code !== "undefined") {
    let norm;
    try {
      norm = normalizeTagCode(code);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    fields.push(`code = $${fields.length + 1}`);
    vals.push(norm);
  }

  if (typeof description !== "undefined") {
    fields.push(`description = $${fields.length + 1}`);
    vals.push(description ?? null);
  }

  try {
    const { rows } = await db.query(
      `
      UPDATE tag
      SET ${fields.join(", ")}
      WHERE id = $${fields.length + 1}
      RETURNING id, code, description, created_at
      `,
      [...vals, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Tag not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res.status(409).json({ error: "Tag code already exists" });
    }
    return res.status(500).json({ error: "Failed to update tag" });
  }
});

// DELETE /api/v1/tags/:id
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const del = await db.query(`DELETE FROM tag WHERE id = $1`, [
      req.params.id,
    ]);
    if (del.rowCount === 0)
      return res.status(404).json({ error: "Tag not found" });
    return res.json({ message: "Tag deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete tag" });
  }
});

module.exports = router;
