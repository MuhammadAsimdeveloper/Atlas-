-- V122 API role grants. No worker grants: provider credentials and customer communication
-- data remain API-controlled and tenant-RLS protected.
BEGIN;
GRANT SELECT,INSERT,UPDATE,DELETE ON atlas_v122_provider_connections,atlas_v122_credentials,atlas_v122_conversations,atlas_v122_messages,atlas_v122_webhook_endpoints,atlas_v122_oauth_connections,atlas_v122_crm_definitions,atlas_v122_marketing_definitions,atlas_v122_enterprise_controls TO atlas_app;
COMMIT;
