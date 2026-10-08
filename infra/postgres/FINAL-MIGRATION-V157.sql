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



CREATE TABLE IF NOT EXISTS atlas_v157_knowledge_stores(
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  store_id UUID NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}),
  default_source_types JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(default_source_types)='array' AND jsonb_array_length(default_source_types)<=50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,store_id),
  CHECK (octet_length(name)<=320)
);
CREATE TABLE IF NOT EXISTS atlas_v157_knowledge_documents(
  tenant_id UUID NOT NULL,
  store_id UUID NOT NULL,
  document_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content_ref TEXT NOT NULL CHECK (content_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=16000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,document_id),
  FOREIGN KEY (tenant_id,store_id) REFERENCES atlas_v157_knowledge_stores(tenant_id,store_id) ON DELETE CASCADE,
  CHECK (octet_length(title)<=400)
);
CREATE TABLE IF NOT EXISTS atlas_v157_knowledge_chunks(
  tenant_id UUID NOT NULL,
  store_id UUID NOT NULL,
  document_id UUID NOT NULL,
  chunk_id UUID NOT NULL,
  chunk_ref TEXT NOT NULL CHECK (chunk_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}),
  embedding_ref TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 9999),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,chunk_id),
  UNIQUE (tenant_id,document_id,ordinal),
  FOREIGN KEY (tenant_id,store_id) REFERENCES atlas_v157_knowledge_stores(tenant_id,store_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,store_id,document_id) REFERENCES atlas_v157_knowledge_documents(tenant_id,store_id,document_id) ON DELETE CASCADE,
  CHECK (embedding_ref IS NULL OR embedding_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240})
);
CREATE TABLE IF NOT EXISTS atlas_v157_knowledge_retrieval_policies(
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  policy_id UUID NOT NULL,
  store_id UUID NOT NULL,
  top_k INTEGER NOT NULL CHECK (top_k BETWEEN 1 AND 20),
  min_score NUMERIC(4,3) NOT NULL CHECK (min_score BETWEEN 0 AND 1),
  reranker TEXT NOT NULL CHECK (reranker IN ('none','weighted','cross_encoder')),
  allowed_source_types JSONB NOT NULL CHECK (jsonb_typeof(allowed_source_types)='array' AND jsonb_array_length(allowed_source_types)<=50),
  require_citations BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,policy_id),
  FOREIGN KEY (tenant_id,store_id) REFERENCES atlas_v157_knowledge_stores(tenant_id,store_id) ON DELETE CASCADE
);

DO $v157_knowledge_rls$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['atlas_v157_knowledge_stores','atlas_v157_knowledge_documents','atlas_v157_knowledge_chunks','atlas_v157_knowledge_retrieval_policies']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t,t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  END LOOP;
END;
$v157_knowledge_rls$;


COMMIT;
