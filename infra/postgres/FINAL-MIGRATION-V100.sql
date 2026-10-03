-- Atlas V100: privacy-minimal voice-agent quality reviews and structured coaching.
-- Apply after FINAL-MIGRATION-V99.sql. The service must set app.tenant_id only
-- after authenticating a user and resolving active membership for that tenant.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_voice_call_quality_reviews (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  review_ref TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_checksum TEXT NOT NULL CHECK (session_checksum ~ '^[a-f0-9]{64}$'),
  reviewed_release_ids JSONB NOT NULL CHECK (jsonb_typeof(reviewed_release_ids) = 'array' AND jsonb_array_length(reviewed_release_ids) BETWEEN 1 AND 4),
  call_outcome TEXT NOT NULL CHECK (call_outcome IN ('resolved','appointment_booked','qualified','follow_up_required','transferred','voicemail','spam','other')),
  business_intent TEXT NOT NULL CHECK (business_intent IN ('appointment_booking','lead_qualification','billing','support','other')),
  business_intent_evidence_ref TEXT NOT NULL,
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  critical_failure_codes TEXT[] NOT NULL DEFAULT '{}'
    CHECK (critical_failure_codes <@ ARRAY['policy_compliance','ai_disclosure']::TEXT[]),
  review_status TEXT NOT NULL CHECK (review_status IN ('good','coaching_required','safety_escalation')),
  evaluator_id TEXT NOT NULL,
  evaluator_version TEXT NOT NULL,
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('voice_qa_runtime','authenticated_reviewer')),
  reviewer_ref TEXT NOT NULL,
  talk_duration_seconds INTEGER CHECK (talk_duration_seconds IS NULL OR talk_duration_seconds BETWEEN 0 AND 86400),
  agent_transfer_count SMALLINT NOT NULL CHECK (agent_transfer_count BETWEEN 0 AND 3),
  human_handoff BOOLEAN NOT NULL,
  appointment_booked BOOLEAN NOT NULL,
  review_checksum TEXT NOT NULL CHECK (review_checksum ~ '^[a-f0-9]{64}$'),
  evaluated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, session_id, review_ref),
  FOREIGN KEY (tenant_id, session_id) REFERENCES atlas_voice_call_sessions (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS atlas_voice_call_quality_criteria (
  tenant_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL CHECK (criterion_id IN ('policy_compliance','ai_disclosure','task_completion','answer_grounding','handoff_quality','follow_up_quality')),
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence_bps SMALLINT NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
  evidence_refs JSONB NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) BETWEEN 1 AND 5),
  PRIMARY KEY (tenant_id, review_id, criterion_id),
  FOREIGN KEY (tenant_id, review_id) REFERENCES atlas_voice_call_quality_reviews (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_atlas_voice_quality_release_v100
  ON atlas_voice_call_quality_reviews (tenant_id, evaluated_at DESC, score);
CREATE INDEX IF NOT EXISTS idx_atlas_voice_quality_safety_v100
  ON atlas_voice_call_quality_reviews (tenant_id, review_status, evaluated_at DESC)
  WHERE review_status = 'safety_escalation';
CREATE INDEX IF NOT EXISTS idx_atlas_voice_quality_criterion_v100
  ON atlas_voice_call_quality_criteria (tenant_id, criterion_id, score);

CREATE OR REPLACE FUNCTION atlas_voice_quality_completed_call_v100()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_status TEXT;
BEGIN
  SELECT status INTO session_status
    FROM atlas_voice_call_sessions
    WHERE tenant_id = NEW.tenant_id AND id = NEW.session_id
    FOR SHARE;
  IF session_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Voice quality reviews require a completed same-tenant call';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS atlas_voice_quality_completed_call_trigger_v100 ON atlas_voice_call_quality_reviews;
CREATE TRIGGER atlas_voice_quality_completed_call_trigger_v100
  BEFORE INSERT ON atlas_voice_call_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION atlas_voice_quality_completed_call_v100();

ALTER TABLE atlas_voice_call_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_voice_call_quality_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_voice_quality_reviews_tenant_scope_v100 ON atlas_voice_call_quality_reviews;
CREATE POLICY atlas_voice_quality_reviews_tenant_scope_v100 ON atlas_voice_call_quality_reviews
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

ALTER TABLE atlas_voice_call_quality_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_voice_call_quality_criteria FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_voice_quality_criteria_tenant_scope_v100 ON atlas_voice_call_quality_criteria;
CREATE POLICY atlas_voice_quality_criteria_tenant_scope_v100 ON atlas_voice_call_quality_criteria
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE OR REPLACE FUNCTION atlas_voice_quality_immutable_v100()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Voice quality reviews and criteria are append-only';
END;
$$;
DROP TRIGGER IF EXISTS atlas_voice_quality_reviews_immutable_trigger_v100 ON atlas_voice_call_quality_reviews;
CREATE TRIGGER atlas_voice_quality_reviews_immutable_trigger_v100
  BEFORE UPDATE OR DELETE ON atlas_voice_call_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION atlas_voice_quality_immutable_v100();
DROP TRIGGER IF EXISTS atlas_voice_quality_criteria_immutable_trigger_v100 ON atlas_voice_call_quality_criteria;
CREATE TRIGGER atlas_voice_quality_criteria_immutable_trigger_v100
  BEFORE UPDATE OR DELETE ON atlas_voice_call_quality_criteria
  FOR EACH ROW EXECUTE FUNCTION atlas_voice_quality_immutable_v100();
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_voice_call_quality_reviews FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_voice_call_quality_criteria FROM PUBLIC;

COMMIT;
