# Atlas V82–V85 Implementation

## V82 — Connector Reliability Fabric

Atlas now has a provider-neutral reliability contract: connector health states (unknown, healthy, degraded, unhealthy), latency/error-rate signals, credential validity, advertised-vs-observed capability drift, bounded exponential backoff, and persisted health/capability snapshots.

A connector is degraded when advertised capabilities disappear, latency exceeds the operating threshold, or recent error rate crosses the degraded threshold. It is unhealthy when credentials are invalid or error rate reaches the hard failure threshold.

Provider adapters should feed this contract rather than embedding provider-specific policy in the UI.

## V83 — Agent Evaluation + OpenTelemetry Observability

Golden evaluations compare expected tool set, expected outcome, and tenant-safe trace context. A release gate can enforce minimum evaluation score, maximum error rate and zero critical failures.

The telemetry facade is dependency-light so domain tests remain deterministic. In a deployed Node service, inject OpenTelemetry tracer/meter implementations. Atlas operation names and attributes should follow OpenTelemetry semantic conventions.

References:
- https://opentelemetry.io/docs/languages/js/instrumentation/
- https://opentelemetry.io/docs/concepts/semantic-conventions/

## V84 — Action Inbox + Durable Operations

Actions use an explicit state machine:

proposed -> pending_approval -> approved -> running -> succeeded

with controlled failure/cancellation/compensation paths.

Every action requires tenant and actor identity. Idempotency keys prevent duplicate execution. Postgres adds action records and append-only action events so runtime state can recover after process failure.

Approval is a state transition, not a UI decoration. Execution must reject actions that have not reached approved.

## V85 — Visual Business Command Center

The command center is laptop-first and operational. It presents revenue/pipeline, connector health, agent evaluation score, approval queue, operational risks, action inbox and AI workforce release status.

The UI is a presentation surface over the domain snapshot contract so the production web app can bind live tenant data without changing domain semantics.

## Multi-tenant safety

All persisted tables include tenant_id. Every repository query must bind to the authenticated tenant. Cross-tenant trace records fail evaluation rather than being silently ignored.
