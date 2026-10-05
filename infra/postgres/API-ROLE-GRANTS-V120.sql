-- V120 permissions for workflow execution isolation.
DO $$
DECLARE app_role_oid OID; worker_role_oid OID;
BEGIN
  SELECT oid INTO app_role_oid FROM pg_roles WHERE rolname='atlas_app';
  SELECT oid INTO worker_role_oid FROM pg_roles WHERE rolname='atlas_worker';
  IF app_role_oid IS NULL OR worker_role_oid IS NULL THEN RAISE EXCEPTION 'Apply V115 role grants before V120 grants'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid IN (app_role_oid,worker_role_oid) AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'Runtime roles must remain restricted and non-bypass';
  END IF;
END;
$$;

REVOKE ALL ON atlas_workflow_executions, atlas_workflow_execution_events FROM PUBLIC, atlas_worker;
GRANT USAGE ON SCHEMA public TO atlas_worker;
GRANT SELECT,INSERT,UPDATE ON atlas_workflow_executions TO atlas_app;
GRANT SELECT,INSERT ON atlas_workflow_execution_events TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v120_get_execution_for_job(UUID,UUID,TEXT) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v120_update_execution_for_job(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,JSONB,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TIMESTAMPTZ) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v120_append_execution_event_for_job(UUID,UUID,TEXT,UUID,TEXT,TEXT,SMALLINT,TEXT,JSONB,TIMESTAMPTZ) TO atlas_worker;
