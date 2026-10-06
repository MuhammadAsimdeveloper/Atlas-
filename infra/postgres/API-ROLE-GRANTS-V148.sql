-- Atlas V148: API access and restricted worker RPCs for agent turn execution
BEGIN;
GRANT SELECT, INSERT, UPDATE ON atlas_agent_turn_executions TO atlas_app;
GRANT SELECT, UPDATE ON atlas_agent_turn_plans TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v148_get_agent_turn_for_job(UUID,UUID,TEXT) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v148_update_agent_turn_for_job(UUID,UUID,TEXT,UUID,INTEGER,TEXT,JSONB,TEXT,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT) TO atlas_worker;
COMMIT;
