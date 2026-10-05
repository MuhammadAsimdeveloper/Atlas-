-- Atlas V115: tenant-aware durable jobs, transactional outbox and interval scheduler.
-- Queue rows contain resource references only. API code can enqueue only for the
-- current transaction tenant; a separate worker role uses narrow SECURITY DEFINER RPCs.
BEGIN;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_worker') THEN CREATE ROLE atlas_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $;

-- A canceled trial must remain marked as used so the workspace cannot restart it.
ALTER TABLE atlas_paddle_subscriptions ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS atlas_runtime_jobs (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  payload_ref JSONB NOT NULL CHECK (
    jsonb_typeof(payload_ref)='object'
    AND payload_ref ? 'kind' AND payload_ref ? 'id'
    AND payload_ref - 'kind' - 'id' - 'version' = '{}'::jsonb
    AND jsonb_typeof(payload_ref->'kind')='string' AND length(payload_ref->>'kind') BETWEEN 1 AND 80
    AND jsonb_typeof(payload_ref->'id')='string' AND length(payload_ref->>'id') BETWEEN 1 AND 160
    AND (NOT payload_ref ? 'version' OR (jsonb_typeof(payload_ref->'version')='number' AND (payload_ref->>'version')::numeric BETWEEN 1 AND 2147483647))
    AND octet_length(payload_ref::text) <= 1024
  ),
  idempotency_key CHAR(64) NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','retryable','succeeded','dead_letter','canceled')),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 12),
  lease_owner TEXT CHECK (lease_owner IS NULL OR lease_owner ~ '^[a-zA-Z0-9_.:-]{1,120}$'),
  lease_until TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK ((status='leased') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_atlas_runtime_jobs_claim ON atlas_runtime_jobs (run_at, created_at, tenant_id, job_id) WHERE status IN ('queued','retryable');
CREATE INDEX IF NOT EXISTS idx_atlas_runtime_jobs_expired_lease ON atlas_runtime_jobs (lease_until, tenant_id, job_id) WHERE status='leased';
ALTER TABLE atlas_runtime_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_runtime_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_runtime_jobs_tenant ON atlas_runtime_jobs;
CREATE POLICY atlas_runtime_jobs_tenant ON atlas_runtime_jobs
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR current_user='atlas_worker')
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR current_user='atlas_worker');

CREATE TABLE IF NOT EXISTS atlas_event_outbox (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){1,5}$'),
  payload_ref JSONB NOT NULL CHECK (
    jsonb_typeof(payload_ref)='object'
    AND payload_ref ? 'kind' AND payload_ref ? 'id'
    AND payload_ref - 'kind' - 'id' - 'version' = '{}'::jsonb
    AND jsonb_typeof(payload_ref->'kind')='string' AND length(payload_ref->>'kind') BETWEEN 1 AND 80
    AND jsonb_typeof(payload_ref->'id')='string' AND length(payload_ref->>'id') BETWEEN 1 AND 160
    AND (NOT payload_ref ? 'version' OR (jsonb_typeof(payload_ref->'version')='number' AND (payload_ref->>'version')::numeric BETWEEN 1 AND 2147483647))
    AND octet_length(payload_ref::text) <= 1024
  ),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','published','dead_letter')),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
  max_attempts SMALLINT NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 12),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT CHECK (lease_owner IS NULL OR lease_owner ~ '^[a-zA-Z0-9_.:-]{1,120}$'),
  lease_until TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id,event_id),
  CHECK ((state='leased') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((state='published') = (published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_atlas_event_outbox_claim ON atlas_event_outbox (available_at, occurred_at, tenant_id, event_id) WHERE state='pending';
ALTER TABLE atlas_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_event_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_event_outbox_tenant ON atlas_event_outbox;
CREATE POLICY atlas_event_outbox_tenant ON atlas_event_outbox
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR current_user='atlas_worker')
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR current_user='atlas_worker');

CREATE TABLE IF NOT EXISTS atlas_runtime_schedules (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  payload_ref JSONB NOT NULL CHECK (
    jsonb_typeof(payload_ref)='object'
    AND payload_ref ? 'kind' AND payload_ref ? 'id'
    AND payload_ref - 'kind' - 'id' - 'version' = '{}'::jsonb
    AND jsonb_typeof(payload_ref->'kind')='string' AND length(payload_ref->>'kind') BETWEEN 1 AND 80
    AND jsonb_typeof(payload_ref->'id')='string' AND length(payload_ref->>'id') BETWEEN 1 AND 160
    AND (NOT payload_ref ? 'version' OR (jsonb_typeof(payload_ref->'version')='number' AND (payload_ref->>'version')::numeric BETWEEN 1 AND 2147483647))
    AND octet_length(payload_ref::text) <= 1024
  ),
  idempotency_prefix CHAR(56) NOT NULL CHECK (idempotency_prefix ~ '^[a-f0-9]{56}$'),
  next_run_at TIMESTAMPTZ NOT NULL,
  interval_seconds INTEGER CHECK (interval_seconds IS NULL OR interval_seconds BETWEEN 60 AND 2678400),
  run_sequence BIGINT NOT NULL DEFAULT 0 CHECK (run_sequence BETWEEN 0 AND 4294967295),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 12),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,schedule_id),
  UNIQUE (tenant_id,idempotency_prefix),
  CHECK (state <> 'completed' OR interval_seconds IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_atlas_runtime_schedules_due ON atlas_runtime_schedules (next_run_at, tenant_id, schedule_id) WHERE state='active';
ALTER TABLE atlas_runtime_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_runtime_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_runtime_schedules_tenant ON atlas_runtime_schedules;
CREATE POLICY atlas_runtime_schedules_tenant ON atlas_runtime_schedules
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR current_user='atlas_worker')
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR current_user='atlas_worker');

CREATE OR REPLACE FUNCTION atlas_v115_enqueue_job(
  p_tenant_id UUID, p_job_id UUID, p_job_type TEXT, p_payload_ref JSONB,
  p_idempotency_key CHAR(64), p_run_at TIMESTAMPTZ, p_max_attempts SMALLINT DEFAULT 5
) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE existing public.atlas_runtime_jobs%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'tenant_scope_invalid'; END IF;
  IF p_max_attempts NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'job_attempt_limit_invalid'; END IF;
  INSERT INTO public.atlas_runtime_jobs(tenant_id,job_id,job_type,payload_ref,idempotency_key,run_at,max_attempts)
    VALUES(p_tenant_id,p_job_id,p_job_type,p_payload_ref,p_idempotency_key,coalesce(p_run_at,now()),p_max_attempts)
    ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
  SELECT * INTO existing FROM public.atlas_runtime_jobs WHERE tenant_id=p_tenant_id AND idempotency_key=p_idempotency_key;
  IF existing.job_id IS NULL OR existing.job_id<>p_job_id OR existing.job_type<>p_job_type OR existing.payload_ref<>p_payload_ref THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN existing.job_id;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_append_outbox_event(
  p_tenant_id UUID, p_event_id UUID, p_event_type TEXT, p_payload_ref JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'tenant_scope_invalid'; END IF;
  INSERT INTO public.atlas_event_outbox(tenant_id,event_id,event_type,payload_ref) VALUES(p_tenant_id,p_event_id,p_event_type,p_payload_ref);
  RETURN p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_create_schedule(
  p_tenant_id UUID,p_schedule_id UUID,p_job_type TEXT,p_payload_ref JSONB,p_prefix CHAR(56),
  p_next_run_at TIMESTAMPTZ,p_interval_seconds INTEGER,p_max_attempts SMALLINT DEFAULT 5
) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'tenant_scope_invalid'; END IF;
  IF p_interval_seconds IS NOT NULL AND p_interval_seconds NOT BETWEEN 60 AND 2678400 THEN RAISE EXCEPTION 'schedule_interval_invalid'; END IF;
  IF p_max_attempts NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'job_attempt_limit_invalid'; END IF;
  INSERT INTO public.atlas_runtime_schedules(tenant_id,schedule_id,job_type,payload_ref,idempotency_prefix,next_run_at,interval_seconds,max_attempts)
    VALUES(p_tenant_id,p_schedule_id,p_job_type,p_payload_ref,p_prefix,p_next_run_at,p_interval_seconds,p_max_attempts);
  RETURN p_schedule_id;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_pause_schedule(p_tenant_id UUID,p_schedule_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'tenant_scope_invalid'; END IF;
  UPDATE public.atlas_runtime_schedules SET state='paused',updated_at=now() WHERE tenant_id=p_tenant_id AND schedule_id=p_schedule_id AND state='active';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_claim_jobs(p_worker_id TEXT,p_limit INTEGER DEFAULT 10,p_lease_seconds INTEGER DEFAULT 60,p_job_types TEXT[] DEFAULT NULL)
RETURNS TABLE(tenant_id UUID,job_id UUID,job_type TEXT,payload_ref JSONB,idempotency_key TEXT,attempts SMALLINT,lease_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$' OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 15 AND 900 OR
    (p_job_types IS NOT NULL AND (cardinality(p_job_types) NOT BETWEEN 1 AND 100 OR EXISTS (SELECT 1 FROM unnest(p_job_types) t WHERE t !~ '^[a-z][a-z0-9_.-]{1,79}$'))) THEN RAISE EXCEPTION 'worker_claim_parameters_invalid'; END IF;
  RETURN QUERY WITH candidates AS (
    SELECT j.tenant_id,j.job_id FROM public.atlas_runtime_jobs j
    WHERE j.status IN ('queued','retryable') AND j.run_at<=now() AND j.attempts<j.max_attempts
      AND (p_job_types IS NULL OR j.job_type=ANY(p_job_types))
    ORDER BY j.run_at,j.created_at,j.tenant_id,j.job_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.atlas_runtime_jobs j SET status='leased',attempts=j.attempts+1,lease_owner=p_worker_id,
      lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
    FROM candidates c WHERE j.tenant_id=c.tenant_id AND j.job_id=c.job_id
    RETURNING j.tenant_id,j.job_id,j.job_type,j.payload_ref,j.idempotency_key,j.attempts,j.lease_until
  ) SELECT c.tenant_id,c.job_id,c.job_type,c.payload_ref::jsonb,rtrim(c.idempotency_key),c.attempts,c.lease_until FROM claimed c;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_heartbeat_job(p_tenant_id UUID,p_job_id UUID,p_worker_id TEXT,p_lease_seconds INTEGER DEFAULT 60)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_lease_seconds NOT BETWEEN 15 AND 900 THEN RAISE EXCEPTION 'worker_lease_invalid'; END IF;
  UPDATE public.atlas_runtime_jobs SET lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
    WHERE tenant_id=p_tenant_id AND job_id=p_job_id AND status='leased' AND lease_owner=p_worker_id AND lease_until>now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_complete_job(p_tenant_id UUID,p_job_id UUID,p_worker_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.atlas_runtime_jobs SET status='succeeded',lease_owner=NULL,lease_until=NULL,updated_at=now()
    WHERE tenant_id=p_tenant_id AND job_id=p_job_id AND status='leased' AND lease_owner=p_worker_id AND lease_until>now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_fail_job(p_tenant_id UUID,p_job_id UUID,p_worker_id TEXT,p_error_code TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE result TEXT;
BEGIN
  IF p_error_code !~ '^[a-z][a-z0-9_.-]{0,79}$' THEN RAISE EXCEPTION 'worker_error_code_invalid'; END IF;
  UPDATE public.atlas_runtime_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'retryable' END,
    run_at=CASE WHEN attempts>=max_attempts THEN run_at ELSE now()+make_interval(secs=>LEAST(3600,(power(2,LEAST(attempts-1,11)))::integer)) END,
    lease_owner=NULL,lease_until=NULL,last_error_code=p_error_code,updated_at=now()
    WHERE tenant_id=p_tenant_id AND job_id=p_job_id AND status='leased' AND lease_owner=p_worker_id AND lease_until>now()
    RETURNING status INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_reap_jobs(p_limit INTEGER DEFAULT 100)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE affected INTEGER;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'worker_reap_limit_invalid'; END IF;
  WITH candidates AS (
    SELECT tenant_id,job_id FROM public.atlas_runtime_jobs WHERE status='leased' AND lease_until<=now()
    ORDER BY lease_until,tenant_id,job_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.atlas_runtime_jobs j SET status=CASE WHEN j.attempts>=j.max_attempts THEN 'dead_letter' ELSE 'retryable' END,
    run_at=CASE WHEN j.attempts>=j.max_attempts THEN j.run_at ELSE now() END,
    lease_owner=NULL,lease_until=NULL,last_error_code='lease_expired',updated_at=now()
    FROM candidates c WHERE j.tenant_id=c.tenant_id AND j.job_id=c.job_id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_tick_schedules(p_limit INTEGER DEFAULT 100)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE scheduled public.atlas_runtime_schedules%ROWTYPE; affected INTEGER:=0; next_sequence BIGINT; next_time TIMESTAMPTZ;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'schedule_tick_limit_invalid'; END IF;
  FOR scheduled IN
    SELECT * FROM public.atlas_runtime_schedules WHERE state='active' AND next_run_at<=now()
    ORDER BY next_run_at,tenant_id,schedule_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    next_sequence:=scheduled.run_sequence+1;
    INSERT INTO public.atlas_runtime_jobs(tenant_id,job_id,job_type,payload_ref,idempotency_key,run_at,max_attempts)
      VALUES(scheduled.tenant_id,gen_random_uuid(),scheduled.job_type,scheduled.payload_ref,
        scheduled.idempotency_prefix||lpad(to_hex(next_sequence),8,'0'),now(),scheduled.max_attempts)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
    IF scheduled.interval_seconds IS NULL THEN
      UPDATE public.atlas_runtime_schedules SET state='completed',run_sequence=next_sequence,updated_at=now()
        WHERE tenant_id=scheduled.tenant_id AND schedule_id=scheduled.schedule_id;
    ELSE
      next_time:=GREATEST(scheduled.next_run_at+make_interval(secs=>scheduled.interval_seconds),now()+make_interval(secs=>scheduled.interval_seconds));
      UPDATE public.atlas_runtime_schedules SET run_sequence=next_sequence,next_run_at=next_time,updated_at=now()
        WHERE tenant_id=scheduled.tenant_id AND schedule_id=scheduled.schedule_id;
    END IF;
    affected:=affected+1;
  END LOOP;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_claim_outbox(p_worker_id TEXT,p_limit INTEGER DEFAULT 50,p_lease_seconds INTEGER DEFAULT 60,p_event_types TEXT[] DEFAULT NULL)
RETURNS TABLE(tenant_id UUID,event_id UUID,event_type TEXT,payload_ref JSONB,attempts SMALLINT,lease_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,120}$' OR p_limit NOT BETWEEN 1 AND 500 OR p_lease_seconds NOT BETWEEN 15 AND 900 OR
    (p_event_types IS NOT NULL AND (cardinality(p_event_types) NOT BETWEEN 1 AND 100 OR EXISTS (SELECT 1 FROM unnest(p_event_types) t WHERE t !~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){1,5}$'))) THEN RAISE EXCEPTION 'outbox_claim_parameters_invalid'; END IF;
  RETURN QUERY WITH candidates AS (
    SELECT o.tenant_id,o.event_id FROM public.atlas_event_outbox o
    WHERE o.state='pending' AND o.available_at<=now() AND o.attempts<o.max_attempts
      AND (p_event_types IS NULL OR o.event_type=ANY(p_event_types))
    ORDER BY o.available_at,o.occurred_at,o.tenant_id,o.event_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.atlas_event_outbox o SET state='leased',attempts=o.attempts+1,lease_owner=p_worker_id,
      lease_until=now()+make_interval(secs=>p_lease_seconds)
    FROM candidates c WHERE o.tenant_id=c.tenant_id AND o.event_id=c.event_id
    RETURNING o.tenant_id,o.event_id,o.event_type,o.payload_ref,o.attempts,o.lease_until
  ) SELECT c.tenant_id,c.event_id,c.event_type,c.payload_ref::jsonb,c.attempts,c.lease_until FROM claimed c;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_ack_outbox(p_tenant_id UUID,p_event_id UUID,p_worker_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.atlas_event_outbox SET state='published',published_at=now(),lease_owner=NULL,lease_until=NULL
    WHERE tenant_id=p_tenant_id AND event_id=p_event_id AND state='leased' AND lease_owner=p_worker_id AND lease_until>now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_heartbeat_outbox(p_tenant_id UUID,p_event_id UUID,p_worker_id TEXT,p_lease_seconds INTEGER DEFAULT 60)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_lease_seconds NOT BETWEEN 15 AND 900 THEN RAISE EXCEPTION 'outbox_lease_invalid'; END IF;
  UPDATE public.atlas_event_outbox SET lease_until=now()+make_interval(secs=>p_lease_seconds)
    WHERE tenant_id=p_tenant_id AND event_id=p_event_id AND state='leased' AND lease_owner=p_worker_id AND lease_until>now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_fail_outbox(p_tenant_id UUID,p_event_id UUID,p_worker_id TEXT,p_error_code TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE result TEXT;
BEGIN
  IF p_error_code !~ '^[a-z][a-z0-9_.-]{0,79}$' THEN RAISE EXCEPTION 'outbox_error_code_invalid'; END IF;
  UPDATE public.atlas_event_outbox SET state=CASE WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'pending' END,
    available_at=CASE WHEN attempts>=max_attempts THEN available_at ELSE now()+make_interval(secs=>LEAST(3600,(power(2,LEAST(attempts-1,11)))::integer)) END,
    lease_owner=NULL,lease_until=NULL,last_error_code=p_error_code
    WHERE tenant_id=p_tenant_id AND event_id=p_event_id AND state='leased' AND lease_owner=p_worker_id AND lease_until>now()
    RETURNING state INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_reap_outbox(p_limit INTEGER DEFAULT 500)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE affected INTEGER;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'outbox_reap_limit_invalid'; END IF;
  WITH candidates AS (
    SELECT tenant_id,event_id FROM public.atlas_event_outbox WHERE state='leased' AND lease_until<=now()
    ORDER BY lease_until,tenant_id,event_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.atlas_event_outbox o SET state=CASE WHEN o.attempts>=o.max_attempts THEN 'dead_letter' ELSE 'pending' END,
    available_at=CASE WHEN o.attempts>=o.max_attempts THEN o.available_at ELSE now() END,
    lease_owner=NULL,lease_until=NULL,last_error_code='lease_expired'
    FROM candidates c WHERE o.tenant_id=c.tenant_id AND o.event_id=c.event_id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v115_runtime_queue_counts()
RETURNS TABLE(queued BIGINT,leased BIGINT,retryable BIGINT,dead_letter BIGINT,pending_outbox BIGINT)
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT
    (SELECT count(*) FROM public.atlas_runtime_jobs WHERE status='queued'),
    (SELECT count(*) FROM public.atlas_runtime_jobs WHERE status='leased'),
    (SELECT count(*) FROM public.atlas_runtime_jobs WHERE status='retryable'),
    (SELECT count(*) FROM public.atlas_runtime_jobs WHERE status='dead_letter'),
    (SELECT count(*) FROM public.atlas_event_outbox WHERE state IN ('pending','leased'))
$$;

REVOKE ALL ON atlas_runtime_jobs,atlas_event_outbox,atlas_runtime_schedules FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_enqueue_job(UUID,UUID,TEXT,JSONB,CHAR,TIMESTAMPTZ,SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_append_outbox_event(UUID,UUID,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_create_schedule(UUID,UUID,TEXT,JSONB,CHAR,TIMESTAMPTZ,INTEGER,SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_pause_schedule(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_claim_jobs(TEXT,INTEGER,INTEGER,TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_heartbeat_job(UUID,UUID,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_complete_job(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_fail_job(UUID,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_reap_jobs(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_tick_schedules(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_claim_outbox(TEXT,INTEGER,INTEGER,TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_ack_outbox(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_heartbeat_outbox(UUID,UUID,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_fail_outbox(UUID,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_reap_outbox(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v115_runtime_queue_counts() FROM PUBLIC;

COMMIT;
