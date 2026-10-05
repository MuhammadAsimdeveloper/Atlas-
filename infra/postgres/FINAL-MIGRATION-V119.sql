-- V119 forward migration: extend the V102 workflow execution target into the durable execution control plane.
-- Preserve the existing V102 table and its TEXT tenant/record identity model.
ALTER TABLE atlas_workflow_executions
  ADD COLUMN IF NOT EXISTS graph_checksum CHAR(64),
  ADD COLUMN IF NOT EXISTS current_node_id TEXT,
  ADD COLUMN IF NOT EXISTS trigger_event_type TEXT,
  ADD COLUMN IF NOT EXISTS trigger_event_ref TEXT,
  ADD COLUMN IF NOT EXISTS state JSONB,
  ADD COLUMN IF NOT EXISTS state_checksum CHAR(64),
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS canceled_by UUID,
  ADD COLUMN IF NOT EXISTS replay_of_execution_id TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE atlas_workflow_executions
SET created_at = COALESCE(created_at, started_at),
    updated_at = COALESCE(updated_at, started_at)
WHERE created_at IS NULL OR updated_at IS NULL;

ALTER TABLE atlas_workflow_executions
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atlas_workflow_exec_list
  ON atlas_workflow_executions (tenant_id, created_at DESC, execution_id DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_workflow_exec_current
  ON atlas_workflow_executions (tenant_id, workflow_id, status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='atlas_workflow_execution_state_shape'
      AND conrelid='atlas_workflow_executions'::regclass
  ) THEN
    ALTER TABLE atlas_workflow_executions
      ADD CONSTRAINT atlas_workflow_execution_state_shape
      CHECK (
        state IS NULL OR (
          jsonb_typeof(state)='object'
          AND octet_length(state::text) <= 220000
          AND NOT state ? 'event'
          AND NOT state ? 'rawEvent'
          AND NOT state ? 'customerData'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='atlas_workflow_execution_checksum_shape'
      AND conrelid='atlas_workflow_executions'::regclass
  ) THEN
    ALTER TABLE atlas_workflow_executions
      ADD CONSTRAINT atlas_workflow_execution_checksum_shape
      CHECK (
        graph_checksum IS NULL OR graph_checksum ~ '^[a-f0-9]{64}$'
      );
    ALTER TABLE atlas_workflow_executions
      ADD CONSTRAINT atlas_workflow_execution_state_checksum_shape
      CHECK (
        state_checksum IS NULL OR state_checksum ~ '^[a-f0-9]{64}$'
      );
  END IF;
END
$$;

DROP POLICY IF EXISTS atlas_workflow_executions_tenant ON atlas_workflow_executions;
CREATE POLICY atlas_workflow_executions_tenant ON atlas_workflow_executions
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
    OR current_user='atlas_worker'
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
    OR current_user='atlas_worker'
  );

CREATE TABLE IF NOT EXISTS atlas_workflow_execution_events (
  tenant_id TEXT NOT NULL,
  event_id UUID NOT NULL,
  execution_id TEXT NOT NULL,
  actor_id UUID,
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  node_id TEXT CHECK (node_id IS NULL OR node_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,179}$'),
  attempt SMALLINT CHECK (attempt IS NULL OR attempt BETWEEN 1 AND 10),
  status TEXT,
  details_ref JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(details_ref)='object'
    AND details_ref - 'kind' - 'id' - 'version' = '{}'::jsonb
    AND octet_length(details_ref::text) <= 1024
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, execution_id)
    REFERENCES atlas_workflow_executions(tenant_id, execution_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_atlas_workflow_execution_events_timeline
  ON atlas_workflow_execution_events (tenant_id, execution_id, created_at, event_id);

ALTER TABLE atlas_workflow_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_workflow_execution_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_workflow_execution_events_tenant ON atlas_workflow_execution_events;
CREATE POLICY atlas_workflow_execution_events_tenant ON atlas_workflow_execution_events
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
    OR current_user='atlas_worker'
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
    OR current_user='atlas_worker'
  );

REVOKE ALL ON atlas_workflow_executions, atlas_workflow_execution_events FROM PUBLIC;
REVOKE ALL ON atlas_workflow_executions, atlas_workflow_execution_events FROM atlas_app, atlas_worker;
