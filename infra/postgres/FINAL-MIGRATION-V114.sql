-- Atlas V114: tenant-scoped Growth Center records, immutable revisions, jobs and Paddle billing state.
-- Apply after V112 with scripts/migrate.mjs. All tenant data uses forced RLS.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_growth_items (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  module_key TEXT NOT NULL CHECK (module_key IN (
    'contacts','leads','pipelines','tasks','ai-qualification','ai-follow-up','workflows',
    'email-templates','funnels','websites','social-planner','affiliate-system','reputation-management'
  )),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  state TEXT NOT NULL CHECK (state IN ('draft','review','published','scheduled','paused','active','open','in_progress','blocked','completed','canceled','archived')),
  version INTEGER NOT NULL CHECK (version >= 1),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 98304),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_by UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  updated_by UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  idempotency_key CHAR(64) CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id),
  UNIQUE (tenant_id, module_key, idempotency_key)
);
ALTER TABLE atlas_growth_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_growth_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_growth_items_tenant ON atlas_growth_items;
CREATE POLICY atlas_growth_items_tenant ON atlas_growth_items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND updated_by::text = nullif(current_setting('app.actor_id', true), ''));
CREATE INDEX IF NOT EXISTS idx_atlas_growth_items_module_updated ON atlas_growth_items (tenant_id, module_key, updated_at DESC, item_id);
CREATE INDEX IF NOT EXISTS idx_atlas_growth_items_state ON atlas_growth_items (tenant_id, module_key, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS atlas_growth_item_versions (
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  module_key TEXT NOT NULL CHECK (module_key IN (
    'contacts','leads','pipelines','tasks','ai-qualification','ai-follow-up','workflows',
    'email-templates','funnels','websites','social-planner','affiliate-system','reputation-management'
  )),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  state TEXT NOT NULL CHECK (state IN ('draft','review','published','scheduled','paused','active','open','in_progress','blocked','completed','canceled','archived')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 98304),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  actor_id UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id, version),
  FOREIGN KEY (tenant_id, item_id) REFERENCES atlas_growth_items(tenant_id, item_id) ON DELETE CASCADE
);
ALTER TABLE atlas_growth_item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_growth_item_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_growth_item_versions_tenant ON atlas_growth_item_versions;
CREATE POLICY atlas_growth_item_versions_tenant ON atlas_growth_item_versions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND actor_id::text = nullif(current_setting('app.actor_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_growth_item_events (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  item_id UUID,
  actor_id UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  module_key TEXT NOT NULL CHECK (module_key IN (
    'contacts','leads','pipelines','tasks','ai-qualification','ai-follow-up','workflows',
    'email-templates','funnels','websites','social-planner','affiliate-system','reputation-management','billing'
  )),
  action TEXT NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.-]{1,80}$'),
  version INTEGER CHECK (version IS NULL OR version >= 1),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);
ALTER TABLE atlas_growth_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_growth_item_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_growth_item_events_tenant ON atlas_growth_item_events;
CREATE POLICY atlas_growth_item_events_tenant ON atlas_growth_item_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND actor_id::text = nullif(current_setting('app.actor_id', true), ''));
CREATE INDEX IF NOT EXISTS idx_atlas_growth_events_timeline ON atlas_growth_item_events (tenant_id, created_at DESC, event_id);

CREATE TABLE IF NOT EXISTS atlas_growth_jobs (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  item_id UUID NOT NULL,
  module_key TEXT NOT NULL CHECK (module_key IN ('ai-follow-up','workflows','email-templates','social-planner','reputation-management')),
  job_type TEXT NOT NULL CHECK (job_type IN ('evaluate_lead','advance_follow_up','execute_workflow','send_email','publish_social','request_review')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','succeeded','retryable','dead_letter','canceled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  idempotency_key CHAR(64) NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  result_code TEXT CHECK (result_code IS NULL OR result_code ~ '^[a-z0-9_.-]{1,80}$'),
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, item_id) REFERENCES atlas_growth_items(tenant_id, item_id)
);
ALTER TABLE atlas_growth_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_growth_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_growth_jobs_tenant ON atlas_growth_jobs;
CREATE POLICY atlas_growth_jobs_tenant ON atlas_growth_jobs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_atlas_growth_jobs_queue ON atlas_growth_jobs (status, scheduled_at, tenant_id) WHERE status IN ('queued','retryable');

CREATE TABLE IF NOT EXISTS atlas_paddle_subscriptions (
  tenant_id UUID PRIMARY KEY REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  paddle_subscription_id TEXT NOT NULL UNIQUE CHECK (length(paddle_subscription_id) BETWEEN 4 AND 128),
  paddle_customer_id TEXT CHECK (paddle_customer_id IS NULL OR length(paddle_customer_id) BETWEEN 4 AND 128),
  paddle_price_id TEXT NOT NULL CHECK (length(paddle_price_id) BETWEEN 4 AND 128),
  plan_key TEXT NOT NULL CHECK (plan_key IN ('starter','growth','scale')),
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','paused','canceled','unknown')),
  current_period_ends_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  last_event_id TEXT NOT NULL CHECK (length(last_event_id) BETWEEN 4 AND 128),
  last_event_occurred_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE atlas_paddle_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_paddle_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_paddle_subscriptions_tenant ON atlas_paddle_subscriptions;
CREATE POLICY atlas_paddle_subscriptions_tenant ON atlas_paddle_subscriptions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS atlas_paddle_events (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  paddle_event_id TEXT NOT NULL CHECK (length(paddle_event_id) BETWEEN 4 AND 160),
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,100}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  body_sha256 CHAR(64) NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  process_status TEXT NOT NULL CHECK (process_status IN ('accepted','applied','ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, paddle_event_id),
  UNIQUE (paddle_event_id)
);
ALTER TABLE atlas_paddle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_paddle_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_paddle_events_tenant ON atlas_paddle_events;
CREATE POLICY atlas_paddle_events_tenant ON atlas_paddle_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION atlas_v114_immutable_growth_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Atlas V114 version and event rows are append-only';
END;
$$;
DROP TRIGGER IF EXISTS atlas_v114_growth_versions_immutable ON atlas_growth_item_versions;
CREATE TRIGGER atlas_v114_growth_versions_immutable BEFORE UPDATE OR DELETE ON atlas_growth_item_versions FOR EACH ROW EXECUTE FUNCTION atlas_v114_immutable_growth_row();
DROP TRIGGER IF EXISTS atlas_v114_growth_events_immutable ON atlas_growth_item_events;
CREATE TRIGGER atlas_v114_growth_events_immutable BEFORE UPDATE OR DELETE ON atlas_growth_item_events FOR EACH ROW EXECUTE FUNCTION atlas_v114_immutable_growth_row();
DROP TRIGGER IF EXISTS atlas_v114_paddle_events_immutable ON atlas_paddle_events;
CREATE TRIGGER atlas_v114_paddle_events_immutable BEFORE UPDATE OR DELETE ON atlas_paddle_events FOR EACH ROW EXECUTE FUNCTION atlas_v114_immutable_growth_row();
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_growth_item_versions, atlas_growth_item_events, atlas_paddle_events FROM PUBLIC;

COMMIT;
