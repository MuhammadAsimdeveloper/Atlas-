-- Atlas V102: hardened target CRM + workflow nodes + booking calendars + agent runtime
-- Static migration target. Apply after V100 only after validating PostgreSQL version and deployment roles.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_crm_records (
  tenant_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('contact','company','lead','deal','ticket','task','note','appointment','custom')),
  version INTEGER NOT NULL CHECK (version >= 1),
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, record_id)
);
ALTER TABLE atlas_crm_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_crm_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_crm_records_tenant ON atlas_crm_records;
CREATE POLICY atlas_crm_records_tenant ON atlas_crm_records USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
CREATE INDEX IF NOT EXISTS idx_atlas_crm_records_tenant_type ON atlas_crm_records (tenant_id, object_type, record_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_crm_records_dedupe ON atlas_crm_records (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS atlas_crm_associations (
  tenant_id TEXT NOT NULL,
  association_id TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  label TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, association_id),
  UNIQUE (tenant_id, from_type, from_id, to_type, to_id, label)
);
ALTER TABLE atlas_crm_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_crm_associations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_crm_associations_tenant ON atlas_crm_associations;
CREATE POLICY atlas_crm_associations_tenant ON atlas_crm_associations USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_crm_pipelines (
  tenant_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, pipeline_id, version)
);
ALTER TABLE atlas_crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_crm_pipelines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_crm_pipelines_tenant ON atlas_crm_pipelines;
CREATE POLICY atlas_crm_pipelines_tenant ON atlas_crm_pipelines USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_workflow_graph_releases (
  tenant_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  release_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, workflow_id, version),
  UNIQUE (tenant_id, release_id)
);
ALTER TABLE atlas_workflow_graph_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_graph_releases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_graph_releases_tenant ON atlas_workflow_graph_releases;
CREATE POLICY atlas_workflow_graph_releases_tenant ON atlas_workflow_graph_releases USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
CREATE OR REPLACE FUNCTION atlas_v102_immutable_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable Atlas release/calendar row'; END; $$;
DROP TRIGGER IF EXISTS atlas_v102_workflow_release_immutable ON atlas_workflow_graph_releases;
CREATE TRIGGER atlas_v102_workflow_release_immutable BEFORE UPDATE OR DELETE ON atlas_workflow_graph_releases FOR EACH ROW EXECUTE FUNCTION atlas_v102_immutable_release();

CREATE TABLE IF NOT EXISTS atlas_booking_calendars (
  tenant_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  snapshot JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, calendar_id, version)
);
ALTER TABLE atlas_booking_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_booking_calendars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_booking_calendars_tenant ON atlas_booking_calendars;
CREATE POLICY atlas_booking_calendars_tenant ON atlas_booking_calendars USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
DROP TRIGGER IF EXISTS atlas_v102_booking_calendar_immutable ON atlas_booking_calendars;
CREATE TRIGGER atlas_v102_booking_calendar_immutable BEFORE UPDATE OR DELETE ON atlas_booking_calendars FOR EACH ROW EXECUTE FUNCTION atlas_v102_immutable_release();

CREATE TABLE IF NOT EXISTS atlas_appointments (
  tenant_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  calendar_version INTEGER NOT NULL,
  contact_ref TEXT NOT NULL,
  host_ref TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('held','booked','canceled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  idempotency_key TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, appointment_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (end_at > start_at)
);
ALTER TABLE atlas_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_appointments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_appointments_tenant ON atlas_appointments;
CREATE POLICY atlas_appointments_tenant ON atlas_appointments USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
CREATE INDEX IF NOT EXISTS idx_atlas_appointments_window ON atlas_appointments (tenant_id, calendar_id, start_at, end_at) WHERE status <> 'canceled';

CREATE TABLE IF NOT EXISTS atlas_workflow_executions (
  tenant_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum CHAR(64) NOT NULL,
  PRIMARY KEY (tenant_id, execution_id)
);
ALTER TABLE atlas_workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_executions_tenant ON atlas_workflow_executions;
CREATE POLICY atlas_workflow_executions_tenant ON atlas_workflow_executions USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_workflow_execution_steps (
  tenant_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  PRIMARY KEY (tenant_id, execution_id, step_index),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES atlas_workflow_executions(tenant_id, execution_id) ON DELETE CASCADE
);
ALTER TABLE atlas_workflow_execution_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_execution_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_execution_steps_tenant ON atlas_workflow_execution_steps;
CREATE POLICY atlas_workflow_execution_steps_tenant ON atlas_workflow_execution_steps USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_agent_sessions (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  conversation_ref TEXT NOT NULL,
  actor_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','completed','failed','handoff','needs_approval')),
  turns INTEGER NOT NULL DEFAULT 0 CHECK (turns >= 0),
  tool_calls INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls >= 0),
  lease_until TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  summary TEXT,
  checksum CHAR(64) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, session_id)
);
ALTER TABLE atlas_agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_agent_sessions_tenant ON atlas_agent_sessions;
CREATE POLICY atlas_agent_sessions_tenant ON atlas_agent_sessions USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_agent_tool_events (
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('read','network','write','financial','destructive')),
  arguments_hash CHAR(64) NOT NULL,
  idempotency_key CHAR(64) NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, session_id) REFERENCES atlas_agent_sessions(tenant_id, session_id) ON DELETE CASCADE
);
ALTER TABLE atlas_agent_tool_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_tool_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_agent_tool_events_tenant ON atlas_agent_tool_events;
CREATE POLICY atlas_agent_tool_events_tenant ON atlas_agent_tool_events USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_workflow_graph_releases FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_booking_calendars FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_agent_tool_events FROM PUBLIC;

COMMIT;
