-- Atlas V147: agent turn plans + human handoff evidence
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_agent_turn_plans (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL,
  session_id UUID NOT NULL,
  turn_id TEXT NOT NULL,
  agent_id UUID NOT NULL,
  release_id TEXT NOT NULL,
  release_version INTEGER NOT NULL CHECK (release_version > 0),
  prompt_hash CHAR(64) NOT NULL,
  tool_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  workflow_invocation_ref TEXT,
  journey_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','executing','needs_approval','handoff','completed','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum CHAR(64) NOT NULL,
  PRIMARY KEY (tenant_id, plan_id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, session_id, turn_id),
  CHECK (jsonb_typeof(tool_plan) = 'array'),
  CHECK (jsonb_typeof(approval_refs) = 'array')
);
ALTER TABLE atlas_agent_turn_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_turn_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_agent_turn_plans_tenant ON atlas_agent_turn_plans;
CREATE POLICY atlas_agent_turn_plans_tenant ON atlas_agent_turn_plans
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid);
CREATE INDEX IF NOT EXISTS idx_atlas_agent_turn_plans_session ON atlas_agent_turn_plans(tenant_id, session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_agent_handoffs (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  handoff_id UUID NOT NULL,
  session_id UUID NOT NULL,
  reason TEXT NOT NULL,
  queue_ref TEXT NOT NULL,
  appointment_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','resolved','canceled')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum CHAR(64) NOT NULL,
  PRIMARY KEY (tenant_id, handoff_id),
  UNIQUE (tenant_id, session_id, reason, queue_ref)
);
ALTER TABLE atlas_agent_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_agent_handoffs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_agent_handoffs_tenant ON atlas_agent_handoffs;
CREATE POLICY atlas_agent_handoffs_tenant ON atlas_agent_handoffs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid);

REVOKE UPDATE, DELETE, TRUNCATE ON atlas_agent_turn_plans, atlas_agent_handoffs FROM PUBLIC;

COMMIT;
