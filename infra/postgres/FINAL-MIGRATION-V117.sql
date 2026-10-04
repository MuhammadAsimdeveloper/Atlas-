-- Atlas V111-V117: security, AI and governance persistence targets.
-- Static migration target. Validate PostgreSQL version, managed roles, backups and KMS before application.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_ai_agent_releases (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  release_id TEXT NOT NULL,
  config JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','evaluated','approved','published','paused','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id, version),
  UNIQUE (tenant_id, release_id)
);
ALTER TABLE atlas_ai_agent_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_ai_agent_releases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_ai_agent_releases_tenant ON atlas_ai_agent_releases;
CREATE POLICY atlas_ai_agent_releases_tenant ON atlas_ai_agent_releases
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_ai_knowledge_documents (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_hash CHAR(64) NOT NULL,
  source_ref TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  chunk_version INTEGER NOT NULL CHECK (chunk_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('pending','ready','quarantined','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, document_id)
);
ALTER TABLE atlas_ai_knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_ai_knowledge_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_ai_knowledge_documents_tenant ON atlas_ai_knowledge_documents;
CREATE POLICY atlas_ai_knowledge_documents_tenant ON atlas_ai_knowledge_documents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_security_policies (
  tenant_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  name TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  principal TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, policy_id)
);
ALTER TABLE atlas_security_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_security_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_security_policies_tenant ON atlas_security_policies;
CREATE POLICY atlas_security_policies_tenant ON atlas_security_policies
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_secret_references (
  tenant_id TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  expires_at TIMESTAMPTZ,
  rotation_policy TEXT NOT NULL,
  reference_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, secret_ref, version)
);
ALTER TABLE atlas_secret_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_secret_references FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_secret_references_tenant ON atlas_secret_references;
CREATE POLICY atlas_secret_references_tenant ON atlas_secret_references
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_audit_chain (
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  previous_hash CHAR(64),
  event_hash CHAR(64) NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  risk TEXT NOT NULL,
  decision TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);
ALTER TABLE atlas_audit_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_audit_chain FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_audit_chain_tenant ON atlas_audit_chain;
CREATE POLICY atlas_audit_chain_tenant ON atlas_audit_chain
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_audit_chain FROM PUBLIC;

CREATE TABLE IF NOT EXISTS atlas_sso_policies (
  tenant_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('oidc','saml','ldap')),
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_claims JSONB NOT NULL DEFAULT '["sub","email"]'::jsonb,
  enforce_mfa BOOLEAN NOT NULL DEFAULT TRUE,
  checksum CHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE atlas_sso_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_sso_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_sso_policies_tenant ON atlas_sso_policies;
CREATE POLICY atlas_sso_policies_tenant ON atlas_sso_policies
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

COMMIT;
