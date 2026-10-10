# Atlas V156 — Transactional Operating System

Date: 2026-10-07

## Delivered
- Product, variants, SKU, price books, taxes and coupons.
- Deterministic cart pricing with bounded integer minor-unit money.
- Inventory reservations using state hashes to prevent double allocation/replay.
- Quote, order, checkout and subscription state machines with optimistic versioning.
- Payment events with payload hashes and deterministic provider-event dedupe keys.
- Refund requests with approval thresholds and credits.
- Evidence-bound document approval.
- Relationship-scoped Customer, Partner, Freelancer, Agency and Vendor portal access.
- Projects/tasks/dependencies with blocker checks and cycle detection.
- Durable idempotency and provider-reconciliation database contracts.

## Existing Atlas hardening
- Removed process-memory payment reconciliation state from atlas-next.
- Universal business actions reject credential-shaped input and recursive payload abuse.
- Central capability registry now covers transactional commerce, portals, projects, documents, idempotency and reconciliation.

## Database
`infra/postgres/FINAL-MIGRATION-V156.sql` defines 23 tenant-scoped tables with forced RLS, composite tenant-aware keys, payment-event/provider-event uniqueness, idempotency uniqueness and restricted worker grants.

## Production gate
V156 remains staged. Production promotion requires staging migration/RLS tests, provider sandbox checkout/payment/refund/subscription E2E, concurrency/idempotency tests, portal relationship isolation, document approval evidence, backup/PITR restore tests and deployment evidence.

V153 remains the production release identifier until those gates pass.
