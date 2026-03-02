// routes/systemTags.js
// Mount: app.use("/api/v1/systems", require("./routes/systemTags"));
// Endpoints:
//   GET    /api/v1/systems/:service_tag/tags        (NO AUTH)
//   POST   /api/v1/systems/:service_tag/tags        (AUTH) body: { tag_code }
//   DELETE /api/v1/systems/:service_tag/tags        (NO AUTH) body: { tag_code }
//   PATCH  /api/v1/systems/:service_tag/tags        (AUTH) optional "replace" semantics, see below

const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const router = express.Router();

function normalizeTagCode(codeRaw) {
  const code = String(codeRaw || "").trim();
  if (!code) throw new Error("tag_code is required");
  if (code.length > 32) throw new Error("tag_code must be <= 32 characters");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(code)) {
    throw new Error(
      "tag_code must match: ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$ (no spaces)",
    );
  }
  return code;
}

async function getSystemId(serviceTag) {
  const st = String(serviceTag || "").trim();
  if (!st) return null;
  const { rows } = await db.query(
    `SELECT id FROM system WHERE service_tag = $1`,
    [st],
  );
  return rows[0]?.id ?? null;
}

// GET /api/v1/systems/:service_tag/tags  (NO AUTH)
router.get("/:service_tag/tags", async (req, res) => {
  const { service_tag } = req.params;

  try {
    const systemId = await getSystemId(service_tag);
    if (!systemId) return res.status(404).json({ error: "System not found" });

    const { rows } = await db.query(
      `
      SELECT
        t.id AS tag_id,
        t.code,
        t.description,
        st.created_at,
        u.username AS created_by
      FROM system_tag st
      JOIN tag t ON t.id = st.tag_id
      LEFT JOIN users u ON u.id = st.created_by
      WHERE st.system_id = $1
      ORDER BY t.code ASC
      `,
      [systemId],
    );

    return res.json({
      system_id: systemId,
      service_tag: String(service_tag).trim(),
      tags: rows,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch system tags" });
  }
});

// POST /api/v1/systems/:service_tag/tags  (AUTH)
// Body: { tag_code: "DOA" }
// Ensures tag exists (create if missing), then attaches.
router.post("/:service_tag/tags", authenticateToken, async (req, res) => {
  const { service_tag } = req.params;
  const { tag_code } = req.body || {};

  let code;
  try {
    code = normalizeTagCode(tag_code);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const sys = await client.query(
      `SELECT id FROM system WHERE service_tag = $1`,
      [String(service_tag).trim()],
    );
    if (!sys.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "System not found" });
    }
    const systemId = sys.rows[0].id;

    // ✅ Create tag if missing without aborting txn
    let tagId;
    const ins = await client.query(
      `INSERT INTO tag (code)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [code],
    );

    if (ins.rows.length) {
      tagId = ins.rows[0].id;
    } else {
      const sel = await client.query(
        `SELECT id FROM tag WHERE lower(code) = lower($1)`,
        [code],
      );
      tagId = sel.rows[0]?.id;
      if (!tagId) throw new Error("Tag exists but could not be selected");
    }

    const link = await client.query(
      `INSERT INTO system_tag (system_id, tag_id, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [systemId, tagId, req.user.userId],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: link.rowCount ? "Tag attached" : "Tag already attached",
      service_tag: String(service_tag).trim(),
      tag_code: code,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("attach tag failed:", e);
    return res.status(500).json({ error: "Failed to attach tag" });
  } finally {
    client.release();
  }
});

// DELETE /api/v1/systems/:service_tag/tags  (NO AUTH per your rule)
// Body: { tag_code: "DOA" }
// Detaches tag from system. If that was the last system using the tag, delete the tag.
router.delete("/:service_tag/tags", async (req, res) => {
  const { service_tag } = req.params;
  const { tag_code } = req.body || {};

  let code;
  try {
    code = normalizeTagCode(tag_code);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const sys = await client.query(
      `SELECT id FROM system WHERE service_tag = $1`,
      [String(service_tag).trim()],
    );
    if (!sys.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "System not found" });
    }
    const systemId = sys.rows[0].id;

    const tag = await client.query(
      `SELECT id, code FROM tag WHERE lower(code) = lower($1)`,
      [code],
    );
    if (!tag.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Tag not found" });
    }
    const tagId = tag.rows[0].id;

    // 1) delete relationship
    const delRel = await client.query(
      `
      DELETE FROM system_tag
      WHERE system_id = $1 AND tag_id = $2
      RETURNING tag_id
      `,
      [systemId, tagId],
    );

    if (!delRel.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Tag not attached to system" });
    }

    // 2) delete tag if no longer referenced (race-safe)
    const delTag = await client.query(
      `
      DELETE FROM tag t
      WHERE t.id = $1
        AND NOT EXISTS (
          SELECT 1 FROM system_tag st WHERE st.tag_id = t.id
        )
      RETURNING t.id, t.code
      `,
      [tagId],
    );

    await client.query("COMMIT");

    return res.json({
      message: "Tag detached",
      service_tag: String(service_tag).trim(),
      tag_code: code,
      deleted_tag: delTag.rowCount ? delTag.rows[0] : null,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error(e);
    return res.status(500).json({ error: "Failed to detach tag" });
  } finally {
    client.release();
  }
});

// PATCH /api/v1/systems/:service_tag/tags  (AUTH)
// Optional "replace all tags" semantics for a UI:
// Body: { tag_codes: ["DOA","GPU3"] }
// This sets the system's tags to exactly this list (creates missing tag defs).
router.patch("/:service_tag/tags", authenticateToken, async (req, res) => {
  const { service_tag } = req.params;
  const { tag_codes } = req.body || {};

  if (!Array.isArray(tag_codes)) {
    return res.status(400).json({ error: "tag_codes must be an array" });
  }

  let codes;
  try {
    codes = tag_codes.map(normalizeTagCode);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // de-dupe case-insensitively in request payload
  const seen = new Set();
  codes = codes.filter((c) => {
    const k = c.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const sys = await client.query(
      `SELECT id FROM system WHERE service_tag = $1`,
      [String(service_tag).trim()],
    );
    if (!sys.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "System not found" });
    }
    const systemId = sys.rows[0].id;

    // Ensure all tags exist; collect ids
    const tagIds = [];
    for (const code of codes) {
      let tagId;
      try {
        const ins = await client.query(
          `INSERT INTO tag (code) VALUES ($1) RETURNING id`,
          [code],
        );
        tagId = ins.rows[0].id;
      } catch (e) {
        const sel = await client.query(
          `SELECT id FROM tag WHERE lower(code) = lower($1)`,
          [code],
        );
        tagId = sel.rows[0]?.id;
        if (!tagId) throw e;
      }
      tagIds.push(tagId);
    }

    // Delete any existing tags not in the new set
    if (tagIds.length === 0) {
      await client.query(`DELETE FROM system_tag WHERE system_id = $1`, [
        systemId,
      ]);
    } else {
      await client.query(
        `
        DELETE FROM system_tag
        WHERE system_id = $1
          AND tag_id <> ALL($2::int[])
        `,
        [systemId, tagIds],
      );
    }

    // Insert missing links
    for (const tagId of tagIds) {
      await client.query(
        `
        INSERT INTO system_tag (system_id, tag_id, created_by)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        `,
        [systemId, tagId, req.user.userId],
      );
    }

    await client.query("COMMIT");
    return res.json({
      message: "System tags replaced",
      service_tag: String(service_tag).trim(),
      tag_codes: codes,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return res.status(500).json({ error: "Failed to replace system tags" });
  } finally {
    client.release();
  }
});

module.exports = router;
