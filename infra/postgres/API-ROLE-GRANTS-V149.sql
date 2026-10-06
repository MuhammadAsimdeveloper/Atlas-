-- Atlas V149: durable agent approval persistence access
BEGIN;
GRANT SELECT, INSERT, UPDATE ON atlas_agent_tool_approvals TO atlas_app;
COMMIT;
