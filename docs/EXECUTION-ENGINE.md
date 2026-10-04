# Atlas execution engine — V116

## Implemented

V115 adds a PostgreSQL-backed job queue, event outbox and interval scheduler. Growth Center creates, edits and lifecycle changes write their tenant audit event and an outbox reference in the same database transaction. Queue and outbox payloads accept only a resource kind, opaque resource ID and optional integer version; message bodies, credentials and arbitrary JSON are rejected.

The queue supports idempotent enqueue, delayed execution, `FOR UPDATE SKIP LOCKED` claims, bounded leases, lease renewal, completion, exponential retry with a one-hour cap, dead-letter state and stale-lease recovery. The scheduler materializes due one-shot and recurring jobs transactionally, coalesces missed intervals instead of replaying a burst, and supports pause. Recurrence is interval-based in UTC with a 60-second minimum and 31-day maximum; cron/time-zone rules are not included.

`apps/worker/runtime.mjs` runs only registered job/event handlers, claims only their declared types, renews leases, passes an abort signal and drains active work on shutdown. `apps/worker/main.mjs` requires a distinct `atlas_worker` database identity in production and loads a reviewed handler module from `apps/worker/handlers/`. The worker is an at-least-once delivery system; all side-effect handlers must use the supplied job idempotency key or outbox event ID.

## V116 workflow authoring

The authenticated workspace provides a visual editor over Atlas's existing versioned workflow graph contract. Trigger and node definitions come from `GET /api/v1/growth/workflows/catalog`, which applies the active tenant membership and workflow-read permission check. Graph saves continue through the strict record validator and immutable revision/audit path. The UI marks external adapter dependencies and states that workflow jobs are not connected. This adds authoring; it does not add a graph interpreter or claim that publishing executes a workflow.

## Database boundary

`atlas_app` can submit tenant-scoped jobs/outbox events/schedules through RLS and narrow operations. It cannot claim, complete or fail work. `atlas_worker` is non-superuser, non-inheriting and `NOBYPASSRLS`; its RLS policy exposes only queue metadata in three runtime tables. It has no grants on CRM, auth, billing, or other customer tables. Both roles must remain separate and must not own Atlas relations.

Apply all forward migrations, then run `infra/postgres/API-ROLE-GRANTS-V115.sql` as the database migration owner. Provision a credential for `atlas_worker` through the deployment secret manager. Never put that connection string in the API container. Production readiness requires V115 tables, while the worker additionally checks its exact role at startup.

## Not yet connected

- No default event or job handlers ship; the worker intentionally refuses to claim jobs until a reviewed handler module is mounted.
- Workflow graph traversal, waits/resume, approval resume, retries/replay UI and provider actions are not yet connected to this queue. The V116 visual Studio is an authoring surface only.
- Redis is present in the Compose reference but is not used by the V115 queue. PostgreSQL is the durable source; no distributed Redis rate limiter or broker adapter is included.
- No worker health endpoint, queue dashboard, OpenTelemetry exporter, object storage, KMS secret vault, or measured horizontal-capacity result is included.
- No live email, messaging, social, calendar, voice, AI-model, or payment-effect handler is claimed by this release.

The queue and scheduler mechanics have isolated PGlite integration coverage under both restricted roles. This verifies SQL behavior in the test engine; it does not verify a managed production PostgreSQL deployment, broker/provider integration, or millions-of-users capacity.
