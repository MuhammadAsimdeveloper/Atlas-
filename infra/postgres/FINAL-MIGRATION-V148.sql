-- Atlas V148: durable provider outcome reconciliation and idempotency.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_provider_action_reconciliations (
  reconciliation_id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  provider_key TEXT NOT NULL CHECK(provider_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  connection_id UUID NOT NULL,
  action_key TEXT NOT NULL CHECK(action_key ~ '^[a-z][a-z0-9_.-]{1,159}$'),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 240),
  state TEXT NOT NULL CHECK(state IN ('pending','sent','ambiguous','reconciliation_required','reconciled','failed')),
  provider_ref TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 1000),
  last_error_code TEXT,
  next_reconcile_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  resolution_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,idempotency_key),
  UNIQUE(tenant_id,job_id,action_key)
);

CREATE INDEX IF NOT EXISTS idx_atlas_provider_reconciliation_due
  ON atlas_provider_action_reconciliations(state,next_reconcile_at,updated_at);

ALTER TABLE atlas_provider_action_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_provider_action_reconciliations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_provider_action_reconciliations_worker ON atlas_provider_action_reconciliations;
CREATE POLICY atlas_provider_action_reconciliations_worker
  ON atlas_provider_action_reconciliations
  USING(current_user='atlas_worker')
  WITH CHECK(current_user='atlas_worker');

CREATE OR REPLACE FUNCTION atlas_v148_start_provider_action(
  p_tenant_id UUID,
  p_job_id UUID,
  p_provider_key TEXT,
  p_connection_id UUID,
  p_action_key TEXT,
  p_idempotency_key TEXT
) RETURNS TABLE(state TEXT,provider_ref TEXT,reconciliation_id TEXT,attempt_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.atlas_runtime_jobs
    WHERE tenant_id=p_tenant_id AND job_id=p_job_id
      AND lease_owner=current_user AND status='running'
  ) THEN
    RAISE EXCEPTION 'provider_action_lease_required';
  END IF;

  INSERT INTO public.atlas_provider_action_reconciliations(
    reconciliation_id,tenant_id,job_id,provider_key,connection_id,action_key,idempotency_key,state,next_reconcile_at
  ) VALUES(
    md5(p_tenant_id::text||'|'||p_idempotency_key),
    p_tenant_id,p_job_id,p_provider_key,p_connection_id,p_action_key,p_idempotency_key,'pending',NULL
  )
  ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;

  RETURN QUERY
  SELECT r.state,r.provider_ref,r.reconciliation_id,r.attempt_count
  FROM public.atlas_provider_action_reconciliations r
  WHERE r.tenant_id=p_tenant_id AND r.idempotency_key=p_idempotency_key;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v148_record_provider_outcome(
  p_tenant_id UUID,
  p_job_id UUID,
  p_idempotency_key TEXT,
  p_state TEXT,
  p_provider_ref TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_resolution_code TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE changed BOOLEAN;
BEGIN
  IF p_state NOT IN ('sent','ambiguous','reconciled','failed') THEN
    RAISE EXCEPTION 'provider_outcome_state_invalid';
  END IF;
  UPDATE public.atlas_provider_action_reconciliations r
  SET state=p_state,
      provider_ref=COALESCE(p_provider_ref,r.provider_ref),
      attempt_count=r.attempt_count+1,
      last_error_code=p_error_code,
      resolution_code=p_resolution_code,
      next_reconcile_at=CASE WHEN p_state IN ('ambiguous','reconciliation_required') THEN now()+interval '1 minute' ELSE NULL END,
      updated_at=now()
  WHERE r.tenant_id=p_tenant_id
    AND r.job_id=p_job_id
    AND r.idempotency_key=p_idempotency_key
    AND EXISTS(
      SELECT 1 FROM public.atlas_runtime_jobs j
      WHERE j.tenant_id=r.tenant_id AND j.job_id=r.job_id AND j.lease_owner=current_user AND j.status='running'
    );
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION atlas_v148_start_provider_action(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v148_record_provider_outcome(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON atlas_provider_action_reconciliations FROM PUBLIC;

COMMIT;
