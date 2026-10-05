-- Atlas V135: environment promotion, immutable releases and rollback pointers.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_workflow_environments (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, environment_id UUID NOT NULL, name TEXT NOT NULL CHECK(name ~ '^[a-z][a-z0-9_-]{0,39}$'), stage TEXT NOT NULL CHECK(stage IN ('draft','staging','production')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,environment_id), UNIQUE(tenant_id,name)
);
CREATE TABLE IF NOT EXISTS atlas_workflow_promotions (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, promotion_id UUID NOT NULL, workflow_id TEXT NOT NULL, source_environment_id UUID NOT NULL, target_environment_id UUID NOT NULL, source_version INTEGER NOT NULL CHECK(source_version>0), target_version INTEGER NOT NULL CHECK(target_version>0), manifest_sha256 CHAR(64) NOT NULL, status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','promoting','succeeded','failed','rolled_back')), requested_by UUID, approved_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ, PRIMARY KEY(tenant_id,promotion_id)
);
CREATE TABLE IF NOT EXISTS atlas_workflow_rollbacks (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, rollback_id UUID NOT NULL, promotion_id UUID NOT NULL, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, reason TEXT NOT NULL CHECK(length(reason)<=500), requested_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,rollback_id)
);
ALTER TABLE atlas_workflow_environments ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_workflow_environments FORCE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_promotions ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_workflow_promotions FORCE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_rollbacks ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_workflow_rollbacks FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_workflow_env_tenant ON atlas_workflow_environments USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY atlas_workflow_promotions_tenant ON atlas_workflow_promotions USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY atlas_workflow_rollbacks_tenant ON atlas_workflow_rollbacks USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;
