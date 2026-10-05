-- Atlas V149: executable recovery-drill step evidence.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_recovery_drill_steps (
  step_id TEXT PRIMARY KEY,
  drill_id TEXT NOT NULL REFERENCES atlas_runtime_recovery_drills(drill_id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL CHECK(step_index BETWEEN 1 AND 100),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK(status IN ('planned','running','passed','failed','skipped')),
  evidence_ref TEXT,
  evidence_sha256 TEXT CHECK(evidence_sha256 IS NULL OR evidence_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(drill_id,step_index)
);
ALTER TABLE atlas_runtime_recovery_drill_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_runtime_recovery_drill_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_runtime_recovery_drill_steps_worker ON atlas_runtime_recovery_drill_steps;
CREATE POLICY atlas_runtime_recovery_drill_steps_worker ON atlas_runtime_recovery_drill_steps
  USING(current_user='atlas_worker') WITH CHECK(current_user='atlas_worker');
REVOKE ALL ON atlas_runtime_recovery_drill_steps FROM PUBLIC;
COMMIT;
