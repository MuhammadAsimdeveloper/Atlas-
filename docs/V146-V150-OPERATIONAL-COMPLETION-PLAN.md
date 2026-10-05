# Atlas V146-V150 Operational Completion Plan

## Purpose

This plan converts the MiroFish decision record and the repository audit into the next executable production frontier.

The MiroFish evidence in `docs/MIROFISH-ATLAS-DECISION-RECORD-2026-10.md` is treated as hypothesis-generation, not market proof. The engineering objective is to make one complete customer outcome reliably executable, observable and recoverable before expanding feature count.

## MiroFish-derived product thesis

The simulated stakeholders consistently elevate five requirements:

1. Atlas must provide a compelling switching reason instead of merely matching feature count.
2. The first flagship outcome should be a complete lead-to-revenue workflow:
   Lead -> CRM -> qualification -> follow-up -> appointment -> pipeline update -> reporting.
3. Trust must be visible in product behavior: honest provider status, bounded automation, auditability, recoverability and safe failure.
4. Free-tier economics require strict resource controls around workflow executions, messaging and model usage.
5. Execution reliability is a stronger near-term moat than adding another disconnected feature family.

These are product hypotheses. Real beta usage, interviews, activation data and retention evidence remain required.

## Current audited state

The repository contains V139-V145 distributed-runtime foundations:
- PostgreSQL remains the durable authority.
- Redis has a native bounded RESP2 client and worker wakeup path.
- Autoscaling, failover, OTLP and deployment evidence contracts exist.
- Runtime control events and dispatch state exist.
- The workflow engine, tenant isolation, approvals, provider adapters and unified inbox are implemented at the repository boundary.

The remaining gap is operational integration: actuators, alert delivery, provider reconciliation, executable recovery drills and infrastructure evidence automation.

## V146 — Autoscaler actuator and control loop

### Goal
Turn autoscaling decisions into durable, single-leader, bounded actuator operations.

### Deliverables
- Durable scaling decision/actuation tables.
- Per-pool scaler lease so only one worker can actuate.
- SLO/error-budget-aware control loop.
- Pluggable HTTPS actuator with strict bounds and idempotency.
- Dry-run mode for development.
- Backoff/cooldown protection.
- Runtime control-event evidence.
- Worker integration.
- Tests for scale-up, scale-down, cooldown, actuator failure and leadership loss.

### Exit criteria
- A scale decision is persisted before an actuator call.
- Only the scaler leader can actuate.
- An actuator failure never changes durable worker truth.
- Repeated decisions with the same decision identity are idempotent.
- Missing actuator configuration leaves Atlas in advisory mode and never claims capacity changed.

## V147 — Real OTLP/SLO alert delivery

### Goal
Turn durable SLO evaluations into actual, bounded incident notifications.

### Deliverables
- Durable alert-delivery attempts.
- Destination health state.
- HMAC-signed HTTPS webhook alerts.
- Optional mailer adapter boundary.
- Per-destination retry/backoff.
- Delivery deduplication.
- Alert acknowledgment/resolution tracking.
- Runtime worker integration.
- Tests for signature, retry, destination failure, duplicate delivery and recovery.

### Exit criteria
- An alert has one deterministic delivery identity per destination.
- Failed destinations retry without duplicating successful deliveries.
- Alert routing is independent from customer payload storage.
- Incident resolution stops further notifications.

## V148 — Provider reconciliation and idempotency fabric

### Goal
Handle ambiguous provider outcomes without unsafe automatic duplicate sends.

### Deliverables
- Durable provider action ledger.
- Explicit states: pending, sent, ambiguous, reconciliation_required, reconciled, failed.
- Provider idempotency identity bound to tenant/action.
- Reconciliation adapter contract with optional provider lookup.
- Backoff and reconciliation windows.
- Worker integration with provider runtime.
- Tests for success, timeout-after-send, provider lookup, stale lookup, cross-tenant protection and duplicate suppression.

### Exit criteria
- Ambiguous provider outcomes are never automatically re-sent.
- Reconciliation can safely convert an ambiguous action to reconciled.
- Provider callbacks/receipts cannot cross tenants.
- Replayed action IDs cannot create a second side effect.

## V149 — Executable recovery and disaster-recovery drills

### Goal
Make the recovery matrix runnable and auditable.

### Deliverables
- Drill runner with scenarios: worker crash, Redis failure, PostgreSQL failure, duplicate execution, split brain.
- Step-by-step bounded execution model.
- Evidence SHA-256.
- Pass/fail criteria.
- Drill history and operator summaries.
- CI-safe simulated drills.
- Optional live-drill hooks for deployment environments.

### Exit criteria
- Every scenario has an executable simulation.
- Drill artifacts are reference-only and contain no credentials/customer payloads.
- Recovery behavior matches the failover state machine.
- Failed drills block the production readiness gate.

## V150 — Production infrastructure/IaC evidence automation

### Goal
Make infrastructure readiness machine-verifiable.

### Deliverables
- Production manifest schema.
- IaC evidence checker.
- Managed PostgreSQL/Redis/KMS/WAF/CDN/PITR/restore/load/DR/provider/domain controls.
- Expiration-aware evidence records.
- Deployment gate report.
- Optional Terraform module references without hard-coded cloud secrets.
- CI launch gate.
- Operator command for generating the evidence report.

### Exit criteria
- A deployment cannot be called production-ready without all mandatory controls verified.
- Evidence is hashed and time-bounded.
- Missing or expired controls fail closed.
- Repo readiness and live infrastructure evidence remain separate.

## End-to-end launch sequence

1. Merge and validate V144/V145.
2. Run V146 control loop in advisory mode.
3. Configure a real autoscaler actuator and verify measured scaling.
4. Enable V147 alert destinations and prove alert delivery.
5. Configure real provider idempotency/reconciliation adapters and run ambiguity drills.
6. Run V149 recovery drills against staging.
7. Record V150 infrastructure evidence for the exact production deployment.
8. Run the flagship workflow end to end with real providers.
9. Perform tenant-isolation, backup/restore, load and failover evidence.
10. Only then enable the real public origin, provider production traffic and indexing.

## Product launch gate

Atlas is launch-ready only when:
- the flagship workflow completes successfully from ingress to customer-visible outcome;
- provider failures are recoverable without unsafe duplicate side effects;
- SLO breaches create and route alerts;
- recovery drills pass;
- infrastructure evidence is current;
- external provider credentials, domain, WAF, backup/restore and measured load/failover are verified.

Feature count is not a launch criterion.
