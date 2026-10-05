-- V119 durable workflow execution state.
-- Stores only validated workflow snapshots, opaque event references and opaque step result references.
CREATE TABLE IF NOT EXISTS atlas_workflow_executions (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  execution_id UUID NOT NULL,
  workflow_id UUID NOT NULL,
  workflow_version INTEGER NOT NULL CHECK (workflow_version BETWEEN 1 AND 2147483647),
  graph_checksum CHAR(64) NOT NULL CHECK (graph_checksum ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting','waiting_approval','retryable','completed','failed','canceled','dead_letter')),
  current_node_id TEXT,
  trigger_event_type TEXT NOT NULL CHECK (trigger_event_type ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  trigger_event_ref TEXT NOT NULL CHECK (trigger_event_ref ~ '^[A-Za-z][A-Za-z0-9_.:_-]{0,179}$'),
  state JSONB NOT NULL CHECK (
    jsonb_typeof(state)='object'
    AND octet_length(state::text) <= 220000
    AND NOT state ? 'event'
    AND NOT state ? 'rawEvent'
    AND NOT state ? 'customerData'
  ),
  state_checksum CHAR(64) NOT NULL CHECK (state_checksum ~ '^[a-f0-9]{64}$'),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  retry_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  canceled_by UUID REFERENCES atlas_auth_users(user_id),
  replay_of_execution_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, execution_id),
  CHECK ((status IN ('completed','failed','canceled','dead_letter')) = (ended_at IS NOT NULL)),
  CHECK ((status='retryable') = (retry_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_atlas_workflow_exec_list ON atlas_workflow_executions (tenant_id, created_at DESC, execution_id DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_workflow_exec_current ON atlas_workflow_executions (tenant_id, workflow_id, status, created_at DESC);

ALTER TABLE atlas_workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_executions_tenant ON atlas_workflow_executions;
CREATE POLICY atlas_workflow_executions_tenant ON atlas_workflow_executions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_user='atlas_worker')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_user='atlas_worker');

CREATE TABLE IF NOT EXISTS atlas_workflow_execution_events (
  tenant_id UUID NOT NULL,
  event_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  actor_id UUID,
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  node_id TEXT CHECK (node_id IS NULL OR node_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,179}$'),
  attempt SMALLINT CHECK (attempt IS NULL OR attempt BETWEEN 1 AND 10),
  status TEXT CHECK (status IS NULL OR status IN ('queued','running','waiting','waiting_approval','retryable','completed','failed','canceled','dead_letter')),
  details_ref JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(details_ref)='object'
    AND details_ref - 'kind' - 'id' - 'version' = '{}'::jsonb
    AND octet_length(details_ref::text) <= 1024
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES atlas_workflow_executions(tenant_id, execution_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_atlas_workflow_execution_events_timeline ON atlas_workflow_execution_events (tenant_id, execution_id, created_at, event_id);

ALTER TABLE atlas_workflow_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_execution_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_execution_events_tenant ON atlas_workflow_execution_events;
CREATE POLICY atlas_workflow_execution_events_tenant ON atlas_workflow_execution_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_user='atlas_worker')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_user='atlas_worker');

REVOKE ALL ON atlas_workflow_executions, atlas_workflow_execution_events FROM PUBLIC;
REVOKE ALL ON atlas_workflow_executions, atlas_workflow_execution_events FROM atlas_app, atlas_worker;
