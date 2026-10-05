-- Atlas V127 API role grants.
-- The API needs only tenant-RLS-mediated access through the record/finalize functions.
GRANT SELECT, INSERT, UPDATE ON atlas_v127_automation_events TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v127_record_automation_event(UUID,TEXT,TEXT,JSONB,CHAR) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v127_finalize_automation_event(UUID,UUID,INTEGER,INTEGER) TO atlas_app;
REVOKE ALL ON atlas_v127_automation_events FROM atlas_worker, PUBLIC;
