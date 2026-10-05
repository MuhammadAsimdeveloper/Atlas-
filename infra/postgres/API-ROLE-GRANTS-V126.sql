BEGIN;
GRANT SELECT,INSERT,UPDATE ON atlas_v126_inbox_events,atlas_v126_message_receipts TO atlas_app;
COMMIT;
