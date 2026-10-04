-- Atlas V118 integration grants. Run as migration/database owner after FINAL-MIGRATION-V118.sql.
DO $$
DECLARE app_role_oid OID; worker_role_oid OID; ingress_role_oid OID;
BEGIN
  SELECT oid INTO app_role_oid FROM pg_roles WHERE rolname='atlas_app';
  SELECT oid INTO worker_role_oid FROM pg_roles WHERE rolname='atlas_worker';
  SELECT oid INTO ingress_role_oid FROM pg_roles WHERE rolname='atlas_integration_ingress';
  IF app_role_oid IS NULL THEN RAISE EXCEPTION 'Create atlas_app before applying V118 grants'; END IF;
  IF worker_role_oid IS NULL THEN RAISE EXCEPTION 'Apply V115 worker grants before applying V118 grants'; END IF;
  IF ingress_role_oid IS NULL THEN RAISE EXCEPTION 'Apply FINAL-MIGRATION-V118 before applying V118 grants'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid IN (app_role_oid,worker_role_oid,ingress_role_oid) AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'Atlas runtime integration roles must remain restricted';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN (app_role_oid,worker_role_oid,ingress_role_oid)) THEN
    RAISE EXCEPTION 'Atlas runtime integration roles must not inherit database role memberships';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relowner IN (app_role_oid,worker_role_oid,ingress_role_oid)
      AND c.relname = ANY(ARRAY['atlas_integration_connections','atlas_integration_oauth_states','atlas_integration_mappings','atlas_integration_webhook_events','atlas_integration_tasks'])
  ) THEN RAISE EXCEPTION 'Runtime integration roles must not own integration tables'; END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC,atlas_app,atlas_worker,atlas_integration_ingress;
GRANT USAGE ON SCHEMA public TO atlas_app,atlas_worker,atlas_integration_ingress;

GRANT SELECT,INSERT,UPDATE ON atlas_integration_connections TO atlas_app;
GRANT SELECT,INSERT,UPDATE ON atlas_integration_oauth_states TO atlas_app;
GRANT SELECT,INSERT,UPDATE ON atlas_integration_tasks TO atlas_app;
GRANT SELECT ON atlas_integration_mappings,atlas_integration_webhook_events TO atlas_app;

GRANT SELECT,UPDATE ON atlas_integration_connections TO atlas_worker;
GRANT SELECT,UPDATE ON atlas_integration_tasks TO atlas_worker;
GRANT SELECT,UPDATE ON atlas_integration_webhook_events TO atlas_worker;
GRANT SELECT,INSERT,UPDATE ON atlas_integration_deliveries TO atlas_worker;
GRANT SELECT,INSERT,UPDATE ON atlas_integration_mappings TO atlas_worker;

GRANT EXECUTE ON FUNCTION atlas_v118_consume_oauth_state(CHAR) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v118_ingest_jobber_webhook(TEXT,CHAR,TEXT,TEXT,JSONB) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v118_ingest_zapier_webhook(CHAR,CHAR,JSONB) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v118_get_growth_record(UUID,UUID) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v118_get_integration_contact(UUID,UUID,TEXT) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v118_upsert_integration_contact(UUID,UUID,TEXT,TIMESTAMPTZ,JSONB) TO atlas_worker;
