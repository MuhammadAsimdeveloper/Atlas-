-- V119 permissions for durable workflow execution state.
DO $$
DECLARE app_role_oid OID; worker_role_oid OID;
BEGIN
  SELECT oid INTO app_role_oid FROM pg_roles WHERE rolname='atlas_app';
  SELECT oid INTO worker_role_oid FROM pg_roles WHERE rolname='atlas_worker';
  IF app_role_oid IS NULL OR worker_role_oid IS NULL THEN RAISE EXCEPTION 'Apply V115 role grants before V119 grants'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid IN (app_role_oid,worker_role_oid) AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'Runtime roles must remain restricted and non-bypass';
  END IF;
END;
$$;

REVOKE ALL ON atlas_workflow_executions, atlas_workflow_execution_events FROM PUBLIC, atlas_app, atlas_worker;
GRANT SELECT,INSERT,UPDATE ON atlas_workflow_executions TO atlas_app;
GRANT SELECT,INSERT ON atlas_workflow_execution_events TO atlas_app;
GRANT SELECT,INSERT,UPDATE ON atlas_workflow_executions,atlas_workflow_execution_events TO atlas_worker;
