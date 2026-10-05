# Atlas V119 — Durable Workflow Execution Engine

## What V119 adds

V119 moves Atlas from “validated workflow definition + safe preview” to a durable execution control plane.

The release introduces a version-pinned workflow execution state machine and PostgreSQL persistence for:

- execution identity and graph checksum
- current node and execution status
- bounded step history
- retry scheduling and error codes
- approval requests and approval evidence references
- cancellation
- replay from the exact original workflow version/checksum
- immutable execution timeline events
- atomic enqueue of the corresponding `workflow.execute` job

The state machine is implemented in `packages/atlas-target/workflow-execution-engine.mjs`.

## Execution lifecycle

A live execution follows this bounded lifecycle:

`queued → running → queued`

and may transition to:

`waiting`, `waiting_approval`, `retryable`, `completed`, `failed`, `canceled`, or `dead_letter`.

The engine never rewrites history. Each transition creates a new immutable state version and appends an execution event.

### Version pinning

Each execution stores:

- workflow ID
- workflow version
- graph SHA-256 checksum

The saved graph snapshot is retained inside the execution state so a later workflow edit cannot silently change an in-flight run.

Replay creates a new execution identity while preserving the original workflow version and graph checksum.

### Retry safety

Retries use the node’s existing bounded retry policy. A retry is allowed only when the graph node is marked retry-safe.

The execution identity and queue identity remain deterministic for a logical run. The worker must use the queue idempotency key for any external side effect.

### Approval safety

Approval state is bound to:

- tenant
- execution
- workflow checksum
- node
- requestor
- expiration

The control-plane approval operation rejects expired approvals and self-approval.

Sensitive provider operations remain subject to the existing V111 trusted approval verifier when they are actually dispatched by a reviewed handler.

## PostgreSQL persistence

`infra/postgres/FINAL-MIGRATION-V119.sql` adds:

- `atlas_workflow_executions`
- `atlas_workflow_execution_events`

Both tables use forced tenant RLS.

Execution state contains no raw customer event field and is bounded by a database size check. Trigger and result data are references only.

The API application role can manage tenant-scoped execution rows. The worker role can process execution state without receiving grants on CRM/customer tables.

Apply `API-ROLE-GRANTS-V119.sql` as the database owner after the migration.

## API control plane

The authenticated Growth API now supports:

- `POST /api/v1/growth/workflows/:workflowId/executions` — start a published workflow when execution is explicitly enabled and a reviewed worker handler is declared ready
- `GET /api/v1/growth/workflows/:workflowId/executions` — list recent runs
- `GET /api/v1/growth/workflows/:workflowId/executions/:executionId` — inspect a run
- `POST /api/v1/growth/workflows/:workflowId/executions/:executionId/cancel` — cancel with an expected execution version
- `POST /api/v1/growth/workflows/:workflowId/executions/:executionId/approve` — approve with the authenticated actor identity
- `POST /api/v1/growth/workflows/:workflowId/executions/:executionId/replay` — create a new queued replay from a terminal failed/dead-letter/canceled run

All mutations use the existing origin and CSRF controls.

## Why execution is feature-gated

V119 deliberately does not ship a default business handler.

A queue row being created is not the same thing as a provider action being executed.

Production start therefore requires both:

`ATLAS_WORKFLOW_EXECUTION_ENABLED=true`

and

`ATLAS_WORKFLOW_EXECUTION_HANDLER_READY=true`

The second flag is an operator assertion that a deployment-reviewed worker module is installed. Atlas does not infer this from a UI toggle.

The worker still refuses to start if no handler module is configured.

## Current execution boundary

V119 still does **not** claim:

- live event ingestion from external providers
- live email/SMS/WhatsApp/social/voice sending
- real payment operations
- real calendar side effects
- model-provider execution
- durable customer-event payload storage
- full operator execution inspector UI
- production worker horizontal scaling
- verified production provider credentials

Those belong to V118 provider execution work and the remaining V119/V120/V125 deployment hardening.

## Flagship path

The target journey remains:

**Lead → CRM → qualify → follow up → book → update pipeline → measure outcome**

V117 proved the journey can be safely rehearsed. V119 now gives that journey a durable execution identity and control plane so the next reviewed provider/worker slice can plug into a real execution lifecycle without changing the core state model.

## Tests

V119 includes:

- execution creation and version/checksum pinning
- exactly-once completion behavior for a step transition
- approval request/resume
- retry/dead-letter behavior
- cancellation
- replay version pinning
- authenticated API start/control paths
- PostgreSQL persistence, RLS and worker-role separation

The repository CI remains the release gate.
