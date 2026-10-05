-- Atlas V129: execution inspector, diagnostics and replay evidence.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_workflow_execution_diagnostics (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
 diagnostic_id UUID NOT NULL, execution_id TEXT NOT NULL, event_id UUID,
 severity TEXT NOT NULL CHECK (severity IN ('info','warning','error','critical')),
 code TEXT NOT NULL CHECK (code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
 node_id TEXT CHECK (node_id IS NULL OR node_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,179}$'),
 attempt SMALLINT CHECK (attempt IS NULL OR attempt BETWEEN 1 AND 10),
 details_ref JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details_ref)='object' AND details_ref-'kind'-'id'-'version'='{}'::jsonb AND octet_length(details_ref::text)<=2048),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,diagnostic_id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_exec_diag ON atlas_workflow_execution_diagnostics(tenant_id,execution_id,created_at);
ALTER TABLE atlas_workflow_execution_diagnostics ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_workflow_execution_diagnostics FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_exec_diag_tenant ON atlas_workflow_execution_diagnostics USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE IF NOT EXISTS atlas_workflow_execution_replays (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
 replay_id UUID NOT NULL, source_execution_id TEXT NOT NULL, source_version INTEGER NOT NULL CHECK(source_version>0), target_workflow_version INTEGER NOT NULL CHECK(target_workflow_version>0), requested_by UUID, reason TEXT CHECK(reason IS NULL OR length(reason)<=500), status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','queued','running','completed','failed','canceled')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,replay_id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_exec_replays ON atlas_workflow_execution_replays(tenant_id,source_execution_id,created_at);
ALTER TABLE atlas_workflow_execution_replays ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_workflow_execution_replays FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_exec_replays_tenant ON atlas_workflow_execution_replays USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;
