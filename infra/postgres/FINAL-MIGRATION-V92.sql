-- Atlas V92: safe customer messaging, versioned workflow automations and tenant RLS hardening.
-- Apply V80, V85, V90 and V91 first. Execute each tenant request in a transaction that sets
-- app.tenant_id from the authenticated server session with SET LOCAL; never from request JSON.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_automation_workflow_releases (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot JSONB NOT NULL,
  trigger_type TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, workflow_id, version)
);
CREATE INDEX IF NOT EXISTS idx_atlas_workflow_releases_tenant_trigger
  ON atlas_automation_workflow_releases (tenant_id, trigger_type, published_at DESC);

CREATE TABLE IF NOT EXISTS atlas_automation_enrollments (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workflow_release_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  contact_ref TEXT NOT NULL,
  conversation_ref TEXT,
  trigger_type TEXT NOT NULL,
  event_occurred_at TIMESTAMPTZ NOT NULL,
  event_anchor_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  step_index INTEGER NOT NULL DEFAULT 0 CHECK (step_index >= 0),
  status TEXT NOT NULL CHECK (status IN ('queued','waiting','waiting_reply','waiting_delivery','waiting_action','completed','canceled','needs_review')),
  trigger_inputs JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_inputs) = 'object'),
  parent_enrollment_id TEXT,
  waiting_action_type TEXT CHECK (waiting_action_type IS NULL OR waiting_action_type IN ('create_task','enqueue_subworkflow','invoke_customer_agent')),
  waiting_action_key TEXT CHECK (waiting_action_key IS NULL OR waiting_action_key ~ '^[a-f0-9]{64}$'),
  child_enrollment_id TEXT,
  last_agent_outcome TEXT CHECK (last_agent_outcome IS NULL OR last_agent_outcome IN ('answered','human_handoff','needs_approval')),
  last_branch_step_id TEXT,
  last_branch_matched BOOLEAN,
  next_run_at TIMESTAMPTZ,
  reply_started_at TIMESTAMPTZ,
  reply_deadline_at TIMESTAMPTZ,
  reply_step_id TEXT,
  timeout_step_id TEXT,
  last_reason TEXT CHECK (last_reason IS NULL OR last_reason ~ '^[a-z][a-z0-9_]{1,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, workflow_release_id)
    REFERENCES atlas_automation_workflow_releases (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_automation_enrollments_due
  ON atlas_automation_enrollments (tenant_id, status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_atlas_automation_enrollments_contact
  ON atlas_automation_enrollments (tenant_id, contact_ref, created_at DESC);
ALTER TABLE atlas_automation_enrollments ADD COLUMN IF NOT EXISTS trigger_inputs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE atlas_automation_enrollments ADD COLUMN IF NOT EXISTS parent_enrollment_id TEXT;
ALTER TABLE atlas_automation_enrollments ADD COLUMN IF NOT EXISTS waiting_action_type TEXT;
ALTER TABLE atlas_automation_enrollments ADD COLUMN IF NOT EXISTS waiting_action_key TEXT;
ALTER TABLE atlas_automation_enrollments ADD COLUMN IF NOT EXISTS child_enrollment_id TEXT;
ALTER TABLE atlas_automation_enrollments ADD COLUMN IF NOT EXISTS last_agent_outcome TEXT;
ALTER TABLE atlas_automation_enrollments ADD COLUMN IF NOT EXISTS last_branch_step_id TEXT;
ALTER TABLE atlas_automation_enrollments ADD COLUMN IF NOT EXISTS last_branch_matched BOOLEAN;
CREATE INDEX IF NOT EXISTS idx_atlas_automation_enrollments_parent
  ON atlas_automation_enrollments (tenant_id, parent_enrollment_id) WHERE parent_enrollment_id IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atlas_automation_enrollments_trigger_inputs_object') THEN
    ALTER TABLE atlas_automation_enrollments ADD CONSTRAINT atlas_automation_enrollments_trigger_inputs_object CHECK (jsonb_typeof(trigger_inputs) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atlas_automation_enrollments_waiting_action_type') THEN
    ALTER TABLE atlas_automation_enrollments ADD CONSTRAINT atlas_automation_enrollments_waiting_action_type CHECK (waiting_action_type IS NULL OR waiting_action_type IN ('create_task','enqueue_subworkflow','invoke_customer_agent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atlas_automation_enrollments_waiting_action_key') THEN
    ALTER TABLE atlas_automation_enrollments ADD CONSTRAINT atlas_automation_enrollments_waiting_action_key CHECK (waiting_action_key IS NULL OR waiting_action_key ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atlas_automation_enrollments_last_agent_outcome') THEN
    ALTER TABLE atlas_automation_enrollments ADD CONSTRAINT atlas_automation_enrollments_last_agent_outcome CHECK (last_agent_outcome IS NULL OR last_agent_outcome IN ('answered','human_handoff','needs_approval'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS atlas_message_templates (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','webchat','voice')),
  purpose TEXT NOT NULL CHECK (purpose IN ('service','transactional','marketing','support','appointment','billing')),
  locale TEXT NOT NULL DEFAULT 'en-US',
  subject_template TEXT CHECK (subject_template IS NULL OR length(subject_template) <= 600),
  body_template TEXT NOT NULL CHECK (length(body_template) BETWEEN 1 AND 100000),
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id, version)
);
CREATE INDEX IF NOT EXISTS idx_atlas_message_templates_tenant_channel
  ON atlas_message_templates (tenant_id, channel, purpose, id, version DESC);

CREATE TABLE IF NOT EXISTS atlas_message_outbox (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  contact_ref TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','webchat','voice')),
  purpose TEXT NOT NULL CHECK (purpose IN ('service','transactional','marketing','support','appointment','billing')),
  workflow_release_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL CHECK (template_version > 0),
  connection_ref TEXT NOT NULL,
  delivery_key TEXT NOT NULL CHECK (delivery_key ~ '^[a-f0-9]{64}$'),
  intent_hash TEXT NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  policy_decision_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  suppression_revision TEXT NOT NULL,
  frequency_window_id TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('pending','scheduled','provider_accepted','delivered','opened','clicked','replied','bounced','failed','suppressed','canceled','needs_review')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_ref TEXT,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, delivery_key),
  FOREIGN KEY (tenant_id, workflow_release_id)
    REFERENCES atlas_automation_workflow_releases (tenant_id, id),
  FOREIGN KEY (tenant_id, enrollment_id)
    REFERENCES atlas_automation_enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, template_id, template_version)
    REFERENCES atlas_message_templates (tenant_id, id, version)
);
CREATE INDEX IF NOT EXISTS idx_atlas_message_outbox_claim
  ON atlas_message_outbox (tenant_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_atlas_message_outbox_contact
  ON atlas_message_outbox (tenant_id, contact_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_provider_message_receipts (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  outbox_message_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','webchat','voice')),
  connection_ref TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  provider_message_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('delivered','opened','clicked','replied','bounced','complaint','unsubscribed')),
  bounce_type TEXT CHECK (bounce_type IS NULL OR bounce_type IN ('hard','soft')),
  payload_sha256 TEXT CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connection_ref, provider_event_id),
  FOREIGN KEY (tenant_id, outbox_message_id)
    REFERENCES atlas_message_outbox (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_provider_receipts_message
  ON atlas_provider_message_receipts (tenant_id, outbox_message_id, occurred_at DESC);
ALTER TABLE atlas_provider_message_receipts ADD COLUMN IF NOT EXISTS bounce_type TEXT;
-- Legacy V92 receipt rows predate bounce classification; treat unclassified old
-- bounces as soft until the provider can supply definitive hard-bounce evidence.
UPDATE atlas_provider_message_receipts SET bounce_type = 'soft' WHERE status = 'bounced' AND bounce_type IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atlas_provider_message_receipts_bounce_type') THEN
    ALTER TABLE atlas_provider_message_receipts ADD CONSTRAINT atlas_provider_message_receipts_bounce_type
      CHECK ((status = 'bounced' AND bounce_type IN ('hard','soft')) OR (status <> 'bounced' AND bounce_type IS NULL));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS atlas_contact_channel_suppressions (
  tenant_id TEXT NOT NULL,
  contact_ref TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','webchat','voice')),
  status TEXT NOT NULL CHECK (status IN ('active','cleared')),
  source TEXT NOT NULL CHECK (source IN ('complaint','unsubscribed','hard_bounce','customer_request','verified_reconsent','platform_policy')),
  source_receipt_id TEXT,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, contact_ref, channel),
  FOREIGN KEY (tenant_id, source_receipt_id)
    REFERENCES atlas_provider_message_receipts (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_channel_suppressions_status
  ON atlas_contact_channel_suppressions (tenant_id, channel, status, updated_at DESC);
ALTER TABLE atlas_contact_channel_suppressions DROP CONSTRAINT IF EXISTS atlas_contact_channel_suppressions_source_check;
ALTER TABLE atlas_contact_channel_suppressions ADD CONSTRAINT atlas_contact_channel_suppressions_source_check
  CHECK (source IN ('complaint','unsubscribed','hard_bounce','customer_request','verified_reconsent','platform_policy'));

-- Memory facts are envelope-encrypted by the application/KMS adapter. This table
-- intentionally has no plaintext value column; retention cleanup must delete
-- expired and consent-revoked records across all partitions.
CREATE TABLE IF NOT EXISTS atlas_agent_memory_facts (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('conversation','contact')),
  scope_ref TEXT NOT NULL,
  fact_key TEXT NOT NULL CHECK (fact_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  encrypted_value BYTEA NOT NULL,
  key_version TEXT NOT NULL,
  value_sha256 TEXT NOT NULL CHECK (value_sha256 ~ '^[a-f0-9]{64}$'),
  consent_evidence_ref TEXT NOT NULL,
  consent_revision TEXT NOT NULL,
  source_inbound_message_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  erased_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id),
  CHECK (expires_at > created_at),
  CHECK (scope <> 'conversation' OR scope_ref <> '')
);
CREATE INDEX IF NOT EXISTS idx_atlas_agent_memory_scope_lookup
  ON atlas_agent_memory_facts (tenant_id, agent_id, scope, scope_ref, created_at DESC)
  WHERE erased_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_agent_memory_expiry
  ON atlas_agent_memory_facts (tenant_id, expires_at) WHERE erased_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_agent_memory_consent
  ON atlas_agent_memory_facts (tenant_id, consent_evidence_ref, erased_at);

-- Durable outbox for customer-agent calls started from a workflow. The message body
-- stays in tenant conversation storage and is fetched by the worker at execution time.
CREATE TABLE IF NOT EXISTS atlas_workflow_agent_invocations (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workflow_release_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  agent_deployment_id TEXT NOT NULL,
  agent_release_id TEXT NOT NULL,
  conversation_ref TEXT NOT NULL,
  inbound_event_ref TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('queued','running','answered','human_handoff','needs_approval','failed','needs_review')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, workflow_release_id) REFERENCES atlas_automation_workflow_releases (tenant_id, id),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES atlas_automation_enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_release_id) REFERENCES atlas_agent_deployment_releases (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_workflow_agent_invocations_claim
  ON atlas_workflow_agent_invocations (tenant_id, status, created_at);

CREATE OR REPLACE FUNCTION atlas_reject_business_artifact_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published Atlas workflow and message-template versions are immutable';
END;
$$;
DROP TRIGGER IF EXISTS atlas_automation_releases_immutable ON atlas_automation_workflow_releases;
CREATE TRIGGER atlas_automation_releases_immutable
  BEFORE UPDATE OR DELETE ON atlas_automation_workflow_releases
  FOR EACH ROW EXECUTE FUNCTION atlas_reject_business_artifact_mutation();
DROP TRIGGER IF EXISTS atlas_message_templates_immutable ON atlas_message_templates;
CREATE TRIGGER atlas_message_templates_immutable
  BEFORE UPDATE OR DELETE ON atlas_message_templates
  FOR EACH ROW EXECUTE FUNCTION atlas_reject_business_artifact_mutation();

-- Repair the earlier V80-V90 schema gap: every tenant-owned table must require an
-- explicit tenant context. Do not grant BYPASSRLS to an API or worker database role.
DO $$
DECLARE
  table_name TEXT;
  policy_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'atlas_agent_skills', 'atlas_agent_skill_assignments', 'atlas_ops_insights',
    'atlas_connector_health', 'atlas_connector_capability_snapshots', 'atlas_agent_evaluations',
    'atlas_agent_traces', 'atlas_actions', 'atlas_action_events', 'atlas_command_center_snapshots',
    'atlas_sync_cursors', 'atlas_webhook_receipts', 'atlas_queue_jobs', 'atlas_slo_windows',
    'atlas_customer_graph_nodes', 'atlas_customer_graph_edges', 'atlas_revenue_snapshots',
    'atlas_agent_deployment_releases', 'atlas_agent_deployment_bindings', 'atlas_agent_route_decisions',
    'atlas_automation_workflow_releases', 'atlas_automation_enrollments', 'atlas_message_templates',
    'atlas_message_outbox', 'atlas_provider_message_receipts', 'atlas_contact_channel_suppressions',
    'atlas_workflow_agent_invocations', 'atlas_agent_memory_facts'
  ] LOOP
    policy_name := table_name || '_tenant_scope_v92';
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    IF table_name = 'atlas_agent_deployment_releases' THEN
      EXECUTE 'DROP POLICY IF EXISTS atlas_agent_releases_tenant_scope ON atlas_agent_deployment_releases';
    ELSIF table_name = 'atlas_agent_deployment_bindings' THEN
      EXECUTE 'DROP POLICY IF EXISTS atlas_agent_bindings_tenant_scope ON atlas_agent_deployment_bindings';
    ELSIF table_name = 'atlas_agent_route_decisions' THEN
      EXECUTE 'DROP POLICY IF EXISTS atlas_agent_decisions_tenant_scope ON atlas_agent_route_decisions';
    END IF;
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))',
      policy_name, table_name
    );
  END LOOP;
END;
$$;

COMMIT;
