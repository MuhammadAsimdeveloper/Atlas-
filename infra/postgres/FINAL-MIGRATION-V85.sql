-- Atlas V82-V85: reliability, evaluations, telemetry, durable actions and command center projections.
CREATE TABLE IF NOT EXISTS atlas_connector_health (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connector_id TEXT NOT NULL, provider TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unknown','healthy','degraded','unhealthy')),
  latency_ms INTEGER, error_rate NUMERIC(8,5) NOT NULL DEFAULT 0, credential_valid BOOLEAN NOT NULL DEFAULT true,
  missing_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb, observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_connector_health_tenant_connector ON atlas_connector_health(tenant_id, connector_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS atlas_connector_capability_snapshots (
  tenant_id TEXT NOT NULL, connector_id TEXT NOT NULL, capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, connector_id, captured_at)
);
CREATE TABLE IF NOT EXISTS atlas_agent_evaluations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, score NUMERIC(6,2) NOT NULL,
  passed INTEGER NOT NULL, total INTEGER NOT NULL, release_gate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas_agent_traces (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, trace_id TEXT NOT NULL, span_id TEXT, operation TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT, duration_ms INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_agent_traces_tenant_trace ON atlas_agent_traces(tenant_id, trace_id, created_at);
CREATE TABLE IF NOT EXISTS atlas_actions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, proposal_id TEXT NOT NULL, tool TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, risk TEXT NOT NULL, status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_atlas_actions_tenant_status ON atlas_actions(tenant_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS atlas_action_events (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, action_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
  actor_id TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_action_events_tenant_action ON atlas_action_events(tenant_id, action_id, created_at);
CREATE TABLE IF NOT EXISTS atlas_command_center_snapshots (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, snapshot JSONB NOT NULL, generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_command_center_tenant_time ON atlas_command_center_snapshots(tenant_id, generated_at DESC);