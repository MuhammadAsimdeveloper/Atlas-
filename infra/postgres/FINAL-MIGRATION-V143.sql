-- Atlas V143: deployment evidence gates; no credentials or provider secrets are stored here.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_deployment_evidence (
 evidence_id TEXT PRIMARY KEY,
 release TEXT NOT NULL,
 control TEXT NOT NULL CHECK(control IN ('managed_postgres','redis_ha','kms','waf_cdn','backup_pitr','restore_drill','load_test','disaster_recovery','provider_credentials','public_origin')),
 status TEXT NOT NULL CHECK(status IN ('unverified','verified','expired')),
 evidence_sha256 TEXT,
 verified_at TIMESTAMPTZ,
 expires_at TIMESTAMPTZ
);
REVOKE ALL ON atlas_runtime_deployment_evidence FROM PUBLIC;
COMMIT;
