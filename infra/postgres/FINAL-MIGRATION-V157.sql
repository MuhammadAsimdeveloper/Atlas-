-- Atlas V157: platform-admin moderation and notification operations.
-- Additive migration. Mutations remain disabled until the audited API workflow is enabled.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_platform_content_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES atlas_organizations(tenant_id) ON DELETE SET NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('page','message','profile','workflow','asset','other')),
  content_ref TEXT NOT NULL CHECK (length(content_ref) BETWEEN 1 AND 256),
  reporter_ref TEXT,
  category TEXT NOT NULL CHECK (category IN ('spam','abuse','fraud','privacy','copyright','unsafe','other')),
  description TEXT NOT NULL DEFAULT '' CHECK (octet_length(description) <= 8000),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object' AND octet_length(evidence::text) <= 16000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','actioned','dismissed','appealed')),
  assigned_to TEXT,
  decision TEXT CHECK (decision IN ('hide','restore','warn','suspend','dismiss')),
  decision_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CHECK ((status NOT IN ('actioned','dismissed')) OR (decision IS NOT NULL AND decision_reason IS NOT NULL AND length(trim(decision_reason)) >= 8))
);
CREATE INDEX IF NOT EXISTS atlas_platform_content_reports_queue_idx ON atlas_platform_content_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS atlas_platform_content_reports_tenant_idx ON atlas_platform_content_reports(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_platform_content_moderation_events (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES atlas_platform_content_reports(report_id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES atlas_auth_users(user_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('assigned','marked_in_review','hide','restore','warn','suspend','dismiss','appeal_opened','appeal_resolved')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 8 AND octet_length(reason) <= 2000),
  from_status TEXT,
  to_status TEXT NOT NULL,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS atlas_platform_content_moderation_events_report_idx ON atlas_platform_content_moderation_events(report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_platform_notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('system','security','billing','product','moderation')),
  channel TEXT NOT NULL CHECK (channel IN ('email','in_app','webhook')),
  audience TEXT NOT NULL CHECK (audience IN ('all_users','workspace_owners','specific_user','platform_owners')),
  recipient_ref TEXT,
  subject TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 12000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sending','sent','partial','failed','cancelled')),
  created_by UUID NOT NULL REFERENCES atlas_auth_users(user_id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 12 AND 200),
  provider_message_ref TEXT,
  last_error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (audience <> 'specific_user' OR recipient_ref IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS atlas_platform_notifications_queue_idx ON atlas_platform_notifications(status, scheduled_at, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_platform_notification_attempts (
  attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES atlas_platform_notifications(notification_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL CHECK (status IN ('started','sent','failed','suppressed')),
  provider_message_ref TEXT,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(notification_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS atlas_platform_notification_attempts_idx ON atlas_platform_notification_attempts(notification_id, started_at DESC);

ALTER TABLE atlas_platform_content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_platform_content_moderation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_platform_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_platform_notification_attempts ENABLE ROW LEVEL SECURITY;

-- Platform tables have no direct table grants. Owner-executed SECURITY DEFINER functions
-- provide a narrow API surface; do not grant direct SELECT/INSERT/UPDATE to atlas_app.
CREATE OR REPLACE FUNCTION atlas_v157_admin_list_content_reports(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 25)
RETURNS SETOF atlas_platform_content_reports
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $
  SELECT r.* FROM public.atlas_platform_content_reports r
  WHERE p_status IS NULL OR r.status = p_status
  ORDER BY r.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,25),1),100)
$;

CREATE OR REPLACE FUNCTION atlas_v157_admin_list_notifications(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 25)
RETURNS SETOF atlas_platform_notifications
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $
  SELECT n.* FROM public.atlas_platform_notifications n
  WHERE p_status IS NULL OR n.status = p_status
  ORDER BY n.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,25),1),100)
$;

CREATE OR REPLACE FUNCTION atlas_v157_admin_notification_attempts(p_notification_id UUID)
RETURNS SETOF atlas_platform_notification_attempts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $
  SELECT a.* FROM public.atlas_platform_notification_attempts a
  WHERE a.notification_id = p_notification_id ORDER BY a.started_at DESC LIMIT 50
$;

REVOKE ALL ON FUNCTION atlas_v157_admin_list_content_reports(TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v157_admin_list_notifications(TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v157_admin_notification_attempts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v157_admin_list_content_reports(TEXT,INTEGER) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v157_admin_list_notifications(TEXT,INTEGER) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v157_admin_notification_attempts(UUID) TO atlas_app;

COMMIT;
