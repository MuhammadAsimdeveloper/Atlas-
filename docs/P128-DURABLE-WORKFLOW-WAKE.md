# P128 — Durable workflow wake/resume control

## Purpose

P127 can create durable workflow executions, and V119 already models bounded waiting and retryable states. P128 connects those states to the production queue so delayed automation can resume without manual intervention.

## Implemented

- worker-cycle wake hook for workflow.execute deployments
- atlas_v128_tick_workflow_executions() using FOR UPDATE SKIP LOCKED
- due waiting executions are re-queued from state.resumeAt
- due retryable executions are re-queued from retry_at
- optimistic version check prevents duplicate state transitions
- tenant-scoped, opaque workflow.execute queue payloads only
- idempotency key prevents duplicate wake jobs
- V128 migration/grant/doctor/test coverage

## Production boundary

The wake scheduler does not execute customer actions itself. It only moves due durable executions back to queued and creates a reference-only job. The reviewed V125 worker handler remains responsible for graph traversal, provider verification, consent/approval checks, retries and provider side effects.

The phase is production-ready at the source/runtime boundary, but a deployment is not considered Live merely because the migration exists: the managed PostgreSQL migration, restricted worker role, reviewed handler module, provider credentials, monitoring and operational failover evidence must be verified in the target environment.

## Next missing production phases

1. execution inspector timeline and step-level operator diagnostics
2. schedule authoring UI and timezone/DST-aware trigger definitions
3. event predicates/branch routing and automation guardrails
4. connector lifecycle/OAuth grant rotation/provider health
5. broad app/action catalog
6. AI workflow builder and live agent sessions
7. environment promotion/diff/rollback
8. distributed Redis execution and load/failover evidence
