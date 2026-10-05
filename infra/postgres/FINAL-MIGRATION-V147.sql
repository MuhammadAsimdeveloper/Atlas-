-- Atlas V147: durable SLO alert delivery attempts.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_alert_deliveries (
  delivery_id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES atlas_runtime_alerts(alert_id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES atlas_runtime_observability_destinations(destination_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','leased','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1000),
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code TEXT,
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alert_id,destination_id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_runtime_alert_deliveries_due
  ON atlas_runtime_alert_deliveries(status,next_attempt_at,updated_at);
ALTER TABLE atlas_runtime_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_runtime_alert_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_runtime_alert_deliveries_worker ON atlas_runtime_alert_deliveries;
CREATE POLICY atlas_runtime_alert_deliveries_worker
  ON atlas_runtime_alert_deliveries
  USING(current_user='atlas_worker')
  WITH CHECK(current_user='atlas_worker');
REVOKE ALL ON atlas_runtime_alert_deliveries FROM PUBLIC;
COMMIT;
