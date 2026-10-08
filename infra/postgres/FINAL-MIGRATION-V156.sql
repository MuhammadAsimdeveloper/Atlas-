-- Atlas V156: transactional OS persistence, reconciliation, portal scopes and project work.
-- Production truth: this migration is staged for review; executing it against live infrastructure remains a deployment gate.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_v156_products (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('physical','digital','service')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_id),
  CHECK (length(name) BETWEEN 2 AND 160),
  CHECK (octet_length(description) <= 2000)
);

CREATE TABLE IF NOT EXISTS atlas_v156_product_variants (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  variant_id UUID NOT NULL,
  product_id UUID NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (tenant_id, variant_id),
  UNIQUE (tenant_id, sku),
  FOREIGN KEY (tenant_id, product_id) REFERENCES atlas_v156_products(tenant_id, product_id) ON DELETE CASCADE,
  CHECK (sku ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'),
  CHECK (jsonb_typeof(attributes)='object' AND octet_length(attributes::text) <= 10000)
);

CREATE TABLE IF NOT EXISTS atlas_v156_price_books (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  price_book_id UUID NOT NULL,
  name TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  default_book BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, price_book_id),
  CHECK (length(name) BETWEEN 2 AND 160)
);

CREATE TABLE IF NOT EXISTS atlas_v156_price_entries (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  price_book_id UUID NOT NULL,
  variant_id UUID NOT NULL,
  product_id UUID NOT NULL,
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor > 0),
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity > 0 AND min_quantity <= 100000),
  active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, price_book_id, variant_id),
  FOREIGN KEY (tenant_id, price_book_id) REFERENCES atlas_v156_price_books(tenant_id, price_book_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, variant_id) REFERENCES atlas_v156_product_variants(tenant_id, variant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_id) REFERENCES atlas_v156_products(tenant_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS atlas_v156_coupons (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  coupon_id UUID NOT NULL,
  code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value BIGINT NOT NULL CHECK (value > 0),
  minimum_subtotal_minor BIGINT NOT NULL DEFAULT 0 CHECK (minimum_subtotal_minor >= 0),
  max_redemptions BIGINT NOT NULL DEFAULT 100000 CHECK (max_redemptions > 0),
  redeemed_count BIGINT NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0 AND redeemed_count <= max_redemptions),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, coupon_id),
  UNIQUE (tenant_id, code),
  CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  CHECK ((kind='percent' AND value BETWEEN 1 AND 10000) OR (kind='fixed' AND value > 0))
);

CREATE TABLE IF NOT EXISTS atlas_v156_inventory (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  variant_id UUID NOT NULL,
  on_hand BIGINT NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= on_hand),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, variant_id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES atlas_v156_product_variants(tenant_id, variant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS atlas_v156_inventory_reservations (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL,
  base_state_hash CHAR(64) NOT NULL CHECK (base_state_hash ~ '^[a-f0-9]{64}$'),
  reserved_state_hash CHAR(64) NOT NULL CHECK (reserved_state_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  lines JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, reservation_id),
  CHECK (jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 200)
);

CREATE TABLE IF NOT EXISTS atlas_v156_carts (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  cart_id UUID NOT NULL,
  customer_ref TEXT,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','checked_out','abandoned','closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  cart_hash CHAR(64) NOT NULL CHECK (cart_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, cart_id),
  CHECK (customer_ref IS NULL OR length(customer_ref) BETWEEN 1 AND 180),
  CHECK (jsonb_typeof(lines)='array' AND jsonb_array_length(lines) <= 200)
);

CREATE TABLE IF NOT EXISTS atlas_v156_orders (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  order_id UUID NOT NULL,
  customer_ref TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  pricing_hash CHAR(64) NOT NULL CHECK (pricing_hash ~ '^[a-f0-9]{64}$'),
  inventory_reservation_id UUID,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_payment','paid','fulfilled','canceled','refunded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id),
  FOREIGN KEY (tenant_id, inventory_reservation_id) REFERENCES atlas_v156_inventory_reservations(tenant_id, reservation_id),
  CHECK (length(customer_ref) BETWEEN 1 AND 180),
  CHECK (octet_length(reason) <= 300)
);

CREATE TABLE IF NOT EXISTS atlas_v156_checkouts (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  checkout_id UUID NOT NULL,
  cart_id UUID NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  pricing_hash CHAR(64) NOT NULL CHECK (pricing_hash ~ '^[a-f0-9]{64}$'),
  return_origin TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','authorized','completed','canceled','failed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, checkout_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES atlas_v156_carts(tenant_id, cart_id) ON DELETE RESTRICT,
  CHECK (return_origin ~ '^https://'),
  CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,255}$')
);

CREATE TABLE IF NOT EXISTS atlas_v156_payment_events (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  order_id UUID,
  status TEXT NOT NULL CHECK (status IN ('requires_payment_method','requires_action','authorized','captured','failed','partially_refunded','refunded')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciliation_key CHAR(64) NOT NULL CHECK (reconciliation_key ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (tenant_id, provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS atlas_v156_subscriptions (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL,
  customer_ref TEXT NOT NULL,
  price_book_id UUID NOT NULL,
  variant_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 100000),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','paused','canceled')),
  trial_ends_at TIMESTAMPTZ,
  renews_at TIMESTAMPTZ,
  reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscription_id),
  FOREIGN KEY (tenant_id, price_book_id) REFERENCES atlas_v156_price_books(tenant_id, price_book_id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES atlas_v156_product_variants(tenant_id, variant_id),
  CHECK (octet_length(reason) <= 300)
);

CREATE TABLE IF NOT EXISTS atlas_v156_refunds (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  refund_id UUID NOT NULL,
  payment_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_approval' CHECK (status IN ('needs_approval','approved','submitted','completed','rejected','failed')),
  approval_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, refund_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,255}$'),
  CHECK (octet_length(reason) BETWEEN 1 AND 500)
);

CREATE TABLE IF NOT EXISTS atlas_v156_credits (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  credit_id UUID NOT NULL,
  customer_ref TEXT NOT NULL,
  original_minor BIGINT NOT NULL CHECK (original_minor > 0),
  remaining_minor BIGINT NOT NULL CHECK (remaining_minor >= 0 AND remaining_minor <= original_minor),
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','consumed','expired','canceled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, credit_id)
);

CREATE TABLE IF NOT EXISTS atlas_v156_documents (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  document_type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','declined','expired')),
  approved_by TEXT,
  approval_evidence_ref TEXT,
  approved_at TIMESTAMPTZ,
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, document_id),
  CHECK (jsonb_typeof(evidence_refs)='array' AND jsonb_array_length(evidence_refs) <= 100)
);

CREATE TABLE IF NOT EXISTS atlas_v156_portal_scopes (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  portal_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  portal_role TEXT NOT NULL CHECK (portal_role IN ('customer','partner','freelancer','agency','vendor')),
  relation_type TEXT NOT NULL,
  relation_id TEXT NOT NULL,
  resource_grants JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope_hash CHAR(64) NOT NULL CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, portal_id, principal_id),
  CHECK (relation_id ~ '^[A-Za-z0-9_.:-]{1,180}$'),
  CHECK (jsonb_typeof(resource_grants)='array' AND jsonb_array_length(resource_grants) <= 20)
);

CREATE TABLE IF NOT EXISTS atlas_v156_projects (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  budget_minor BIGINT NOT NULL DEFAULT 0 CHECK (budget_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','completed','canceled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id),
  CHECK (length(name) BETWEEN 2 AND 200)
);

CREATE TABLE IF NOT EXISTS atlas_v156_project_tasks (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  title TEXT NOT NULL,
  assignee_ref TEXT,
  budget_minor BIGINT NOT NULL DEFAULT 0 CHECK (budget_minor >= 0),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done','canceled')),
  due_at TIMESTAMPTZ,
  expected_state TEXT NOT NULL DEFAULT 'todo',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (tenant_id, task_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES atlas_v156_projects(tenant_id, project_id) ON DELETE CASCADE,
  CHECK (length(title) BETWEEN 1 AND 240)
);

CREATE TABLE IF NOT EXISTS atlas_v156_task_dependencies (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  depends_on_task_id UUID NOT NULL,
  PRIMARY KEY (tenant_id, task_id, depends_on_task_id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES atlas_v156_project_tasks(tenant_id, task_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, depends_on_task_id) REFERENCES atlas_v156_project_tasks(tenant_id, task_id) ON DELETE CASCADE,
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS atlas_v156_idempotency (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key, scope),
  CHECK (key ~ '^[A-Za-z0-9._:-]{8,255}$')
);

CREATE TABLE IF NOT EXISTS atlas_v156_provider_reconciliation (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  resource_ref TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  reconciliation_key CHAR(64) NOT NULL CHECK (reconciliation_key ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider, provider_event_id)
);


CREATE TABLE IF NOT EXISTS atlas_v156_quotes (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  quote_id UUID NOT NULL,
  customer_ref TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  pricing_hash CHAR(64) NOT NULL CHECK (pricing_hash ~ '^[a-f0-9]{64}$'
  valid_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','expired','canceled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  notes TEXT NOT NULL DEFAULT '',
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, quote_id),
  CHECK (length(customer_ref) BETWEEN 1 AND 180), CHECK (octet_length(notes) <= 3000)
);

CREATE TABLE IF NOT EXISTS atlas_v156_payment_links (
  tenant_id UUID NOT NULL REFERENCES atlas_organizations(tenant_id) ON DELETE CASCADE,
  payment_link_id UUID NOT NULL,
  checkout_id UUID NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  pricing_hash CHAR(64) NOT NULL CHECK (pricing_hash ~ '^[a-f0-9]{64}$'
  expires_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disabled','completed')),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, payment_link_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, checkout_id) REFERENCES atlas_v156_checkouts(tenant_id, checkout_id) ON DELETE RESTRICT,
  CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,255}$'

-- Tenant isolation for every V156 persisted resource.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'atlas_v156_products','atlas_v156_product_variants','atlas_v156_price_books','atlas_v156_price_entries',
    'atlas_v156_coupons','atlas_v156_inventory','atlas_v156_inventory_reservations','atlas_v156_carts',
    'atlas_v156_orders','atlas_v156_checkouts','atlas_v156_payment_events','atlas_v156_subscriptions',
    'atlas_v156_refunds','atlas_v156_credits','atlas_v156_documents','atlas_v156_portal_scopes',
    'atlas_v156_projects','atlas_v156_project_tasks','atlas_v156_task_dependencies','atlas_v156_idempotency',
    'atlas_v156_provider_reconciliation'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t,t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO atlas_app',t);
  END LOOP;
END $$;

-- Worker writes are exposed only to controlled event/reconciliation surfaces.
GRANT INSERT,SELECT ON atlas_v156_payment_events,atlas_v156_provider_reconciliation TO atlas_worker;
REVOKE UPDATE,DELETE ON atlas_v156_payment_events,atlas_v156_provider_reconciliation FROM atlas_worker;

-- Idempotent provider-event recording. API/worker callers must still verify signatures before calling.
CREATE OR REPLACE FUNCTION atlas_v156_record_provider_event(
  p_tenant_id UUID,p_provider TEXT,p_provider_event_id TEXT,p_payload_hash CHAR(64),
  p_resource_ref TEXT,p_observed_at TIMESTAMPTZ
) RETURNS TABLE(inserted BOOLEAN,reconciliation_key CHAR(64))
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_key CHAR(64); v_inserted BOOLEAN;
BEGIN
  IF p_tenant_id IS NULL OR p_provider IS NULL OR p_provider_event_id IS NULL
     OR p_payload_hash !~ '^[a-f0-9]{64}$' OR p_resource_ref IS NULL OR p_observed_at IS NULL THEN
    RAISE EXCEPTION 'provider_event_invalid';
  END IF;
  v_key := encode(digest(p_tenant_id::text||':'||p_provider||':'||p_provider_event_id,'sha256'),'hex');
  INSERT INTO public.atlas_v156_provider_reconciliation(
    tenant_id,provider,provider_event_id,payload_hash,resource_ref,observed_at,reconciliation_key
  ) VALUES(p_tenant_id,p_provider,p_provider_event_id,p_payload_hash,p_resource_ref,p_observed_at,v_key)
  ON CONFLICT (tenant_id,provider,provider_event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN QUERY SELECT v_inserted,v_key;
END;
$$;
REVOKE ALL ON FUNCTION atlas_v156_record_provider_event(UUID,TEXT,TEXT,CHAR(64),TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_v156_record_provider_event(UUID,TEXT,TEXT,CHAR(64),TEXT,TIMESTAMPTZ) TO atlas_worker;

COMMIT;
