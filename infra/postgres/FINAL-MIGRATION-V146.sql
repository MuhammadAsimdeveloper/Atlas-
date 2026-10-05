-- Atlas V146: single-leader autoscaler decisions and bounded actuator leases.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_runtime_scaler_leases (
  pool_id TEXT PRIMARY KEY REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atlas_runtime_scaling_decisions (
  decision_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('hold','scale_up','scale_down')),
  target_workers INTEGER NOT NULL CHECK(target_workers BETWEEN 1 AND 10000),
  queue_depth INTEGER NOT NULL CHECK(queue_depth >= 0),
  active_workers INTEGER NOT NULL CHECK(active_workers >= 0),
  worker_utilization NUMERIC(6,5) NOT NULL CHECK(worker_utilization >= 0 AND worker_utilization <= 1),
  slo_error_budget_remaining NUMERIC(6,5) NOT NULL CHECK(slo_error_budget_remaining >= 0 AND slo_error_budget_remaining <= 1),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK(status IN ('proposed','advisory','actuated','failed','skipped')),
  actuator_ref_hash TEXT CHECK(actuator_ref_hash IS NULL OR actuator_ref_hash ~ '^[a-f0-9]{64}$'),
  error_code TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actuated_at TIMESTAMPTZ,
  UNIQUE(pool_id, decision_id)
);

CREATE INDEX IF NOT EXISTS idx_atlas_runtime_scaling_decisions_recent
  ON atlas_runtime_scaling_decisions(pool_id, decided_at DESC);

ALTER TABLE atlas_runtime_scaler_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_runtime_scaler_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_runtime_scaler_leases_worker ON atlas_runtime_scaler_leases;
CREATE POLICY atlas_runtime_scaler_leases_worker
  ON atlas_runtime_scaler_leases
  USING(current_user='atlas_worker')
  WITH CHECK(current_user='atlas_worker');

ALTER TABLE atlas_runtime_scaling_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_runtime_scaling_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_runtime_scaling_decisions_worker ON atlas_runtime_scaling_decisions;
CREATE POLICY atlas_runtime_scaling_decisions_worker
  ON atlas_runtime_scaling_decisions
  USING(current_user='atlas_worker')
  WITH CHECK(current_user='atlas_worker');

CREATE OR REPLACE FUNCTION atlas_v146_acquire_scaler_lease(
  p_pool_id TEXT,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 60
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_pool_id !~ '^[A-Za-z0-9_.:-]{1,120}$'
     OR p_worker_id !~ '^[A-Za-z0-9_.:-]{1,120}$'
     OR p_lease_seconds NOT BETWEEN 15 AND 900 THEN
    RAISE EXCEPTION 'scaler_lease_parameters_invalid';
  END IF;
  INSERT INTO public.atlas_runtime_scaler_leases(pool_id,worker_id,lease_until)
  VALUES(p_pool_id,p_worker_id,now()+make_interval(secs=>p_lease_seconds))
  ON CONFLICT(pool_id) DO UPDATE
    SET worker_id=EXCLUDED.worker_id,
        lease_until=EXCLUDED.lease_until,
        updated_at=now()
    WHERE atlas_runtime_scaler_leases.lease_until <= now()
       OR atlas_runtime_scaler_leases.worker_id = EXCLUDED.worker_id;
  RETURN EXISTS(
    SELECT 1 FROM public.atlas_runtime_scaler_leases
    WHERE pool_id=p_pool_id AND worker_id=p_worker_id AND lease_until > now()
  );
END;
$$;

REVOKE ALL ON FUNCTION atlas_v146_acquire_scaler_lease(TEXT,TEXT,INTEGER) FROM PUBLIC;

REVOKE ALL ON atlas_runtime_scaler_leases,atlas_runtime_scaling_decisions FROM PUBLIC;

COMMIT;
