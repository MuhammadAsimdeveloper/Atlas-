-- Atlas V131: event routing predicates, branches and deduplication policy.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_workflow_event_routes (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
 route_id UUID NOT NULL, workflow_id TEXT NOT NULL, workflow_version INTEGER NOT NULL CHECK(workflow_version>0), event_type TEXT NOT NULL CHECK(event_type ~ '^[a-z][a-z0-9_.:-]{0,119}$'), priority INTEGER NOT NULL DEFAULT 100 CHECK(priority BETWEEN 0 AND 10000), predicate JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(predicate)='object' AND octet_length(predicate::text)<=12000), branch_key TEXT CHECK(branch_key IS NULL OR branch_key ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'), dedup_window_seconds INTEGER NOT NULL DEFAULT 0 CHECK(dedup_window_seconds BETWEEN 0 AND 2592000), enabled BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,route_id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_event_routes ON atlas_workflow_event_routes(tenant_id,event_type,priority) WHERE enabled;
ALTER TABLE atlas_workflow_event_routes ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_workflow_event_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_event_routes_tenant ON atlas_workflow_event_routes USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE IF NOT EXISTS atlas_workflow_event_dedup (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, dedup_key CHAR(64) NOT NULL, route_id UUID NOT NULL, first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(tenant_id,dedup_key,route_id)
);
ALTER TABLE atlas_workflow_event_dedup ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_workflow_event_dedup FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_event_dedup_tenant ON atlas_workflow_event_dedup USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;
