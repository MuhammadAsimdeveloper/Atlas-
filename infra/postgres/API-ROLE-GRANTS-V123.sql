-- V123 API grants for service operations. Worker remains isolated from customer tables.
BEGIN;
GRANT SELECT,INSERT,UPDATE,DELETE ON atlas_v123_oauth_tokens,atlas_v123_service_requests,atlas_v123_jobs,atlas_v123_visits,atlas_v123_quotes,atlas_v123_invoices,atlas_v123_webhook_deliveries TO atlas_app;
COMMIT;
