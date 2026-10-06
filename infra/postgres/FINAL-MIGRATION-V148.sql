-- Atlas V148: durable agent turn execution evidence and worker-mediated runtime
BEGIN;

ALTER TABLE atlas_agent_turn_plans
  ADD COLUMN IF NOT EXISTS release_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE atlas_agent_turn_plans
  DROP CONSTRAINT IF EXISTS atlas_agent_turn_plans_release_snapshot_shape;
ALTER TABLE atlas_agent_turn_plans
  ADD CONSTRAINT atlas_agent_turn_plans_release_snapshot_shape
  CHECK (
    jsonb_typeof(release_snapshot) = 'object'
    AND release_snapshot ? 'tenantId'
    AND release_snapshot ? 'agentId'
    AND release_snapshot ? 'releaseId'
    AND release_snapshot ? 'version'
    AND release_snapshot ? 'checksum'
    AND release_snapshot - 'tenantId' - 'agentId' - 'releaseId' - 'version' - 'status' - 'allowedTools' - 'modelPolicy' - 'systemPromptHash' - 'checksum' = '{}'::jsonb
  );

CREATE TABLE IF NOT EXISTS atlas_agent_turn_executions (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  execution_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  session_id UUID NOT NULL,
  turn_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  release_version INTEGER NOT NULL CHECK (release_version > 0),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting_reply','waiting_approval','completed','handoff','failed','canceled','retryable','dead_letter')),
  prompt_hash CHAR(64) NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  input_ref TEXT NOT NULL,
  result_ref JSONB CHECK (result_ref IS NULL OR (
    jsonb_typeof(result_ref) = 'object'
    AND result_ref - 'kind' - 'id' - 'version' = '{}'::jsonb
    AND result_ref ? 'kind' AND result_ref ? 'id'
  )),
  output_hash CHAR(64) CHECK (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'),
  tool_calls INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls >= 0 AND tool_calls <= 100),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0 AND input_tokens <= 1000000),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0 AND output_tokens <= 1000000),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0 AND latency_ms <= 3600000),
  waiting_reason TEXT CHECK (waiting_reason IS NULL OR waiting_reason ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  idempotency_key CHAR(64) NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, execution_id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, plan_id),
  CHECK (octet_length(input_ref) BETWEEN 3 AND 240)
);

ALTER TABLE atlas_agent_turn_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_turn_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_agent_turn_executions_tenant ON atlas_agent_turn_executions;
CREATE POLICY atlas_agent_turn_executions_tenant ON atlas_agent_turn_executions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_atlas_agent_turn_executions_session
  ON atlas_agent_turn_executions(tenant_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_agent_turn_executions_status
  ON atlas_agent_turn_executions(tenant_id, status, updated_at DESC);

CREATE OR REPLACE FUNCTION atlas_v148_get_agent_turn_for_job(
  p_tenant_id UUID,
  p_job_id UUID,
  p_worker_id TEXT
) RETURNS TABLE (
  tenant_id UUID,
  execution_id UUID,
  plan_id UUID,
  session_id UUID,
  turn_id TEXT,
  release_id TEXT,
  release_version INTEGER,
  release_snapshot JSONB,
  prompt_hash CHAR(64),
  input_ref TEXT,
  status TEXT,
  result_ref JSONB,
  output_hash CHAR(64),
  tool_calls INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  waiting_reason TEXT,
  error_code TEXT,
  idempotency_key CHAR(64),
  version INTEGER,
  checksum CHAR(64)
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE execution_ref UUID;
BEGIN
  IF p_tenant_id IS NULL OR p_job_id IS NULL OR p_worker_id IS NULL
     OR p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$' THEN
    RAISE EXCEPTION 'worker_agent_turn_parameters_invalid';
  END IF;

  SELECT NULLIF(j.payload_ref->>'executionId','')::uuid
    INTO execution_ref
  FROM public.atlas_runtime_jobs j
  WHERE j.tenant_id=p_tenant_id
    AND j.job_id=p_job_id
    AND j.job_type='agent.turn.execute'
    AND j.status='leased'
    AND j.lease_owner=p_worker_id
    AND j.lease_until>now()
  LIMIT 1;

  IF execution_ref IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);

  RETURN QUERY
  SELECT e.tenant_id,e.execution_id,e.plan_id,e.session_id,e.turn_id,e.release_id,e.release_version,
         p.release_snapshot,prompt_hash,e.input_ref,e.status,e.result_ref,e.output_hash,e.tool_calls,
         e.input_tokens,e.output_tokens,e.latency_ms,e.waiting_reason,e.error_code,e.idempotency_key,e.version,e.checksum
  FROM public.atlas_agent_turn_executions e
  JOIN public.atlas_agent_turn_plans p
    ON p.tenant_id=e.tenant_id AND p.plan_id=e.plan_id
  WHERE e.tenant_id=p_tenant_id AND e.execution_id=execution_ref
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v148_update_agent_turn_for_job(
  p_tenant_id UUID,
  p_job_id UUID,
  p_worker_id TEXT,
  p_execution_id UUID,
  p_expected_version INTEGER,
  p_status TEXT,
  p_result_ref JSONB,
  p_output_hash TEXT,
  p_tool_calls INTEGER,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_latency_ms INTEGER,
  p_waiting_reason TEXT,
  p_error_code TEXT,
  p_checksum TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ok BOOLEAN;
BEGIN
  IF p_tenant_id IS NULL OR p_job_id IS NULL OR p_execution_id IS NULL
     OR p_worker_id IS NULL OR p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$'
     OR p_expected_version IS NULL OR p_expected_version < 1
     OR p_status NOT IN ('queued','running','waiting_reply','waiting_approval','completed','handoff','failed','canceled','retryable','dead_letter')
     OR (p_result_ref IS NOT NULL AND (jsonb_typeof(p_result_ref)<>'object' OR p_result_ref-'kind'-'id'-'version'<>'{}'::jsonb))
     OR (p_output_hash IS NOT NULL AND p_output_hash !~ '^[a-f0-9]{64}$')
     OR p_tool_calls IS NULL OR p_tool_calls < 0 OR p_tool_calls > 100
     OR p_input_tokens IS NULL OR p_input_tokens < 0 OR p_input_tokens > 1000000
     OR p_output_tokens IS NULL OR p_output_tokens < 0 OR p_output_tokens > 1000000
     OR (p_latency_ms IS NOT NULL AND (p_latency_ms < 0 OR p_latency_ms > 3600000))
     OR (p_waiting_reason IS NOT NULL AND p_waiting_reason !~ '^[a-z][a-z0-9_.-]{2,79}$')
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z][a-z0-9_.-]{0,79}$')
     OR p_checksum !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'worker_agent_turn_update_invalid';
  END IF;

  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE public.atlas_agent_turn_executions e
  SET status=p_status,
      result_ref=p_result_ref,
      output_hash=p_output_hash,
      tool_calls=p_tool_calls,
      input_tokens=p_input_tokens,
      output_tokens=p_output_tokens,
      latency_ms=p_latency_ms,
      waiting_reason=p_waiting_reason,
      error_code=p_error_code,
      checksum=p_checksum,
      version=e.version+1,
      updated_at=now()
  WHERE e.tenant_id=p_tenant_id
    AND e.execution_id=p_execution_id
    AND e.version=p_expected_version
    AND EXISTS (
      SELECT 1 FROM public.atlas_runtime_jobs j
      WHERE j.tenant_id=p_tenant_id
        AND j.job_id=p_job_id
        AND j.job_type='agent.turn.execute'
        AND j.status='leased'
        AND j.lease_owner=p_worker_id
        AND j.lease_until>now()
        AND NULLIF(j.payload_ref->>'executionId','')::uuid=p_execution_id
    );
  GET DIAGNOSTICS ok = ROW_COUNT;
  RETURN ok;
END;
$$;

REVOKE ALL ON atlas_agent_turn_executions FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v148_get_agent_turn_for_job(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v148_update_agent_turn_for_job(UUID,UUID,TEXT,UUID,INTEGER,TEXT,JSONB,TEXT,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC;

COMMIT;
