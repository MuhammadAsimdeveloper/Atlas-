GRANT EXECUTE ON FUNCTION atlas_v148_start_provider_action(UUID,UUID,TEXT,UUID,TEXT,TEXT) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v148_record_provider_outcome(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO atlas_worker;
GRANT SELECT ON atlas_provider_action_reconciliations TO atlas_worker;
