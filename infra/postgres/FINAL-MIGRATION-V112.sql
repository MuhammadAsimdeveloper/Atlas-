-- Atlas V112: identity, organization tenancy and authenticated API foundation.
-- Apply V80 through V110 first with scripts/migrate.mjs, then apply this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_auth_users (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email = lower(btrim(email)))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_auth_users_email ON atlas_auth_users (email);
ALTER TABLE atlas_auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_auth_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_auth_users_self ON atlas_auth_users;
CREATE POLICY atlas_auth_users_self ON atlas_auth_users
  USING (user_id::text = nullif(current_setting('app.actor_id', true), '') OR email = nullif(current_setting('app.auth_email', true), ''))
  WITH CHECK (user_id::text = nullif(current_setting('app.actor_id', true), '') OR email = nullif(current_setting('app.auth_email', true), ''));

CREATE TABLE IF NOT EXISTS atlas_organizations (
  tenant_id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  industry_key TEXT NOT NULL DEFAULT 'home_services' CHECK (industry_key IN ('home_services','appointment_services','professional_services','agency','other')),
  time_zone TEXT NOT NULL DEFAULT 'America/Los_Angeles' CHECK (length(time_zone) BETWEEN 1 AND 80),
  created_by UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_organizations_slug ON atlas_organizations (slug);
ALTER TABLE atlas_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_organizations_tenant ON atlas_organizations;
CREATE POLICY atlas_organizations_tenant ON atlas_organizations
  USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '') OR created_by::text = nullif(current_setting('app.actor_id', true), ''))
  WITH CHECK (created_by::text = nullif(current_setting('app.actor_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_organization_roles (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  role_id UUID NOT NULL,
  role_key TEXT NOT NULL CHECK (role_key ~ '^custom:[a-z0-9][a-z0-9-]{0,48}$'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 64),
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions) = 'array' AND jsonb_array_length(permissions) <= 64),
  created_by UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_id),
  UNIQUE (tenant_id, role_key),
  UNIQUE (tenant_id, role_id, role_key),
  UNIQUE (tenant_id, display_name)
);
ALTER TABLE atlas_organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_organization_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_organization_roles_tenant ON atlas_organization_roles;
CREATE POLICY atlas_organization_roles_tenant ON atlas_organization_roles
  USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), '') AND created_by::text = nullif(current_setting('app.actor_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_organization_memberships (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES atlas_auth_users(user_id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (role_key IN ('owner','admin','member','viewer','billing_admin') OR role_key ~ '^custom:[a-z0-9][a-z0-9-]{0,48}$'),
  custom_role_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended','removed')),
  invited_by UUID REFERENCES atlas_auth_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, custom_role_id, role_key) REFERENCES atlas_organization_roles(tenant_id, role_id, role_key),
  CHECK ((role_key LIKE 'custom:%') = (custom_role_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_membership_single_owner ON atlas_organization_memberships (tenant_id) WHERE role_key = 'owner' AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_atlas_memberships_user ON atlas_organization_memberships (user_id, status, tenant_id);
ALTER TABLE atlas_organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_organization_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_organization_memberships_tenant ON atlas_organization_memberships;
CREATE POLICY atlas_organization_memberships_tenant ON atlas_organization_memberships
  USING (user_id::text = nullif(current_setting('app.actor_id', true), '') OR tenant_id::text = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (user_id::text = nullif(current_setting('app.actor_id', true), '') AND tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS atlas_auth_users_self ON atlas_auth_users;
CREATE POLICY atlas_auth_users_self ON atlas_auth_users
  USING (user_id::text = nullif(current_setting('app.actor_id', true), '') OR email = nullif(current_setting('app.auth_email', true), '') OR user_id IN (SELECT user_id FROM atlas_organization_memberships WHERE tenant_id::text = nullif(current_setting('app.tenant_id', true), '') AND status='active'))
  WITH CHECK (user_id::text = nullif(current_setting('app.actor_id', true), '') OR email = nullif(current_setting('app.auth_email', true), ''));
DROP POLICY IF EXISTS atlas_organizations_tenant ON atlas_organizations;
CREATE POLICY atlas_organizations_tenant ON atlas_organizations
  USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '') OR created_by::text = nullif(current_setting('app.actor_id', true), '') OR EXISTS (SELECT 1 FROM atlas_organization_memberships m WHERE m.tenant_id=atlas_organizations.tenant_id AND m.user_id::text=nullif(current_setting('app.actor_id', true), '') AND m.status='active'))
  WITH CHECK (created_by::text = nullif(current_setting('app.actor_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_auth_sessions (
  session_hash CHAR(64) PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  user_id UUID NOT NULL REFERENCES atlas_auth_users(user_id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES atlas_organizations(tenant_id) ON DELETE SET NULL,
  csrf_hash CHAR(64) NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  ip_hash CHAR(64) CHECK (ip_hash IS NULL OR ip_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_atlas_auth_sessions_user_expiry ON atlas_auth_sessions (user_id, expires_at);
ALTER TABLE atlas_auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_auth_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_auth_sessions_self ON atlas_auth_sessions;
CREATE POLICY atlas_auth_sessions_self ON atlas_auth_sessions
  USING (user_id::text = nullif(current_setting('app.actor_id', true), '') OR session_hash = nullif(current_setting('app.session_hash', true), ''))
  WITH CHECK (user_id::text = nullif(current_setting('app.actor_id', true), ''));

CREATE TABLE IF NOT EXISTS atlas_auth_tokens (
  token_hash CHAR(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id UUID REFERENCES atlas_auth_users(user_id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email','password_reset','organization_invite')),
  tenant_id UUID REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  invited_email TEXT,
  invited_role_key TEXT,
  invited_custom_role_id UUID,
  created_by UUID REFERENCES atlas_auth_users(user_id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((purpose = 'organization_invite') = (tenant_id IS NOT NULL)),
  CHECK ((purpose = 'organization_invite') = (invited_email IS NOT NULL)),
  CHECK ((purpose = 'organization_invite') = (invited_role_key IS NOT NULL)),
  CHECK ((purpose = 'organization_invite') = (created_by IS NOT NULL)),
  CHECK (purpose = 'organization_invite' OR user_id IS NOT NULL),
  FOREIGN KEY (tenant_id, invited_custom_role_id) REFERENCES atlas_organization_roles(tenant_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_auth_tokens_user_purpose ON atlas_auth_tokens (user_id, purpose, expires_at);
CREATE INDEX IF NOT EXISTS idx_atlas_auth_tokens_invite_email ON atlas_auth_tokens (lower(invited_email), tenant_id) WHERE purpose = 'organization_invite';
CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_auth_tokens_active_invitation ON atlas_auth_tokens (tenant_id, lower(invited_email)) WHERE purpose = 'organization_invite' AND consumed_at IS NULL;
ALTER TABLE atlas_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_auth_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_auth_tokens_actor ON atlas_auth_tokens;
DROP POLICY IF EXISTS atlas_auth_tokens_read ON atlas_auth_tokens;
DROP POLICY IF EXISTS atlas_auth_tokens_insert ON atlas_auth_tokens;
DROP POLICY IF EXISTS atlas_auth_tokens_update ON atlas_auth_tokens;
CREATE POLICY atlas_auth_tokens_read ON atlas_auth_tokens FOR SELECT
  USING (user_id::text = nullif(current_setting('app.actor_id', true), '') OR token_hash = nullif(current_setting('app.auth_token_hash', true), '') OR lower(invited_email) = nullif(current_setting('app.auth_email', true), '') OR tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
CREATE POLICY atlas_auth_tokens_insert ON atlas_auth_tokens FOR INSERT
  WITH CHECK (user_id::text = nullif(current_setting('app.actor_id', true), '') OR (purpose='organization_invite' AND tenant_id::text = nullif(current_setting('app.tenant_id', true), '') AND created_by::text = nullif(current_setting('app.actor_id', true), '') AND EXISTS (SELECT 1 FROM atlas_organization_memberships m WHERE m.tenant_id=atlas_auth_tokens.tenant_id AND m.user_id::text=nullif(current_setting('app.actor_id', true), '') AND m.role_key IN ('owner','admin') AND m.status='active')));
CREATE POLICY atlas_auth_tokens_update ON atlas_auth_tokens FOR UPDATE
  USING (user_id::text = nullif(current_setting('app.actor_id', true), '') OR token_hash = nullif(current_setting('app.auth_token_hash', true), '') OR lower(invited_email) = nullif(current_setting('app.auth_email', true), '') OR tenant_id::text = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (user_id::text = nullif(current_setting('app.actor_id', true), '') OR lower(invited_email) = nullif(current_setting('app.auth_email', true), '') OR (purpose='organization_invite' AND tenant_id::text = nullif(current_setting('app.tenant_id', true), '') AND EXISTS (SELECT 1 FROM atlas_organization_memberships m WHERE m.tenant_id=atlas_auth_tokens.tenant_id AND m.user_id::text=nullif(current_setting('app.actor_id', true), '') AND m.role_key IN ('owner','admin') AND m.status='active')));

CREATE TABLE IF NOT EXISTS atlas_auth_rate_limits (
  rate_key CHAR(64) NOT NULL CHECK (rate_key ~ '^[a-f0-9]{64}$'),
  window_start TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL CHECK (hit_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (rate_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_atlas_auth_rate_limits_expiry ON atlas_auth_rate_limits (expires_at);
ALTER TABLE atlas_auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_auth_rate_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_auth_rate_limits_key ON atlas_auth_rate_limits;
CREATE POLICY atlas_auth_rate_limits_key ON atlas_auth_rate_limits
  USING (rate_key = nullif(current_setting('app.rate_key', true), ''))
  WITH CHECK (rate_key = nullif(current_setting('app.rate_key', true), ''));

CREATE TABLE IF NOT EXISTS atlas_auth_audit_events (
  event_id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES atlas_organizations(tenant_id) ON DELETE SET NULL,
  actor_id UUID REFERENCES atlas_auth_users(user_id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.-]{1,80}$'),
  subject_ref TEXT CHECK (subject_ref IS NULL OR length(subject_ref) <= 160),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_auth_audit_tenant_time ON atlas_auth_audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_auth_audit_actor_time ON atlas_auth_audit_events (actor_id, created_at DESC);
ALTER TABLE atlas_auth_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_auth_audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_auth_audit_events_actor ON atlas_auth_audit_events;
CREATE POLICY atlas_auth_audit_events_actor ON atlas_auth_audit_events
  USING (actor_id::text = nullif(current_setting('app.actor_id', true), '') OR tenant_id::text = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (actor_id::text = nullif(current_setting('app.actor_id', true), '') AND (tenant_id IS NULL OR tenant_id::text = nullif(current_setting('app.tenant_id', true), '')));

CREATE OR REPLACE FUNCTION atlas_v112_immutable_auth_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Atlas authentication audit events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS atlas_v112_auth_audit_immutable ON atlas_auth_audit_events;
CREATE TRIGGER atlas_v112_auth_audit_immutable BEFORE UPDATE OR DELETE ON atlas_auth_audit_events FOR EACH ROW EXECUTE FUNCTION atlas_v112_immutable_auth_audit();
REVOKE UPDATE, DELETE, TRUNCATE ON atlas_auth_audit_events FROM PUBLIC;

COMMIT;
