-- Atlas V80: Agent Skills Fabric + Operational Pulse.
CREATE TABLE IF NOT EXISTS atlas_agent_skills (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_risk TEXT NOT NULL DEFAULT 'read',
  approval TEXT NOT NULL DEFAULT 'write',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_agent_skills_tenant ON atlas_agent_skills(tenant_id);
CREATE TABLE IF NOT EXISTS atlas_agent_skill_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_agent_skill_assignments_tenant_agent ON atlas_agent_skill_assignments(tenant_id, agent_id);
CREATE TABLE IF NOT EXISTS atlas_ops_insights (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  pulse JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_ops_insights_tenant_created ON atlas_ops_insights(tenant_id, created_at DESC);
