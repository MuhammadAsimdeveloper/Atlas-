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
INSERT INTO atlas_action_catalog(action_key,connector_key,action_version,input_schema,output_schema,risk_class,requires_approval)
VALUES
 ('communication.email','postmark',1,'{"type":"object","required":["connectionRef","to","from","subject","textBody"]}','{"type":"object","properties":{"providerRef":{"type":"string"}}}','standard',true),
 ('communication.sms','twilio',1,'{"type":"object","required":["connectionRef","to","body"]}','{"type":"object","properties":{"providerRef":{"type":"string"}}}','sensitive',true),
 ('communication.whatsapp','whatsapp_cloud',1,'{"type":"object","required":["connectionRef","to","body"]}','{"type":"object","properties":{"providerRef":{"type":"string"}}}','sensitive',true),
 ('communication.voice','twilio_voice',1,'{"type":"object","required":["connectionRef","to","twimlUrl"]}','{"type":"object","properties":{"providerRef":{"type":"string"}}}','sensitive',true),
 ('automation.webhook','webhook',1,'{"type":"object","required":["connectionRef","payload"]}','{"type":"object","properties":{"providerRef":{"type":"string"}}}','sensitive',true),
 ('service.jobber','jobber',1,'{"type":"object","required":["connectionRef","query","variables"]}','{"type":"object"}','standard',true)
ON CONFLICT(action_key) DO NOTHING;
COMMIT;
