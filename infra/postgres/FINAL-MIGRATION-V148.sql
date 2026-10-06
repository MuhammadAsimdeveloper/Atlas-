-- Atlas V148: durable voice journey reconciliation outcomes
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_voice_journey_outcomes (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  outcome_id UUID NOT NULL,
  journey_id TEXT NOT NULL,
  voice_session_ref TEXT NOT NULL,
  contact_ref TEXT NOT NULL,
  conversation_ref TEXT NOT NULL,
  lead_ref TEXT,
  appointment_ref TEXT,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('resolved','appointment_booked','qualified','follow_up_required','transferred','voicemail','spam','other')),
  event_ref TEXT NOT NULL,
  idempotency_key CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'reconciled' CHECK (status IN ('reconciled','duplicate','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum CHAR(64) NOT NULL,
  PRIMARY KEY (tenant_id, outcome_id),
  UNIQUE (tenant_id, idempotency_key)
);
ALTER TABLE atlas_voice_journey_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_voice_journey_outcomes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_voice_journey_outcomes_tenant ON atlas_voice_journey_outcomes;
CREATE POLICY atlas_voice_journey_outcomes_tenant ON atlas_voice_journey_outcomes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid);
CREATE INDEX IF NOT EXISTS idx_atlas_voice_journey_outcomes_conversation
  ON atlas_voice_journey_outcomes(tenant_id, conversation_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_voice_journey_outcomes_contact
  ON atlas_voice_journey_outcomes(tenant_id, contact_ref, created_at DESC);
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_voice_journey_outcomes FROM PUBLIC;

COMMIT;
