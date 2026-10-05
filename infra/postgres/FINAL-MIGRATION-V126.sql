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
ALTER TABLE atlas_v126_message_receipts ENABLE ROW LEVEL SECURITY;
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
 IF NOT EXISTS(SELECT 1 FROM atlas_v122_conversations c WHERE c.tenant_id=p_tenant_id AND c.conversation_id=p_conversation_id AND (p_connection_id IS NULL OR c.provider_connection_id=p_connection_id)) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
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
