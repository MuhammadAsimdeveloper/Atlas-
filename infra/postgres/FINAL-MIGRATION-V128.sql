-- Atlas V128: durable workflow wake scheduler.
BEGIN;

CREATE OR REPLACE FUNCTION atlas_v128_tick_workflow_executions(p_limit INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $v128$
DECLARE
  row_item RECORD;
  affected INTEGER := 0;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'workflow_wake_limit_invalid'; END IF;
  FOR row_item IN
    SELECT tenant_id,execution_id,version,status,retry_at,
           CASE WHEN state ? 'resumeAt' THEN (state->>'resumeAt')::timestamptz ELSE NULL END AS resume_at
      FROM public.atlas_workflow_executions
     WHERE status IN ('waiting','retryable')
       AND ((status='waiting' AND state ? 'resumeAt' AND (state->>'resumeAt')::timestamptz <= now())
         OR (status='retryable' AND retry_at IS NOT NULL AND retry_at <= now()))
     ORDER BY COALESCE(retry_at,CASE WHEN state ? 'resumeAt' THEN (state->>'resumeAt')::timestamptz ELSE NULL END),tenant_id,execution_id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  LOOP
    UPDATE public.atlas_workflow_executions
       SET status='queued', updated_at=now()
     WHERE tenant_id=row_item.tenant_id AND execution_id=row_item.execution_id
       AND version=row_item.version AND status=row_item.status;
    IF FOUND THEN
      INSERT INTO public.atlas_runtime_jobs(tenant_id,job_id,job_type,payload_ref,idempotency_key,run_at,max_attempts)
      VALUES(row_item.tenant_id,gen_random_uuid(),'workflow.execute',
        jsonb_build_object('kind','workflow_execution','id',row_item.execution_id,'version',row_item.version+1),
        encode(digest(row_item.tenant_id::text||':'||row_item.execution_id||':'||row_item.version::text||':wake','sha256'),'hex')::char(64),now(),8)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
      affected := affected + 1;
    END IF;
  END LOOP;
  RETURN affected;
END
$v128$;

REVOKE ALL ON FUNCTION atlas_v128_tick_workflow_executions(INTEGER) FROM PUBLIC;

COMMIT;
