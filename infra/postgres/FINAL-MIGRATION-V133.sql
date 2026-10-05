-- Atlas V133: governed action catalog and connector capability bindings.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_action_catalog (
 action_key TEXT PRIMARY KEY, connector_key TEXT NOT NULL, action_version INTEGER NOT NULL CHECK(action_version>0), input_schema JSONB NOT NULL CHECK(jsonb_typeof(input_schema)='object' AND octet_length(input_schema::text)<=16000), output_schema JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(output_schema)='object' AND octet_length(output_schema::text)<=16000), risk_class TEXT NOT NULL DEFAULT 'standard' CHECK(risk_class IN ('read','standard','sensitive','financial','destructive')), requires_approval BOOLEAN NOT NULL DEFAULT false, enabled BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas_tenant_action_bindings (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, action_key TEXT NOT NULL REFERENCES atlas_action_catalog(action_key), enabled BOOLEAN NOT NULL DEFAULT true, installation_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,action_key)
);
ALTER TABLE atlas_tenant_action_bindings ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_tenant_action_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_tenant_action_bindings_tenant ON atlas_tenant_action_bindings USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;
