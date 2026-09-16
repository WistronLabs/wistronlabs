-- Non-login attribution identity: application login requires an email username.
INSERT INTO users (username, password_hash, admin)
VALUES ('System', '!', false)
ON CONFLICT (username) DO NOTHING;

ALTER TABLE system_location_history
  ADD COLUMN IF NOT EXISTS evidence_scan_job_id uuid REFERENCES l11_scan_job(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS history_evidence_scan_job_unique
  ON system_location_history(evidence_scan_job_id);
