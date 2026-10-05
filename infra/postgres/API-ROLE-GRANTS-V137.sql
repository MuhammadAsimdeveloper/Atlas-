GRANT SELECT,INSERT,UPDATE ON atlas_runtime_slo_policies,atlas_runtime_slo_evaluations,atlas_runtime_alerts,atlas_runtime_incidents TO atlas_app;
GRANT SELECT,INSERT,UPDATE ON atlas_runtime_slo_policies,atlas_runtime_slo_evaluations,atlas_runtime_alerts,atlas_runtime_incidents TO atlas_worker;
GRANT EXECUTE ON FUNCTION atlas_v137_evaluate_runtime_slo(text,text,uuid) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v137_evaluate_runtime_slo(text,text,uuid) TO atlas_worker;
