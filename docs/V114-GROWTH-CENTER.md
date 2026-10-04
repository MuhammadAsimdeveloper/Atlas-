# V114 Growth Center — CRM, builders and Paddle Billing

V114 connects the requested Growth Center areas to authenticated, tenant-scoped PostgreSQL records and a laptop-first workspace UI. It delivers a common record lifecycle, not a claim that every downstream provider or every HighLevel product is already running.

## What is live after deployment

The API exposes tenant-scoped create/read/update operations for Contacts, Leads, Pipelines, Tasks, AI Lead Qualification policies, AI Follow-up sequences, Workflow definitions, Email templates, Funnels, Websites, Social Planner posts, Affiliate campaigns and Reputation Management policies.

Every saved record has:

- server-resolved tenant and actor; caller-supplied tenant/global-role fields are rejected;
- module-specific, allowlisted payload validation with size, type and reference checks;
- SHA-256 checksums, optimistic version checks, immutable revision history and append-only activity events;
- create idempotency via `Idempotency-Key` and module/tenant-scoped uniqueness;
- owner/admin access, scoped custom-role permissions and member access only for CRM writes permitted by their role.

Lead links must resolve to same-tenant active contacts and pipelines, stage IDs must belong to the selected pipeline, and task assignees must be active workspace members. CRM phone values require E.164 format. Contact consent defaults to false per channel; the product does not infer consent from a record or a source.

AI qualification profiles, AI follow-up sequences and workflows are saved, versioned definitions. A published qualification profile can be run against operator-entered 0–100 criterion scores and evidence references; the deterministic weighted result updates the lead's immutable revision and audit timeline. Missing evidence always requires review, and profiles default to mandatory human review. This is not model inference. V114 does not automatically qualify live inbound leads, run a workflow worker, schedule/send follow-up, or send an email. The UI labels these as drafts/configurations until a governed provider runtime and durable workers are deployed.

Email templates have plain text and restricted HTML modes. Funnels and Websites contain a bounded safe block set and SEO metadata; preview output escapes content and remains noindex. Publication/indexing fails until domain verification is integrated. Social posts support a future schedule and explicit approval state but are not sent to social networks. Affiliate campaign rules and minor-unit commission math exist, but attribution, affiliate enrollment/portal and payouts are not connected. Reputation policies require a neutral request to every eligible completed customer and forbid incentives; review ingestion and AI response are not connected.

## API

All routes require an authenticated session with an active tenant membership. Mutations also require same-origin and CSRF validation. Active membership is re-read from PostgreSQL for each request; Khan's platform-owner authority is not a tenant membership bypass.

| Route | Purpose |
| --- | --- |
| `GET /api/v1/growth/overview` | Read permission-filtered module counts and explicit provider capability flags |
| `GET /api/v1/growth/:module` | Search/paginate current tenant records |
| `POST /api/v1/growth/:module` | Validate and create a record; optional `Idempotency-Key` |
| `GET /api/v1/growth/:module/:id` | Read a tenant record after module permission check |
| `PATCH /api/v1/growth/:module/:id` | Create a new immutable revision with `expectedVersion` |
| `POST /api/v1/growth/:module/:id/:action` | Publish, pause, approve, complete, cancel or archive supported records |
| `POST /api/v1/growth/leads/:id/move-stage` | Move a lead with expected-version, pipeline-scope and stage transition policy checks |
| `GET /api/v1/growth/ai-qualification?publishedOnly=true` | List only published rubrics for CRM lead operators |
| `POST /api/v1/growth/ai-qualification/:id/evaluate` | Score an authorized lead from criterion ratings/evidence and append a reviewable revision |
| `GET /api/v1/billing/plans` | Read the configured plan catalog and checkout readiness |
| `GET /api/v1/billing/subscription` | Read the active tenant subscription for billing-authorized users |
| `POST /api/v1/billing/checkout` | Create server-side Paddle checkout for owner/admin/billing manager |
| `POST /api/v1/webhooks/paddle` | Verify exact raw-body Paddle HMAC, normalize event and apply idempotently |

An `expectedVersion` conflict returns HTTP 409 and does not overwrite a newer edit. Backward lead movement is blocked when the pipeline requires approval; V114 does not silently treat an administrator as approval evidence. Published rubric reads are tenant-bound and exposed only to lead operators. Owners/admins can operate their company workspace; a company admin cannot grant or receive platform-owner access.

## Paddle setup

The API requires an explicit Paddle `sandbox` or `live` environment before creating transactions; it never defaults to live mode. It calls only the Paddle API origin for that mode. The API key stays server-side; the browser receives only an allowlisted HTTPS checkout URL. Subscription events are checked against configured plan price IDs and signed tenant/plan metadata. Raw webhook bodies, credentials and payment details are not stored. Event IDs are deduplicated, tenant lifecycle events serialize before reconciliation, and older events cannot overwrite newer subscription state.

Configure these deployment secrets/values when ready:

```text
ATLAS_PADDLE_ENVIRONMENT=sandbox|live
ATLAS_PADDLE_API_KEY=...
ATLAS_PADDLE_WEBHOOK_SECRET=...
ATLAS_PADDLE_PRICE_STARTER=pri_...
ATLAS_PADDLE_PRICE_GROWTH=pri_...
ATLAS_PADDLE_PRICE_SCALE=pri_...
```

Create the plans/prices and webhook destination in the Paddle dashboard. Use sandbox events first. Customer portal management, seat/usage entitlements, proration, refunds, dunning and plan enforcement are not implemented in V114.

## Database rollout

Use the separate schema-owner connection with the migration runner. Then extend the restricted runtime role:

```powershell
$env:ATLAS_MIGRATION_DATABASE_URL = '<schema-owner connection>'
npm run db:migrate
psql $env:ATLAS_MIGRATION_DATABASE_URL -f infra/postgres/API-ROLE-GRANTS-V114.sql
```

The API should continue to use the non-owner `atlas_app` database role. The migration is forward-only and checksum-tracked. Health readiness stays blocked until identity, Growth Center and Paddle tables are present. `FINAL-MIGRATION-V114.sql` was executed by the repository's ephemeral PostgreSQL-compatible migration/RLS tests; that does not mean it has been applied to a managed production database.

Production API startup now queries PostgreSQL role/catalog metadata and exits if the connection is not `atlas_app`, has elevated database/role privileges or RLS bypass, can assume another role, or owns an Atlas relation. The check is exercised both through unit negative cases and the actual `atlas_app` PGlite RLS integration path.

## HighLevel and n8n coverage after V114

V114 adds authenticated persistence and first-party UI for the 13 requested modules above, versioned drafts, lifecycle gates, Paddle transaction checkout/webhook reconciliation, tenant permission filters and record audit history. It adds policy-checked pipeline stage moves and a human-reviewable qualification scoring surface. It does not provide HighLevel parity for unified conversations, forms/surveys, calendar booking UI, bulk import/export, campaign delivery, social account integration, affiliate attribution/payouts, review aggregation, SaaS provisioning/white-label, membership courses or mobile app.

V114 adopts n8n patterns that fit Atlas: typed definitions, draft/publish/pause lifecycle, optimistic versions, idempotent create, append-only history, relationship validation, explicit approval state, webhook signature verification and runtime capability reporting. Visual node-canvas editing, sub-workflow execution, durable wait/retry/replay, schedule execution, OAuth/credential management, worker fleet, template marketplace and full execution inspector remain deployment/product work.

V115 adds a PostgreSQL queue, transactional outbox, interval scheduler, worker role and generic worker loop. It still does not execute workflow graphs or ship real event/provider handlers. See [V115 Execution Engine](EXECUTION-ENGINE.md) for exact role and delivery semantics.

The larger family-by-family inventory and current official source links are in [the V114 competitor feature matrix](COMPETITOR-FEATURE-MATRIX-2026-10.md), [the n8n architecture review](N8N-ARCHITECTURE-REVIEW-2026-10.md), and [the HighLevel benchmark](COMPETITOR-BENCHMARK-2026-10.md).

## Scale and production boundary

The local JSON/state adapter remains development-only. Use managed PostgreSQL for authoritative records and durable queue state, optional managed Redis for ephemeral acceleration, separate horizontally scalable API/webhook/worker services, managed object storage for media, a CDN and WAF at the public edge, and an OpenTelemetry collector for redacted traces. Apply per-tenant quotas/fair scheduling, provider rate limits and graceful queue draining before turning on volume features. V115 includes queue and scheduler mechanics, not object storage, CDN, WAF, autoscaler or millions-of-users benchmark.

The checked-in Docker Compose file is a deployment template: provide the PostgreSQL bootstrap password out of band, complete the documented migrations/runtime-role setup, configure the HTTPS edge and provider secrets, and run a Docker image build in the deployment pipeline. Docker is not installed in the current build environment, so the container build has not been verified here.

Khan remains the only global Atlas platform owner. All Growth Center operations still require the account's current active tenant membership, even when the signed-in account is Khan's platform-owner account.
