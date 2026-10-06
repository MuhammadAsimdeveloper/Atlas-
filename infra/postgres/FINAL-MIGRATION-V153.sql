-- Atlas V153: authenticated Copilot Chat Hub, public webchat gateway, streaming evidence and human handoff.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_v153_copilot_configs (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  config_id UUID NOT NULL,
  widget_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Atlas Copilot',
  release_snapshot JSONB NOT NULL,
  allowed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, config_id),
  CHECK (widget_key ~ '^[A-Za-z0-9_-]{32,128}$'),
  CHECK (jsonb_typeof(release_snapshot)='object'),
  CHECK (jsonb_typeof(allowed_origins)='array' AND jsonb_array_length(allowed_origins) <= 32),
  CHECK (octet_length(release_snapshot::text) <= 30000)
);

CREATE TABLE IF NOT EXISTS atlas_v153_copilot_sessions (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  config_id UUID NOT NULL,
  release_id TEXT NOT NULL,
  customer_ref TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id),
  FOREIGN KEY (tenant_id, config_id) REFERENCES atlas_v153_copilot_configs(tenant_id, config_id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_v153_copilot_sessions_expiry
  ON atlas_v153_copilot_sessions(tenant_id, expires_at);

CREATE TABLE IF NOT EXISTS atlas_v153_copilot_stream_events (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  execution_id UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('delta','done','error')),
  content_ref TEXT,
  content_hash CHAR(64) CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, execution_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_atlas_v153_copilot_stream_execution
  ON atlas_v153_copilot_stream_events(tenant_id, execution_id, sequence);

CREATE INDEX IF NOT EXISTS idx_atlas_v153_copilot_configs_widget
  ON atlas_v153_copilot_configs(widget_key, status);

ALTER TABLE atlas_v153_copilot_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v153_copilot_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE atlas_v153_copilot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v153_copilot_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE atlas_v153_copilot_stream_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v153_copilot_stream_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atlas_v153_copilot_configs_tenant ON atlas_v153_copilot_configs;
CREATE POLICY atlas_v153_copilot_configs_tenant ON atlas_v153_copilot_configs
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
DROP POLICY IF EXISTS atlas_v153_copilot_sessions_tenant ON atlas_v153_copilot_sessions;
CREATE POLICY atlas_v153_copilot_sessions_tenant ON atlas_v153_copilot_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
DROP POLICY IF EXISTS atlas_v153_copilot_stream_tenant ON atlas_v153_copilot_stream_events;
CREATE POLICY atlas_v153_copilot_stream_tenant ON atlas_v153_copilot_stream_events
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE OR REPLACE FUNCTION atlas_v153_create_public_session(
  p_widget_key TEXT,
  p_session_id UUID,
  p_customer_ref TEXT,
  p_expires_at TIMESTAMPTZ,
  p_origin TEXT DEFAULT NULL
) RETURNS TABLE(
  tenant_id UUID, config_id UUID, session_id UUID, release_snapshot JSONB, allowed_origins JSONB
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_widget_key IS NULL OR p_widget_key !~ '^[A-Za-z0-9_-]{32,128}
     OR p_expires_at <= now() OR p_expires_at > now() + interval '24 hours' THEN
    RAISE EXCEPTION 'copilot_session_invalid';
  END IF;
  RETURN QUERY
  WITH cfg AS (
    SELECT c.tenant_id,c.config_id,c.release_snapshot,c.allowed_origins
    FROM public.atlas_v153_copilot_configs c
    WHERE c.widget_key=p_widget_key AND c.status='active'
    LIMIT 1
  ), ins AS (
    INSERT INTO public.atlas_v153_copilot_sessions(tenant_id,session_id,config_id,release_id,customer_ref,expires_at)
    SELECT tenant_id,p_session_id,config_id,release_snapshot->>'releaseId',
           CASE WHEN p_customer_ref IS NULL OR p_customer_ref='' THEN NULL ELSE left(p_customer_ref,240) END,
           p_expires_at
    FROM cfg
    RETURNING tenant_id,config_id,session_id
  )
  SELECT cfg.tenant_id,cfg.config_id,ins.session_id,cfg.release_snapshot,cfg.allowed_origins
  FROM cfg JOIN ins ON ins.tenant_id=cfg.tenant_id AND ins.config_id=cfg.config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'copilot_widget_not_found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v153_prepare_public_turn(
  p_tenant_id UUID,
  p_config_id UUID,
  p_session_id UUID,
  p_message_id UUID,
  p_content_ref TEXT,
  p_prompt_hash CHAR(64),
  p_turn_id TEXT,
  p_plan_id UUID,
  p_execution_id UUID,
  p_idempotency_key CHAR(64)
) RETURNS TABLE(
  conversation_id UUID, execution_id UUID, plan_id UUID, job_id UUID, release_snapshot JSONB, created BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_snapshot JSONB;
  v_agent_id UUID;
  v_release_id TEXT;
  v_version INTEGER;
  v_conversation UUID;
  v_job UUID;
  v_created BOOLEAN:=false;
  v_existing UUID;
BEGIN
  IF p_tenant_id IS NULL OR p_config_id IS NULL OR p_session_id IS NULL OR p_message_id IS NULL
     OR p_content_ref IS NULL OR p_content_ref !~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$'
     OR p_prompt_hash !~ '^[a-f0-9]{64}$'
     OR p_idempotency_key !~ '^[a-f0-9]{64}$'
     OR p_plan_id IS NULL OR p_execution_id IS NULL
     OR p_turn_id IS NULL OR p_turn_id !~ '^[A-Za-z0-9_.:-]{3,160}$' THEN
    RAISE EXCEPTION 'copilot_turn_invalid';
  END IF;

  SELECT c.release_snapshot INTO v_snapshot
  FROM public.atlas_v153_copilot_configs c
  JOIN public.atlas_v153_copilot_sessions s
    ON s.tenant_id=c.tenant_id AND s.config_id=c.config_id
  WHERE c.tenant_id=p_tenant_id AND (p_config_id IS NULL OR c.config_id=p_config_id)
    AND c.status='active' AND s.session_id=p_session_id
    AND s.revoked_at IS NULL AND s.expires_at>now()
  FOR SHARE;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'copilot_session_not_found'; END IF;
  IF v_snapshot->>'status' NOT IN ('active','canary') THEN RAISE EXCEPTION 'copilot_release_inactive'; END IF;
  IF v_snapshot->>'releaseId' IS NULL OR v_snapshot->>'agentId' IS NULL
     OR v_snapshot->>'version' IS NULL OR v_snapshot->>'checksum' IS NULL
     OR v_snapshot->>'modelPolicy' IS NULL OR v_snapshot->>'systemPromptHash' IS NULL THEN
    RAISE EXCEPTION 'copilot_release_runtime_incomplete';
  END IF;
  BEGIN v_agent_id := (v_snapshot->>'agentId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'copilot_release_agent_invalid'; END;
  v_release_id := v_snapshot->>'releaseId';
  v_version := (v_snapshot->>'version')::integer;

  INSERT INTO public.atlas_ai_agent_sessions(tenant_id,session_id,agent_release_ref,channel,customer_ref,memory_scope,created_by)
  VALUES(
    p_tenant_id,p_session_id,v_release_id,'webchat',
    jsonb_build_object('kind','copilot_session','id',p_session_id::text,'version',1),'session',NULL
  ) ON CONFLICT (tenant_id,session_id) DO NOTHING;

  IF v_existing IS NOT NULL THEN
    SELECT c.conversation_id INTO v_conversation FROM public.atlas_v122_conversations c WHERE c.tenant_id=p_tenant_id AND c.external_thread_ref='copilot:'||p_session_id::text LIMIT 1;
    SELECT j.job_id INTO v_job FROM public.atlas_runtime_jobs j WHERE j.tenant_id=p_tenant_id AND j.job_type='agent.turn.execute' AND j.payload_ref->>'executionId'=v_existing::text ORDER BY j.created_at DESC LIMIT 1;
    RETURN QUERY SELECT v_conversation,v_existing,(SELECT plan_id FROM public.atlas_agent_turn_executions WHERE tenant_id=p_tenant_id AND execution_id=v_existing),v_job,v_snapshot,false; RETURN;
  END IF;

  INSERT INTO public.atlas_v122_conversations(
    tenant_id,conversation_id,channel,external_thread_ref,status,subject,last_message_at,last_inbound_at,unread_count,version,updated_at
  ) VALUES(p_tenant_id,gen_random_uuid(),'webchat','copilot:'||p_session_id::text,'open',NULL,now(),now(),1,1,now())
  ON CONFLICT (tenant_id,channel,external_thread_ref)
    WHERE external_thread_ref IS NOT NULL
  DO UPDATE SET last_message_at=now(),last_inbound_at=now(),unread_count=atlas_v122_conversations.unread_count+1,updated_at=now(),version=atlas_v122_conversations.version+1
  RETURNING conversation_id INTO v_conversation;

  INSERT INTO public.atlas_v122_messages(
    tenant_id,message_id,conversation_id,direction,sender_ref,recipient_ref,body_ref,delivery_status,idempotency_key,content_ref,created_at,updated_at
  ) VALUES(
    p_tenant_id,p_message_id,v_conversation,'inbound',
    'copilot:'||p_session_id::text,NULL,'{}','delivered',
    encode(digest('copilot-in:'||p_session_id::text||':'||p_prompt_hash,'sha256'),'hex'),
    p_content_ref,now(),now()
  ) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;

  INSERT INTO public.atlas_agent_turn_plans(
    tenant_id,plan_id,session_id,turn_id,agent_id,release_id,release_version,release_snapshot,prompt_hash,tool_plan,approval_refs,workflow_invocation_ref,journey_context,idempotency_key,status,checksum
  ) VALUES(
    p_tenant_id,p_plan_id,p_session_id,p_turn_id,v_agent_id,v_release_id,v_version,v_snapshot,p_prompt_hash,'[]','[]',NULL,
    jsonb_build_object('tenantId',p_tenant_id::text,'journeyId','copilot-'||p_session_id::text,'conversationRef', 'inbox:conversation:'||v_conversation::text),
    p_idempotency_key,'planned',
    encode(digest(p_tenant_id::text||':'||p_session_id::text||':'||p_turn_id||':'||p_prompt_hash,'sha256'),'hex')
  );

  INSERT INTO public.atlas_agent_turn_executions(
    tenant_id,execution_id,plan_id,session_id,turn_id,release_id,release_version,prompt_hash,input_ref,idempotency_key,checksum
  ) VALUES(
    p_tenant_id,p_execution_id,p_plan_id,p_session_id,p_turn_id,v_release_id,v_version,p_prompt_hash,
    'inbox:conversation:'||v_conversation::text,p_idempotency_key,
    encode(digest(p_tenant_id::text||':'||p_execution_id::text||':'||p_prompt_hash,'sha256'),'hex')
  );

  SELECT public.atlas_v115_enqueue_job(
    p_tenant_id,p_execution_id,'agent.turn.execute',
    jsonb_build_object('executionId',p_execution_id::text),
    p_idempotency_key,now(),5
  ) INTO v_job;
  v_created:=true;
  RETURN QUERY SELECT v_conversation,p_execution_id,p_plan_id,v_job,v_snapshot,v_created;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v153_append_stream_event(
  p_tenant_id UUID,p_execution_id UUID,p_job_id UUID,p_worker_id TEXT,
  p_sequence BIGINT,p_event_type TEXT,p_content_ref TEXT,p_content_hash CHAR(64)
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ok BOOLEAN;
BEGIN
  IF p_event_type NOT IN ('delta','done','error') OR p_sequence < 1
     OR p_content_ref IS NOT NULL AND p_content_ref !~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$'
     OR p_content_hash IS NOT NULL AND p_content_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'copilot_stream_event_invalid';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.atlas_runtime_jobs j
    WHERE j.tenant_id=p_tenant_id AND j.job_id=p_job_id AND j.job_type='agent.turn.execute'
      AND j.status='leased' AND j.lease_owner=p_worker_id AND j.lease_until>now()
      AND j.payload_ref->>'executionId'=p_execution_id::text
  ) THEN RAISE EXCEPTION 'worker_job_lease_invalid'; END IF;
  INSERT INTO public.atlas_v153_copilot_stream_events(tenant_id,execution_id,sequence,event_type,content_ref,content_hash)
  VALUES(p_tenant_id,p_execution_id,p_sequence,p_event_type,p_content_ref,p_content_hash)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS ok = ROW_COUNT;
  RETURN ok;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v153_public_state(
  p_tenant_id UUID,p_session_id UUID,p_execution_id UUID DEFAULT NULL
) RETURNS TABLE(
  conversation_id UUID, execution_id UUID, execution_status TEXT, execution_version INTEGER,
  message_id UUID, message_direction TEXT, content_ref TEXT, created_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  RETURN QUERY
  SELECT c.conversation_id,e.execution_id,e.status,e.version,m.message_id,m.direction,m.content_ref,m.created_at
  FROM public.atlas_v153_copilot_sessions s
  JOIN public.atlas_v122_conversations c
    ON c.tenant_id=s.tenant_id AND c.external_thread_ref='copilot:'||s.session_id::text
  LEFT JOIN public.atlas_agent_turn_executions e
    ON e.tenant_id=s.tenant_id AND e.session_id=s.session_id
   AND (p_execution_id IS NULL OR e.execution_id=p_execution_id)
  LEFT JOIN public.atlas_v122_messages m
    ON m.tenant_id=c.tenant_id AND m.conversation_id=c.conversation_id
  WHERE s.tenant_id=p_tenant_id AND s.session_id=p_session_id AND s.revoked_at IS NULL AND s.expires_at>now()
  ORDER BY m.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v153_public_stream(
  p_tenant_id UUID,p_session_id UUID,p_execution_id UUID,p_after BIGINT DEFAULT 0
) RETURNS TABLE(
  sequence BIGINT,event_type TEXT,content_ref TEXT,content_hash CHAR(64),
  execution_status TEXT,error_code TEXT
) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $
  SELECT e.sequence,e.event_type,e.content_ref,e.content_hash,x.status,x.error_code
  FROM public.atlas_v153_copilot_sessions s
  JOIN public.atlas_v153_copilot_stream_events e
    ON e.tenant_id=s.tenant_id AND e.execution_id=p_execution_id
  JOIN public.atlas_agent_turn_executions x
    ON x.tenant_id=s.tenant_id AND x.execution_id=p_execution_id
  WHERE s.tenant_id=p_tenant_id AND s.session_id=p_session_id
    AND s.revoked_at IS NULL AND s.expires_at>now() AND e.sequence>p_after
  ORDER BY e.sequence ASC LIMIT 100;
$;

GRANT EXECUTE ON FUNCTION atlas_v153_public_stream(UUID,UUID,UUID,BIGINT) TO atlas_app;
REVOKE ALL ON FUNCTION atlas_v153_public_stream(UUID,UUID,UUID,BIGINT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_v153_request_handoff(
  p_tenant_id UUID,p_session_id UUID,p_reason TEXT,p_handoff_id UUID,p_queue_ref TEXT
) RETURNS TABLE(conversation_id UUID,handoff_id UUID,status TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_conversation UUID;
BEGIN
  IF p_reason NOT IN ('caller_requested_human','billing_help','appointment_help','sensitive_request','low_confidence','tool_failure','language_mismatch','urgent_safety','other')
     OR p_queue_ref IS NULL OR p_queue_ref !~ '^[A-Za-z0-9_.:/@+-]{3,160}$' THEN RAISE EXCEPTION 'copilot_handoff_invalid'; END IF;
  SELECT c.conversation_id INTO v_conversation
  FROM public.atlas_v153_copilot_sessions s JOIN public.atlas_v122_conversations c
    ON c.tenant_id=s.tenant_id AND c.external_thread_ref='copilot:'||s.session_id::text
  WHERE s.tenant_id=p_tenant_id AND s.session_id=p_session_id AND s.revoked_at IS NULL AND s.expires_at>now();
  IF v_conversation IS NULL THEN RAISE EXCEPTION 'copilot_session_not_found'; END IF;
  INSERT INTO public.atlas_agent_handoffs(tenant_id,handoff_id,session_id,reason,queue_ref,status,checksum)
  VALUES(p_tenant_id,p_handoff_id,p_session_id,p_reason,p_queue_ref,'pending',
    encode(digest(p_tenant_id::text||':'||p_session_id::text||':'||p_reason||':'||p_queue_ref,'sha256'),'hex'))
  ON CONFLICT DO NOTHING;
  UPDATE public.atlas_v122_conversations
  SET status='open',handoff_reason=p_reason,updated_at=now(),version=version+1
  WHERE tenant_id=p_tenant_id AND conversation_id=v_conversation;
  RETURN QUERY SELECT v_conversation,p_handoff_id,'pending';
END;
$$;

REVOKE ALL ON atlas_v153_copilot_configs,atlas_v153_copilot_sessions,atlas_v153_copilot_stream_events FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v153_create_public_session(TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v153_create_public_session(TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT) TO atlas_app;
GRANT EXECUTE ON FUNCTION atlas_v153_prepare_public_turn(UUID,UUID,UUID,UUID,TEXT,CHAR(64),TEXT,UUID,UUID,CHAR(64)) TO atlas_app;
REVOKE ALL ON FUNCTION atlas_v153_prepare_public_turn(UUID,UUID,UUID,UUID,TEXT,CHAR(64),TEXT,UUID,UUID,CHAR(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v153_append_stream_event(UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,CHAR(64)) TO atlas_worker;
REVOKE ALL ON FUNCTION atlas_v153_append_stream_event(UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,CHAR(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v153_public_state(UUID,UUID,UUID) TO atlas_app;
REVOKE ALL ON FUNCTION atlas_v153_public_state(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v153_request_handoff(UUID,UUID,TEXT,UUID,TEXT) TO atlas_app;
REVOKE ALL ON FUNCTION atlas_v153_request_handoff(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;

COMMIT;

     OR p_session_id IS NULL OR p_expires_at IS NULL
     OR (p_origin IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text((SELECT c.allowed_origins FROM public.atlas_v153_copilot_configs c WHERE c.widget_key=p_widget_key AND c.status='active' LIMIT 1)) o(value) WHERE o.value=p_origin))
     OR p_expires_at <= now() OR p_expires_at > now() + interval '24 hours' THEN
    RAISE EXCEPTION 'copilot_session_invalid';
  END IF;
  RETURN QUERY
  WITH cfg AS (
    SELECT c.tenant_id,c.config_id,c.release_snapshot,c.allowed_origins
    FROM public.atlas_v153_copilot_configs c
    WHERE c.widget_key=p_widget_key AND c.status='active'
    LIMIT 1
  ), ins AS (
    INSERT INTO public.atlas_v153_copilot_sessions(tenant_id,session_id,config_id,release_id,customer_ref,expires_at)
    SELECT tenant_id,p_session_id,config_id,release_snapshot->>'releaseId',
           CASE WHEN p_customer_ref IS NULL OR p_customer_ref='' THEN NULL ELSE left(p_customer_ref,240) END,
           p_expires_at
    FROM cfg
    RETURNING tenant_id,config_id,session_id
  )
  SELECT cfg.tenant_id,cfg.config_id,ins.session_id,cfg.release_snapshot,cfg.allowed_origins
  FROM cfg JOIN ins ON ins.tenant_id=cfg.tenant_id AND ins.config_id=cfg.config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'copilot_widget_not_found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v153_prepare_public_turn(
  p_tenant_id UUID,
  p_config_id UUID,
  p_session_id UUID,
  p_message_id UUID,
  p_content_ref TEXT,
  p_prompt_hash CHAR(64),
  p_turn_id TEXT,
  p_plan_id UUID,
  p_execution_id UUID,
  p_idempotency_key CHAR(64)
) RETURNS TABLE(
  conversation_id UUID, execution_id UUID, plan_id UUID, job_id UUID, release_snapshot JSONB, created BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_snapshot JSONB;
  v_agent_id UUID;
  v_release_id TEXT;
  v_version INTEGER;
  v_conversation UUID;
  v_job UUID;
  v_created BOOLEAN:=false;
  v_existing UUID;
BEGIN
  IF p_tenant_id IS NULL OR p_config_id IS NULL OR p_session_id IS NULL OR p_message_id IS NULL
     OR p_content_ref IS NULL OR p_content_ref !~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$'
     OR p_prompt_hash !~ '^[a-f0-9]{64}$'
     OR p_idempotency_key !~ '^[a-f0-9]{64}$'
     OR p_plan_id IS NULL OR p_execution_id IS NULL
     OR p_turn_id IS NULL OR p_turn_id !~ '^[A-Za-z0-9_.:-]{3,160}$' THEN
    RAISE EXCEPTION 'copilot_turn_invalid';
  END IF;

  SELECT c.release_snapshot INTO v_snapshot
  FROM public.atlas_v153_copilot_configs c
  JOIN public.atlas_v153_copilot_sessions s
    ON s.tenant_id=c.tenant_id AND s.config_id=c.config_id
  WHERE c.tenant_id=p_tenant_id AND c.config_id=p_config_id
    AND c.status='active' AND s.session_id=p_session_id
    AND s.revoked_at IS NULL AND s.expires_at>now()
  FOR SHARE;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'copilot_session_not_found'; END IF;
  IF v_snapshot->>'status' NOT IN ('active','canary') THEN RAISE EXCEPTION 'copilot_release_inactive'; END IF;
  IF v_snapshot->>'releaseId' IS NULL OR v_snapshot->>'agentId' IS NULL
     OR v_snapshot->>'version' IS NULL OR v_snapshot->>'checksum' IS NULL
     OR v_snapshot->>'modelPolicy' IS NULL OR v_snapshot->>'systemPromptHash' IS NULL THEN
    RAISE EXCEPTION 'copilot_release_runtime_incomplete';
  END IF;
  BEGIN v_agent_id := (v_snapshot->>'agentId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'copilot_release_agent_invalid'; END;
  v_release_id := v_snapshot->>'releaseId';
  v_version := (v_snapshot->>'version')::integer;

  INSERT INTO public.atlas_ai_agent_sessions(tenant_id,session_id,agent_release_ref,channel,customer_ref,memory_scope,created_by)
  VALUES(
    p_tenant_id,p_session_id,v_release_id,'webchat',
    jsonb_build_object('kind','copilot_session','id',p_session_id::text,'version',1),'session',NULL
  ) ON CONFLICT (tenant_id,session_id) DO NOTHING;

  INSERT INTO public.atlas_v122_conversations(
    tenant_id,conversation_id,channel,external_thread_ref,status,subject,last_message_at,last_inbound_at,unread_count,version,updated_at
  ) VALUES(p_tenant_id,gen_random_uuid(),'webchat','copilot:'||p_session_id::text,'open',NULL,now(),now(),1,1,now())
  ON CONFLICT (tenant_id,channel,external_thread_ref)
    WHERE external_thread_ref IS NOT NULL
  DO UPDATE SET last_message_at=now(),last_inbound_at=now(),unread_count=atlas_v122_conversations.unread_count+1,updated_at=now(),version=atlas_v122_conversations.version+1
  RETURNING conversation_id INTO v_conversation;

  SELECT e.execution_id INTO v_existing
  FROM public.atlas_agent_turn_executions e
  WHERE e.tenant_id=p_tenant_id AND e.idempotency_key=p_idempotency_key
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    SELECT j.job_id INTO v_job FROM public.atlas_runtime_jobs j
    WHERE j.tenant_id=p_tenant_id AND j.job_type='agent.turn.execute' AND j.payload_ref->>'executionId'=v_existing::text
    ORDER BY j.created_at DESC LIMIT 1;
    RETURN QUERY SELECT v_conversation,v_existing,(SELECT plan_id FROM public.atlas_agent_turn_executions WHERE tenant_id=p_tenant_id AND execution_id=v_existing),v_job,v_snapshot,false;
    RETURN;
  END IF;

  INSERT INTO public.atlas_v122_messages(
    tenant_id,message_id,conversation_id,direction,sender_ref,recipient_ref,body_ref,delivery_status,idempotency_key,content_ref,created_at,updated_at
  ) VALUES(
    p_tenant_id,p_message_id,v_conversation,'inbound',
    'copilot:'||p_session_id::text,NULL,'{}','delivered',
    encode(digest('copilot-in:'||p_session_id::text||':'||p_prompt_hash,'sha256'),'hex'),
    p_content_ref,now(),now()
  ) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;

  INSERT INTO public.atlas_agent_turn_plans(
    tenant_id,plan_id,session_id,turn_id,agent_id,release_id,release_version,release_snapshot,prompt_hash,tool_plan,approval_refs,workflow_invocation_ref,journey_context,idempotency_key,status,checksum
  ) VALUES(
    p_tenant_id,p_plan_id,p_session_id,p_turn_id,v_agent_id,v_release_id,v_version,v_snapshot,p_prompt_hash,'[]','[]',NULL,
    jsonb_build_object('tenantId',p_tenant_id::text,'journeyId','copilot-'||p_session_id::text,'conversationRef', 'inbox:conversation:'||v_conversation::text),
    p_idempotency_key,'planned',
    encode(digest(p_tenant_id::text||':'||p_session_id::text||':'||p_turn_id||':'||p_prompt_hash,'sha256'),'hex')
  );

  INSERT INTO public.atlas_agent_turn_executions(
    tenant_id,execution_id,plan_id,session_id,turn_id,release_id,release_version,prompt_hash,input_ref,idempotency_key,checksum
  ) VALUES(
    p_tenant_id,p_execution_id,p_plan_id,p_session_id,p_turn_id,v_release_id,v_version,p_prompt_hash,
    'inbox:conversation:'||v_conversation::text,p_idempotency_key,
    encode(digest(p_tenant_id::text||':'||p_execution_id::text||':'||p_prompt_hash,'sha256'),'hex')
  );

  SELECT public.atlas_v115_enqueue_job(
    p_tenant_id,p_execution_id,'agent.turn.execute',
    jsonb_build_object('executionId',p_execution_id::text),
    p_idempotency_key,now(),5
  ) INTO v_job;
  v_created:=true;
  RETURN QUERY SELECT v_conversation,p_execution_id,p_plan_id,v_job,v_snapshot,v_created;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v153_append_stream_event(
  p_tenant_id UUID,p_execution_id UUID,p_job_id UUID,p_worker_id TEXT,
  p_sequence BIGINT,p_event_type TEXT,p_content_ref TEXT,p_content_hash CHAR(64)
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ok BOOLEAN;
BEGIN
  IF p_event_type NOT IN ('delta','done','error') OR p_sequence < 1
     OR p_content_ref IS NOT NULL AND p_content_ref !~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$'
     OR p_content_hash IS NOT NULL AND p_content_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'copilot_stream_event_invalid';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.atlas_runtime_jobs j
    WHERE j.tenant_id=p_tenant_id AND j.job_id=p_job_id AND j.job_type='agent.turn.execute'
      AND j.status='leased' AND j.lease_owner=p_worker_id AND j.lease_until>now()
      AND j.payload_ref->>'executionId'=p_execution_id::text
  ) THEN RAISE EXCEPTION 'worker_job_lease_invalid'; END IF;
  INSERT INTO public.atlas_v153_copilot_stream_events(tenant_id,execution_id,sequence,event_type,content_ref,content_hash)
  VALUES(p_tenant_id,p_execution_id,p_sequence,p_event_type,p_content_ref,p_content_hash)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS ok = ROW_COUNT;
  RETURN ok;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v153_public_state(
  p_tenant_id UUID,p_session_id UUID,p_execution_id UUID DEFAULT NULL
) RETURNS TABLE(
  conversation_id UUID, execution_id UUID, execution_status TEXT, execution_version INTEGER,
  message_id UUID, message_direction TEXT, content_ref TEXT, created_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  RETURN QUERY
  SELECT c.conversation_id,e.execution_id,e.status,e.version,m.message_id,m.direction,m.content_ref,m.created_at
  FROM public.atlas_v153_copilot_sessions s
  JOIN public.atlas_v122_conversations c
    ON c.tenant_id=s.tenant_id AND c.external_thread_ref='copilot:'||s.session_id::text
  LEFT JOIN public.atlas_agent_turn_executions e
    ON e.tenant_id=s.tenant_id AND e.session_id=s.session_id
   AND (p_execution_id IS NULL OR e.execution_id=p_execution_id)
  LEFT JOIN public.atlas_v122_messages m
    ON m.tenant_id=c.tenant_id AND m.conversation_id=c.conversation_id
  WHERE s.tenant_id=p_tenant_id AND s.session_id=p_session_id AND s.revoked_at IS NULL AND s.expires_at>now()
  ORDER BY m.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v153_request_handoff(
  p_tenant_id UUID,p_session_id UUID,p_reason TEXT,p_handoff_id UUID,p_queue_ref TEXT
) RETURNS TABLE(conversation_id UUID,handoff_id UUID,status TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_conversation UUID;
BEGIN
  IF p_reason NOT IN ('caller_requested_human','billing_help','appointment_help','sensitive_request','low_confidence','tool_failure','language_mismatch','urgent_safety','other')
     OR p_queue_ref IS NULL OR p_queue_ref !~ '^[A-Za-z0-9_.:/@+-]{3,160}$' THEN RAISE EXCEPTION 'copilot_handoff_invalid'; END IF;
  SELECT c.conversation_id INTO v_conversation
  FROM public.atlas_v153_copilot_sessions s JOIN public.atlas_v122_conversations c
    ON c.tenant_id=s.tenant_id AND c.external_thread_ref='copilot:'||s.session_id::text
  WHERE s.tenant_id=p_tenant_id AND s.session_id=p_session_id AND s.revoked_at IS NULL AND s.expires_at>now();
  IF v_conversation IS NULL THEN RAISE EXCEPTION 'copilot_session_not_found'; END IF;
  INSERT INTO public.atlas_agent_handoffs(tenant_id,handoff_id,session_id,reason,queue_ref,status,checksum)
  VALUES(p_tenant_id,p_handoff_id,p_session_id,p_reason,p_queue_ref,'pending',
    encode(digest(p_tenant_id::text||':'||p_session_id::text||':'||p_reason||':'||p_queue_ref,'sha256'),'hex'))
  ON CONFLICT DO NOTHING;
  UPDATE public.atlas_v122_conversations
  SET status='open',handoff_reason=p_reason,updated_at=now(),version=version+1
  WHERE tenant_id=p_tenant_id AND conversation_id=v_conversation;
  RETURN QUERY SELECT v_conversation,p_handoff_id,'pending';
END;
$$;

REVOKE ALL ON atlas_v153_copilot_configs,atlas_v153_copilot_sessions,atlas_v153_copilot_stream_events FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v153_create_public_session(TEXT,UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v153_prepare_public_turn(UUID,UUID,UUID,UUID,TEXT,CHAR(64),TEXT,UUID,UUID,CHAR(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v153_append_stream_event(UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,CHAR(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v153_public_state(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v153_request_handoff(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;

COMMIT;
