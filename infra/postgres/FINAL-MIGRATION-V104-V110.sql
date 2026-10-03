-- Atlas V104-V110: provider, website, communications, finance, agency and trust persistence targets
-- Static migration target. Validate PostgreSQL version, role boundaries, backups and tenant middleware before applying.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_provider_connections (
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending','active','degraded','revoked','error')),
  secret_ref TEXT NOT NULL,
  api_version TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, connection_id)
);
ALTER TABLE atlas_provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_provider_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_provider_connections_tenant ON atlas_provider_connections;
CREATE POLICY atlas_provider_connections_tenant ON atlas_provider_connections
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_sync_checkpoints (
  tenant_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound','bidirectional')),
  cursor TEXT,
  delta_link TEXT,
  etag TEXT,
  dedupe_key TEXT NOT NULL,
  conflict_policy TEXT NOT NULL,
  max_batch INTEGER NOT NULL CHECK (max_batch BETWEEN 1 AND 5000),
  checksum CHAR(64) NOT NULL,
  PRIMARY KEY (tenant_id, checkpoint_id),
  UNIQUE (tenant_id, dedupe_key)
);
ALTER TABLE atlas_sync_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_sync_checkpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_sync_checkpoints_tenant ON atlas_sync_checkpoints;
CREATE POLICY atlas_sync_checkpoints_tenant ON atlas_sync_checkpoints
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_webhook_receipts (
  tenant_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  payload_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (tenant_id, receipt_id),
  UNIQUE (tenant_id, provider_id, provider_event_id)
);
ALTER TABLE atlas_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_webhook_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_webhook_receipts_tenant ON atlas_webhook_receipts;
CREATE POLICY atlas_webhook_receipts_tenant ON atlas_webhook_receipts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_webhook_receipts FROM PUBLIC;

CREATE TABLE IF NOT EXISTS atlas_sites (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  locale TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, site_id)
);
ALTER TABLE atlas_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_sites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_sites_tenant ON atlas_sites;
CREATE POLICY atlas_sites_tenant ON atlas_sites
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_site_publish_events (
  tenant_id TEXT NOT NULL,
  publish_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('preview','public')),
  artifact_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  rollback_key CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, publish_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES atlas_sites(tenant_id, site_id) ON DELETE CASCADE
);
ALTER TABLE atlas_site_publish_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_site_publish_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_site_publish_events_tenant ON atlas_site_publish_events;
CREATE POLICY atlas_site_publish_events_tenant ON atlas_site_publish_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_delivery_envelopes (
  tenant_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  purpose TEXT NOT NULL,
  recipient_ref TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  template_release_hash CHAR(64) NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL,
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, delivery_id),
  UNIQUE (tenant_id, idempotency_key)
);
ALTER TABLE atlas_delivery_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_delivery_envelopes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_delivery_envelopes_tenant ON atlas_delivery_envelopes;
CREATE POLICY atlas_delivery_envelopes_tenant ON atlas_delivery_envelopes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_financial_documents (
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice','credit_note','usage','payment','refund','dispute','wallet')),
  currency CHAR(3) NOT NULL CHECK (currency = 'USD'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL,
  idempotency_key TEXT,
  checksum CHAR(64) NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, document_id)
);
ALTER TABLE atlas_financial_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_financial_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_financial_documents_tenant ON atlas_financial_documents;
CREATE POLICY atlas_financial_documents_tenant ON atlas_financial_documents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_agency_projects (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  budget_minor BIGINT NOT NULL CHECK (budget_minor > 0),
  currency CHAR(3) NOT NULL CHECK (currency = 'USD'),
  snapshot JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, project_id)
);
ALTER TABLE atlas_agency_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agency_projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_agency_projects_tenant ON atlas_agency_projects;
CREATE POLICY atlas_agency_projects_tenant ON atlas_agency_projects
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_snapshot_manifests (
  tenant_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  signature CHAR(64) NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, snapshot_id),
  UNIQUE (tenant_id, name, version)
);
ALTER TABLE atlas_snapshot_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_snapshot_manifests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_snapshot_manifests_tenant ON atlas_snapshot_manifests;
CREATE POLICY atlas_snapshot_manifests_tenant ON atlas_snapshot_manifests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_trust_control_evidence (
  tenant_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  control_id TEXT NOT NULL,
  framework TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  checksum CHAR(64) NOT NULL,
  PRIMARY KEY (tenant_id, evidence_id)
);
ALTER TABLE atlas_trust_control_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_trust_control_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_trust_control_evidence_tenant ON atlas_trust_control_evidence;
CREATE POLICY atlas_trust_control_evidence_tenant ON atlas_trust_control_evidence
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_trust_control_evidence FROM PUBLIC;

CREATE TABLE IF NOT EXISTS atlas_release_gates (
  release_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('approved','blocked')),
  failed_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  checksum CHAR(64) NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL
);
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_release_gates FROM PUBLIC;

COMMIT;
