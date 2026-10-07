# Atlas V156 — Transactional Operating System

Date: 2026-10-07

## Scope

V156 turns the previously scattered commerce, financial, project and portal contracts into a single hardened transactional layer.

### Implemented contract layer
- Product / variant / SKU definitions.
- Price books and integer minor-unit prices.
- Tax policies and bounded coupons.
- Cart creation and deterministic pricing.
- Inventory state, reservations, commits and releases with snapshot hashes.
- Quotes and optimistic quote state transitions.
- Orders and optimistic order state transitions.
- Checkout intents and payment links.
- Provider payment events with payload hashes and deterministic dedupe keys.
- Subscription lifecycle state machine.
- Refund requests with approval thresholds.
- Credits and credit consumption.
- Evidence-bound document approval.
- Relationship-scoped customer / partner / freelancer / agency / vendor portal access.
- Project tasks, dependencies, blockers and cycle detection.
- Durable idempotency-record contract.
- Provider reconciliation contract that depends on database uniqueness, not process memory.

## Hardening changes to existing Atlas

### Provider reconciliation

The previous atlas-next reconciliation helper kept duplicate-event state in a module-level Set. That was unsafe for multi-process workers, restarts and horizontal scaling. V156 changes it to a deterministic reconciliation-key contract; durable duplicate suppression is now owned by PostgreSQL uniqueness.

### Action input isolation

The Universal Business Action fabric now rejects credential-shaped keys and excessively deep/large recursive inputs before they are persisted or handed to downstream execution.

### Capability registry

The central capability fabric now contains transactional commerce, document, project, portal, idempotency and provider-reconciliation capabilities.

### Project/workflow relationship

Transactional records retain tenant identity, version/checksum information and explicit idempotency references so UI, workflows, APIs, MCP tools and agents can share the same state rules.

## Database design

infra/postgres/FINAL-MIGRATION-V156.sql adds tenant-scoped persistence with:
- Forced Row Level Security on every V156 table.
- Composite tenant/entity primary keys where applicable.
- Cross-table foreign keys preserving tenant identity.
- Integer minor-unit financial amounts.
- Unique provider-event identity `(tenant_id, provider, provider_event_id)`.
- Unique idempotency identity `(tenant_id, key, scope)`.
- Evidence/content hashes for documents and mutable business objects.
- A security-definer provider-event recording function with conflict-safe insertion.
- Restricted atlas_app / atlas_worker grants.

## Rollout gates

V156 is a staged release, not a claim of live production commerce.

1. Execute the V156 migration against an isolated staging PostgreSQL instance.
2. Run the full migration/RLS test suite from V80 through V156.
3. Verify tenant cross-read/cross-write negative tests against the deployed database role.
4. Verify provider webhook signatures before calling the reconciliation function.
5. Run provider sandbox checkout, payment, refund and subscription lifecycle E2E tests.
6. Run concurrency tests for inventory reservation, order transitions and idempotency.
7. Verify portal relationship isolation for all five portal roles.
8. Verify document evidence and approval audit trails.
9. Run backup/PITR and restore tests before production activation.
10. Keep V153 production release metadata unchanged until deployment evidence is recorded.

## Known external gates

Still externally gated:
- Real Stripe/PayPal/Shopify/WooCommerce provider credentials.
- Live payment and refund execution.
- Tax-provider connectivity.
- Managed vault/KMS secrets.
- Production database execution of the V156 migration.
- Production Redis/worker capacity evidence.
- Real customer-facing portal deployment.
- Multi-region, failover and DR evidence.

This separation is intentional: code presence is not treated as provider or infrastructure proof.