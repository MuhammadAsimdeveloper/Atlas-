# Atlas V86–V90 Frontier Roadmap

## V86 — Provider Adapter & Sync Fabric
Provider-neutral adapters, capability negotiation, tenant-scoped incremental sync cursors and webhook deduplication.

## V87 — Durable Worker / Queue Runtime
Tenant-bound jobs, idempotency, worker leases, heartbeats, bounded retry, lease recovery and dead-letter handling.

## V88 — Full OTLP + SLO Observability
OTLP-shaped trace requests, stable Atlas resource attributes, SLO ratio, error budget and burn-rate calculations.

## V89 — Customer Intelligence Graph
Tenant-scoped customer/deal relationship graph, bounded path queries and deterministic health scoring.

## V90 — Revenue Command Center + Business Graph
Revenue cockpit for pipeline, weighted pipeline, wins, customer health and expansion/retention signals, composed with the customer graph.

## Security invariants
1. Every sync, queue and graph record is tenant-bound.
2. Provider capabilities never grant authority.
3. High-impact actions remain approval-gated.
4. Idempotency is enforced server-side.
5. Telemetry excludes secrets and message bodies.

## Production frontier after V90
Concrete provider adapters; managed Redis/Postgres workers; authenticated OTLP collector; graph indexes; live command-center API projections; forecast calibration; load/failover testing.
