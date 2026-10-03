-- Atlas V96: immutable tenant business calendars and DST-aware SLA deadline pins.
-- Apply V96 only after V80, V85, V90, V91, V92, V93, V94 and V95.
-- Resolve calendar revisions using trusted tenant storage; never use a JSON-provided snapshot.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_support_business_calendars (
  tenant_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 100),
  weekly_hours JSONB NOT NULL CHECK (jsonb_typeof(weekly_hours) = 'object'),
  holidays JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(holidays) = 'array' AND jsonb_array_length(holidays) <= 5000),
  date_overrides JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(date_overrides) = 'object' AND jsonb_object_length(date_overrides) <= 1000),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, calendar_id, version)
);

CREATE INDEX IF NOT EXISTS idx_atlas_support_business_calendars_latest
  ON atlas_support_business_calendars (tenant_id, calendar_id, version DESC);

ALTER TABLE atlas_support_business_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_support_business_calendars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_support_business_calendars_tenant_scope_v96 ON atlas_support_business_calendars;
CREATE POLICY atlas_support_business_calendars_tenant_scope_v96 ON atlas_support_business_calendars
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE OR REPLACE FUNCTION atlas_support_calendar_revision_immutable_v96()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Support calendar revisions are immutable; insert a new version';
END;
$$;
DROP TRIGGER IF EXISTS atlas_support_calendar_revision_immutable_trigger_v96 ON atlas_support_business_calendars;
CREATE TRIGGER atlas_support_calendar_revision_immutable_trigger_v96
  BEFORE UPDATE OR DELETE ON atlas_support_business_calendars
  FOR EACH ROW EXECUTE FUNCTION atlas_support_calendar_revision_immutable_v96();
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_support_business_calendars FROM PUBLIC;

ALTER TABLE atlas_support_cases ADD COLUMN IF NOT EXISTS sla_calendar_ref TEXT;
ALTER TABLE atlas_support_cases ADD COLUMN IF NOT EXISTS sla_calendar_version INTEGER;
ALTER TABLE atlas_support_cases DROP CONSTRAINT IF EXISTS atlas_support_cases_sla_calendar_pair_v96;
ALTER TABLE atlas_support_cases ADD CONSTRAINT atlas_support_cases_sla_calendar_pair_v96
  CHECK ((sla_calendar_ref IS NULL AND sla_calendar_version IS NULL) OR (sla_calendar_ref IS NOT NULL AND sla_calendar_version > 0));
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atlas_support_cases_sla_calendar_fk_v96'
      AND conrelid = 'atlas_support_cases'::regclass
  ) THEN
    ALTER TABLE atlas_support_cases
      ADD CONSTRAINT atlas_support_cases_sla_calendar_fk_v96
      FOREIGN KEY (tenant_id, sla_calendar_ref, sla_calendar_version)
      REFERENCES atlas_support_business_calendars (tenant_id, calendar_id, version);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_atlas_support_cases_sla_calendar
  ON atlas_support_cases (tenant_id, sla_calendar_ref, sla_calendar_version) WHERE sla_calendar_ref IS NOT NULL;

COMMIT;
