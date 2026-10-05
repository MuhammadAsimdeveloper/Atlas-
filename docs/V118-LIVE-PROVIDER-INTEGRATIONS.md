# V118 — Live Provider Connections and Execution

V118 turns the V117 provider catalog into a real execution layer for the first two integrations:

- Jobber: OAuth 2.0 + PKCE, encrypted token storage, refresh-token rotation, account health checks, paginated client synchronization, verified HMAC webhooks, disconnect handling and tenant mapping into Atlas Contacts.
- Zapier: per-workspace webhook connections, inbound webhook receipt, outbound Atlas-event delivery, optional HMAC signatures and an idempotent per-connection delivery ledger.
- Other providers: HubSpot, Salesforce, Zoho CRM, Pipedrive, HighLevel, monday.com, ServiceTitan, Housecall Pro, Freshsales and Close remain cataloged but do not have live worker adapters yet.

## Architecture

The live path is split into four layers:

1. API: authenticates the Atlas workspace, enforces owner/admin or integrations.manage, starts OAuth, receives public webhooks and creates durable integration tasks.
2. PostgreSQL: stores tenant-scoped connection metadata plus encrypted provider credentials, one-use OAuth state, external-ID mappings, webhook receipts, task state and delivery state. Integration tables use forced RLS.
3. Worker: claims normal Atlas queue work and executes provider operations through integration.execute. Provider secrets are decrypted only inside the worker process.
4. Provider adapter: contains OAuth/token handling, API calls, normalization, rate/error classification and provider-specific security checks.

## Jobber setup

Jobber uses OAuth 2.0 authorization-code flow with PKCE. Access tokens are short-lived and refresh tokens must be treated as rotating credentials. Atlas encrypts the verifier before storing temporary OAuth state and encrypts the resulting access/refresh token bundle before storing the connection.

The production deployment must provide:

- ATLAS_JOBBER_CLIENT_ID
- ATLAS_JOBBER_CLIENT_SECRET
- ATLAS_JOBBER_GRAPHQL_VERSION
- ATLAS_INTEGRATION_ENCRYPTION_KEY
- ATLAS_PUBLIC_ORIGIN

The GraphQL version is deployment configuration because Jobber versions its API and expects the version in X-JOBBER-GRAPHQL-VERSION.

### Jobber webhooks

Configure this Atlas endpoint in the Jobber Developer Center:

POST https://<atlas-origin>/api/v1/integrations/webhooks/jobber

The endpoint verifies X-Jobber-Hmac-SHA256 over the raw request body using the Jobber OAuth client secret, stores/deduplicates the event and queues background work. It does not trust the webhook body as a source of customer fields; the worker re-queries Jobber using the webhook account/item identity.

Subscribe to the client lifecycle topics required by the deployed feature set, including CLIENT_CREATE, CLIENT_UPDATE, CLIENT_ARCHIVE, CLIENT_RESTORE, plus APP_DISCONNECT.

Jobber documents at-least-once webhook delivery and recommends asynchronous processing with a fast acknowledgement. Atlas therefore treats the webhook endpoint as an ingress/queue boundary rather than a synchronous sync endpoint.

### Client synchronization

The current live adapter supports:

- jobber.health
- jobber.sync_clients
- jobber.sync_client

Client pages are bounded to 100 records and full synchronization stops after 50 pages in one task to keep one job bounded. A later incremental-sync phase can add checkpointed cursors and backfill windows.

A Jobber client becomes an Atlas Contact only when Atlas has an acceptable email address or E.164 phone number. Provider data does not grant marketing consent: Atlas imports contact data with email/SMS/WhatsApp consent set to false unless a separate consent provider/evidence flow exists.

Mappings are keyed by tenant, connection, provider object type and external id. Source timestamps prevent stale webhook/sync data from overwriting newer Atlas state, and Atlas record checksums/version numbers are re-verified before worker updates.

## Zapier setup

Create a Zapier Catch Hook and paste its webhook URL into Integrations → Zapier → Configure Zapier webhook.

Atlas generates a separate inbound key per workspace. The key is stored as a hash and the encrypted connection payload also contains the Zapier destination URL. The public inbound endpoint is:

POST https://<atlas-origin>/api/v1/integrations/webhooks/zapier/<one-time-key>

Use the endpoint as a Zapier webhook action target when you want Zapier to push data back into Atlas.

### Outbound Atlas events

Atlas emits selected Growth Center outbox events to connected Zapier webhooks. The outbound payload contains Atlas event identity/type, workspace identity, object identity/module/title/state/version, and the bounded Atlas business payload.

An optional connection signing secret creates an X-Atlas-Event-Signature HMAC-SHA256 header. The worker also writes a connection/event delivery ledger row before sending so retrying the same Atlas outbox event does not create duplicate deliveries to a connection that already succeeded.

Current live outbound event families include contact, lead, pipeline and task mutations.

### Inbound Zapier events

Zapier inbound requests are stored as webhook events and queued as zapier.receive. V118 acknowledges and persists the event safely; a future workflow-execution phase will bind arbitrary inbound payloads to the Atlas workflow graph after node/action authorization is available at runtime.

## Connection lifecycle

Connections move through pending → connected → needs_reauth/error → disconnected.

Deleting a connection clears the encrypted provider secret. OAuth state is one-use and expires after ten minutes. Jobber refresh operations use a PostgreSQL advisory transaction lock so concurrent workers do not race a rotating refresh token.

## Production boundary

V118 contains real provider execution code, but repository implementation is not the same thing as live production connectivity.

A production deployment is incomplete until the deployment operator has:

1. created the required provider applications and deployment secrets
2. applied FINAL-MIGRATION-V118.sql and API-ROLE-GRANTS-V118.sql
3. set the real HTTPS ATLAS_PUBLIC_ORIGIN
4. configured Jobber webhook subscriptions
5. configured at least one real Zapier Catch Hook when Zapier is used
6. deployed the API and worker with a distinct restricted worker database role
7. run end-to-end connection, webhook, refresh, disconnect and replay tests against provider sandbox/test accounts
8. reviewed provider terms, rate limits and data-retention requirements

V118 does not claim live adapters for the remaining catalog providers.

## Official provider references

- Jobber developer docs: https://developer.getjobber.com/docs/
- Jobber OAuth authorization: https://developer.getjobber.com/docs/building_your_app/app_authorization/
- Jobber webhooks: https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/
- Zapier developer platform: https://developer.zapier.com/
