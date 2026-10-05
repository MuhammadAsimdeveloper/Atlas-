-- Atlas V130: timezone/DST-aware schedule definitions.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_workflow_schedules (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
 schedule_id UUID NOT NULL, workflow_id TEXT NOT NULL, workflow_version INTEGER NOT NULL CHECK(workflow_version>0), schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('cron','interval','calendar')),
 expression TEXT NOT NULL CHECK(length(expression) BETWEEN 1 AND 240), timezone TEXT NOT NULL CHECK(length(timezone) BETWEEN 1 AND 80), dst_policy TEXT NOT NULL DEFAULT 'skip' CHECK(dst_policy IN ('skip','shift_forward','run_once')),
 next_run_at TIMESTAMPTZ NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','completed')), created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,schedule_id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_workflow_schedules_due ON atlas_workflow_schedules(next_run_at,tenant_id,schedule_id) WHERE state='active';
ALTER TABLE atlas_workflow_schedules ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_workflow_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_workflow_schedules_tenant ON atlas_workflow_schedules USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE OR REPLACE FUNCTION atlas_v130_claim_workflow_schedules(p_limit INTEGER DEFAULT 100)
RETURNS TABLE(tenant_id UUID,schedule_id UUID,workflow_id TEXT,workflow_version INTEGER,schedule_kind TEXT,expression TEXT,timezone TEXT,dst_policy TEXT,due_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN RAISE EXCEPTION 'invalid schedule limit'; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT s.*
    FROM atlas_workflow_schedules s
    WHERE s.state='active' AND s.next_run_at <= now()
    ORDER BY s.next_run_at,s.schedule_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE atlas_workflow_schedules s
  SET next_run_at=now()+interval '1 minute',updated_at=now()
  FROM due d
  WHERE s.tenant_id=d.tenant_id AND s.schedule_id=d.schedule_id
  RETURNING s.tenant_id,s.schedule_id,s.workflow_id,s.workflow_version,s.schedule_kind,s.expression,s.timezone,s.dst_policy,d.next_run_at;
END;
$$;
REVOKE ALL ON FUNCTION atlas_v130_claim_workflow_schedules(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v130_claim_workflow_schedules(INTEGER) TO atlas_app;
COMMIT;
