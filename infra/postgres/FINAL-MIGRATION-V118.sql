-- Atlas V118: durable provider connections, encrypted OAuth state, webhook ingress,
-- provider tasks, external-to-Atlas mappings and narrow worker integration functions.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_integration_connections (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id ~ '^[a-z][a-z0-9-]{1,79}$'),
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('oauth2','api_key','webhook')),
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('pending','connected','needs_reauth','error','disconnected')),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  external_account_id TEXT CHECK (external_account_id IS NULL OR length(external_account_id) BETWEEN 1 AND 512),
  external_account_name TEXT CHECK (external_account_name IS NULL OR length(external_account_name) BETWEEN 1 AND 240),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  secret_ciphertext TEXT CHECK (secret_ciphertext IS NULL OR length(secret_ciphertext) BETWEEN 16 AND 128000),
  config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config)='object' AND octet_length(config::text) <= 32000),
  webhook_key_hash CHAR(64) CHECK (webhook_key_hash IS NULL OR webhook_key_hash ~ '^[a-f0-9]{64}$'),
  last_health_status TEXT CHECK (last_health_status IS NULL OR last_health_status IN ('healthy','unhealthy','unknown')),
  last_health_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  created_by UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id),
  UNIQUE (tenant_id, provider_id, external_account_id),
  UNIQUE (webhook_key_hash)
);
ALTER TABLE atlas_integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_integration_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_integration_connections_tenant ON atlas_integration_connections;
CREATE POLICY atlas_integration_connections_tenant ON atlas_integration_connections
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid
    OR current_user IN ('atlas_worker','atlas_integration_ingress')
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid
    OR current_user IN ('atlas_worker','atlas_integration_ingress')
  );
CREATE INDEX IF NOT EXISTS idx_atlas_integration_connections_tenant ON atlas_integration_connections(tenant_id,provider_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS atlas_integration_oauth_states (
  state_hash CHAR(64) PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES atlas_auth_users(user_id),
  provider_id TEXT NOT NULL CHECK (provider_id ~ '^[a-z][a-z0-9-]{1,79}$'),
  redirect_uri TEXT NOT NULL CHECK (length(redirect_uri) BETWEEN 12 AND 2048),
  code_verifier_ciphertext TEXT NOT NULL CHECK (length(code_verifier_ciphertext) BETWEEN 16 AND 128000),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE atlas_integration_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_integration_oauth_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_integration_oauth_states_tenant ON atlas_integration_oauth_states;
CREATE POLICY atlas_integration_oauth_states_tenant ON atlas_integration_oauth_states
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'));
CREATE INDEX IF NOT EXISTS idx_atlas_integration_oauth_states_expiry ON atlas_integration_oauth_states(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS atlas_integration_mappings (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  provider_object_type TEXT NOT NULL CHECK (provider_object_type ~ '^[A-Za-z][A-Za-z0-9_.-]{0,79}$'),
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 512),
  atlas_module TEXT NOT NULL CHECK (atlas_module ~ '^[a-z][a-z0-9-]{0,79}$'),
  atlas_item_id UUID NOT NULL,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id, provider_object_type, external_id),
  UNIQUE (connection_id, provider_object_type, atlas_item_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES atlas_integration_connections(tenant_id, connection_id) ON DELETE CASCADE
);
ALTER TABLE atlas_integration_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_integration_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_integration_mappings_tenant ON atlas_integration_mappings;
CREATE POLICY atlas_integration_mappings_tenant ON atlas_integration_mappings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'));
CREATE INDEX IF NOT EXISTS idx_atlas_integration_mappings_item ON atlas_integration_mappings(tenant_id,atlas_module,atlas_item_id);

CREATE TABLE IF NOT EXISTS atlas_integration_webhook_events (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  webhook_event_id UUID NOT NULL,
  external_event_key CHAR(64) NOT NULL CHECK (external_event_key ~ '^[a-f0-9]{64}$'),
  provider_event_type TEXT NOT NULL CHECK (provider_event_type ~ '^[A-Za-z][A-Za-z0-9_.-]{0,119}$'),
  external_object_id TEXT CHECK (external_object_id IS NULL OR length(external_object_id) BETWEEN 1 AND 512),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text) <= 256000),
  process_status TEXT NOT NULL DEFAULT 'accepted' CHECK (process_status IN ('accepted','queued','applied','ignored','failed')),
  processed_at TIMESTAMPTZ,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,webhook_event_id),
  UNIQUE (connection_id,external_event_key),
  FOREIGN KEY (tenant_id,connection_id) REFERENCES atlas_integration_connections(tenant_id,connection_id) ON DELETE CASCADE
);
ALTER TABLE atlas_integration_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_integration_webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_integration_webhook_events_tenant ON atlas_integration_webhook_events;
CREATE POLICY atlas_integration_webhook_events_tenant ON atlas_integration_webhook_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'));
CREATE INDEX IF NOT EXISTS idx_atlas_integration_webhook_events_pending ON atlas_integration_webhook_events(tenant_id,process_status,received_at) WHERE process_status IN ('accepted','queued','failed');

CREATE TABLE IF NOT EXISTS atlas_integration_tasks (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  request JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request)='object' AND octet_length(request::text) <= 256000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','retryable','dead_letter','canceled')),
  result JSONB CHECK (result IS NULL OR (jsonb_typeof(result)='object' AND octet_length(result::text) <= 256000)),
  idempotency_key CHAR(64) NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES atlas_auth_users(user_id),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,task_id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,connection_id) REFERENCES atlas_integration_connections(tenant_id,connection_id) ON DELETE CASCADE
);
ALTER TABLE atlas_integration_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_integration_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_integration_tasks_tenant ON atlas_integration_tasks;
CREATE POLICY atlas_integration_tasks_tenant ON atlas_integration_tasks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'));
CREATE INDEX IF NOT EXISTS idx_atlas_integration_tasks_queue ON atlas_integration_tasks(tenant_id,status,updated_at) WHERE status IN ('queued','retryable');

CREATE TABLE IF NOT EXISTS atlas_integration_deliveries (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,119}

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_integration_ingress') THEN
    CREATE ROLE atlas_integration_ingress NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE atlas_integration_ingress NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION atlas_v118_consume_oauth_state(p_state_hash CHAR(64))
RETURNS TABLE(tenant_id UUID,actor_id UUID,provider_id TEXT,redirect_uri TEXT,code_verifier_ciphertext TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row public.atlas_integration_oauth_states%ROWTYPE;
BEGIN
  IF p_state_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'oauth_state_invalid'; END IF;
  SELECT * INTO row FROM public.atlas_integration_oauth_states
    WHERE state_hash=p_state_hash AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oauth_state_invalid'; END IF;
  UPDATE public.atlas_integration_oauth_states SET consumed_at=now() WHERE state_hash=p_state_hash;
  tenant_id:=row.tenant_id; actor_id:=row.actor_id; provider_id:=row.provider_id;
  redirect_uri:=row.redirect_uri; code_verifier_ciphertext:=row.code_verifier_ciphertext;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_get_growth_record(p_tenant_id UUID,p_item_id UUID)
RETURNS TABLE(item_id UUID,module_key TEXT,title TEXT,state TEXT,version INTEGER,payload JSONB,checksum CHAR(64),created_by UUID,updated_by UUID,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $
BEGIN
  IF current_user NOT IN ('atlas_worker','atlas_integration_ingress') THEN RAISE EXCEPTION 'integration_worker_required'; END IF;
  RETURN QUERY SELECT g.item_id,g.module_key,g.title,g.state,g.version,g.payload,g.checksum,g.created_by,g.updated_by,g.created_at,g.updated_at
  FROM public.atlas_growth_items g
  WHERE g.tenant_id=p_tenant_id AND g.item_id=p_item_id;
END;
$;

CREATE OR REPLACE FUNCTION atlas_v118_get_integration_contact(
  p_tenant_id UUID,p_connection_id UUID,p_external_id TEXT
)
RETURNS TABLE(
  atlas_item_id UUID,module_key TEXT,title TEXT,state TEXT,version INTEGER,payload JSONB,checksum CHAR(64),
  created_by UUID,updated_by UUID,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,source_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_user NOT IN ('atlas_worker','atlas_integration_ingress') THEN RAISE EXCEPTION 'integration_worker_required'; END IF;
  RETURN QUERY
  SELECT m.atlas_item_id,g.module_key,g.title,g.state,g.version,g.payload,g.checksum,g.created_by,g.updated_by,g.created_at,g.updated_at,m.source_updated_at
  FROM public.atlas_integration_mappings m
  JOIN public.atlas_growth_items g ON g.tenant_id=m.tenant_id AND g.item_id=m.atlas_item_id
  WHERE m.tenant_id=p_tenant_id AND m.connection_id=p_connection_id AND m.provider_object_type='Client' AND m.external_id=p_external_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_upsert_integration_contact(
  p_tenant_id UUID,p_connection_id UUID,p_external_id TEXT,p_source_updated_at TIMESTAMPTZ,p_record JSONB
)
RETURNS TABLE(result_code TEXT,atlas_item_id UUID,version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  existing_map public.atlas_integration_mappings%ROWTYPE;
  old_version INTEGER;
  item UUID;
  actor UUID;
  event_id UUID;
  record_tenant UUID;
  record_actor UUID;
  record_module TEXT;
  record_version INTEGER;
BEGIN
  IF current_user NOT IN ('atlas_worker','atlas_integration_ingress') THEN RAISE EXCEPTION 'integration_worker_required'; END IF;
  IF p_record IS NULL OR jsonb_typeof(p_record)<>'object' THEN RAISE EXCEPTION 'integration_record_invalid'; END IF;
  record_tenant:=NULLIF(p_record->>'tenantId','')::uuid;
  record_actor:=NULLIF(p_record->>'actorId','')::uuid;
  record_module:=p_record->>'module';
  record_version=NULLIF(p_record->>'version','')::integer;
  item=NULLIF(p_record->>'id','')::uuid;
  actor:=record_actor;
  IF record_tenant IS DISTINCT FROM p_tenant_id OR record_module <> 'contacts' OR item IS NULL OR record_version IS NULL OR record_version<1 THEN RAISE EXCEPTION 'integration_record_scope_invalid'; END IF;
  IF actor IS NULL OR octet_length(p_record->>'checksum') <> 64 OR p_record->>'checksum' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'integration_record_integrity_invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.atlas_integration_connections c WHERE c.tenant_id=p_tenant_id AND c.connection_id=p_connection_id AND c.status IN ('connected','needs_reauth','error')) THEN
    RAISE EXCEPTION 'integration_connection_not_found';
  END IF;
  SELECT * INTO existing_map FROM public.atlas_integration_mappings
    WHERE tenant_id=p_tenant_id AND connection_id=p_connection_id AND provider_object_type='Client' AND external_id=p_external_id FOR UPDATE;
  mapping_found := FOUND;
  PERFORM set_config('app.tenant_id',p_tenant_id::text,true);
  PERFORM set_config('app.actor_id',actor::text,true);
  IF mapping_found AND existing_map.source_updated_at IS NOT NULL AND p_source_updated_at IS NOT NULL AND p_source_updated_at <= existing_map.source_updated_at THEN
    result_code:='skipped'; atlas_item_id:=existing_map.atlas_item_id;
    SELECT g.version INTO version FROM public.atlas_growth_items g WHERE g.tenant_id=p_tenant_id AND g.item_id=existing_map.atlas_item_id;
    RETURN NEXT; RETURN;
  END IF;
  IF existing_map.atlas_item_id IS NOT NULL THEN
    IF item <> existing_map.atlas_item_id THEN RAISE EXCEPTION 'integration_mapping_conflict'; END IF;
    SELECT g.version INTO old_version FROM public.atlas_growth_items g WHERE g.tenant_id=p_tenant_id AND g.item_id=item FOR UPDATE;
    IF old_version IS NULL OR record_version <> old_version+1 THEN RAISE EXCEPTION 'integration_version_conflict'; END IF;
    UPDATE public.atlas_growth_items SET
      title=p_record->>'title',state=p_record->>'state',version=record_version,payload=p_record->'payload',
      checksum=p_record->>'checksum',updated_by=actor,updated_at=(p_record->>'updatedAt')::timestamptz
      WHERE tenant_id=p_tenant_id AND item_id=item;
    result_code:='updated';
  ELSE
    INSERT INTO public.atlas_growth_items(
      tenant_id,item_id,module_key,title,state,version,payload,checksum,created_by,updated_by,idempotency_key,created_at,updated_at
    ) VALUES (
      p_tenant_id,item,record_module,p_record->>'title',p_record->>'state',record_version,p_record->'payload',p_record->>'checksum',
      actor,actor,NULL,(p_record->>'createdAt')::timestamptz,(p_record->>'updatedAt')::timestamptz
    );
    result_code:='created';
  END IF;
  INSERT INTO public.atlas_growth_item_versions(
    tenant_id,item_id,version,module_key,title,state,payload,checksum,actor_id,created_at
  ) VALUES (
    p_tenant_id,item,record_version,record_module,p_record->>'title',p_record->>'state',p_record->'payload',p_record->>'checksum',
    actor,(p_record->>'updatedAt')::timestamptz
  ) ON CONFLICT (tenant_id,item_id,version) DO NOTHING;
  INSERT INTO public.atlas_integration_mappings(
    tenant_id,connection_id,provider_object_type,external_id,atlas_module,atlas_item_id,source_updated_at
  ) VALUES (p_tenant_id,p_connection_id,'Client',p_external_id,'contacts',item,p_source_updated_at)
  ON CONFLICT (tenant_id,connection_id,'Client',external_id) DO UPDATE SET
    atlas_item_id=EXCLUDED.atlas_item_id,source_updated_at=EXCLUDED.source_updated_at,updated_at=now();
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_growth_item_events(
    tenant_id,event_id,item_id,actor_id,module_key,action,version,metadata
  ) VALUES (
    p_tenant_id,event_id,item,actor,'contacts','integration_upserted',record_version,
    jsonb_build_object('connectionId',p_connection_id,'providerObjectType','Client','externalId',p_external_id)
  ) ON CONFLICT (tenant_id,event_id) DO NOTHING;
  PERFORM atlas_v115_append_outbox_event(
    p_tenant_id,event_id,'contacts.integration_upserted',
    jsonb_build_object('kind','contacts','id',item::text,'version',record_version)
  );
  atlas_item_id:=item; version:=record_version;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_ingest_jobber_webhook(
  p_account_id TEXT,p_external_event_key CHAR(64),p_topic TEXT,p_external_object_id TEXT,p_payload JSONB
)
RETURNS TABLE(tenant_id UUID,connection_id UUID,webhook_event_id UUID,duplicate BOOLEAN,queued BOOLEAN,disconnected BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  connection public.atlas_integration_connections%ROWTYPE;
  event_id UUID;
  task_id UUID;
  queue_key CHAR(64);
  operation TEXT;
  inserted BOOLEAN:=FALSE;
  mapping_found BOOLEAN:=FALSE;
BEGIN
  IF current_user <> 'atlas_integration_ingress' THEN RAISE EXCEPTION 'integration_ingress_required'; END IF;
  IF p_account_id IS NULL OR length(p_account_id) NOT BETWEEN 1 AND 512
    OR p_external_event_key !~ '^[a-f0-9]{64}$'
    OR p_topic IS NULL OR p_topic !~ '^[A-Za-z][A-Za-z0-9_-]{0,119}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'jobber_webhook_invalid';
  END IF;
  SELECT * INTO connection FROM public.atlas_integration_connections
    WHERE provider_id='jobber' AND external_account_id=p_account_id AND status <> 'disconnected'
    ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration_connection_not_found'; END IF;
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_integration_webhook_events(
    tenant_id,connection_id,webhook_event_id,external_event_key,provider_event_type,external_object_id,payload
  ) VALUES (
    connection.tenant_id,connection.connection_id,event_id,p_external_event_key,p_topic,p_external_object_id,p_payload
  )
  ON CONFLICT (connection_id,external_event_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT tenant_id,connection_id,webhook_event_id INTO tenant_id,connection_id,webhook_event_id
      FROM public.atlas_integration_webhook_events
      WHERE connection_id=connection.connection_id AND external_event_key=p_external_event_key;
    duplicate:=TRUE; queued:=FALSE; disconnected:=FALSE; RETURN NEXT; RETURN;
  END IF;
  tenant_id:=connection.tenant_id; connection_id:=connection.connection_id; webhook_event_id:=event_id;
  IF p_topic='APP_DISCONNECT' THEN
    UPDATE public.atlas_integration_connections SET status='disconnected',secret_ciphertext=NULL,last_health_status='unhealthy',
      last_health_at=now(),last_error_code='provider_disconnect',updated_at=now()
      WHERE tenant_id=connection.tenant_id AND connection_id=connection.connection_id;
    UPDATE public.atlas_integration_webhook_events SET process_status='applied',processed_at=now()
      WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    duplicate:=FALSE; queued:=FALSE; disconnected:=TRUE; RETURN NEXT; RETURN;
  END IF;
  IF p_topic IN ('CLIENT_CREATE','CLIENT_UPDATE','CLIENT_ARCHIVE','CLIENT_RESTORE') THEN
    operation:='jobber.sync_client';
    task_id:=gen_random_uuid();
    queue_key:=encode(digest(('jobber-webhook:'||connection.connection_id::text||':'||p_external_event_key),'sha256'),'hex');
    PERFORM set_config('app.tenant_id',connection.tenant_id::text,true);
    PERFORM set_config('app.actor_id',connection.created_by::text,true);
    INSERT INTO public.atlas_integration_tasks(
      tenant_id,task_id,connection_id,operation,request,status,idempotency_key,created_by
    ) VALUES (
      connection.tenant_id,task_id,connection.connection_id,operation,
      jsonb_build_object('externalId',p_external_object_id,'topic',p_topic,'webhookEventId',event_id),
      'queued',queue_key,connection.created_by
    ) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING;
    IF FOUND THEN
      PERFORM atlas_v115_enqueue_job(
        connection.tenant_id,task_id,'integration.execute',
        jsonb_build_object('kind','integration_task','id',task_id::text,'version',1),
        queue_key,now(),8
      );
      UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
      queued:=TRUE;
    ELSE
      UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
      queued:=FALSE;
    END IF;
  ELSE
    UPDATE public.atlas_integration_webhook_events SET process_status='ignored',processed_at=now() WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    queued:=FALSE;
  END IF;
  duplicate:=FALSE; disconnected:=FALSE;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_ingest_zapier_webhook(
  p_webhook_key_hash CHAR(64),p_external_event_key CHAR(64),p_payload JSONB
)
RETURNS TABLE(tenant_id UUID,connection_id UUID,webhook_event_id UUID,duplicate BOOLEAN,queued BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  connection public.atlas_integration_connections%ROWTYPE;
  event_id UUID;
  task_id UUID;
  queue_key CHAR(64);
BEGIN
  IF current_user <> 'atlas_integration_ingress' THEN RAISE EXCEPTION 'integration_ingress_required'; END IF;
  IF p_webhook_key_hash !~ '^[a-f0-9]{64}$' OR p_external_event_key !~ '^[a-f0-9]{64}$' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'zapier_webhook_invalid'; END IF;
  SELECT * INTO connection FROM public.atlas_integration_connections
    WHERE provider_id='zapier' AND auth_mode='webhook' AND status='connected' AND webhook_key_hash=p_webhook_key_hash LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration_connection_not_found'; END IF;
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_integration_webhook_events(
    tenant_id,connection_id,webhook_event_id,external_event_key,provider_event_type,payload
  ) VALUES (
    connection.tenant_id,connection.connection_id,event_id,p_external_event_key,'hook.received',p_payload
  ) ON CONFLICT(connection_id,external_event_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT tenant_id,connection_id,webhook_event_id INTO tenant_id,connection_id,webhook_event_id
      FROM public.atlas_integration_webhook_events WHERE connection_id=connection.connection_id AND external_event_key=p_external_event_key;
    duplicate:=TRUE; queued:=FALSE; RETURN NEXT; RETURN;
  END IF;
  task_id:=gen_random_uuid();
  queue_key:=encode(digest(('zapier-webhook:'||connection.connection_id::text||':'||p_external_event_key),'sha256'),'hex');
  PERFORM set_config('app.tenant_id',connection.tenant_id::text,true);
  PERFORM set_config('app.actor_id',connection.created_by::text,true);
  INSERT INTO public.atlas_integration_tasks(
    tenant_id,task_id,connection_id,operation,request,status,idempotency_key,created_by
  ) VALUES (
    connection.tenant_id,task_id,connection.connection_id,'zapier.receive',jsonb_build_object('webhookEventId',event_id,'payload',p_payload),
    'queued',queue_key,connection.created_by
  ) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING;
  IF FOUND THEN
    PERFORM atlas_v115_enqueue_job(
      connection.tenant_id,task_id,'integration.execute',
      jsonb_build_object('kind','integration_task','id',task_id::text,'version',1),
      queue_key,now(),8
    );
    UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    queued:=TRUE;
  ELSE
    queued:=FALSE;
  END IF;
  tenant_id:=connection.tenant_id; connection_id:=connection.connection_id; webhook_event_id:=event_id; duplicate:=FALSE;
  RETURN NEXT;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_app') THEN
    GRANT USAGE ON SCHEMA public TO atlas_integration_ingress;
    GRANT SELECT,INSERT,UPDATE ON atlas_integration_connections,atlas_integration_oauth_states,atlas_integration_mappings,atlas_integration_webhook_events,atlas_integration_tasks,atlas_integration_deliveries TO atlas_integration_ingress;
    GRANT SELECT,INSERT,UPDATE ON atlas_growth_items TO atlas_integration_ingress;
    GRANT SELECT,INSERT,UPDATE ON atlas_integration_deliveries TO atlas_integration_ingress;
    GRANT SELECT,INSERT ON atlas_growth_item_versions,atlas_growth_item_events TO atlas_integration_ingress;
    GRANT INSERT ON atlas_event_outbox TO atlas_integration_ingress;
    GRANT EXECUTE ON FUNCTION atlas_v115_append_outbox_event(UUID,UUID,TEXT,JSONB) TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_get_growth_record(UUID,UUID) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_consume_oauth_state(CHAR) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_get_integration_contact(UUID,UUID,TEXT) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_upsert_integration_contact(UUID,UUID,TEXT,TIMESTAMPTZ,JSONB) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_ingest_jobber_webhook(TEXT,CHAR,TEXT,TEXT,JSONB) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_ingest_zapier_webhook(CHAR,CHAR,JSONB) OWNER TO atlas_integration_ingress;
  END IF;
END
$$;

REVOKE ALL ON atlas_integration_connections,atlas_integration_oauth_states,atlas_integration_mappings,atlas_integration_webhook_events,atlas_integration_tasks,atlas_integration_deliveries FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_get_growth_record(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_consume_oauth_state(CHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_get_integration_contact(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_upsert_integration_contact(UUID,UUID,TEXT,TIMESTAMPTZ,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_ingest_jobber_webhook(TEXT,CHAR,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_ingest_zapier_webhook(CHAR,CHAR,JSONB) FROM PUBLIC;

COMMIT;
),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','skipped')),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 32),
  response_status INTEGER CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_.-]{0,79}

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_integration_ingress') THEN
    CREATE ROLE atlas_integration_ingress NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE atlas_integration_ingress NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION atlas_v118_consume_oauth_state(p_state_hash CHAR(64))
RETURNS TABLE(tenant_id UUID,actor_id UUID,provider_id TEXT,redirect_uri TEXT,code_verifier_ciphertext TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row public.atlas_integration_oauth_states%ROWTYPE;
BEGIN
  IF p_state_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'oauth_state_invalid'; END IF;
  SELECT * INTO row FROM public.atlas_integration_oauth_states
    WHERE state_hash=p_state_hash AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oauth_state_invalid'; END IF;
  UPDATE public.atlas_integration_oauth_states SET consumed_at=now() WHERE state_hash=p_state_hash;
  tenant_id:=row.tenant_id; actor_id:=row.actor_id; provider_id:=row.provider_id;
  redirect_uri:=row.redirect_uri; code_verifier_ciphertext:=row.code_verifier_ciphertext;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_get_integration_contact(
  p_tenant_id UUID,p_connection_id UUID,p_external_id TEXT
)
RETURNS TABLE(
  atlas_item_id UUID,module_key TEXT,title TEXT,state TEXT,version INTEGER,payload JSONB,checksum CHAR(64),
  created_by UUID,updated_by UUID,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,source_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_user NOT IN ('atlas_worker','atlas_integration_ingress') THEN RAISE EXCEPTION 'integration_worker_required'; END IF;
  RETURN QUERY
  SELECT m.atlas_item_id,g.module_key,g.title,g.state,g.version,g.payload,g.checksum,g.created_by,g.updated_by,g.created_at,g.updated_at,m.source_updated_at
  FROM public.atlas_integration_mappings m
  JOIN public.atlas_growth_items g ON g.tenant_id=m.tenant_id AND g.item_id=m.atlas_item_id
  WHERE m.tenant_id=p_tenant_id AND m.connection_id=p_connection_id AND m.provider_object_type='Client' AND m.external_id=p_external_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_upsert_integration_contact(
  p_tenant_id UUID,p_connection_id UUID,p_external_id TEXT,p_source_updated_at TIMESTAMPTZ,p_record JSONB
)
RETURNS TABLE(result_code TEXT,atlas_item_id UUID,version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  existing_map public.atlas_integration_mappings%ROWTYPE;
  old_version INTEGER;
  item UUID;
  actor UUID;
  event_id UUID;
  record_tenant UUID;
  record_actor UUID;
  record_module TEXT;
  record_version INTEGER;
BEGIN
  IF current_user NOT IN ('atlas_worker','atlas_integration_ingress') THEN RAISE EXCEPTION 'integration_worker_required'; END IF;
  IF p_record IS NULL OR jsonb_typeof(p_record)<>'object' THEN RAISE EXCEPTION 'integration_record_invalid'; END IF;
  record_tenant:=NULLIF(p_record->>'tenantId','')::uuid;
  record_actor:=NULLIF(p_record->>'actorId','')::uuid;
  record_module:=p_record->>'module';
  record_version=NULLIF(p_record->>'version','')::integer;
  item=NULLIF(p_record->>'id','')::uuid;
  actor:=record_actor;
  IF record_tenant IS DISTINCT FROM p_tenant_id OR record_module <> 'contacts' OR item IS NULL OR record_version IS NULL OR record_version<1 THEN RAISE EXCEPTION 'integration_record_scope_invalid'; END IF;
  IF actor IS NULL OR octet_length(p_record->>'checksum') <> 64 OR p_record->>'checksum' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'integration_record_integrity_invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.atlas_integration_connections c WHERE c.tenant_id=p_tenant_id AND c.connection_id=p_connection_id AND c.status IN ('connected','needs_reauth','error')) THEN
    RAISE EXCEPTION 'integration_connection_not_found';
  END IF;
  SELECT * INTO existing_map FROM public.atlas_integration_mappings
    WHERE tenant_id=p_tenant_id AND connection_id=p_connection_id AND provider_object_type='Client' AND external_id=p_external_id FOR UPDATE;
  mapping_found := FOUND;
  PERFORM set_config('app.tenant_id',p_tenant_id::text,true);
  PERFORM set_config('app.actor_id',actor::text,true);
  IF mapping_found AND existing_map.source_updated_at IS NOT NULL AND p_source_updated_at IS NOT NULL AND p_source_updated_at <= existing_map.source_updated_at THEN
    result_code:='skipped'; atlas_item_id:=existing_map.atlas_item_id;
    SELECT g.version INTO version FROM public.atlas_growth_items g WHERE g.tenant_id=p_tenant_id AND g.item_id=existing_map.atlas_item_id;
    RETURN NEXT; RETURN;
  END IF;
  IF existing_map.atlas_item_id IS NOT NULL THEN
    IF item <> existing_map.atlas_item_id THEN RAISE EXCEPTION 'integration_mapping_conflict'; END IF;
    SELECT g.version INTO old_version FROM public.atlas_growth_items g WHERE g.tenant_id=p_tenant_id AND g.item_id=item FOR UPDATE;
    IF old_version IS NULL OR record_version <> old_version+1 THEN RAISE EXCEPTION 'integration_version_conflict'; END IF;
    UPDATE public.atlas_growth_items SET
      title=p_record->>'title',state=p_record->>'state',version=record_version,payload=p_record->'payload',
      checksum=p_record->>'checksum',updated_by=actor,updated_at=(p_record->>'updatedAt')::timestamptz
      WHERE tenant_id=p_tenant_id AND item_id=item;
    result_code:='updated';
  ELSE
    INSERT INTO public.atlas_growth_items(
      tenant_id,item_id,module_key,title,state,version,payload,checksum,created_by,updated_by,idempotency_key,created_at,updated_at
    ) VALUES (
      p_tenant_id,item,record_module,p_record->>'title',p_record->>'state',record_version,p_record->'payload',p_record->>'checksum',
      actor,actor,NULL,(p_record->>'createdAt')::timestamptz,(p_record->>'updatedAt')::timestamptz
    );
    result_code:='created';
  END IF;
  INSERT INTO public.atlas_growth_item_versions(
    tenant_id,item_id,version,module_key,title,state,payload,checksum,actor_id,created_at
  ) VALUES (
    p_tenant_id,item,record_version,record_module,p_record->>'title',p_record->>'state',p_record->'payload',p_record->>'checksum',
    actor,(p_record->>'updatedAt')::timestamptz
  ) ON CONFLICT (tenant_id,item_id,version) DO NOTHING;
  INSERT INTO public.atlas_integration_mappings(
    tenant_id,connection_id,provider_object_type,external_id,atlas_module,atlas_item_id,source_updated_at
  ) VALUES (p_tenant_id,p_connection_id,'Client',p_external_id,'contacts',item,p_source_updated_at)
  ON CONFLICT (tenant_id,connection_id,'Client',external_id) DO UPDATE SET
    atlas_item_id=EXCLUDED.atlas_item_id,source_updated_at=EXCLUDED.source_updated_at,updated_at=now();
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_growth_item_events(
    tenant_id,event_id,item_id,actor_id,module_key,action,version,metadata
  ) VALUES (
    p_tenant_id,event_id,item,actor,'contacts','integration_upserted',record_version,
    jsonb_build_object('connectionId',p_connection_id,'providerObjectType','Client','externalId',p_external_id)
  ) ON CONFLICT (tenant_id,event_id) DO NOTHING;
  PERFORM atlas_v115_append_outbox_event(
    p_tenant_id,event_id,'contacts.integration_upserted',
    jsonb_build_object('kind','contacts','id',item::text,'version',record_version)
  );
  atlas_item_id:=item; version:=record_version;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_ingest_jobber_webhook(
  p_account_id TEXT,p_external_event_key CHAR(64),p_topic TEXT,p_external_object_id TEXT,p_payload JSONB
)
RETURNS TABLE(tenant_id UUID,connection_id UUID,webhook_event_id UUID,duplicate BOOLEAN,queued BOOLEAN,disconnected BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  connection public.atlas_integration_connections%ROWTYPE;
  event_id UUID;
  task_id UUID;
  queue_key CHAR(64);
  operation TEXT;
  inserted BOOLEAN:=FALSE;
  mapping_found BOOLEAN:=FALSE;
BEGIN
  IF current_user <> 'atlas_integration_ingress' THEN RAISE EXCEPTION 'integration_ingress_required'; END IF;
  IF p_account_id IS NULL OR length(p_account_id) NOT BETWEEN 1 AND 512
    OR p_external_event_key !~ '^[a-f0-9]{64}$'
    OR p_topic IS NULL OR p_topic !~ '^[A-Za-z][A-Za-z0-9_-]{0,119}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'jobber_webhook_invalid';
  END IF;
  SELECT * INTO connection FROM public.atlas_integration_connections
    WHERE provider_id='jobber' AND external_account_id=p_account_id AND status <> 'disconnected'
    ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration_connection_not_found'; END IF;
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_integration_webhook_events(
    tenant_id,connection_id,webhook_event_id,external_event_key,provider_event_type,external_object_id,payload
  ) VALUES (
    connection.tenant_id,connection.connection_id,event_id,p_external_event_key,p_topic,p_external_object_id,p_payload
  )
  ON CONFLICT (connection_id,external_event_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT tenant_id,connection_id,webhook_event_id INTO tenant_id,connection_id,webhook_event_id
      FROM public.atlas_integration_webhook_events
      WHERE connection_id=connection.connection_id AND external_event_key=p_external_event_key;
    duplicate:=TRUE; queued:=FALSE; disconnected:=FALSE; RETURN NEXT; RETURN;
  END IF;
  tenant_id:=connection.tenant_id; connection_id:=connection.connection_id; webhook_event_id:=event_id;
  IF p_topic='APP_DISCONNECT' THEN
    UPDATE public.atlas_integration_connections SET status='disconnected',secret_ciphertext=NULL,last_health_status='unhealthy',
      last_health_at=now(),last_error_code='provider_disconnect',updated_at=now()
      WHERE tenant_id=connection.tenant_id AND connection_id=connection.connection_id;
    UPDATE public.atlas_integration_webhook_events SET process_status='applied',processed_at=now()
      WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    duplicate:=FALSE; queued:=FALSE; disconnected:=TRUE; RETURN NEXT; RETURN;
  END IF;
  IF p_topic IN ('CLIENT_CREATE','CLIENT_UPDATE','CLIENT_ARCHIVE','CLIENT_RESTORE') THEN
    operation:='jobber.sync_client';
    task_id:=gen_random_uuid();
    queue_key:=encode(digest(('jobber-webhook:'||connection.connection_id::text||':'||p_external_event_key),'sha256'),'hex');
    PERFORM set_config('app.tenant_id',connection.tenant_id::text,true);
    PERFORM set_config('app.actor_id',connection.created_by::text,true);
    INSERT INTO public.atlas_integration_tasks(
      tenant_id,task_id,connection_id,operation,request,status,idempotency_key,created_by
    ) VALUES (
      connection.tenant_id,task_id,connection.connection_id,operation,
      jsonb_build_object('externalId',p_external_object_id,'topic',p_topic,'webhookEventId',event_id),
      'queued',queue_key,connection.created_by
    ) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING;
    IF FOUND THEN
      PERFORM atlas_v115_enqueue_job(
        connection.tenant_id,task_id,'integration.execute',
        jsonb_build_object('kind','integration_task','id',task_id::text,'version',1),
        queue_key,now(),8
      );
      UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
      queued:=TRUE;
    ELSE
      UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
      queued:=FALSE;
    END IF;
  ELSE
    UPDATE public.atlas_integration_webhook_events SET process_status='ignored',processed_at=now() WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    queued:=FALSE;
  END IF;
  duplicate:=FALSE; disconnected:=FALSE;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_ingest_zapier_webhook(
  p_webhook_key_hash CHAR(64),p_external_event_key CHAR(64),p_payload JSONB
)
RETURNS TABLE(tenant_id UUID,connection_id UUID,webhook_event_id UUID,duplicate BOOLEAN,queued BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  connection public.atlas_integration_connections%ROWTYPE;
  event_id UUID;
  task_id UUID;
  queue_key CHAR(64);
BEGIN
  IF current_user <> 'atlas_integration_ingress' THEN RAISE EXCEPTION 'integration_ingress_required'; END IF;
  IF p_webhook_key_hash !~ '^[a-f0-9]{64}$' OR p_external_event_key !~ '^[a-f0-9]{64}$' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'zapier_webhook_invalid'; END IF;
  SELECT * INTO connection FROM public.atlas_integration_connections
    WHERE provider_id='zapier' AND auth_mode='webhook' AND status='connected' AND webhook_key_hash=p_webhook_key_hash LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration_connection_not_found'; END IF;
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_integration_webhook_events(
    tenant_id,connection_id,webhook_event_id,external_event_key,provider_event_type,payload
  ) VALUES (
    connection.tenant_id,connection.connection_id,event_id,p_external_event_key,'hook.received',p_payload
  ) ON CONFLICT(connection_id,external_event_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT tenant_id,connection_id,webhook_event_id INTO tenant_id,connection_id,webhook_event_id
      FROM public.atlas_integration_webhook_events WHERE connection_id=connection.connection_id AND external_event_key=p_external_event_key;
    duplicate:=TRUE; queued:=FALSE; RETURN NEXT; RETURN;
  END IF;
  task_id:=gen_random_uuid();
  queue_key:=encode(digest(('zapier-webhook:'||connection.connection_id::text||':'||p_external_event_key),'sha256'),'hex');
  PERFORM set_config('app.tenant_id',connection.tenant_id::text,true);
  PERFORM set_config('app.actor_id',connection.created_by::text,true);
  INSERT INTO public.atlas_integration_tasks(
    tenant_id,task_id,connection_id,operation,request,status,idempotency_key,created_by
  ) VALUES (
    connection.tenant_id,task_id,connection.connection_id,'zapier.receive',jsonb_build_object('webhookEventId',event_id,'payload',p_payload),
    'queued',queue_key,connection.created_by
  ) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING;
  IF FOUND THEN
    PERFORM atlas_v115_enqueue_job(
      connection.tenant_id,task_id,'integration.execute',
      jsonb_build_object('kind','integration_task','id',task_id::text,'version',1),
      queue_key,now(),8
    );
    UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    queued:=TRUE;
  ELSE
    queued:=FALSE;
  END IF;
  tenant_id:=connection.tenant_id; connection_id:=connection.connection_id; webhook_event_id:=event_id; duplicate:=FALSE;
  RETURN NEXT;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_app') THEN
    GRANT USAGE ON SCHEMA public TO atlas_integration_ingress;
    GRANT SELECT,INSERT,UPDATE ON atlas_integration_connections,atlas_integration_oauth_states,atlas_integration_mappings,atlas_integration_webhook_events,atlas_integration_tasks TO atlas_integration_ingress;
    GRANT SELECT,INSERT,UPDATE ON atlas_growth_items TO atlas_integration_ingress;
    GRANT SELECT,INSERT ON atlas_growth_item_versions,atlas_growth_item_events TO atlas_integration_ingress;
    GRANT INSERT ON atlas_event_outbox TO atlas_integration_ingress;
    GRANT EXECUTE ON FUNCTION atlas_v115_append_outbox_event(UUID,UUID,TEXT,JSONB) TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_consume_oauth_state(CHAR) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_get_integration_contact(UUID,UUID,TEXT) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_upsert_integration_contact(UUID,UUID,TEXT,TIMESTAMPTZ,JSONB) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_ingest_jobber_webhook(TEXT,CHAR,TEXT,TEXT,JSONB) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_ingest_zapier_webhook(CHAR,CHAR,JSONB) OWNER TO atlas_integration_ingress;
  END IF;
END
$$;

REVOKE ALL ON atlas_integration_connections,atlas_integration_oauth_states,atlas_integration_mappings,atlas_integration_webhook_events,atlas_integration_tasks FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_consume_oauth_state(CHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_get_integration_contact(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_upsert_integration_contact(UUID,UUID,TEXT,TIMESTAMPTZ,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_ingest_jobber_webhook(TEXT,CHAR,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_ingest_zapier_webhook(CHAR,CHAR,JSONB) FROM PUBLIC;

COMMIT;
),
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id,event_id),
  FOREIGN KEY (tenant_id,connection_id) REFERENCES atlas_integration_connections(tenant_id,connection_id) ON DELETE CASCADE
);
ALTER TABLE atlas_integration_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_integration_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atlas_integration_deliveries_tenant ON atlas_integration_deliveries;
CREATE POLICY atlas_integration_deliveries_tenant ON atlas_integration_deliveries
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_user IN ('atlas_worker','atlas_integration_ingress'));
CREATE INDEX IF NOT EXISTS idx_atlas_integration_deliveries_status ON atlas_integration_deliveries(tenant_id,status,updated_at) WHERE status <> 'delivered';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_integration_ingress') THEN
    CREATE ROLE atlas_integration_ingress NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE atlas_integration_ingress NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION atlas_v118_consume_oauth_state(p_state_hash CHAR(64))
RETURNS TABLE(tenant_id UUID,actor_id UUID,provider_id TEXT,redirect_uri TEXT,code_verifier_ciphertext TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row public.atlas_integration_oauth_states%ROWTYPE;
BEGIN
  IF p_state_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'oauth_state_invalid'; END IF;
  SELECT * INTO row FROM public.atlas_integration_oauth_states
    WHERE state_hash=p_state_hash AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oauth_state_invalid'; END IF;
  UPDATE public.atlas_integration_oauth_states SET consumed_at=now() WHERE state_hash=p_state_hash;
  tenant_id:=row.tenant_id; actor_id:=row.actor_id; provider_id:=row.provider_id;
  redirect_uri:=row.redirect_uri; code_verifier_ciphertext:=row.code_verifier_ciphertext;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_get_integration_contact(
  p_tenant_id UUID,p_connection_id UUID,p_external_id TEXT
)
RETURNS TABLE(
  atlas_item_id UUID,module_key TEXT,title TEXT,state TEXT,version INTEGER,payload JSONB,checksum CHAR(64),
  created_by UUID,updated_by UUID,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,source_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_user NOT IN ('atlas_worker','atlas_integration_ingress') THEN RAISE EXCEPTION 'integration_worker_required'; END IF;
  RETURN QUERY
  SELECT m.atlas_item_id,g.module_key,g.title,g.state,g.version,g.payload,g.checksum,g.created_by,g.updated_by,g.created_at,g.updated_at,m.source_updated_at
  FROM public.atlas_integration_mappings m
  JOIN public.atlas_growth_items g ON g.tenant_id=m.tenant_id AND g.item_id=m.atlas_item_id
  WHERE m.tenant_id=p_tenant_id AND m.connection_id=p_connection_id AND m.provider_object_type='Client' AND m.external_id=p_external_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_upsert_integration_contact(
  p_tenant_id UUID,p_connection_id UUID,p_external_id TEXT,p_source_updated_at TIMESTAMPTZ,p_record JSONB
)
RETURNS TABLE(result_code TEXT,atlas_item_id UUID,version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  existing_map public.atlas_integration_mappings%ROWTYPE;
  old_version INTEGER;
  item UUID;
  actor UUID;
  event_id UUID;
  record_tenant UUID;
  record_actor UUID;
  record_module TEXT;
  record_version INTEGER;
BEGIN
  IF current_user NOT IN ('atlas_worker','atlas_integration_ingress') THEN RAISE EXCEPTION 'integration_worker_required'; END IF;
  IF p_record IS NULL OR jsonb_typeof(p_record)<>'object' THEN RAISE EXCEPTION 'integration_record_invalid'; END IF;
  record_tenant:=NULLIF(p_record->>'tenantId','')::uuid;
  record_actor:=NULLIF(p_record->>'actorId','')::uuid;
  record_module:=p_record->>'module';
  record_version=NULLIF(p_record->>'version','')::integer;
  item=NULLIF(p_record->>'id','')::uuid;
  actor:=record_actor;
  IF record_tenant IS DISTINCT FROM p_tenant_id OR record_module <> 'contacts' OR item IS NULL OR record_version IS NULL OR record_version<1 THEN RAISE EXCEPTION 'integration_record_scope_invalid'; END IF;
  IF actor IS NULL OR octet_length(p_record->>'checksum') <> 64 OR p_record->>'checksum' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'integration_record_integrity_invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.atlas_integration_connections c WHERE c.tenant_id=p_tenant_id AND c.connection_id=p_connection_id AND c.status IN ('connected','needs_reauth','error')) THEN
    RAISE EXCEPTION 'integration_connection_not_found';
  END IF;
  SELECT * INTO existing_map FROM public.atlas_integration_mappings
    WHERE tenant_id=p_tenant_id AND connection_id=p_connection_id AND provider_object_type='Client' AND external_id=p_external_id FOR UPDATE;
  mapping_found := FOUND;
  PERFORM set_config('app.tenant_id',p_tenant_id::text,true);
  PERFORM set_config('app.actor_id',actor::text,true);
  IF mapping_found AND existing_map.source_updated_at IS NOT NULL AND p_source_updated_at IS NOT NULL AND p_source_updated_at <= existing_map.source_updated_at THEN
    result_code:='skipped'; atlas_item_id:=existing_map.atlas_item_id;
    SELECT g.version INTO version FROM public.atlas_growth_items g WHERE g.tenant_id=p_tenant_id AND g.item_id=existing_map.atlas_item_id;
    RETURN NEXT; RETURN;
  END IF;
  IF existing_map.atlas_item_id IS NOT NULL THEN
    IF item <> existing_map.atlas_item_id THEN RAISE EXCEPTION 'integration_mapping_conflict'; END IF;
    SELECT g.version INTO old_version FROM public.atlas_growth_items g WHERE g.tenant_id=p_tenant_id AND g.item_id=item FOR UPDATE;
    IF old_version IS NULL OR record_version <> old_version+1 THEN RAISE EXCEPTION 'integration_version_conflict'; END IF;
    UPDATE public.atlas_growth_items SET
      title=p_record->>'title',state=p_record->>'state',version=record_version,payload=p_record->'payload',
      checksum=p_record->>'checksum',updated_by=actor,updated_at=(p_record->>'updatedAt')::timestamptz
      WHERE tenant_id=p_tenant_id AND item_id=item;
    result_code:='updated';
  ELSE
    INSERT INTO public.atlas_growth_items(
      tenant_id,item_id,module_key,title,state,version,payload,checksum,created_by,updated_by,idempotency_key,created_at,updated_at
    ) VALUES (
      p_tenant_id,item,record_module,p_record->>'title',p_record->>'state',record_version,p_record->'payload',p_record->>'checksum',
      actor,actor,NULL,(p_record->>'createdAt')::timestamptz,(p_record->>'updatedAt')::timestamptz
    );
    result_code:='created';
  END IF;
  INSERT INTO public.atlas_growth_item_versions(
    tenant_id,item_id,version,module_key,title,state,payload,checksum,actor_id,created_at
  ) VALUES (
    p_tenant_id,item,record_version,record_module,p_record->>'title',p_record->>'state',p_record->'payload',p_record->>'checksum',
    actor,(p_record->>'updatedAt')::timestamptz
  ) ON CONFLICT (tenant_id,item_id,version) DO NOTHING;
  INSERT INTO public.atlas_integration_mappings(
    tenant_id,connection_id,provider_object_type,external_id,atlas_module,atlas_item_id,source_updated_at
  ) VALUES (p_tenant_id,p_connection_id,'Client',p_external_id,'contacts',item,p_source_updated_at)
  ON CONFLICT (tenant_id,connection_id,'Client',external_id) DO UPDATE SET
    atlas_item_id=EXCLUDED.atlas_item_id,source_updated_at=EXCLUDED.source_updated_at,updated_at=now();
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_growth_item_events(
    tenant_id,event_id,item_id,actor_id,module_key,action,version,metadata
  ) VALUES (
    p_tenant_id,event_id,item,actor,'contacts','integration_upserted',record_version,
    jsonb_build_object('connectionId',p_connection_id,'providerObjectType','Client','externalId',p_external_id)
  ) ON CONFLICT (tenant_id,event_id) DO NOTHING;
  PERFORM atlas_v115_append_outbox_event(
    p_tenant_id,event_id,'contacts.integration_upserted',
    jsonb_build_object('kind','contacts','id',item::text,'version',record_version)
  );
  atlas_item_id:=item; version:=record_version;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_ingest_jobber_webhook(
  p_account_id TEXT,p_external_event_key CHAR(64),p_topic TEXT,p_external_object_id TEXT,p_payload JSONB
)
RETURNS TABLE(tenant_id UUID,connection_id UUID,webhook_event_id UUID,duplicate BOOLEAN,queued BOOLEAN,disconnected BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  connection public.atlas_integration_connections%ROWTYPE;
  event_id UUID;
  task_id UUID;
  queue_key CHAR(64);
  operation TEXT;
  inserted BOOLEAN:=FALSE;
  mapping_found BOOLEAN:=FALSE;
BEGIN
  IF current_user <> 'atlas_integration_ingress' THEN RAISE EXCEPTION 'integration_ingress_required'; END IF;
  IF p_account_id IS NULL OR length(p_account_id) NOT BETWEEN 1 AND 512
    OR p_external_event_key !~ '^[a-f0-9]{64}$'
    OR p_topic IS NULL OR p_topic !~ '^[A-Za-z][A-Za-z0-9_-]{0,119}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'jobber_webhook_invalid';
  END IF;
  SELECT * INTO connection FROM public.atlas_integration_connections
    WHERE provider_id='jobber' AND external_account_id=p_account_id AND status <> 'disconnected'
    ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration_connection_not_found'; END IF;
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_integration_webhook_events(
    tenant_id,connection_id,webhook_event_id,external_event_key,provider_event_type,external_object_id,payload
  ) VALUES (
    connection.tenant_id,connection.connection_id,event_id,p_external_event_key,p_topic,p_external_object_id,p_payload
  )
  ON CONFLICT (connection_id,external_event_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT tenant_id,connection_id,webhook_event_id INTO tenant_id,connection_id,webhook_event_id
      FROM public.atlas_integration_webhook_events
      WHERE connection_id=connection.connection_id AND external_event_key=p_external_event_key;
    duplicate:=TRUE; queued:=FALSE; disconnected:=FALSE; RETURN NEXT; RETURN;
  END IF;
  tenant_id:=connection.tenant_id; connection_id:=connection.connection_id; webhook_event_id:=event_id;
  IF p_topic='APP_DISCONNECT' THEN
    UPDATE public.atlas_integration_connections SET status='disconnected',secret_ciphertext=NULL,last_health_status='unhealthy',
      last_health_at=now(),last_error_code='provider_disconnect',updated_at=now()
      WHERE tenant_id=connection.tenant_id AND connection_id=connection.connection_id;
    UPDATE public.atlas_integration_webhook_events SET process_status='applied',processed_at=now()
      WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    duplicate:=FALSE; queued:=FALSE; disconnected:=TRUE; RETURN NEXT; RETURN;
  END IF;
  IF p_topic IN ('CLIENT_CREATE','CLIENT_UPDATE','CLIENT_ARCHIVE','CLIENT_RESTORE') THEN
    operation:='jobber.sync_client';
    task_id:=gen_random_uuid();
    queue_key:=encode(digest(('jobber-webhook:'||connection.connection_id::text||':'||p_external_event_key),'sha256'),'hex');
    PERFORM set_config('app.tenant_id',connection.tenant_id::text,true);
    PERFORM set_config('app.actor_id',connection.created_by::text,true);
    INSERT INTO public.atlas_integration_tasks(
      tenant_id,task_id,connection_id,operation,request,status,idempotency_key,created_by
    ) VALUES (
      connection.tenant_id,task_id,connection.connection_id,operation,
      jsonb_build_object('externalId',p_external_object_id,'topic',p_topic,'webhookEventId',event_id),
      'queued',queue_key,connection.created_by
    ) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING;
    IF FOUND THEN
      PERFORM atlas_v115_enqueue_job(
        connection.tenant_id,task_id,'integration.execute',
        jsonb_build_object('kind','integration_task','id',task_id::text,'version',1),
        queue_key,now(),8
      );
      UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
      queued:=TRUE;
    ELSE
      UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
      queued:=FALSE;
    END IF;
  ELSE
    UPDATE public.atlas_integration_webhook_events SET process_status='ignored',processed_at=now() WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    queued:=FALSE;
  END IF;
  duplicate:=FALSE; disconnected:=FALSE;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION atlas_v118_ingest_zapier_webhook(
  p_webhook_key_hash CHAR(64),p_external_event_key CHAR(64),p_payload JSONB
)
RETURNS TABLE(tenant_id UUID,connection_id UUID,webhook_event_id UUID,duplicate BOOLEAN,queued BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  connection public.atlas_integration_connections%ROWTYPE;
  event_id UUID;
  task_id UUID;
  queue_key CHAR(64);
BEGIN
  IF current_user <> 'atlas_integration_ingress' THEN RAISE EXCEPTION 'integration_ingress_required'; END IF;
  IF p_webhook_key_hash !~ '^[a-f0-9]{64}$' OR p_external_event_key !~ '^[a-f0-9]{64}$' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'zapier_webhook_invalid'; END IF;
  SELECT * INTO connection FROM public.atlas_integration_connections
    WHERE provider_id='zapier' AND auth_mode='webhook' AND status='connected' AND webhook_key_hash=p_webhook_key_hash LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration_connection_not_found'; END IF;
  event_id:=gen_random_uuid();
  INSERT INTO public.atlas_integration_webhook_events(
    tenant_id,connection_id,webhook_event_id,external_event_key,provider_event_type,payload
  ) VALUES (
    connection.tenant_id,connection.connection_id,event_id,p_external_event_key,'hook.received',p_payload
  ) ON CONFLICT(connection_id,external_event_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT tenant_id,connection_id,webhook_event_id INTO tenant_id,connection_id,webhook_event_id
      FROM public.atlas_integration_webhook_events WHERE connection_id=connection.connection_id AND external_event_key=p_external_event_key;
    duplicate:=TRUE; queued:=FALSE; RETURN NEXT; RETURN;
  END IF;
  task_id:=gen_random_uuid();
  queue_key:=encode(digest(('zapier-webhook:'||connection.connection_id::text||':'||p_external_event_key),'sha256'),'hex');
  PERFORM set_config('app.tenant_id',connection.tenant_id::text,true);
  PERFORM set_config('app.actor_id',connection.created_by::text,true);
  INSERT INTO public.atlas_integration_tasks(
    tenant_id,task_id,connection_id,operation,request,status,idempotency_key,created_by
  ) VALUES (
    connection.tenant_id,task_id,connection.connection_id,'zapier.receive',jsonb_build_object('webhookEventId',event_id,'payload',p_payload),
    'queued',queue_key,connection.created_by
  ) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING;
  IF FOUND THEN
    PERFORM atlas_v115_enqueue_job(
      connection.tenant_id,task_id,'integration.execute',
      jsonb_build_object('kind','integration_task','id',task_id::text,'version',1),
      queue_key,now(),8
    );
    UPDATE public.atlas_integration_webhook_events SET process_status='queued' WHERE tenant_id=connection.tenant_id AND webhook_event_id=event_id;
    queued:=TRUE;
  ELSE
    queued:=FALSE;
  END IF;
  tenant_id:=connection.tenant_id; connection_id:=connection.connection_id; webhook_event_id:=event_id; duplicate:=FALSE;
  RETURN NEXT;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_app') THEN
    GRANT USAGE ON SCHEMA public TO atlas_integration_ingress;
    GRANT SELECT,INSERT,UPDATE ON atlas_integration_connections,atlas_integration_oauth_states,atlas_integration_mappings,atlas_integration_webhook_events,atlas_integration_tasks TO atlas_integration_ingress;
    GRANT SELECT,INSERT,UPDATE ON atlas_growth_items TO atlas_integration_ingress;
    GRANT SELECT,INSERT ON atlas_growth_item_versions,atlas_growth_item_events TO atlas_integration_ingress;
    GRANT INSERT ON atlas_event_outbox TO atlas_integration_ingress;
    GRANT EXECUTE ON FUNCTION atlas_v115_append_outbox_event(UUID,UUID,TEXT,JSONB) TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_consume_oauth_state(CHAR) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_get_integration_contact(UUID,UUID,TEXT) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_upsert_integration_contact(UUID,UUID,TEXT,TIMESTAMPTZ,JSONB) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_ingest_jobber_webhook(TEXT,CHAR,TEXT,TEXT,JSONB) OWNER TO atlas_integration_ingress;
    ALTER FUNCTION atlas_v118_ingest_zapier_webhook(CHAR,CHAR,JSONB) OWNER TO atlas_integration_ingress;
  END IF;
END
$$;

REVOKE ALL ON atlas_integration_connections,atlas_integration_oauth_states,atlas_integration_mappings,atlas_integration_webhook_events,atlas_integration_tasks FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_consume_oauth_state(CHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_get_integration_contact(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_upsert_integration_contact(UUID,UUID,TEXT,TIMESTAMPTZ,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_ingest_jobber_webhook(TEXT,CHAR,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_v118_ingest_zapier_webhook(CHAR,CHAR,JSONB) FROM PUBLIC;

COMMIT;
