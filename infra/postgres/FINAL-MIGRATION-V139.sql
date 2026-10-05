-- Atlas V139: Redis acceleration contracts with PostgreSQL durability authority.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_runtime_dispatch_records (
 tenant_id TEXT NOT NULL,
 dispatch_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 job_type TEXT NOT NULL,
 priority SMALLINT NOT NULL CHECK(priority BETWEEN 0 AND 9),
 transport TEXT NOT NULL CHECK(transport IN ('postgres','redis')),
 envelope_sha256 TEXT NOT NULL,
 published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,dispatch_id),
 UNIQUE(tenant_id,job_id)
);
ALTER TABLE atlas_runtime_dispatch_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_runtime_dispatch_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_runtime_dispatch_records_worker ON atlas_runtime_dispatch_records;
CREATE POLICY atlas_runtime_dispatch_records_worker ON atlas_runtime_dispatch_records USING(current_user='atlas_worker') WITH CHECK(current_user='atlas_worker');
REVOKE ALL ON atlas_runtime_dispatch_records FROM PUBLIC;
COMMIT;
