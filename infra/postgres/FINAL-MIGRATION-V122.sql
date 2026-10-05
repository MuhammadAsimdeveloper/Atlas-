-- V122 capability fabric: tenant-scoped runtime state for communications, integrations,
-- CRM/marketing extensions, agency controls and enterprise security metadata.
-- Secret material is intentionally NOT stored here; credential_ref points to an external KMS/vault.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_v122_provider_connections(
 tenant_id UUID NOT NULL, connection_id UUID NOT NULL, provider_key TEXT NOT NULL,
 channel TEXT, status TEXT NOT NULL DEFAULT 'draft', credential_ref TEXT, scopes JSONB NOT NULL DEFAULT '[]',
 metadata JSONB NOT NULL DEFAULT '{}', last_verified_at TIMESTAMPTZ, version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connection_id),
 CHECK(provider_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
 CHECK(channel IS NULL OR channel IN ('email','sms','whatsapp','voice')),
 CHECK(status IN ('draft','pending_oauth','verified','disabled','error')),
 CHECK(credential_ref IS NULL OR credential_ref ~ '^[A-Za-z0-9_.:/-]{1,240}$'),
 CHECK(jsonb_typeof(scopes)='array' AND octet_length(scopes::text)<=10000),
 CHECK(jsonb_typeof(metadata)='object' AND metadata ? 'secret' = false AND octet_length(metadata::text)<=20000)
);
CREATE UNIQUE INDEX IF NOT EXISTS atlas_v122_provider_unique ON atlas_v122_provider_connections(tenant_id,provider_key,coalesce(channel,'_'));

CREATE TABLE IF NOT EXISTS atlas_v122_credentials(
 tenant_id UUID NOT NULL, credential_id UUID NOT NULL DEFAULT gen_random_uuid(), provider_key TEXT NOT NULL,
 label TEXT NOT NULL, secret_ref TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
 expires_at TIMESTAMPTZ, rotated_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,credential_id),
 CHECK(secret_ref ~ '^[A-Za-z0-9_.:/-]{8,240}$'),
 CHECK(label ~ '^[^\\r\\n]{1,120}$'),
 CHECK(status IN ('active','expiring','expired','revoked'))
);

CREATE TABLE IF NOT EXISTS atlas_v122_conversations(
 tenant_id UUID NOT NULL, conversation_id UUID NOT NULL DEFAULT gen_random_uuid(), contact_id UUID,
 channel TEXT NOT NULL, provider_connection_id UUID, external_thread_ref TEXT,
 status TEXT NOT NULL DEFAULT 'open', assigned_agent_id UUID, handoff_reason TEXT,
 subject TEXT, last_message_at TIMESTAMPTZ, version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,conversation_id),
 CHECK(channel IN ('email','sms','whatsapp','voice','webchat')),
 CHECK(status IN ('open','pending','snoozed','closed')),
 CHECK(subject IS NULL OR length(subject)<=240)
);
CREATE UNIQUE INDEX IF NOT EXISTS atlas_v122_conversation_external ON atlas_v122_conversations(tenant_id,channel,external_thread_ref) WHERE external_thread_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS atlas_v122_messages(
 tenant_id UUID NOT NULL, message_id UUID NOT NULL DEFAULT gen_random_uuid(), conversation_id UUID NOT NULL,
 direction TEXT NOT NULL, sender_ref TEXT, recipient_ref TEXT, provider_message_ref TEXT,
 body_ref JSONB NOT NULL DEFAULT '{}', delivery_status TEXT NOT NULL DEFAULT 'queued',
 idempotency_key TEXT NOT NULL, sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, failed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,message_id),
 UNIQUE(tenant_id,idempotency_key),
 CHECK(direction IN ('inbound','outbound','system')),
 CHECK(delivery_status IN ('queued','sending','sent','delivered','read','failed','blocked')),
 CHECK(jsonb_typeof(body_ref)='object' AND body_ref ? 'body' = false AND body_ref ? 'secret' = false AND octet_length(body_ref::text)<=5000)
);

CREATE TABLE IF NOT EXISTS atlas_v122_webhook_endpoints(
 tenant_id UUID NOT NULL, endpoint_id UUID NOT NULL DEFAULT gen_random_uuid(), provider_key TEXT NOT NULL,
 path_token_hash TEXT NOT NULL, signing_secret_ref TEXT, enabled BOOLEAN NOT NULL DEFAULT true,
 accepted_events JSONB NOT NULL DEFAULT '[]', last_received_at TIMESTAMPTZ, failure_count INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,endpoint_id),
 CHECK(path_token_hash ~ '^[a-f0-9]{64}$'),
 CHECK(signing_secret_ref IS NULL OR signing_secret_ref ~ '^[A-Za-z0-9_.:/-]{8,240}$')
);

CREATE TABLE IF NOT EXISTS atlas_v122_oauth_connections(
 tenant_id UUID NOT NULL, oauth_connection_id UUID NOT NULL DEFAULT gen_random_uuid(), provider_key TEXT NOT NULL,
 state_hash TEXT NOT NULL, code_verifier_hash TEXT, scopes JSONB NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'pending', credential_ref TEXT, expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,oauth_connection_id),
 CHECK(state_hash ~ '^[a-f0-9]{64}$'), CHECK(code_verifier_hash IS NULL OR code_verifier_hash ~ '^[a-f0-9]{64}$'),
 CHECK(status IN ('pending','verified','revoked','error'))
);

CREATE TABLE IF NOT EXISTS atlas_v122_crm_definitions(
 tenant_id UUID NOT NULL, definition_id UUID NOT NULL DEFAULT gen_random_uuid(), kind TEXT NOT NULL,
 key TEXT NOT NULL, label TEXT NOT NULL, schema JSONB NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,definition_id), UNIQUE(tenant_id,kind,key),
 CHECK(kind IN ('custom_object','custom_field','segment','pipeline','score_model','forecast_model')),
 CHECK(key ~ '^[a-z][a-z0-9_.-]{1,79}$'), CHECK(jsonb_typeof(schema)='object' AND octet_length(schema::text)<=50000)
);

CREATE TABLE IF NOT EXISTS atlas_v122_marketing_definitions(
 tenant_id UUID NOT NULL, definition_id UUID NOT NULL DEFAULT gen_random_uuid(), kind TEXT NOT NULL,
 key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', config JSONB NOT NULL DEFAULT '{}',
 version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,definition_id), UNIQUE(tenant_id,kind,key),
 CHECK(kind IN ('campaign','form','funnel','landing_page','website','experiment','attribution')),
 CHECK(status IN ('draft','ready','published','paused','archived')),
 CHECK(jsonb_typeof(config)='object' AND config ? 'secret' = false AND octet_length(config::text)<=100000)
);

CREATE TABLE IF NOT EXISTS atlas_v122_agency_accounts(
 agency_tenant_id UUID NOT NULL, client_tenant_id UUID NOT NULL, relationship_status TEXT NOT NULL DEFAULT 'active',
 white_label BOOLEAN NOT NULL DEFAULT false, portal_enabled BOOLEAN NOT NULL DEFAULT false,
 snapshot_policy JSONB NOT NULL DEFAULT '{}', billing_policy JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(agency_tenant_id,client_tenant_id),
 CHECK(agency_tenant_id<>client_tenant_id), CHECK(jsonb_typeof(snapshot_policy)='object'), CHECK(jsonb_typeof(billing_policy)='object')
);

CREATE TABLE IF NOT EXISTS atlas_v122_enterprise_controls(
 tenant_id UUID PRIMARY KEY, mfa_required BOOLEAN NOT NULL DEFAULT false, sso_required BOOLEAN NOT NULL DEFAULT false,
 scim_enabled BOOLEAN NOT NULL DEFAULT false, waf_required BOOLEAN NOT NULL DEFAULT true,
 kms_key_ref TEXT, rotation_days INTEGER NOT NULL DEFAULT 90, audit_retention_days INTEGER NOT NULL DEFAULT 365,
 pen_test_due_at TIMESTAMPTZ, dr_rpo_seconds INTEGER NOT NULL DEFAULT 900, dr_rto_seconds INTEGER NOT NULL DEFAULT 3600,
 load_test_status TEXT NOT NULL DEFAULT 'not_run', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(rotation_days BETWEEN 1 AND 3650), CHECK(audit_retention_days BETWEEN 30 AND 36500),
 CHECK(dr_rpo_seconds BETWEEN 60 AND 604800), CHECK(dr_rto_seconds BETWEEN 60 AND 604800),
 CHECK(load_test_status IN ('not_run','scheduled','passed','failed'))
);

ALTER TABLE atlas_v122_provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v122_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v122_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v122_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v122_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v122_oauth_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v122_crm_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v122_marketing_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v122_enterprise_controls ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['atlas_v122_provider_connections','atlas_v122_credentials','atlas_v122_conversations','atlas_v122_messages','atlas_v122_webhook_endpoints','atlas_v122_oauth_connections','atlas_v122_crm_definitions','atlas_v122_marketing_definitions']) AS table_name LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I USING (tenant_id::text=nullif(current_setting(''app.tenant_id'',true),'''')) WITH CHECK (tenant_id::text=nullif(current_setting(''app.tenant_id'',true),''''))',t,t);
  END LOOP;
END;
$policies$;
DROP POLICY IF EXISTS atlas_v122_enterprise_controls_tenant ON atlas_v122_enterprise_controls;
CREATE POLICY atlas_v122_enterprise_controls_tenant ON atlas_v122_enterprise_controls USING (tenant_id::text=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK (tenant_id::text=nullif(current_setting('app.tenant_id',true),''));

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM atlas_worker;
COMMIT;
