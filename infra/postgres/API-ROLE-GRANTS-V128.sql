-- Atlas V128 worker wake scheduler grant.
-- The worker can schedule due execution references but cannot read or mutate
-- workflow execution tables directly; V120 lease-bound RPCs remain authoritative.
GRANT EXECUTE ON FUNCTION atlas_v128_tick_workflow_executions(INTEGER) TO atlas_worker;
REVOKE ALL ON FUNCTION atlas_v128_tick_workflow_executions(INTEGER) FROM PUBLIC;
