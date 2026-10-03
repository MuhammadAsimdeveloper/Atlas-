-- Atlas V99: tenant-scoped voice call sessions and privacy-minimal audit events.
-- Apply after V80, V85, V90 and V91-V96. The webhook adapter must verify the
-- exact provider URL, signature and request parameters before inserting evidence.
-- Set app.tenant_id only from an authenticated server-side tenant context.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_voice_call_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  contact_ref TEXT,
  conversation_ref TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  provider_connection_ref TEXT NOT NULL,
  provider_call_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('scheduled','queued','agent_active','human_handoff_pending','human_active','completed','failed','abandoned','needs_review')),
  current_agent_release_ref TEXT NOT NULL,
  current_agent_version INTEGER NOT NULL CHECK (current_agent_version > 0),
  current_agent_checksum TEXT NOT NULL CHECK (current_agent_checksum ~ '^[a-f0-9]{64}$'),
  agent_release_chain JSONB NOT NULL CHECK (jsonb_typeof(agent_release_chain) = 'array' AND jsonb_array_length(agent_release_chain) BETWEEN 1 AND 4),
  agent_transfer_count SMALLINT NOT NULL DEFAULT 0 CHECK (agent_transfer_count BETWEEN 0 AND 3),
  ai_disclosure_version TEXT NOT NULL,
  ai_disclosure_at TIMESTAMPTZ,
  human_queue_ref TEXT,
  handoff_reason TEXT CHECK (handoff_reason IS NULL OR handoff_reason IN ('caller_requested_human','billing_help','appointment_help','sensitive_request','low_confidence','tool_failure','language_mismatch','urgent_safety','other')),
  recording_mode TEXT NOT NULL CHECK (recording_mode IN ('disabled','consent_required')),
  recording_consent_status TEXT NOT NULL CHECK (recording_consent_status IN ('not_required','unknown','granted','denied')),
  recording_state TEXT NOT NULL DEFAULT 'off' CHECK (recording_state IN ('off','recording','stopped')),
  recording_ref TEXT,
  appointment_ref TEXT,
  call_outcome TEXT CHECK (call_outcome IS NULL OR call_outcome IN ('resolved','appointment_booked','qualified','follow_up_required','transferred','voicemail','spam','other')),
  outbound_authorization_ref TEXT,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  scheduled_at TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, provider_connection_ref, provider_call_ref),
  CHECK (direction <> 'inbound' OR provider_call_ref IS NOT NULL),
  CHECK (status <> 'agent_active' OR ai_disclosure_at IS NOT NULL),
  CHECK (recording_mode <> 'disabled' OR recording_consent_status = 'not_required'),
  CHECK (recording_state <> 'recording' OR (recording_mode = 'consent_required' AND recording_consent_status = 'granted' AND recording_ref IS NOT NULL)),
  CHECK ((status = 'human_handoff_pending' AND human_queue_ref IS NOT NULL AND handoff_reason IS NOT NULL) OR status <> 'human_handoff_pending')
);

CREATE INDEX IF NOT EXISTS idx_atlas_voice_call_queue_v99
  ON atlas_voice_call_sessions (tenant_id, status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_atlas_voice_call_contact_v99
  ON atlas_voice_call_sessions (tenant_id, contact_ref, created_at DESC) WHERE contact_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS atlas_voice_call_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_event_ref TEXT NOT NULL,
  provider_connection_ref TEXT NOT NULL,
  provider_event_ref TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('voice.call_received','voice.call_scheduled','voice.provider_call_started','voice.ai_disclosure_played','voice.agent_connected','voice.agent_transferred','voice.human_handoff_requested','voice.human_connected','voice.recording_consent_granted','voice.recording_consent_denied','voice.recording_started','voice.recording_stopped','voice.appointment_booked','voice.call_completed','voice.caller_disconnected','voice.call_failed','voice.review_required')),
  source_type TEXT NOT NULL CHECK (source_type IN ('provider_webhook','agent_runtime','authenticated_human','workflow_runtime','system_runtime')),
  actor_ref TEXT,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('scheduled','queued','agent_active','human_handoff_pending','human_active','completed','failed','abandoned','needs_review')),
  to_status TEXT CHECK (to_status IS NULL OR to_status IN ('scheduled','queued','agent_active','human_handoff_pending','human_active','completed','failed','abandoned','needs_review')),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('caller_requested_human','billing_help','appointment_help','sensitive_request','low_confidence','tool_failure','language_mismatch','urgent_safety','other','provider_error','caller_disconnect','review_required')),
  related_ref TEXT,
  evidence_ref TEXT,
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, session_id, source_event_ref),
  UNIQUE (tenant_id, provider_connection_ref, provider_event_ref),
  FOREIGN KEY (tenant_id, session_id) REFERENCES atlas_voice_call_sessions (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_atlas_voice_call_events_timeline_v99
  ON atlas_voice_call_events (tenant_id, session_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_atlas_voice_call_events_type_v99
  ON atlas_voice_call_events (tenant_id, event_type, occurred_at DESC);

ALTER TABLE atlas_voice_call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_voice_call_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_voice_call_sessions_tenant_scope_v99 ON atlas_voice_call_sessions;
CREATE POLICY atlas_voice_call_sessions_tenant_scope_v99 ON atlas_voice_call_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

ALTER TABLE atlas_voice_call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_voice_call_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_voice_call_events_tenant_scope_v99 ON atlas_voice_call_events;
CREATE POLICY atlas_voice_call_events_tenant_scope_v99 ON atlas_voice_call_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE OR REPLACE FUNCTION atlas_voice_call_event_immutable_v99()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Voice call events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS atlas_voice_call_events_immutable_trigger_v99 ON atlas_voice_call_events;
CREATE TRIGGER atlas_voice_call_events_immutable_trigger_v99
  BEFORE UPDATE OR DELETE ON atlas_voice_call_events
  FOR EACH ROW EXECUTE FUNCTION atlas_voice_call_event_immutable_v99();
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_voice_call_events FROM PUBLIC;

COMMIT;
