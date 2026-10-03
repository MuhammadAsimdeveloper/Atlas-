-- Atlas V93: immutable message-template and tenant-scoped CRM workflow action contracts.
-- Apply V80, V85, V90, V91 and V92 first. Set app.tenant_id from the trusted
-- authenticated server session with SET LOCAL; never from request JSON.
BEGIN;

ALTER TABLE atlas_automation_enrollments
  DROP CONSTRAINT IF EXISTS atlas_automation_enrollments_waiting_action_type;
ALTER TABLE atlas_automation_enrollments
  DROP CONSTRAINT IF EXISTS atlas_automation_enrollments_waiting_action_type_check;
ALTER TABLE atlas_automation_enrollments
  DROP CONSTRAINT IF EXISTS atlas_automation_enrollments_waiting_action_type_v93;
ALTER TABLE atlas_automation_enrollments
  ADD CONSTRAINT atlas_automation_enrollments_waiting_action_type_v93
  CHECK (waiting_action_type IS NULL OR waiting_action_type IN (
    'create_task','enqueue_subworkflow','invoke_customer_agent',
    'update_contact_field','add_contact_tag','remove_contact_tag'
  ));

-- The step configuration and its value stay in the immutable workflow release.
-- Workers claim this row, load the pinned step under tenant RLS, verify its hash,
-- then apply the contact mutation with the idempotency key. No contact PII is
-- copied into this operational command record.
CREATE TABLE IF NOT EXISTS atlas_workflow_business_action_invocations (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workflow_release_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('update_contact_field','add_contact_tag','remove_contact_tag')),
  contact_ref TEXT NOT NULL,
  field_ref TEXT,
  tag_ref TEXT,
  action_config_sha256 TEXT NOT NULL CHECK (action_config_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','needs_review')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, workflow_release_id)
    REFERENCES atlas_automation_workflow_releases (tenant_id, id),
  FOREIGN KEY (tenant_id, enrollment_id)
    REFERENCES atlas_automation_enrollments (tenant_id, id),
  CHECK (
    (action_type = 'update_contact_field' AND field_ref IS NOT NULL AND tag_ref IS NULL)
    OR (action_type IN ('add_contact_tag','remove_contact_tag') AND field_ref IS NULL AND tag_ref IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_atlas_workflow_business_actions_claim
  ON atlas_workflow_business_action_invocations (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_atlas_workflow_business_actions_enrollment
  ON atlas_workflow_business_action_invocations (tenant_id, enrollment_id, step_id);

ALTER TABLE atlas_workflow_business_action_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_business_action_invocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_business_action_invocations_tenant_scope_v93
  ON atlas_workflow_business_action_invocations;
CREATE POLICY atlas_workflow_business_action_invocations_tenant_scope_v93
  ON atlas_workflow_business_action_invocations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

COMMIT;
