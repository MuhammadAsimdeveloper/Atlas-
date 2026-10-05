-- Atlas V142: OTLP destinations and alert routing contracts.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_observability_destinations (
 destination_id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('otlp','webhook','email')),
 endpoint_ref TEXT NOT NULL,
 secret_ref TEXT,
 enabled BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE atlas_runtime_observability_destinations ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_runtime_observability_destinations FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_runtime_observability_worker ON atlas_runtime_observability_destinations USING(current_user='atlas_worker') WITH CHECK(current_user='atlas_worker');
REVOKE ALL ON atlas_runtime_observability_destinations FROM PUBLIC;
COMMIT;
