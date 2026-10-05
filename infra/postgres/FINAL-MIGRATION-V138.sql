-- Atlas V138: durable distributed runtime capacity leases and backpressure.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_runtime_capacity_leases (
 pool_id TEXT NOT NULL REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE,
 worker_id TEXT NOT NULL,
 slots INTEGER NOT NULL CHECK(slots BETWEEN 0 AND 100000),
 lease_until TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(pool_id,worker_id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_runtime_capacity_active ON atlas_runtime_capacity_leases(pool_id,lease_until);

CREATE OR REPLACE FUNCTION atlas_v138_acquire_runtime_capacity(p_pool_id TEXT,p_worker_id TEXT,p_requested INTEGER,p_lease_seconds INTEGER DEFAULT 60)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE available INTEGER;
DECLARE granted INTEGER;
DECLARE max_slots INTEGER;
BEGIN
 IF p_pool_id !~ '^[A-Za-z0-9_.:-]{1,120}$' OR p_worker_id !~ '^[A-Za-z0-9_.:-]{1,120}$' OR p_requested NOT BETWEEN 1 AND 100000 OR p_lease_seconds NOT BETWEEN 15 AND 900 THEN
   RAISE EXCEPTION 'runtime_capacity_parameters_invalid';
 END IF;
 SELECT max_concurrency INTO max_slots FROM public.atlas_runtime_pools WHERE pool_id=p_pool_id AND enabled=true;
 IF max_slots IS NULL THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_pool_id,0));
 DELETE FROM public.atlas_runtime_capacity_leases WHERE pool_id=p_pool_id AND lease_until<=now();
 SELECT greatest(0,max_slots-coalesce(sum(slots),0))::integer INTO available
 FROM public.atlas_runtime_capacity_leases WHERE pool_id=p_pool_id AND lease_until>now();
 granted := least(p_requested,available);
 INSERT INTO public.atlas_runtime_capacity_leases(pool_id,worker_id,slots,lease_until)
 VALUES(p_pool_id,p_worker_id,granted,now()+make_interval(secs=>p_lease_seconds))
 ON CONFLICT(pool_id,worker_id) DO UPDATE SET slots=EXCLUDED.slots,lease_until=EXCLUDED.lease_until,updated_at=now();
 RETURN granted;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v138_release_runtime_capacity(p_pool_id TEXT,p_worker_id TEXT,p_slots INTEGER DEFAULT 1)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE remaining INTEGER;
BEGIN
 IF p_pool_id !~ '^[A-Za-z0-9_.:-]{1,120}$' OR p_worker_id !~ '^[A-Za-z0-9_.:-]{1,120}$' OR p_slots NOT BETWEEN 1 AND 100000 THEN
   RAISE EXCEPTION 'runtime_capacity_parameters_invalid';
 END IF;
 UPDATE public.atlas_runtime_capacity_leases
 SET slots=greatest(0,slots-p_slots),updated_at=now()
 WHERE pool_id=p_pool_id AND worker_id=p_worker_id
 RETURNING slots INTO remaining;
 IF remaining IS NULL THEN RETURN 0; END IF;
 IF remaining=0 THEN DELETE FROM public.atlas_runtime_capacity_leases WHERE pool_id=p_pool_id AND worker_id=p_worker_id; END IF;
 RETURN remaining;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v138_runtime_capacity_snapshot(p_pool_id TEXT)
RETURNS TABLE(max_concurrency INTEGER,leased_slots BIGINT,available_slots BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p.max_concurrency,coalesce(sum(l.slots),0),greatest(0,p.max_concurrency-coalesce(sum(l.slots),0))
 FROM public.atlas_runtime_pools p
 LEFT JOIN public.atlas_runtime_capacity_leases l ON l.pool_id=p.pool_id AND l.lease_until>now()
 WHERE p.pool_id=p_pool_id AND p.enabled=true
 GROUP BY p.max_concurrency;
$$;

ALTER TABLE atlas_runtime_capacity_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_runtime_capacity_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_runtime_capacity_leases_worker ON atlas_runtime_capacity_leases;
CREATE POLICY atlas_runtime_capacity_leases_worker ON atlas_runtime_capacity_leases
 USING (current_user='atlas_worker')
 WITH CHECK (current_user='atlas_worker');

REVOKE ALL ON atlas_runtime_capacity_leases FROM PUBLIC;
COMMIT;
