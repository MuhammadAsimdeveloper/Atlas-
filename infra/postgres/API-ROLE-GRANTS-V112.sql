-- Run as a database owner after applying the migrations and creating atlas_app
-- as a dedicated NOSUPERUSER NOBYPASSRLS application role.
DO $$
DECLARE
  app_role_oid OID;
BEGIN
  SELECT oid INTO app_role_oid FROM pg_roles WHERE rolname = 'atlas_app';
  IF app_role_oid IS NULL THEN RAISE EXCEPTION 'Create the atlas_app role before applying runtime grants'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid = app_role_oid AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'atlas_app must not be superuser, BYPASSRLS, CREATEDB, or CREATEROLE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = app_role_oid) THEN
    RAISE EXCEPTION 'atlas_app must not inherit or be able to SET ROLE to another database role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY[
    'atlas_auth_users','atlas_organizations','atlas_organization_roles','atlas_organization_memberships',
    'atlas_auth_sessions','atlas_auth_tokens','atlas_auth_rate_limits','atlas_auth_audit_events'
  ]) AND c.relowner = app_role_oid) THEN
    RAISE EXCEPTION 'atlas_app must not own Atlas identity or tenant tables';
  END IF;
END;
$$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, atlas_app;
GRANT USAGE ON SCHEMA public TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_auth_users TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_organizations TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_organization_roles TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_organization_memberships TO atlas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON atlas_auth_sessions TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_auth_tokens TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_auth_rate_limits TO atlas_app;
GRANT SELECT, INSERT ON atlas_auth_audit_events TO atlas_app;
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_auth_audit_events FROM atlas_app;
REVOKE TRUNCATE ON atlas_auth_users, atlas_organizations, atlas_organization_roles,
  atlas_organization_memberships, atlas_auth_sessions, atlas_auth_tokens,
  atlas_auth_rate_limits FROM atlas_app;
