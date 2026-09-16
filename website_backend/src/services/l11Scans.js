const { recordEvidenceHistory } = require("./evidenceHistory");
const { randomUUID } = require("crypto");
const active = ["queued", "dispatching", "running", "unknown"];
const contextSql = `SELECT s.id, s.service_tag, s.rack_service_tag, h.id AS received_event_id, h.changed_at AS received_at
 FROM system s LEFT JOIN LATERAL (SELECT id, changed_at FROM system_location_history
 WHERE system_id=s.id AND to_location_id=1 AND from_location_id IS DISTINCT FROM to_location_id ORDER BY changed_at DESC, id DESC LIMIT 1) h ON true`;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function createL11Scans({ db, submit, getJob, hasDownloaded = async () => false }) {
  async function enqueue(client, tag, userId, trigger, batchId = null) {
    const { rows: units } = await client.query(`${contextSql} WHERE s.service_tag=$1 FOR UPDATE OF s`, [tag]);
    const unit = units[0];
    if (!unit) throw fail("System not found", 404);
    const rack = String(unit.rack_service_tag || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(rack)) throw fail("Current rack service tag is required before scanning L11 logs");
    const existing = await client.query(`SELECT * FROM l11_scan_job WHERE system_id=$1
      AND received_event_id IS NOT DISTINCT FROM $2 AND rack_service_tag=$3
      AND status=ANY($4::text[]) ORDER BY created_at DESC LIMIT 1`, [unit.id, unit.received_event_id, rack, active]);
    if (existing.rows.length) return existing.rows[0];
    const { rows } = await client.query(`INSERT INTO l11_scan_job
      (id,system_id,received_event_id,received_at,rack_service_tag,requested_by,trigger,batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [randomUUID(), unit.id, unit.received_event_id, unit.received_at, rack, userId, trigger, batchId]);
    return rows[0];
  }
  async function request(tag, userId, trigger = "manual", batchId = null) {
    const client = await db.connect();
    try { await client.query("BEGIN"); const job = await enqueue(client, tag, userId, trigger, batchId);
      await client.query("COMMIT"); return job;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async function history(tag, limit = 100) {
    const { rows } = await db.query(`SELECT j.*, j.id AS job_id, u.username AS requested_by_name,
      (j.received_event_id IS NOT DISTINCT FROM c.received_event_id AND j.rack_service_tag=upper(trim(c.rack_service_tag))) AS current
      FROM l11_scan_job j JOIN (${contextSql}) c ON c.id=j.system_id
      LEFT JOIN users u ON u.id=j.requested_by WHERE c.service_tag=$1
      ORDER BY j.created_at DESC LIMIT $2`, [tag, limit]);
    return rows;
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    const client = await db.connect().catch(() => null);
    if (!client) { ticking = false; return; }
    let locked = false;
    try {
      locked = (await client.query("SELECT pg_try_advisory_lock(76116016) AS locked")).rows[0].locked;
      if (!locked) return;
      // Dispatching without an acknowledged runner ID is uncertain after a restart.
      // Do not silently launch a duplicate job for that unit.
      await client.query(`UPDATE l11_scan_job SET status='unknown', error='Runner acknowledgement was interrupted. Check runner before retrying.'
        WHERE status='dispatching'`);
      const { rows } = await client.query(`SELECT j.*, s.service_tag FROM l11_scan_job j JOIN system s ON s.id=j.system_id
        WHERE j.status='running' ORDER BY j.created_at LIMIT 1`);
      if (rows.length) {
        const job = rows[0];
        try {
          const result = await getJob(job.runner_job_id);
          const status = String(result.status || "").toLowerCase();
          if (!["queued", "running", "succeeded", "failed"].includes(status)) {
            await client.query("UPDATE l11_scan_job SET status='unknown',error=$2 WHERE id=$1", [job.id, "Runner returned an unrecognized job state."]);
            return;
          }
          await client.query("BEGIN");
          try {
            if (status === "succeeded" && await hasDownloaded(job, result.stdout)) {
              await recordEvidenceHistory(client, job.system_id,
                `L11 logs from rack ${job.rack_service_tag} downloaded successfully.`, null, job.id);
            }
          await client.query(`UPDATE l11_scan_job SET status=$2,stdout=$3,stderr=$4,returncode=$5,error=NULL,
            ended_at=CASE WHEN $2 IN ('succeeded','failed') THEN now() ELSE NULL END WHERE id=$1`,
          [job.id, ["queued", "running"].includes(status) ? "running" : status,
            String(result.stdout || "").slice(-20000), String(result.stderr || "").slice(-20000), result.returncode ?? null]);
            await client.query("COMMIT");
          } catch (error) { await client.query("ROLLBACK"); throw error; }
        } catch (error) {
          if (error.status === 404) await client.query(`UPDATE l11_scan_job SET status='unknown',error=$2 WHERE id=$1`, [job.id, "Runner no longer has this job. Its outcome is unknown."]);
          else await client.query("UPDATE l11_scan_job SET error=$2 WHERE id=$1", [job.id, "Runner status temporarily unavailable; retrying."]);
          // Temporary runner outages leave the persistent job running for the next poll.
        }
        return;
      }
      const next = await client.query(`SELECT j.*, c.service_tag,
        (j.received_event_id IS NOT DISTINCT FROM c.received_event_id AND j.rack_service_tag=upper(trim(c.rack_service_tag))) AS current
        FROM l11_scan_job j JOIN (${contextSql}) c ON c.id=j.system_id
        WHERE j.status='queued' AND NOT EXISTS (SELECT 1 FROM l11_scan_job x WHERE x.system_id=j.system_id AND x.status='unknown')
        ORDER BY j.created_at LIMIT 1`);
      const job = next.rows[0];
      if (!job) return;
      if (!job.current) {
        await client.query("UPDATE l11_scan_job SET status='outdated',ended_at=now() WHERE id=$1", [job.id]); return;
      }
      await client.query("UPDATE l11_scan_job SET status='dispatching',started_at=now() WHERE id=$1", [job.id]);
      try {
        const ack = await submit(job.service_tag, job.rack_service_tag, { wait: "ack" });
        if (!ack?.job_id) throw new Error("Runner returned no job ID");
        await client.query("UPDATE l11_scan_job SET status='running',runner_job_id=$2 WHERE id=$1", [job.id, ack.job_id]);
      } catch (error) {
        await client.query("UPDATE l11_scan_job SET status='unknown',error=$2 WHERE id=$1", [job.id, `Could not confirm runner start: ${error.message}`]);
      }
    } catch (error) {
      if (error.code !== "42P01") console.error("L11 scan worker:", error.message);
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(76116016)").catch(() => {});
      client.release(); ticking = false;
    }
  }
  function start() { const timer = setInterval(tick, 2500); timer.unref(); return timer; }
  return { enqueue, request, history, tick, start };
}
module.exports = { createL11Scans };
