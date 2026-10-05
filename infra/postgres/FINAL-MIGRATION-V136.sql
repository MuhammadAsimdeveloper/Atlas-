-- Atlas V136: distributed runtime pool, capacity and SLO evidence.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_pools (
 pool_id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('postgres','redis','hybrid')), desired_workers INTEGER NOT NULL DEFAULT 1 CHECK(desired_workers BETWEEN 1 AND 10000), max_concurrency INTEGER NOT NULL DEFAULT 10 CHECK(max_concurrency BETWEEN 1 AND 100000), enabled BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas_runtime_pool_heartbeats (
 pool_id TEXT NOT NULL REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE, worker_id TEXT NOT NULL, queue_depth INTEGER NOT NULL CHECK(queue_depth>=0), active_jobs INTEGER NOT NULL CHECK(active_jobs>=0), observed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(pool_id,worker_id)
);
CREATE TABLE IF NOT EXISTS atlas_runtime_slo_samples (
 sample_id UUID NOT NULL, pool_id TEXT NOT NULL REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE, metric TEXT NOT NULL CHECK(metric IN ('queue_latency_ms','job_duration_ms','error_rate','success_rate','lease_recovery_rate')), value NUMERIC NOT NULL, target NUMERIC NOT NULL, observed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(sample_id)
);
COMMIT;
