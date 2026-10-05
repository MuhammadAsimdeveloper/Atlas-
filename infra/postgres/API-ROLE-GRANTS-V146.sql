GRANT EXECUTE ON FUNCTION atlas_v146_acquire_scaler_lease(TEXT,TEXT,INTEGER) TO atlas_worker;
GRANT SELECT,INSERT,UPDATE ON atlas_runtime_scaler_leases TO atlas_worker;
GRANT SELECT,INSERT,UPDATE ON atlas_runtime_scaling_decisions TO atlas_worker;
