-- V120 security hardening: remove direct workflow-execution table access from atlas_worker.
-- A worker may read/update execution state only through functions that prove it owns
-- the currently leased workflow.execute queue job for that tenant.
BEGIN;

DROP POLICY IF EXISTS atlas_workflow_executions_tenant ON atlas_workflow_executions;
CREATE POLICY atlas_workflow_executions_tenant ON atlas_workflow_executions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS atlas_workflow_execution_events_tenant ON atlas_workflow_execution_events;
CREATE POLICY atlas_workflow_execution_events_tenant ON atlas_workflow_execution_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

REVOKE ALL ON atlas_workflow_executions, atlas_workflow_execution_events FROM PUBLIC;
DO $v120$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_worker') THEN
    EXECUTE 'REVOKE ALL ON atlas_workflow_executions, atlas_workflow_execution_events FROM atlas_worker';
  END IF;
END;
$v120$;

CREATE OR REPLACE FUNCTION atlas_v120_get_execution_for_job(
  p_tenant_id UUID,
  p_job_id UUID,
  p_worker_id TEXT
) RETURNS TABLE (
  tenant_id TEXT,
  execution_id TEXT,
  workflow_id TEXT,
  workflow_version INTEGER,
  status TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  summary JSONB,
  checksum CHAR(64),
  graph_checksum CHAR(64),
  current_node_id TEXT,
  trigger_event_type TEXT,
  trigger_event_ref TEXT,
  state JSONB,
  state_checksum CHAR(64),
  last_error_code TEXT,
  retry_at TIMESTAMPTZ,
  created_by UUID,
  canceled_by UUID,
  replay_of_execution_id TEXT,
  version INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE execution_ref TEXT;
BEGIN
  IF p_tenant_id IS NULL OR p_job_id IS NULL OR p_worker_id IS NULL OR p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$' THEN
    RAISE EXCEPTION 'worker_execution_parameters_invalid';
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
  IF execution_ref IS NULL THEN RETURN; END IF;

  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  RETURN QUERY
    SELECT e.tenant_id,e.execution_id,e.workflow_id,e.workflow_version,e.status,e.started_at,e.finished_at,
      e.summary,e.checksum,e.graph_checksum,e.current_node_id,e.trigger_event_type,e.trigger_event_ref,
      e.state,e.state_checksum,e.last_error_code,e.retry_at,e.created_by,e.canceled_by,e.replay_of_execution_id,
      e.version,e.created_at,e.updated_at
    FROM public.atlas_workflow_executions e
    WHERE e.tenant_id=p_tenant_id::text
      AND e.execution_id=execution_ref
    LIMIT 1;
END;
$$;

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
     OR p_status NOT IN ('queued','running','waiting','waiting_approval','retryable','completed','failed','canceled','dead_letter')
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

CREATE OR REPLACE FUNCTION atlas_v120_append_execution_event_for_job(
  p_tenant_id UUID,
  p_job_id UUID,
  p_worker_id TEXT,
  p_actor_id UUID,
  p_event_type TEXT,
  p_node_id TEXT,
  p_attempt SMALLINT,
  p_status TEXT,
  p_details_ref JSONB,
  p_created_at TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE execution_ref TEXT; event_id UUID;
BEGIN
  IF p_tenant_id IS NULL OR p_job_id IS NULL OR p_worker_id IS NULL OR p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$'
     OR p_event_type !~ '^[a-z][a-z0-9_.-]{0,79}$'
     OR (p_node_id IS NOT NULL AND p_node_id !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,179}$')
     OR (p_attempt IS NOT NULL AND p_attempt NOT BETWEEN 1 AND 10)
     OR (p_details_ref IS NULL OR jsonb_typeof(p_details_ref)<>'object' OR p_details_ref-'kind'-'id'-'version' <> '{}'::jsonb OR octet_length(p_details_ref::text)>1024) THEN
    RAISE EXCEPTION 'worker_execution_event_invalid';
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
  IF execution_ref IS NULL THEN RETURN NULL; END IF;

  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  INSERT INTO public.atlas_workflow_execution_events(
    tenant_id,event_id,execution_id,actor_id,event_type,node_id,attempt,status,details_ref,created_at
  ) VALUES(
    p_tenant_id::text,gen_random_uuid(),execution_ref,p_actor_id,p_event_type,p_node_id,p_attempt,p_status,p_details_ref,COALESCE(p_created_at,now())
  ) RETURNING event_id INTO event_id;
  RETURN event_id;
END;
$$;

REVOKE ALL ON FUNCTION atlas_v120_get_execution_for_job(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v120_update_execution_for_job(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,JSONB,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v120_append_execution_event_for_job(UUID,UUID,TEXT,UUID,TEXT,TEXT,SMALLINT,TEXT,JSONB,TIMESTAMPTZ) FROM PUBLIC;

COMMIT;
