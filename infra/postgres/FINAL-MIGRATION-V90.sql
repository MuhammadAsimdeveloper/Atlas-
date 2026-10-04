-- Atlas V86-V90: provider sync, durable queue runtime, SLO and business graph projections.
CREATE TABLE IF NOT EXISTS atlas_sync_cursors (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connector_id TEXT NOT NULL, resource TEXT NOT NULL,
  cursor_value TEXT, state TEXT NOT NULL DEFAULT 'idle', pages INTEGER NOT NULL DEFAULT 0,
  records INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connector_id, resource)
);
CREATE INDEX IF NOT EXISTS idx_atlas_sync_cursors_tenant ON atlas_sync_cursors(tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS atlas_webhook_receipts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connector_id TEXT NOT NULL, event_id TEXT NOT NULL,
  event_type TEXT, payload_hash TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connector_id, event_id)
);

CREATE TABLE IF NOT EXISTS atlas_queue_jobs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, queue TEXT NOT NULL, type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, idempotency_key TEXT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL, leased_until TIMESTAMPTZ, worker_id TEXT, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, queue, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_atlas_queue_jobs_claim ON atlas_queue_jobs(tenant_id, queue, status, available_at);

CREATE TABLE IF NOT EXISTS atlas_slo_windows (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, service TEXT NOT NULL, "window" TEXT NOT NULL,
  good_events BIGINT NOT NULL DEFAULT 0, total_events BIGINT NOT NULL DEFAULT 0,
  target NUMERIC(8,6) NOT NULL, burn_rate NUMERIC(12,6) NOT NULL DEFAULT 0,
  within_slo BOOLEAN NOT NULL DEFAULT true, observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_slo_tenant_service ON atlas_slo_windows(tenant_id, service, observed_at DESC);

CREATE TABLE IF NOT EXISTS atlas_customer_graph_nodes (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, node_type TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_customer_graph_nodes_tenant_type ON atlas_customer_graph_nodes(tenant_id, node_type);

CREATE TABLE IF NOT EXISTS atlas_customer_graph_edges (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL,
  edge_type TEXT NOT NULL, weight NUMERIC(12,6), attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_customer_graph_edges_from ON atlas_customer_graph_edges(tenant_id, from_node);
CREATE INDEX IF NOT EXISTS idx_atlas_customer_graph_edges_to ON atlas_customer_graph_edges(tenant_id, to_node);

CREATE TABLE IF NOT EXISTS atlas_revenue_snapshots (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, snapshot JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_revenue_snapshots_tenant ON atlas_revenue_snapshots(tenant_id, generated_at DESC);
