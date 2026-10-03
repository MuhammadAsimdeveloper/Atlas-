# Atlas V91 — Customer Agent Operations

V91 adds a deterministic, tenant-scoped deployment and routing layer for customer-facing AI agents. It builds on V80 immutable release/evaluation concepts and the V86–V90 queue and observability contracts.

## Runtime behavior

- A deployment begins as a draft. Publishing requires a same-tenant owner/admin (or the separately authenticated Atlas platform owner) and a recent evaluation with a score of at least 95, at least 20 cases, zero critical failures and at most 2% errors.
- The first release is capped at 10% conversation coverage. Promotion creates a new immutable release, requires at least 50 recent evaluation cases, and increases coverage by at most 25 percentage points at a time.
- Routing matches the tenant, channel, optional opaque provider destination, and contact tags. A direct contact-to-agent assignment takes precedence over tag filters but still must match an enabled channel and tenant.
- Time windows use explicit IANA time zones and local weekday/hour checks. Off-hours conversations route to a person.
- Traffic assignment hashes the tenant, deployment and server-created conversation ID, so one conversation stays in the same rollout cohort.
- Equal-priority overlapping matches fail closed to a human. The agent also hands off on an explicit customer request, an out-of-scope intent, weak knowledge coverage, repeated failures, a configured frustration threshold or a turn limit.
- A paused binding stops new conversations while existing conversations can continue until handoff or resolution.
- An AI resolution is counted only when the customer accepts the outcome, meaningful progress was made, and no human takeover, abandonment, negative signal or loop occurred.

## Authority and trust boundary

`packages/atlas-core/authority.mjs` resolves global authority only for an authenticated actor whose **verified** email exactly matches the single configured `ATLAS_PLATFORM_OWNER_EMAIL`. Missing or malformed configuration fails closed. A tenant's `owner` or `admin` membership is checked against a server-loaded membership for the same actor and tenant. Request fields such as `role`, `platformOwner`, or a claimed email do not grant authority.

The caller must resolve identity from its authenticated session and load tenant memberships from trusted storage before calling the authority helper. The V91 library is not a replacement for an authentication provider, account recovery, email verification or a server middleware layer. Never populate `actor`, `memberships` or `publisherAuthority` from request JSON.

## Persistence

`infra/postgres/FINAL-MIGRATION-V91.sql` adds append-only, checksum-labelled release snapshots; mutable per-channel rollout bindings; and idempotent route-decision audit rows. Row-level security requires the API to set `app.tenant_id` with `SET LOCAL` inside every tenant transaction after authorization. The schema intentionally records IDs and reason codes, not customer messages, email addresses, phone numbers, model prompts or credentials.

`claimRouteDecision(Map, decision)` is a process-local deterministic test helper only. Production must use the unique `(tenant_id, inbound_message_id)` constraint in Postgres so retries across API replicas cannot route the same inbound event twice.

## API integration still required

The V90 repository is a dependency-light contracts foundation, not a running authenticated API. The command center remains a sample-data preview. Production must bind these contracts to authenticated API handlers, Postgres transactions, queue workers, channel providers, consent/suppression records, knowledge retrieval, agent tool authorization and delivery receipts. No email, SMS, WhatsApp, social or voice message is sent by this release.

The platform owner email must be configured to Khan's verified identity in deployment secrets. It is deliberately blank by default and is not committed to this repository.
