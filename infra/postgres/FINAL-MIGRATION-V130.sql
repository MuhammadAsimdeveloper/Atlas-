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
COMMIT;
