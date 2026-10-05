# P127 — Automation Execution Control Plane

## Purpose

P126 made communications executable. P127 starts the same transition for workflow automation: a tenant event can now enter Atlas, be deduplicated, resolve matching published workflows, and create durable execution jobs.

## Implemented

- POST /api/v1/automation/events
- explicit ATLAS_WORKFLOW_EVENT_INGRESS_ENABLED gate
- existing production workflow execution feature/handler gates
- replay-safe (tenant,event_ref) ledger
- tenant/RLS protected event records
- bounded resource references only
- published workflow trigger lookup
- durable workflow.execute creation
- per-workflow execution result reporting
- matched/failed event accounting

## Security

The event API authenticates the tenant session and requires the existing CSRF/origin mutation boundary. It does not persist arbitrary event bodies. Only a bounded {kind,id,version} resource reference and a server-derived SHA-256 digest are stored.

The event ledger is forced through tenant RLS. The worker role has no direct table privileges. Workflow execution remains behind the V125 reviewed worker handler and provider/consent/approval boundaries.

## Current limitations

P127 is intentionally the first slice, not the final automation platform. Remaining phases include:

1. durable timer/wait resume and schedule UI
2. execution inspector with step-level replay/debug data
3. event filtering/branch predicates and event-to-workflow routing policies
4. connector lifecycle, OAuth grant management and provider health
5. broad connector/action catalog
6. AI workflow builder and live agent sessions
7. environment promotion/version diff and rollback
8. Redis-backed distributed execution and production load/failover evidence

## Production activation

Do not enable ATLAS_WORKFLOW_EVENT_INGRESS_ENABLED=true until:

- a reviewed production workflow handler is deployed;
- the workflow execution flags are enabled;
- provider connections required by the workflows are verified;
- monitoring and dead-letter reconciliation are active;
- the managed PostgreSQL migration has been applied and tested.
