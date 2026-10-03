-- Atlas V91: tenant-bound agent deployment releases, channel bindings and safe route decisions.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_agent_deployment_releases (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  config_sha256 TEXT NOT NULL CHECK (config_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot JSONB NOT NULL,
  evaluation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_atlas_agent_releases_tenant_agent
  ON atlas_agent_deployment_releases (tenant_id, agent_id, version DESC);

-- Release snapshots are append-only. Pause, promote and rollback operations update
-- channel bindings and append audit records; they never rewrite an old snapshot.
CREATE OR REPLACE FUNCTION atlas_reject_agent_release_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Atlas agent deployment releases are immutable';
END;
$$;

DROP TRIGGER IF EXISTS atlas_agent_releases_immutable ON atlas_agent_deployment_releases;
CREATE TRIGGER atlas_agent_releases_immutable
  BEFORE UPDATE OR DELETE ON atlas_agent_deployment_releases
  FOR EACH ROW EXECUTE FUNCTION atlas_reject_agent_release_mutation();

CREATE TABLE IF NOT EXISTS atlas_agent_deployment_bindings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','webchat','voice')),
  destination_ref TEXT,
  route_config JSONB NOT NULL,
  route_fingerprint TEXT NOT NULL CHECK (route_fingerprint ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('canary','active','paused','archived')),
  traffic_percent SMALLINT NOT NULL CHECK (traffic_percent BETWEEN 0 AND 100),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, release_id, route_id),
  FOREIGN KEY (tenant_id, release_id)
    REFERENCES atlas_agent_deployment_releases (tenant_id, id)
);

-- Exact live-route duplicates are rejected. Overlapping but non-identical routes
-- are resolved by server policy, and ambiguous ties fail closed to a human.
CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_agent_bindings_live_fingerprint
  ON atlas_agent_deployment_bindings (tenant_id, route_fingerprint)
  WHERE status IN ('canary','active');
CREATE INDEX IF NOT EXISTS idx_atlas_agent_bindings_tenant_channel_status
  ON atlas_agent_deployment_bindings (tenant_id, channel, status, priority DESC);

CREATE TABLE IF NOT EXISTS atlas_agent_route_decisions (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  inbound_message_id TEXT NOT NULL,
  release_id TEXT,
  route_id TEXT,
  agent_id TEXT,
  release_version INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('agent','human')),
  reason_code TEXT NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, inbound_message_id),
  FOREIGN KEY (tenant_id, release_id)
    REFERENCES atlas_agent_deployment_releases (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_atlas_agent_route_decisions_tenant_time
  ON atlas_agent_route_decisions (tenant_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_agent_route_decisions_tenant_conversation
  ON atlas_agent_route_decisions (tenant_id, conversation_id, decided_at);

ALTER TABLE atlas_agent_deployment_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_deployment_releases FORCE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_deployment_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_deployment_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_route_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_route_decisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atlas_agent_releases_tenant_scope ON atlas_agent_deployment_releases;
CREATE POLICY atlas_agent_releases_tenant_scope ON atlas_agent_deployment_releases
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS atlas_agent_bindings_tenant_scope ON atlas_agent_deployment_bindings;
CREATE POLICY atlas_agent_bindings_tenant_scope ON atlas_agent_deployment_bindings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS atlas_agent_decisions_tenant_scope ON atlas_agent_route_decisions;
CREATE POLICY atlas_agent_decisions_tenant_scope ON atlas_agent_route_decisions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

COMMIT;
