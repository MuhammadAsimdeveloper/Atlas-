-- Run as a database owner after FINAL-MIGRATION-V114.sql.
-- Extends the restricted atlas_app role; never run as the application user.
DO $$
DECLARE app_role_oid OID;
BEGIN
  SELECT oid INTO app_role_oid FROM pg_roles WHERE rolname = 'atlas_app';
  IF app_role_oid IS NULL THEN RAISE EXCEPTION 'Create the atlas_app role before applying V114 runtime grants'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid = app_role_oid AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'atlas_app must not be superuser, BYPASSRLS, CREATEDB, or CREATEROLE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = app_role_oid) THEN
    RAISE EXCEPTION 'atlas_app must not inherit or be able to SET ROLE to another database role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relowner=app_role_oid AND c.relname = ANY(ARRAY[
      'atlas_growth_items','atlas_growth_item_versions','atlas_growth_item_events','atlas_growth_jobs',
      'atlas_paddle_subscriptions','atlas_paddle_events'
    ])
  ) THEN RAISE EXCEPTION 'atlas_app must not own Growth Center or billing tables'; END IF;
END;
$$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, atlas_app;
GRANT USAGE ON SCHEMA public TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_growth_items TO atlas_app;
GRANT SELECT ON atlas_growth_item_versions, atlas_growth_item_events TO atlas_app;
GRANT INSERT ON atlas_growth_item_versions, atlas_growth_item_events TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_growth_jobs TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_paddle_subscriptions TO atlas_app;
GRANT SELECT, INSERT ON atlas_paddle_events TO atlas_app;
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_growth_item_versions, atlas_growth_item_events, atlas_paddle_events FROM atlas_app;
REVOKE TRUNCATE ON atlas_growth_items, atlas_growth_jobs, atlas_paddle_subscriptions FROM atlas_app;
