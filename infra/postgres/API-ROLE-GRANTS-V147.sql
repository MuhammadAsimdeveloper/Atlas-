-- Atlas V147: API grants for agent turn plans and handoffs
BEGIN;
GRANT SELECT, INSERT ON atlas_agent_turn_plans TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON atlas_agent_handoffs TO atlas_app;
COMMIT;
