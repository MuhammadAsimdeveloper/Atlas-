-- Atlas V134: governed AI workforce sessions and tool approvals.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_agent_sessions (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, session_id UUID NOT NULL, agent_release_ref TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','waiting_approval','handoff','completed','failed','canceled')), channel TEXT NOT NULL CHECK(channel ~ '^[a-z][a-z0-9_.-]{0,39}$'), customer_ref JSONB CHECK(customer_ref IS NULL OR (jsonb_typeof(customer_ref)='object' AND customer_ref-'kind'-'id'-'version'='{}'::jsonb AND octet_length(customer_ref::text)<=1024)), memory_scope TEXT NOT NULL DEFAULT 'session' CHECK(memory_scope IN ('none','session','tenant')), created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,session_id)
);
CREATE TABLE IF NOT EXISTS atlas_agent_tool_approvals (
 tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE, approval_id UUID NOT NULL, session_id UUID NOT NULL, action_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','expired')), requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ, decided_by UUID, PRIMARY KEY(tenant_id,approval_id)
);
ALTER TABLE atlas_agent_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_agent_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_tool_approvals ENABLE ROW LEVEL SECURITY; ALTER TABLE atlas_agent_tool_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_agent_sessions_tenant ON atlas_agent_sessions USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY atlas_agent_tool_approvals_tenant ON atlas_agent_tool_approvals USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;
