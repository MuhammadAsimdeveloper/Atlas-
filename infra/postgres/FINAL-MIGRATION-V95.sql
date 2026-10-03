-- Atlas V95: duplicate-case suggestions and human-confirmed duplicate links.
-- Apply V80, V85, V90, V91, V92, V93 and V94 first. Preserve tenant RLS.
BEGIN;

ALTER TABLE atlas_support_cases ADD COLUMN IF NOT EXISTS duplicate_of_ref TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atlas_support_cases_duplicate_target_fk_v95'
      AND conrelid = 'atlas_support_cases'::regclass
  ) THEN
    ALTER TABLE atlas_support_cases
      ADD CONSTRAINT atlas_support_cases_duplicate_target_fk_v95
      FOREIGN KEY (tenant_id, duplicate_of_ref) REFERENCES atlas_support_cases (tenant_id, id);
  END IF;
END;
$$;
ALTER TABLE atlas_support_cases DROP CONSTRAINT IF EXISTS atlas_support_cases_duplicate_not_self_v95;
ALTER TABLE atlas_support_cases ADD CONSTRAINT atlas_support_cases_duplicate_not_self_v95
  CHECK (duplicate_of_ref IS NULL OR duplicate_of_ref <> id);
CREATE INDEX IF NOT EXISTS idx_atlas_support_cases_duplicate_target
  ON atlas_support_cases (tenant_id, duplicate_of_ref) WHERE duplicate_of_ref IS NOT NULL;

ALTER TABLE atlas_support_case_events DROP CONSTRAINT IF EXISTS atlas_support_case_events_event_type_check;
ALTER TABLE atlas_support_case_events DROP CONSTRAINT IF EXISTS atlas_support_case_events_event_type_v95;
ALTER TABLE atlas_support_case_events ADD CONSTRAINT atlas_support_case_events_event_type_v95
  CHECK (event_type IN ('case.created','case.assigned','case.status_changed','case.first_response_recorded','case.duplicate_linked'));

ALTER TABLE atlas_support_case_events DROP CONSTRAINT IF EXISTS atlas_support_case_events_reason_code_check;
ALTER TABLE atlas_support_case_events DROP CONSTRAINT IF EXISTS atlas_support_case_events_reason_code_v95;
ALTER TABLE atlas_support_case_events ADD CONSTRAINT atlas_support_case_events_reason_code_v95
  CHECK (reason_code IS NULL OR reason_code IN ('agent_uncertain','customer_requested_human','sentiment_risk','policy_block','tool_failure','sla_risk','billing_help','appointment_help','duplicate_case','other'));

COMMIT;
