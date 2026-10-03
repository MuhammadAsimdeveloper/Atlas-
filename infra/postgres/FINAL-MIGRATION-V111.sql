-- Atlas V111: full-feature catalog, product resources and durable workflow runtime.
-- Static migration target. Apply only after validating roles, RLS, backups and production procedures.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_feature_catalog (
  feature_id TEXT PRIMARY KEY,
  benchmark TEXT NOT NULL CHECK (benchmark IN ('GHL','n8n')),
  domain TEXT NOT NULL,
  feature TEXT NOT NULL,
  stage TEXT NOT NULL,
  atlas_anchor TEXT NOT NULL,
  atlas_status TEXT NOT NULL CHECK (atlas_status IN ('contract','build','deployment')),
  acceptance_gate TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atlas_product_resources (
  tenant_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft','review','approved','published','paused','archived')),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal','sensitive','critical')),
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, resource_type, resource_id, version)
);
ALTER TABLE atlas_product_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_product_resources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_product_resources_tenant ON atlas_product_resources;
CREATE POLICY atlas_product_resources_tenant ON atlas_product_resources
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_product_resources FROM PUBLIC;

CREATE TABLE IF NOT EXISTS atlas_workflow_releases (
  tenant_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  compiled_snapshot JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','paused','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workflow_id, version)
);
ALTER TABLE atlas_workflow_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_releases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_releases_tenant ON atlas_workflow_releases;
CREATE POLICY atlas_workflow_releases_tenant ON atlas_workflow_releases
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_workflow_executions (
  tenant_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  workflow_checksum CHAR(64) NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','running','waiting','succeeded','failed','canceled','dead_letter')),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempts_by_step JSONB NOT NULL DEFAULT '{}'::jsonb,
  trigger_event JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_step JSONB,
  deadline_at TIMESTAMPTZ,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, execution_id),
  UNIQUE (tenant_id, idempotency_key)
);
ALTER TABLE atlas_workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_executions_tenant ON atlas_workflow_executions;
CREATE POLICY atlas_workflow_executions_tenant ON atlas_workflow_executions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_queue_jobs (
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  queue TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  available_at TIMESTAMPTZ NOT NULL,
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','dead_letter')),
  lease_worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  dead_lettered_at TIMESTAMPTZ,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id)
);
ALTER TABLE atlas_queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_queue_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_queue_jobs_tenant ON atlas_queue_jobs;
CREATE POLICY atlas_queue_jobs_tenant ON atlas_queue_jobs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_connector_definitions (
  provider TEXT NOT NULL,
  api_version TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  auth_mode TEXT NOT NULL,
  category TEXT NOT NULL,
  operations JSONB NOT NULL,
  triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  webhook JSONB,
  rate_limit JSONB NOT NULL,
  risk TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, api_version)
);

CREATE TABLE IF NOT EXISTS atlas_feature_bundles (
  tenant_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  declared_capabilities JSONB NOT NULL,
  resource_refs JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, bundle_id, version)
);
ALTER TABLE atlas_feature_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_feature_bundles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_feature_bundles_tenant ON atlas_feature_bundles;
CREATE POLICY atlas_feature_bundles_tenant ON atlas_feature_bundles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE INDEX IF NOT EXISTS idx_atlas_queue_claim
  ON atlas_queue_jobs (tenant_id, queue, state, available_at);
CREATE INDEX IF NOT EXISTS idx_atlas_execution_workflow
  ON atlas_workflow_executions (tenant_id, workflow_id, workflow_version);

COMMIT;
