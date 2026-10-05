# P127 — Durable Workflow Resume Runtime

P127 converts workflow wait/retry/approval state into real durable scheduling.

## Problem closed

Before P127, Atlas persisted waiting and retryable execution states, but the worker did not always create the next workflow.execute job that should wake the execution. A state could therefore be correct in PostgreSQL while no future worker invocation existed.

## Runtime contract

- delay schedules a new workflow.execute job at resumeAt.
- wait_until schedules a new workflow.execute job at the requested future time.
- retryable steps schedule the next execution at retryAt.
- early lease/replay handling can safely request the same resume again because the resume identity is tenant/execution/kind/version bound and idempotent.
- approval acceptance creates a new workflow.execute job for the newly queued execution version.
- the worker can request scheduling only through atlas_v127_schedule_workflow_resume, which proves the currently leased workflow.execute job before creating the future job.
- future queue payloads contain only the execution reference and immutable version; customer content and secrets are not copied into the queue.

## Security

The resume RPC is SECURITY DEFINER, uses a fixed pg_catalog,public search path, accepts only the restricted atlas_worker session, validates the active lease, and is executable only by atlas_worker.

## Verification

The P127 test suite covers wait scheduling and replay-safe resume requests. CI must additionally verify the complete repository migration chain and production activation checks before merge.

## Remaining execution frontier

P127 makes durable waits/retries real, but the broader automation frontier still includes event-triggered workflow starts, broad CRM/action node handlers, production agent/model execution, calendar/social connectors, workflow inspection UI and measured distributed worker scaling.
