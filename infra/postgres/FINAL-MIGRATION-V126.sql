-- Atlas V126: durable unified communications/inbox layer on the V125 provider runtime.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_v126_inbox_events(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
 event_id uuid NOT NULL DEFAULT gen_random_uuid(),
 provider_key text NOT NULL,
 event_ref text NOT NULL,
 payload_hash text NOT NULL,
 event_type text NOT NULL,
 status text NOT NULL DEFAULT 'received',
 conversation_id uuid,
 message_id uuid,
 error_code text,
 received_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 PRIMARY KEY(tenant_id,event_id),
 UNIQUE(tenant_id,provider_key,event_ref,payload_hash),
 CHECK(provider_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
 CHECK(event_ref !~ '[\\r\\n]' AND length(event_ref) BETWEEN 1 AND 240),
 CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 CHECK(status IN ('received','processed','duplicate','ignored','failed'))
);
CREATE TABLE IF NOT EXISTS atlas_v126_message_receipts(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
 receipt_id uuid NOT NULL DEFAULT gen_random_uuid(),
 message_id uuid NOT NULL,
 provider_key text NOT NULL,
 provider_event_ref text NOT NULL,
 status text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 metadata jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(tenant_id,receipt_id),
 UNIQUE(tenant_id,message_id,provider_key,provider_event_ref,status),
 CHECK(status IN ('sent','delivered','read','failed','blocked')),
 CHECK(jsonb_typeof(metadata)='object' AND metadata ? 'secret' = false AND octet_length(metadata::text)<=4000)
);
ALTER TABLE atlas_v122_conversations ADD COLUMN IF NOT EXISTS channel_address text;
ALTER TABLE atlas_v122_conversations ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;
ALTER TABLE atlas_v122_conversations ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE atlas_v122_conversations ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;
ALTER TABLE atlas_v122_messages ADD COLUMN IF NOT EXISTS content_ref text;
ALTER TABLE atlas_v122_messages ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE atlas_v122_messages ADD COLUMN IF NOT EXISTS provider_status text;
ALTER TABLE atlas_v122_messages ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE atlas_v122_messages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS atlas_v126_conversations_queue ON atlas_v122_conversations(tenant_id,status,assigned_agent_id,unread_count,last_message_at DESC);
CREATE INDEX IF NOT EXISTS atlas_v126_messages_thread ON atlas_v122_messages(tenant_id,conversation_id,created_at DESC);
CREATE INDEX IF NOT EXISTS atlas_v126_messages_provider ON atlas_v122_messages(tenant_id,provider_message_ref) WHERE provider_message_ref IS NOT NULL;
ALTER TABLE atlas_v126_inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v126_inbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE atlas_v126_message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_v126_message_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY atlas_v126_inbox_events_tenant ON atlas_v126_inbox_events USING (tenant_id::text=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK (tenant_id::text=nullif(current_setting('app.tenant_id',true),''));
CREATE POLICY atlas_v126_message_receipts_tenant ON atlas_v126_message_receipts USING (tenant_id::text=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK (tenant_id::text=nullif(current_setting('app.tenant_id',true),''));

CREATE OR REPLACE FUNCTION atlas_v126_create_outbound_message(
 p_tenant_id uuid,p_actor_id uuid,p_conversation_id uuid,p_channel text,p_connection_id uuid,
 p_content_ref text,p_sender_ref text,p_recipient_ref text,p_subject text,p_idempotency_key text,p_job_id uuid
) RETURNS TABLE(message_id uuid,conversation_id uuid,created boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $
DECLARE v_id uuid; v_created boolean:=false;
BEGIN
 IF session_user <> 'atlas_app' THEN RAISE EXCEPTION 'api_role_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_v122_conversations c WHERE c.tenant_id=p_tenant_id AND c.conversation_id=p_conversation_id AND c.channel=p_channel AND c.provider_connection_id=p_connection_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT m.message_id INTO v_id FROM atlas_v122_messages m WHERE m.tenant_id=p_tenant_id AND m.idempotency_key=p_idempotency_key FOR UPDATE;
 IF v_id IS NOT NULL THEN RETURN QUERY SELECT v_id,p_conversation_id,false; RETURN; END IF;
 INSERT INTO atlas_v122_messages(tenant_id,message_id,conversation_id,direction,sender_ref,recipient_ref,body_ref,delivery_status,idempotency_key,content_ref,subject,provider_status,updated_at)
 VALUES(p_tenant_id,gen_random_uuid(),p_conversation_id,'outbound',p_sender_ref,p_recipient_ref,'{}','queued',p_idempotency_key,p_content_ref,p_subject,'queued',now())
 RETURNING atlas_v122_messages.message_id INTO v_id;
 UPDATE atlas_v122_conversations SET last_message_at=now(),last_outbound_at=now(),updated_at=now(),version=version+1 WHERE tenant_id=p_tenant_id AND conversation_id=p_conversation_id;
 v_created:=true;
 RETURN QUERY SELECT v_id,p_conversation_id,v_created;
END;$;
REVOKE ALL ON FUNCTION atlas_v126_create_outbound_message(uuid,uuid,uuid,text,uuid,text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v126_create_outbound_message(uuid,uuid,uuid,text,uuid,text,text,text,text,text,uuid) TO atlas_app;

CREATE OR REPLACE FUNCTION atlas_v126_get_message_for_worker(p_tenant_id uuid,p_job_id uuid,p_worker_id text,p_message_id uuid)
RETURNS TABLE(tenant_id uuid,message_id uuid,conversation_id uuid,channel text,provider_connection_id uuid,recipient_ref text,sender_ref text,subject text,content_ref text,delivery_status text,idempotency_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $
BEGIN
 IF session_user <> 'atlas_worker' THEN RAISE EXCEPTION 'worker_role_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_runtime_jobs j WHERE j.tenant_id=p_tenant_id AND j.job_id=p_job_id AND j.status='leased' AND j.lease_owner=p_worker_id AND j.lease_until>now()) THEN RAISE EXCEPTION 'worker_job_lease_invalid'; END IF;
 RETURN QUERY SELECT m.tenant_id,m.message_id,m.conversation_id,c.channel,c.provider_connection_id,m.recipient_ref,m.sender_ref,m.subject,m.content_ref,m.delivery_status,m.idempotency_key
 FROM atlas_v122_messages m JOIN atlas_v122_conversations c ON c.tenant_id=m.tenant_id AND c.conversation_id=m.conversation_id
 WHERE m.tenant_id=p_tenant_id AND m.message_id=p_message_id;
END;$;
REVOKE ALL ON FUNCTION atlas_v126_get_message_for_worker(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v126_get_message_for_worker(uuid,uuid,text,uuid) TO atlas_worker;

CREATE OR REPLACE FUNCTION atlas_v126_resolve_webhook_endpoint(p_path_token_hash text)
RETURNS TABLE(tenant_id uuid,endpoint_id uuid,provider_key text,signing_secret_ref text,accepted_events jsonb,enabled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $
BEGIN
 IF session_user <> 'atlas_app' THEN RAISE EXCEPTION 'api_role_required'; END IF;
 RETURN QUERY SELECT e.tenant_id,e.endpoint_id,e.provider_key,e.signing_secret_ref,e.accepted_events,e.enabled
 FROM atlas_v122_webhook_endpoints e WHERE e.path_token_hash=p_path_token_hash AND e.enabled=true;
END;$;
REVOKE ALL ON FUNCTION atlas_v126_resolve_webhook_endpoint(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v126_resolve_webhook_endpoint(text) TO atlas_app;

CREATE OR REPLACE FUNCTION atlas_v126_ingest_inbound(
 p_tenant_id uuid,p_endpoint_id uuid,p_provider_key text,p_event_ref text,p_payload_hash text,p_event_type text,
 p_channel text,p_external_thread_ref text,p_sender_ref text,p_recipient_ref text,p_provider_message_ref text,p_content_ref text,p_subject text
) RETURNS TABLE(status text,conversation_id uuid,message_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $
DECLARE v_event uuid; v_conversation uuid; v_message uuid; v_inserted boolean:=false;
BEGIN
 IF session_user <> 'atlas_app' THEN RAISE EXCEPTION 'api_role_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_v122_webhook_endpoints e WHERE e.tenant_id=p_tenant_id AND e.endpoint_id=p_endpoint_id AND e.provider_key=p_provider_key AND e.enabled=true) THEN RAISE EXCEPTION 'webhook_endpoint_invalid'; END IF;
 INSERT INTO atlas_v126_inbox_events(tenant_id,provider_key,event_ref,payload_hash,event_type,status)
 VALUES(p_tenant_id,p_provider_key,p_event_ref,p_payload_hash,p_event_type,'received')
 ON CONFLICT(tenant_id,provider_key,event_ref,payload_hash) DO NOTHING
 RETURNING event_id INTO v_event;
 IF v_event IS NULL THEN
   SELECT e.conversation_id,e.message_id INTO v_conversation,v_message FROM atlas_v126_inbox_events e WHERE e.tenant_id=p_tenant_id AND e.provider_key=p_provider_key AND e.event_ref=p_event_ref AND e.payload_hash=p_payload_hash;
   RETURN QUERY SELECT 'duplicate',v_conversation,v_message; RETURN;
 END IF;
 INSERT INTO atlas_v122_conversations(tenant_id,conversation_id,channel,provider_connection_id,external_thread_ref,status,subject,last_message_at,last_inbound_at,unread_count,version,updated_at)
 SELECT p_tenant_id,gen_random_uuid(),p_channel,c.connection_id,p_external_thread_ref,'open',p_subject,now(),now(),1,1,now()
 FROM atlas_v122_provider_connections c WHERE c.tenant_id=p_tenant_id AND c.provider_key=p_provider_key AND c.channel=p_channel AND c.status='verified'
 AND p_external_thread_ref IS NOT NULL
 ON CONFLICT(tenant_id,channel,external_thread_ref) WHERE external_thread_ref IS NOT NULL DO UPDATE SET last_message_at=now(),last_inbound_at=now(),unread_count=atlas_v122_conversations.unread_count+1,updated_at=now(),version=atlas_v122_conversations.version+1
 RETURNING conversation_id INTO v_conversation;
 IF v_conversation IS NULL THEN
   RAISE EXCEPTION 'verified_provider_connection_not_found';
 END IF;
 INSERT INTO atlas_v122_messages(tenant_id,conversation_id,direction,sender_ref,recipient_ref,provider_message_ref,body_ref,delivery_status,idempotency_key,content_ref,subject,provider_status,created_at,updated_at)
 VALUES(p_tenant_id,v_conversation,'inbound',p_sender_ref,p_recipient_ref,p_provider_message_ref,'{}','delivered',
        encode(digest(p_provider_key||E'\\0'||p_event_ref||E'\\0'||p_payload_hash,'sha256'),'hex'),p_content_ref,p_subject,'delivered',now(),now())
 ON CONFLICT(tenant_id,idempotency_key) DO NOTHING
 RETURNING message_id INTO v_message;
 UPDATE atlas_v126_inbox_events SET status=CASE WHEN v_message IS NULL THEN 'duplicate' ELSE 'processed' END,conversation_id=v_conversation,message_id=v_message,processed_at=now() WHERE tenant_id=p_tenant_id AND event_id=v_event;
 RETURN QUERY SELECT CASE WHEN v_message IS NULL THEN 'duplicate' ELSE 'processed' END,v_conversation,v_message;
END;$;
REVOKE ALL ON FUNCTION atlas_v126_ingest_inbound(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v126_ingest_inbound(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text) TO atlas_app;

CREATE OR REPLACE FUNCTION atlas_v126_apply_receipt(p_tenant_id uuid,p_provider_key text,p_event_ref text,p_provider_message_ref text,p_status text,p_metadata jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $
DECLARE v_message uuid;
BEGIN
 IF session_user <> 'atlas_app' THEN RAISE EXCEPTION 'api_role_required'; END IF;
 SELECT m.message_id INTO v_message FROM atlas_v122_messages m WHERE m.tenant_id=p_tenant_id AND m.provider_message_ref=p_provider_message_ref FOR UPDATE;
 IF v_message IS NULL THEN RETURN false; END IF;
 INSERT INTO atlas_v126_message_receipts(tenant_id,message_id,provider_key,provider_event_ref,status,metadata)
 VALUES(p_tenant_id,v_message,p_provider_key,p_event_ref,p_status,coalesce(p_metadata,'{}'::jsonb)) ON CONFLICT DO NOTHING;
 UPDATE atlas_v122_messages SET delivery_status=p_status,provider_status=p_status,delivered_at=CASE WHEN p_status='delivered' THEN coalesce(delivered_at,now()) ELSE delivered_at END,updated_at=now() WHERE tenant_id=p_tenant_id AND message_id=v_message;
 RETURN true;
END;$;
REVOKE ALL ON FUNCTION atlas_v126_apply_receipt(uuid,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v126_apply_receipt(uuid,text,text,text,text,jsonb) TO atlas_app;

CREATE OR REPLACE FUNCTION atlas_v126_mark_message_for_worker(p_tenant_id uuid,p_job_id uuid,p_worker_id text,p_message_id uuid,p_status text,p_provider_ref text,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $
DECLARE changed boolean:=false;
BEGIN
 IF session_user <> 'atlas_worker' THEN RAISE EXCEPTION 'worker_role_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_runtime_jobs j WHERE j.tenant_id=p_tenant_id AND j.job_id=p_job_id AND j.status='leased' AND j.lease_owner=p_worker_id AND j.lease_until>now()) THEN RAISE EXCEPTION 'worker_job_lease_invalid'; END IF;
 UPDATE atlas_v122_messages SET delivery_status=p_status,provider_status=p_status,provider_message_ref=coalesce(p_provider_ref,provider_message_ref),error_code=p_error_code,updated_at=now(),sent_at=CASE WHEN p_status='sent' THEN coalesce(sent_at,now()) ELSE sent_at END,failed_at=CASE WHEN p_status='failed' THEN now() ELSE failed_at END WHERE tenant_id=p_tenant_id AND message_id=p_message_id;
 changed:=found; RETURN changed;
END;$;
REVOKE ALL ON FUNCTION atlas_v126_mark_message_for_worker(uuid,uuid,text,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v126_mark_message_for_worker(uuid,uuid,text,uuid,text,text,text) TO atlas_worker;
COMMIT;
