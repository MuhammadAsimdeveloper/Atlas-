# Atlas execution engine — V120

## Implemented

V115 adds a PostgreSQL-backed job queue, event outbox and interval scheduler. Growth Center creates, edits and lifecycle changes write their tenant audit event and an outbox reference in the same database transaction. Queue and outbox payloads accept only a resource kind, opaque resource ID and optional integer version; message bodies, credentials and arbitrary JSON are rejected.

The queue supports idempotent enqueue, delayed execution, `FOR UPDATE SKIP LOCKED` claims, bounded leases, lease renewal, completion, exponential retry with a one-hour cap, dead-letter state and stale-lease recovery. The scheduler materializes due one-shot and recurring jobs transactionally, coalesces missed intervals instead of replaying a burst, and supports pause. Recurrence is interval-based in UTC with a 60-second minimum and 31-day maximum; cron/time-zone rules are not included.

`apps/worker/runtime.mjs` runs only registered job/event handlers, claims only their declared types, renews leases, passes an abort signal and drains active work on shutdown. `apps/worker/main.mjs` requires a distinct `atlas_worker` database identity in production and loads a reviewed handler module from `apps/worker/handlers/`. The worker is an at-least-once delivery system; all side-effect handlers must use the supplied job idempotency key or outbox event ID.

## V119 durable workflow execution

The V117 authenticated workspace provides a visual editor and safe preview over Atlas's versioned workflow graph contract. V119 adds `packages/atlas-target/workflow-execution-engine.mjs`, a version-pinned state machine for queued/running steps, bounded retries, approval pauses, cancellation and replay. Durable executions persist to `atlas_workflow_executions` with append-only execution events and are atomically handed to the existing `workflow.execute` queue job. V120 removes direct worker access to execution tables and exposes only lease-bound execution RPCs through the worker adapter. The control plane does not fabricate provider completion: a queued execution remains queued until a reviewed worker handler actually processes it.

## Database boundary

`atlas_app` can submit tenant-scoped jobs/outbox events/schedules through RLS and narrow operations. It cannot claim, complete or fail work. `atlas_worker` is non-superuser, non-inheriting and `NOBYPASSRLS`; it can claim queue work through narrow RPCs, but V120 removes direct grants on workflow execution tables as well. Durable execution reads, updates and timeline writes require proof of the current `workflow.execute` lease. Both roles must remain separate and must not own Atlas relations.

Apply all forward migrations, then run `infra/postgres/API-ROLE-GRANTS-V115.sql`, `infra/postgres/API-ROLE-GRANTS-V119.sql` and `infra/postgres/API-ROLE-GRANTS-V120.sql` as the database migration owner. Provision a credential for `atlas_worker` through the deployment secret manager. Never put that connection string in the API container. Production readiness requires V115 tables, while the worker additionally checks its exact role at startup.

## V119 API control plane

The authenticated Growth API supports `start`, `list`, `inspect`, `cancel`, `approve` and `replay` operations for workflow executions. Starting a workflow requires the published workflow graph, a bounded trigger-event reference, and both execution feature flags. The start transaction persists the execution and queues `workflow.execute` together; there is no state where a successful API response claims a provider action has already happened.

## Not yet connected

- No default event or job handlers ship; the worker intentionally refuses to claim jobs until a reviewed handler module is mounted.
- Live external trigger ingress, provider node handlers, durable wall-clock waits, model execution, communication delivery and a full execution inspector UI are still not connected. V119 supplies the durable control/state boundary those handlers will plug into.
- Redis is present in the Compose reference but is not used by the V115 queue. PostgreSQL is the durable source; no distributed Redis rate limiter or broker adapter is included.
- No worker health endpoint, queue dashboard, OpenTelemetry exporter, object storage, KMS secret vault, or measured horizontal-capacity result is included.
- No live email, messaging, social, calendar, voice, AI-model, or payment-effect handler is claimed by this release.

The queue and scheduler mechanics have isolated PGlite integration coverage under both restricted roles. This verifies SQL behavior in the test engine; it does not verify a managed production PostgreSQL deployment, broker/provider integration, or millions-of-users capacity.
