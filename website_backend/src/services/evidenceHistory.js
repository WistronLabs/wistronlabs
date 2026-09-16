const fs = require("fs/promises");
const path = require("path");

async function recordEvidenceHistory(client, systemId, note, userId = null, scanJobId = null) {
  const { rows } = await client.query("SELECT id, location_id FROM system WHERE id=$1 FOR UPDATE", [systemId]);
  if (!rows.length) throw new Error("System no longer exists");
  let actor = userId;
  if (actor == null || actor === -1) {
    const systemUser = await client.query("SELECT id FROM users WHERE username='System'");
    actor = systemUser.rows[0]?.id;
    if (!actor) throw new Error("System history user is missing; apply migration 0017");
  }
  await client.query(`INSERT INTO system_location_history
    (system_id,from_location_id,to_location_id,note,moved_by,evidence_scan_job_id)
    VALUES ($1,$2,$2,$3,$4,$5) ON CONFLICT (evidence_scan_job_id) DO NOTHING`,
  [systemId, rows[0].location_id, note, actor, scanJobId]);
}

async function hasDownloadedArchive(root, job, stdout) {
  const output = String(stdout || "").toLowerCase();
  if (/nothing to collect|nothing to do|no extracted folder tree contains|rack folder in mft not found/.test(output)) return false;
  const started = new Date(job.started_at).getTime();
  if (!Number.isFinite(started)) return false;
  const name = `L11_logs_ST_${job.service_tag}_RT_${job.rack_service_tag}.tgz`.toLowerCase();
  const pending = [{ dir: path.join(root, job.service_tag), depth: 0 }];
  while (pending.length) {
    const { dir, depth } = pending.shift();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === name) {
        const stat = await fs.stat(file);
        if (stat.size > 0 && stat.mtimeMs >= started) return true;
      }
      if (entry.isDirectory() && depth < 2) pending.push({ dir: file, depth: depth + 1 });
    }
  }
  return false;
}
module.exports = { recordEvidenceHistory, hasDownloadedArchive };
