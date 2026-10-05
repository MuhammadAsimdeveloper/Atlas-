GRANT SELECT,INSERT,UPDATE ON atlas_runtime_pool_heartbeats,atlas_runtime_slo_samples TO atlas_app;
GRANT SELECT,INSERT,UPDATE ON atlas_runtime_pools TO atlas_app;

GRANT SELECT, INSERT, UPDATE ON atlas_runtime_pool_heartbeats TO atlas_worker;
GRANT SELECT ON atlas_runtime_pools TO atlas_worker;
GRANT SELECT, INSERT ON atlas_runtime_slo_samples TO atlas_worker;
