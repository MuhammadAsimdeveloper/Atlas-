-- V123 production integration/service-operations fabric.
BEGIN;
CREATE TABLE IF NOT EXISTS atlas_v123_oauth_tokens(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
 connection_id uuid NOT NULL, FOREIGN KEY (tenant_id,connection_id) REFERENCES atlas_v122_provider_connections(tenant_id,connection_id) ON DELETE CASCADE,
 access_token_ref text NOT NULL,
 refresh_token_ref text,
 expires_at timestamptz,
 scope text,
 provider_account_ref text,
 rotated_at timestamptz,
 version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connection_id)
);
CREATE TABLE IF NOT EXISTS atlas_v123_service_requests(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,request_id uuid PRIMARY KEY,customer_id uuid, title text NOT NULL,description text,priority text NOT NULL DEFAULT 'normal',status text NOT NULL DEFAULT 'requested',source text NOT NULL DEFAULT 'manual',external_ref text,version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas_v123_jobs(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,job_id uuid PRIMARY KEY,request_id uuid REFERENCES atlas_v123_service_requests(request_id),customer_id uuid,title text NOT NULL,status text NOT NULL DEFAULT 'draft',address jsonb NOT NULL DEFAULT '{}'::jsonb,checklist jsonb NOT NULL DEFAULT '[]'::jsonb,notes jsonb NOT NULL DEFAULT '[]'::jsonb,external_ref text,version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas_v123_visits(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,visit_id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES atlas_v123_jobs(job_id) ON DELETE CASCADE,starts_at timestamptz NOT NULL,ends_at timestamptz,assignee_id uuid,crew_id uuid,route_order integer,location jsonb NOT NULL DEFAULT '{}'::jsonb,status text NOT NULL DEFAULT 'scheduled',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas_v123_quotes(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,quote_id uuid PRIMARY KEY,job_id uuid,customer_id uuid,title text NOT NULL,items jsonb NOT NULL DEFAULT '[]'::jsonb,subtotal_minor bigint NOT NULL DEFAULT 0,currency char(3) NOT NULL DEFAULT 'USD',status text NOT NULL DEFAULT 'draft',external_ref text,version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas_v123_invoices(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,invoice_id uuid PRIMARY KEY,job_id uuid,customer_id uuid,items jsonb NOT NULL DEFAULT '[]'::jsonb,total_minor bigint NOT NULL DEFAULT 0,currency char(3) NOT NULL DEFAULT 'USD',status text NOT NULL DEFAULT 'draft',external_ref text,version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas_v123_webhook_deliveries(
 tenant_id uuid NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,delivery_id uuid PRIMARY KEY,provider text NOT NULL,event_key text NOT NULL,payload_hash text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,status text NOT NULL DEFAULT 'received',attempts integer NOT NULL DEFAULT 0,last_error text,UNIQUE(tenant_id,provider,event_key,payload_hash)
);
DO $policies$
DECLARE t TEXT;
BEGIN
 FOR t IN SELECT unnest(ARRAY['atlas_v123_oauth_tokens','atlas_v123_service_requests','atlas_v123_jobs','atlas_v123_visits','atlas_v123_quotes','atlas_v123_invoices','atlas_v123_webhook_deliveries']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
  EXECUTE format('CREATE POLICY %I_tenant ON %I USING (tenant_id::text=nullif(current_setting(''app.tenant_id'',true),'''')) WITH CHECK (tenant_id::text=nullif(current_setting(''app.tenant_id'',true),''''))',t,t);
 END LOOP;
END;$policies$;
COMMIT;
