-- Atlas V158: audited, optimistic-concurrency moderation workflow transitions.
-- Only assignment and moving a report into review are enabled; content enforcement stays gated.
BEGIN;

CREATE OR REPLACE FUNCTION atlas_v158_admin_transition_content_report(
  p_report_id UUID,
  p_actor_user_id UUID,
  p_action TEXT,
  p_reason TEXT,
  p_assigned_to TEXT DEFAULT NULL,
  p_expected_version INTEGER DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS SETOF atlas_platform_content_reports
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $func$
DECLARE
  current_report public.atlas_platform_content_reports%ROWTYPE;
  next_status TEXT;
BEGIN
  IF p_action NOT IN ('assigned','marked_in_review') THEN
    RAISE EXCEPTION 'unsupported_moderation_transition' USING ERRCODE='22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 8 OR octet_length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'invalid_moderation_reason' USING ERRCODE='22023';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'expected_version_required' USING ERRCODE='22023';
  END IF;
  IF p_request_id IS NOT NULL AND length(p_request_id) > 128 THEN
    RAISE EXCEPTION 'invalid_request_id' USING ERRCODE='22023';
  END IF;
  IF p_action = 'assigned' AND (p_assigned_to IS NULL OR length(trim(p_assigned_to)) < 1 OR length(p_assigned_to) > 254) THEN
    RAISE EXCEPTION 'assignee_required' USING ERRCODE='22023';
  END IF;

  SELECT r.* INTO current_report
    FROM public.atlas_platform_content_reports r
    WHERE r.report_id = p_report_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'content_report_not_found' USING ERRCODE='P0002';
  END IF;
  IF current_report.version <> p_expected_version THEN
    RAISE EXCEPTION 'content_report_version_conflict' USING ERRCODE='40001';
  END IF;
  IF current_report.status NOT IN ('open','in_review','appealed') THEN
    RAISE EXCEPTION 'content_report_not_transitionable' USING ERRCODE='22023';
  END IF;

  previous_status := current_report.status;
  next_status := CASE WHEN p_action = 'marked_in_review' THEN 'in_review' ELSE current_report.status END;
  UPDATE public.atlas_platform_content_reports
    SET assigned_to = CASE WHEN p_action = 'assigned' THEN trim(p_assigned_to) ELSE assigned_to END,
        status = next_status,
        reviewed_at = CASE WHEN p_action = 'marked_in_review' THEN COALESCE(reviewed_at, now()) ELSE reviewed_at END,
        updated_at = now(),
        version = version + 1
    WHERE report_id = p_report_id
    RETURNING * INTO current_report;

  INSERT INTO public.atlas_platform_content_moderation_events
    (report_id, actor_user_id, action, reason, from_status, to_status, request_id)
  VALUES
    (p_report_id, p_actor_user_id, p_action, trim(p_reason),
     previous_status,
     current_report.status, p_request_id);

  RETURN NEXT current_report;
END
$func$;

REVOKE ALL ON FUNCTION atlas_v158_admin_transition_content_report(UUID,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v158_admin_transition_content_report(UUID,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT) TO atlas_app;

COMMIT;
