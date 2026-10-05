-- Atlas V144: runtime control-plane integration.
BEGIN;
ALTER TABLE atlas_runtime_dispatch_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('pending','published','degraded','failed'));
ALTER TABLE atlas_runtime_dispatch_records ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 0 AND 1000);
ALTER TABLE atlas_runtime_dispatch_records ADD COLUMN IF NOT EXISTS last_error_code TEXT;
ALTER TABLE atlas_runtime_dispatch_records ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE atlas_runtime_dispatch_records ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS atlas_runtime_dispatch_status ON atlas_runtime_dispatch_records(status,last_attempt_at DESC);
CREATE TABLE IF NOT EXISTS atlas_runtime_control_events(event_id UUID PRIMARY KEY,event_type TEXT NOT NULL CHECK(event_type~'^[a-z][a-z0-9_.-]{1,79}$'),severity TEXT NOT NULL CHECK(severity IN ('info','warning','error','critical')),pool_id TEXT,worker_id TEXT,decision JSONB NOT NULL DEFAULT '{}',decision_sha256 TEXT NOT NULL CHECK(decision_sha256~'^[a-f0-9]{64}$'),occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(jsonb_typeof(decision)='object' AND octet_length(decision::text)<=4096));
CREATE INDEX IF NOT EXISTS atlas_runtime_control_events_recent ON atlas_runtime_control_events(occurred_at DESC,event_type);
ALTER TABLE atlas_runtime_control_events ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_runtime_control_events FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_runtime_control_events_worker ON atlas_runtime_control_events USING(current_user='atlas_worker') WITH CHECK(current_user='atlas_worker');
REVOKE ALL ON atlas_runtime_control_events FROM PUBLIC,atlas_app;
COMMIT;