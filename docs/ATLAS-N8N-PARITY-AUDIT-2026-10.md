# Atlas n8n Parity + Hardening Audit — 6 October 2026

## Executive finding

Atlas already has a broad automation foundation: triggers, conditions, switch, merge, waits, rate limiting, data mapping, HTTP/provider actions, AI actions, approvals and sub-workflows are represented in its workflow catalog. The major n8n gap was not basic node count; it was the surrounding workflow-product layer.

V146 therefore adds governance and operational capabilities around the workflow graph instead of copying n8n's unrestricted execution model.

## n8n-derived gaps closed by V146

| n8n-style capability | Atlas status after V146 | Hardening |
|---|---|---|
| Looping/splitting/aggregation | Implemented | Explicit item/iteration bounds |
| Error trigger/stop-and-error | Implemented | Reference-only error context and bounded error codes |
| Respond to webhook | Implemented | Response is reference-bound |
| Execution filters | Implemented | Tenant filter mandatory; customer payloads removed |
| Retry failed executions | Implemented as retry planner | Stable side-effect key; unsafe retries blocked |
| Templates | Implemented | Tenant-scoped, versioned, placeholder substitution revalidated |
| Environments/source control | Implemented as control contract | Protected production + manifest-bound promotion |
| Human-in-the-loop | Implemented as exact approval contract | TTL, tenant/workflow/execution/node binding, no self-approval |
| MCP | Implemented as scoped manifest/authorization contract | Capability intersection; risky tools approval-gated |
| AI workflow builder | Implemented as proposal contract | Draft-only; no production mutation |
| Security audit | Implemented | Direct URLs/secrets/unprotected webhook/risky action findings |
| Arbitrary shell execution | Explicitly not enabled | Atlas refuses host command execution in workflows |

## Existing Atlas strengths retained

- CRM tenant isolation and versioned pipeline mutations.
- Calendar availability/holds/versioned booking.
- Voice consent/suppression/call-window and handoff controls.
- Unified inbox/provider execution boundaries.
- Durable workflow execution state and replay controls.
- Worker isolation and distributed runtime evidence.
- SEO-safe preview/public publication.
- Provider callback verification and idempotency primitives.

## Remaining product gaps

V146 does not magically make live external systems connected. The remaining gaps are primarily runtime/product surface and deployment evidence:

- persistent Agent Studio/session UI and live model adapters;
- actual telephony/email/WhatsApp/calendar provider credentials and callbacks;
- public website/funnel form ingress and publishing infrastructure;
- live Redis wakeup/worker fleet;
- autoscaler actuator;
- OTLP destination and alerting;
- external KMS/secrets manager;
- backup/PITR/failover drills;
- multi-region infrastructure;
- workflow/community marketplace;
- richer connector pagination/conflict reconciliation;
- full CRM timeline/import/export/custom-object UX.

