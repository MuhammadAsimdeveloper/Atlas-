-- Atlas V141: failover evidence and recovery drills.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_recovery_drills (
 drill_id TEXT PRIMARY KEY,
 pool_id TEXT NOT NULL REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE,
 scenario TEXT NOT NULL CHECK(scenario IN ('worker_crash','redis_failure','postgres_failure','duplicate_execution','split_brain')),
 status TEXT NOT NULL CHECK(status IN ('planned','running','passed','failed')),
 evidence_sha256 TEXT,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE atlas_runtime_recovery_drills ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_runtime_recovery_drills FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_runtime_recovery_drill_worker ON atlas_runtime_recovery_drills USING(current_user='atlas_worker') WITH CHECK(current_user='atlas_worker');
REVOKE ALL ON atlas_runtime_recovery_drills FROM PUBLIC;
COMMIT;
