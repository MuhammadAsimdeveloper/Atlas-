-- Atlas V94: tenant-scoped service desk cases, SLA state and append-only audit events.
-- Apply V80, V85, V90, V91, V92 and V93 first. Set app.tenant_id from the
-- authenticated server session with SET LOCAL; never from request JSON.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_support_cases (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  contact_ref TEXT,
  conversation_ref TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','webchat','voice','phone','portal','api')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 240),
  intake_source TEXT NOT NULL DEFAULT 'manual' CHECK (intake_source IN ('manual','customer_agent','workflow','channel')),
  intake_reason TEXT CHECK (intake_reason IS NULL OR intake_reason ~ '^[a-z][a-z0-9_]{1,63}$'),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','waiting_customer','waiting_internal','resolved','closed')),
  assigned_to_ref TEXT,
  first_response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  sla_policy_ref TEXT,
  sla_paused_ms BIGINT NOT NULL DEFAULT 0 CHECK (sla_paused_ms >= 0),
  sla_pause_started_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (first_response_due_at IS NULL OR first_response_due_at >= created_at),
  CHECK (resolution_due_at IS NULL OR resolution_due_at >= created_at),
  CHECK (intake_source <> 'customer_agent' OR intake_reason IS NOT NULL),
  CHECK ((status = 'waiting_customer' AND sla_pause_started_at IS NOT NULL) OR (status <> 'waiting_customer' AND sla_pause_started_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_atlas_support_cases_queue
  ON atlas_support_cases (tenant_id, status, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_support_cases_assignee
  ON atlas_support_cases (tenant_id, assigned_to_ref, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_support_cases_first_response_sla
  ON atlas_support_cases (tenant_id, first_response_due_at) WHERE first_response_at IS NULL AND status <> 'closed';
CREATE INDEX IF NOT EXISTS idx_atlas_support_cases_resolution_sla
  ON atlas_support_cases (tenant_id, resolution_due_at) WHERE resolved_at IS NULL AND status <> 'closed';

CREATE TABLE IF NOT EXISTS atlas_support_case_events (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  actor_ref TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('case.created','case.assigned','case.status_changed','case.first_response_recorded')),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('agent_uncertain','customer_requested_human','sentiment_risk','policy_block','tool_failure','sla_risk','billing_help','appointment_help','other')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, case_id, command_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES atlas_support_cases (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_support_case_events_timeline
  ON atlas_support_case_events (tenant_id, case_id, occurred_at DESC);

ALTER TABLE atlas_support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_support_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_support_cases_tenant_scope_v94 ON atlas_support_cases;
CREATE POLICY atlas_support_cases_tenant_scope_v94 ON atlas_support_cases
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

ALTER TABLE atlas_support_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_support_case_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_support_case_events_tenant_scope_v94 ON atlas_support_case_events;
CREATE POLICY atlas_support_case_events_tenant_scope_v94 ON atlas_support_case_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
REVOKE UPDATE, DELETE ON atlas_support_case_events FROM PUBLIC;

COMMIT;
