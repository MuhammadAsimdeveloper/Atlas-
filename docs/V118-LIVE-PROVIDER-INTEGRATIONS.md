# V118 — Live Provider Integrations

V118 adds a tenant-scoped execution layer for Jobber and Zapier on top of Atlas's durable queue, transactional outbox and worker runtime.

## Live provider coverage

Jobber
- OAuth 2.0 authorization-code flow with PKCE
- encrypted access/refresh token storage
- refresh-token rotation protected by a PostgreSQL advisory transaction lock
- GraphQL account health and paginated client synchronization
- client create/edit primitives for Atlas-to-Jobber sync
- raw-body HMAC webhook verification
- client lifecycle webhook ingestion and APP_DISCONNECT
- external ID mapping into Atlas Contacts

Zapier
- per-workspace webhook connection
- inbound webhook receipt and durable queueing
- outbound Atlas event delivery
- optional HMAC event signature
- per-connection/event delivery idempotency ledger
- connection test delivery

HubSpot, Salesforce, Zoho CRM, Pipedrive, HighLevel, monday.com, ServiceTitan, Housecall Pro, Freshsales and Close remain catalog-only until their own live adapters are enabled. The UI deliberately distinguishes catalog capability from an actually connected runtime adapter.

## Required deployment configuration

Set these deployment secrets/variables:
- ATLAS_PUBLIC_ORIGIN
- ATLAS_INTEGRATION_ENCRYPTION_KEY
- ATLAS_JOBBER_CLIENT_ID
- ATLAS_JOBBER_CLIENT_SECRET
- ATLAS_JOBBER_GRAPHQL_VERSION

The integration encryption key must encode exactly 32 bytes as either 64 hexadecimal characters or base64. Tenant provider tokens are never stored in .env.

For Jobber, register this callback:

/api/v1/integrations/oauth/jobber/callback

and expose this webhook endpoint:

POST /api/v1/integrations/webhooks/jobber

The Jobber webhook handler validates X-Jobber-Hmac-SHA256 over the raw body using the OAuth app client secret, persists the event, deduplicates it and queues background work.

## Database rollout

Apply:
1. infra/postgres/FINAL-MIGRATION-V118.sql
2. infra/postgres/API-ROLE-GRANTS-V118.sql

V118 uses forced row-level security for connection, OAuth-state, mapping, webhook, task and delivery tables. The webhook ingress role is non-login and cannot bypass RLS.

## Worker runtime

The worker loads apps/worker/handlers/provider-integrations.mjs by default when ATLAS_WORKER_HANDLERS_MODULE is not explicitly set.

Provider operations are durable tasks:
- jobber.health
- jobber.sync_clients
- jobber.sync_client
- jobber.upsert_client
- zapier.receive
- zapier.send_test

Errors are converted into bounded error codes and retryable work is returned to the normal worker retry/dead-letter path.

## Atlas CRM mapping

Jobber clients are normalized into the Atlas contacts module. Imported provider records do not create marketing consent: email/SMS/WhatsApp consent defaults to false unless a separate consent/evidence flow exists.

Mappings are keyed by tenant, connection, provider object type and external ID. Source timestamps prevent stale provider events from overwriting newer Atlas state. Atlas record checksums and versions are re-verified before worker updates.

Atlas-to-Jobber contact upsert uses the existing mapping when available; otherwise it creates a new Jobber client and attaches the returned external ID to the Atlas contact.

## Zapier event contract

Outbound events contain:
- Atlas event id/type/time/version
- workspace id
- object id/type/title/state/version
- the bounded Atlas record payload

When a signing secret is configured, Atlas sends X-Atlas-Event-Signature as HMAC-SHA256.

Inbound Zapier requests are stored and acknowledged quickly. V118 persists and queues the inbound event; it intentionally does not execute arbitrary workflow graphs yet. That boundary keeps provider ingress separate from future workflow-action authorization.

## Production completion gate

A repository implementation is not the same thing as a live provider connection. Before production sign-off:
- create the provider apps and set real deployment secrets
- apply both V118 database scripts
- configure HTTPS ATLAS_PUBLIC_ORIGIN
- configure Jobber webhook subscriptions
- create real Zapier Catch Hooks as required
- deploy API and worker with restricted database roles
- test OAuth callback, token refresh, disconnect, webhook replay and outbound retry behavior
- verify provider rate limits, terms and data-retention requirements

## Official references

- Jobber developer docs: https://developer.getjobber.com/docs/
- Jobber OAuth authorization: https://developer.getjobber.com/docs/building_your_app/app_authorization/
- Jobber webhooks: https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/
- Zapier developer platform: https://developer.zapier.com/