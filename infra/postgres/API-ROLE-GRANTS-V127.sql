-- Atlas V127 worker grant: resume scheduling is available only through the lease-bound RPC.
REVOKE ALL ON FUNCTION atlas_v127_schedule_workflow_resume(uuid,uuid,text,text,timestamptz,text,integer) FROM PUBLIC,atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v127_schedule_workflow_resume(uuid,uuid,text,text,timestamptz,text,integer) TO atlas_worker;
