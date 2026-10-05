-- Atlas V125: lease-bound provider connection lookup for the production worker.
BEGIN;

CREATE OR REPLACE FUNCTION atlas_v125_get_provider_connection_for_worker(
  p_tenant_id UUID,
  p_job_id UUID,
  p_worker_id TEXT,
  p_connection_id UUID
) RETURNS TABLE(
  tenant_id UUID,
  connection_id UUID,
  provider_key TEXT,
  channel TEXT,
  status TEXT,
  credential_ref TEXT,
  scopes JSONB,
  metadata JSONB,
  version INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF session_user <> 'atlas_worker' THEN RAISE EXCEPTION 'worker_role_required'; END IF;
  IF p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$' THEN RAISE EXCEPTION 'worker_identity_invalid'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.atlas_runtime_jobs j
    WHERE j.tenant_id=p_tenant_id
      AND j.job_id=p_job_id
      AND j.status='leased'
      AND j.lease_owner=p_worker_id
      AND j.lease_until>now()
  ) THEN
    RAISE EXCEPTION 'worker_job_lease_invalid';
  END IF;

  RETURN QUERY
  SELECT c.tenant_id,c.connection_id,c.provider_key,c.channel,c.status,c.credential_ref,c.scopes,c.metadata,c.version
  FROM public.atlas_v122_provider_connections c
  WHERE c.tenant_id=p_tenant_id
    AND c.connection_id=p_connection_id
    AND c.status='verified';
END;
$$;

REVOKE ALL ON FUNCTION atlas_v125_get_provider_connection_for_worker(UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v125_get_provider_connection_for_worker(UUID,UUID,TEXT,UUID) TO atlas_worker;

COMMIT;
