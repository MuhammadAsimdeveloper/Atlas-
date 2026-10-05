-- Atlas V127: durable event-trigger ingress for live workflow execution.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_v127_automation_events (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  event_ref TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_ref JSONB NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  matched_workflows INTEGER NOT NULL DEFAULT 0,
  failed_workflows INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id,event_id),
  UNIQUE (tenant_id,event_ref),
  CHECK (event_ref !~ '[\\r\\n]' AND length(event_ref) BETWEEN 1 AND 240),
  CHECK (event_type ~ '^[a-z][a-z0-9_.:-]{0,119}$'),
  CHECK (jsonb_typeof(resource_ref)='object'
    AND resource_ref ? 'kind'
    AND resource_ref ? 'id'
    AND resource_ref - 'kind' - 'id' - 'version' = '{}'::jsonb
    AND jsonb_typeof(resource_ref->'kind')='string'
    AND length(resource_ref->>'kind') BETWEEN 1 AND 80
    AND jsonb_typeof(resource_ref->'id')='string'
    AND length(resource_ref->>'id') BETWEEN 1 AND 160
    AND (NOT resource_ref ? 'version' OR (jsonb_typeof(resource_ref->'version')='number' AND (resource_ref->>'version')::numeric BETWEEN 1 AND 2147483647))
    AND octet_length(resource_ref::text) <= 1024),
  CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CHECK (status IN ('received','processed','failed')),
  CHECK (matched_workflows BETWEEN 0 AND 100),
  CHECK (failed_workflows BETWEEN 0 AND 100),
  CHECK (failed_workflows <= matched_workflows)
);

CREATE INDEX IF NOT EXISTS idx_atlas_v127_automation_events_recent
  ON atlas_v127_automation_events(tenant_id,created_at DESC,event_id DESC);

ALTER TABLE atlas_v127_automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v127_automation_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_v127_automation_events_tenant ON atlas_v127_automation_events;
CREATE POLICY atlas_v127_automation_events_tenant ON atlas_v127_automation_events
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid OR current_user='atlas_worker')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid OR current_user='atlas_worker');

REVOKE ALL ON atlas_v127_automation_events FROM PUBLIC, atlas_worker;

CREATE OR REPLACE FUNCTION atlas_v127_record_automation_event(
  p_tenant_id UUID,
  p_event_ref TEXT,
  p_event_type TEXT,
  p_resource_ref JSONB,
  p_payload_hash CHAR(64)
) RETURNS TABLE(event_id UUID, inserted BOOLEAN)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $v127$
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN
    RAISE EXCEPTION 'tenant_scope_invalid';
  END IF;
  INSERT INTO public.atlas_v127_automation_events(tenant_id,event_ref,event_type,resource_ref,payload_hash)
  VALUES(p_tenant_id,p_event_ref,p_event_type,p_resource_ref,p_payload_hash)
  ON CONFLICT(tenant_id,event_ref) DO NOTHING;
  SELECT e.event_id, TRUE
    INTO event_id, inserted
    FROM public.atlas_v127_automation_events e
   WHERE e.tenant_id=p_tenant_id AND e.event_ref=p_event_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_event_record_failed';
  END IF;
  RETURN NEXT;
END
$v127$;

CREATE OR REPLACE FUNCTION atlas_v127_finalize_automation_event(
  p_tenant_id UUID,
  p_event_id UUID,
  p_matched_workflows INTEGER,
  p_failed_workflows INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $v127$
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN
    RAISE EXCEPTION 'tenant_scope_invalid';
  END IF;
  IF p_matched_workflows < 0 OR p_matched_workflows > 100 OR p_failed_workflows < 0 OR p_failed_workflows > p_matched_workflows THEN
    RAISE EXCEPTION 'automation_event_counts_invalid';
  END IF;
  UPDATE public.atlas_v127_automation_events
     SET matched_workflows=p_matched_workflows,
         failed_workflows=p_failed_workflows,
         status=CASE WHEN p_failed_workflows=0 THEN 'processed' ELSE 'failed' END,
         processed_at=now()
   WHERE tenant_id=p_tenant_id AND event_id=p_event_id;
  RETURN FOUND;
END
$v127$;

COMMIT;
