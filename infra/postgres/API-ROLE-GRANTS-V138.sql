GRANT SELECT,INSERT,UPDATE,DELETE ON atlas_runtime_capacity_leases TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v138_acquire_runtime_capacity(text,text,integer,integer) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v138_release_runtime_capacity(text,text,integer) TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v138_runtime_capacity_snapshot(text) TO atlas_worker;
