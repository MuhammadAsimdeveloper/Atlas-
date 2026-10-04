-- Run as the migration/database owner after FINAL-MIGRATION-V115.sql.
-- atlas_app can submit tenant-bound work but cannot poll the shared queue.
-- atlas_worker can call narrowly scoped worker procedures, never query queue tables.
DO $$
DECLARE app_role_oid OID; worker_role_oid OID;
BEGIN
  SELECT oid INTO app_role_oid FROM pg_roles WHERE rolname='atlas_app';
  IF app_role_oid IS NULL THEN RAISE EXCEPTION 'Create atlas_app before applying V115 grants'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_worker') THEN
    CREATE ROLE atlas_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  SELECT oid INTO worker_role_oid FROM pg_roles WHERE rolname='atlas_worker';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid=app_role_oid AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'atlas_app must remain a restricted, non-bypass runtime role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid=worker_role_oid AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolinherit)) THEN
    RAISE EXCEPTION 'atlas_worker must remain restricted, non-bypass and non-inheriting';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN (app_role_oid,worker_role_oid)) THEN
    RAISE EXCEPTION 'atlas_app and atlas_worker must not be members of other database roles';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relowner IN (app_role_oid,worker_role_oid)
      AND c.relname = ANY(ARRAY['atlas_runtime_jobs','atlas_event_outbox','atlas_runtime_schedules'])
  ) THEN RAISE EXCEPTION 'runtime roles must not own V115 queue relations'; END IF;
END;
$$;

REVOKE ALL ON atlas_runtime_jobs,atlas_event_outbox,atlas_runtime_schedules FROM PUBLIC,atlas_app,atlas_worker;
GRANT USAGE ON SCHEMA public TO atlas_app,atlas_worker;
GRANT SELECT,INSERT ON atlas_runtime_jobs TO atlas_app;
GRANT INSERT ON atlas_event_outbox TO atlas_app;
GRANT SELECT,INSERT ON atlas_runtime_schedules TO atlas_app;
GRANT UPDATE(state,updated_at) ON atlas_runtime_schedules TO atlas_app;
GRANT SELECT,INSERT,UPDATE ON atlas_runtime_jobs,atlas_event_outbox,atlas_runtime_schedules TO atlas_worker;

GRANT EXECUTE ON FUNCTION atlas_v115_enqueue_job(UUID,UUID,TEXT,JSONB,CHAR,TIMESTAMPTZ,SMALLINT) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v115_append_outbox_event(UUID,UUID,TEXT,JSONB) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v115_create_schedule(UUID,UUID,TEXT,JSONB,CHAR,TIMESTAMPTZ,INTEGER,SMALLINT) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v115_pause_schedule(UUID,UUID) TO atlas_app;

GRANT EXECUTE ON FUNCTION atlas_v115_claim_jobs(TEXT,INTEGER,INTEGER,TEXT[]) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_heartbeat_job(UUID,UUID,TEXT,INTEGER) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_complete_job(UUID,UUID,TEXT) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_fail_job(UUID,UUID,TEXT,TEXT) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_reap_jobs(INTEGER) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_tick_schedules(INTEGER) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_claim_outbox(TEXT,INTEGER,INTEGER,TEXT[]) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_ack_outbox(UUID,UUID,TEXT) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_heartbeat_outbox(UUID,UUID,TEXT,INTEGER) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_fail_outbox(UUID,UUID,TEXT,TEXT) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_reap_outbox(INTEGER) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v115_runtime_queue_counts() TO atlas_worker;

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
