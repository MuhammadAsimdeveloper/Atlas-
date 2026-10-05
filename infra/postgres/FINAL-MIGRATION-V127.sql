-- Atlas V127: durable workflow resume scheduling for waits, retries and approvals.
BEGIN;
CREATE OR REPLACE FUNCTION atlas_v127_schedule_workflow_resume(
  p_tenant_id uuid,p_job_id uuid,p_worker_id text,p_execution_id text,p_run_at timestamptz,p_resume_kind text,p_execution_version integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $v127$
DECLARE v_job_id uuid; v_key char(64);
BEGIN
  IF session_user <> 'atlas_worker' THEN RAISE EXCEPTION 'worker_role_required'; END IF;
  IF p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$' OR p_execution_id !~ '^[A-Za-z0-9_.:-]{1,180}$' THEN RAISE EXCEPTION 'resume_identity_invalid'; END IF;
  IF p_resume_kind !~ '^(wait|retry)$' OR p_execution_version < 1 OR p_run_at IS NULL THEN RAISE EXCEPTION 'resume_parameters_invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.atlas_runtime_jobs j WHERE j.tenant_id=p_tenant_id AND j.job_id=p_job_id AND j.job_type='workflow.execute' AND j.status='leased' AND j.lease_owner=p_worker_id AND j.lease_until>now()) THEN RAISE EXCEPTION 'worker_job_lease_invalid'; END IF;
  v_key := encode(digest('atlas-v127-workflow-resume:'||p_tenant_id::text||':'||p_execution_id||':'||p_resume_kind||':'||p_execution_version::text,'sha256'),'hex');
  v_job_id := gen_random_uuid();
  INSERT INTO public.atlas_runtime_jobs(tenant_id,job_id,job_type,payload_ref,idempotency_key,run_at,max_attempts)
  VALUES(p_tenant_id,v_job_id,'workflow.execute',jsonb_build_object('kind','workflow_execution','id',p_execution_id,'version',p_execution_version),v_key,p_run_at,8)
  ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
  SELECT j.job_id INTO v_job_id FROM public.atlas_runtime_jobs j WHERE j.tenant_id=p_tenant_id AND j.idempotency_key=v_key;
  RETURN v_job_id;
END;
$v127$;
REVOKE ALL ON FUNCTION atlas_v127_schedule_workflow_resume(uuid,uuid,text,text,timestamptz,text,integer) FROM PUBLIC,atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v127_schedule_workflow_resume(uuid,uuid,text,text,timestamptz,text,integer) TO atlas_worker;
COMMIT;
