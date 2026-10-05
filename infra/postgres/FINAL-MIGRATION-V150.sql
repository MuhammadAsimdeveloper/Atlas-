-- Atlas V150: immutable deployment evidence reports.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_evidence_reports (
  report_id TEXT PRIMARY KEY,
  release TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK(status IN ('incomplete','ready','expired')),
  verified_controls INTEGER NOT NULL CHECK(verified_controls >= 0),
  required_controls INTEGER NOT NULL CHECK(required_controls >= verified_controls),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
REVOKE ALL ON atlas_runtime_evidence_reports FROM PUBLIC;
COMMIT;
