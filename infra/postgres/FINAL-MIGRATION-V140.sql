-- Atlas V140: durable autoscaling control signals.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_scaling_policies (
 pool_id TEXT PRIMARY KEY REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE,
 min_workers INTEGER NOT NULL CHECK(min_workers BETWEEN 1 AND 10000),
 max_workers INTEGER NOT NULL CHECK(max_workers BETWEEN 1 AND 10000),
 target_utilization NUMERIC(5,4) NOT NULL CHECK(target_utilization>0 AND target_utilization<=1),
 scale_up_cooldown_seconds INTEGER NOT NULL CHECK(scale_up_cooldown_seconds BETWEEN 10 AND 3600),
 scale_down_cooldown_seconds INTEGER NOT NULL CHECK(scale_down_cooldown_seconds BETWEEN 10 AND 7200),
 slo_error_budget_floor NUMERIC(6,5) NOT NULL CHECK(slo_error_budget_floor BETWEEN 0 AND 1),
 enabled BOOLEAN NOT NULL DEFAULT true,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(max_workers>=min_workers)
);
ALTER TABLE atlas_runtime_scaling_policies ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_runtime_scaling_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_runtime_scaling_worker ON atlas_runtime_scaling_policies USING(current_user='atlas_worker') WITH CHECK(current_user='atlas_worker');
REVOKE ALL ON atlas_runtime_scaling_policies FROM PUBLIC;
COMMIT;
