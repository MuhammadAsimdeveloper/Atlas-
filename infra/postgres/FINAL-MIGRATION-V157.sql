-- Atlas V157: permit the existing lease-bound workflow worker RPC to persist
-- an explicit unknown-external-outcome state.
BEGIN;

CREATE OR REPLACE FUNCTION atlas_v120_update_execution_for_job(
  p_tenant_id UUID,
  p_job_id UUID,
  p_worker_id TEXT,
  p_expected_version INTEGER,
  p_status TEXT,
  p_current_node_id TEXT,
  p_state JSONB,
  p_state_checksum TEXT,
  p_last_error_code TEXT,
  p_retry_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ,
  p_canceled_by UUID,
  p_updated_at TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE execution_ref TEXT;
BEGIN
  IF p_tenant_id IS NULL OR p_job_id IS NULL OR p_worker_id IS NULL OR p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$'
     OR p_expected_version IS NULL OR p_expected_version < 1
     OR p_status NOT IN ('queued','running','waiting','waiting_approval','retryable','reconciliation_required','completed','failed','canceled','dead_letter')
     OR (p_current_node_id IS NOT NULL AND (length(p_current_node_id)=0 OR length(p_current_node_id)>180))
     OR (p_last_error_code IS NOT NULL AND p_last_error_code !~ '^[a-z][a-z0-9_.-]{0,79}$')
     OR (p_state_checksum IS NULL OR p_state_checksum !~ '^[a-f0-9]{64}$')
     OR p_state IS NULL OR jsonb_typeof(p_state)<>'object' OR octet_length(p_state::text)>220000
     OR p_state ? 'event' OR p_state ? 'rawEvent' OR p_state ? 'customerData' THEN
    RAISE EXCEPTION 'worker_execution_update_invalid';
  END IF;

  SELECT j.payload_ref->>'id' INTO execution_ref
  FROM public.atlas_runtime_jobs j
  WHERE j.tenant_id=p_tenant_id
    AND j.job_id=p_job_id
    AND j.job_type='workflow.execute'
    AND j.status='leased'
    AND j.lease_owner=p_worker_id
    AND j.lease_until>now()
  LIMIT 1;
  IF execution_ref IS NULL THEN RETURN FALSE; END IF;

  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE public.atlas_workflow_executions
  SET status=p_status,
      current_node_id=p_current_node_id,
      state=p_state,
      state_checksum=p_state_checksum,
      checksum=p_state_checksum,
      last_error_code=p_last_error_code,
      retry_at=p_retry_at,
      finished_at=p_finished_at,
      canceled_by=p_canceled_by,
      version=version+1,
      updated_at=COALESCE(p_updated_at,now())
  WHERE tenant_id=p_tenant_id::text
    AND execution_id=execution_ref
    AND version=p_expected_version;
  RETURN FOUND;
END;
$$;

COMMIT;
