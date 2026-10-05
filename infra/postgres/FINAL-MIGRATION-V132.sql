-- Atlas V132: connector lifecycle and provider health.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_connector_installations (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, installation_id UUID NOT NULL, connector_key TEXT NOT NULL CHECK(connector_key ~ '^[a-z][a-z0-9_.-]{1,79}$'), external_account_ref TEXT CHECK(external_account_ref IS NULL OR length(external_account_ref)<=240), credential_ref TEXT NOT NULL CHECK(credential_ref ~ '^[A-Za-z0-9_.:/@+-]{8,240}$'), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','degraded','reauth_required','revoked','disabled')), scopes_hash CHAR(64), token_expires_at TIMESTAMPTZ, last_health_at TIMESTAMPTZ, last_error_code TEXT, installed_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,installation_id), UNIQUE(tenant_id,connector_key,external_account_ref)
);
CREATE INDEX IF NOT EXISTS idx_atlas_connector_health ON atlas_connector_installations(tenant_id,status,last_health_at);
ALTER TABLE atlas_connector_installations ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_connector_installations FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_connector_installations_tenant ON atlas_connector_installations USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE IF NOT EXISTS atlas_connector_health_events (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, event_id UUID NOT NULL, installation_id UUID NOT NULL, status TEXT NOT NULL CHECK(status IN ('healthy','degraded','reauth_required','revoked')), code TEXT, details_ref JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details_ref)='object' AND details_ref-'kind'-'id'-'version'='{}'::jsonb AND octet_length(details_ref::text)<=1024), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,event_id)
);
ALTER TABLE atlas_connector_health_events ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_connector_health_events FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_connector_health_events_tenant ON atlas_connector_health_events USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;
