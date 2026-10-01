# Atlas Business Operating System

Atlas is a laptop-first, multi-tenant Business Operating System combining CRM, engagement, workflow automation, AI workforce, customer intelligence, knowledge, revenue operations, growth, integrations, governance and a platform-owner control plane.

## Current release: V90

V80–V85 established skills, capability intersection, connector reliability, evaluation, durable actions and the visual command center. V86–V90 turns those foundations into synchronization, worker-runtime, observability, customer-graph and revenue-graph contracts.

### Core capabilities
- CRM, engagement, deals and customer operations.
- Workflow automation, simulation and approval-gated actions.
- AI workforce, reusable skills, evaluations and governed assistant operations.
- Provider adapters, capability negotiation, incremental sync cursors and webhook dedupe.
- Durable queue jobs with idempotency, worker leases, heartbeats, retry and dead-letter recovery.
- OTLP-shaped traces and SLO/error-budget calculations.
- Tenant-scoped customer intelligence graph with bounded traversal and explainable health.
- Revenue cockpit and business graph projections.
- Laptop-first Business Command Center.

## Architecture

actor -> authorization -> agent -> skill -> risk/approval -> durable action/job -> provider adapter -> audit/telemetry

Customer and revenue context:
contacts + companies + deals + activities + knowledge + support + finance -> customer graph -> revenue cockpit -> governed action proposals

Provider capabilities never grant authority. Tenant boundaries and server-side policy remain authoritative.

## V80–V90 progression
- V80 Agent Skills Fabric + Operational Pulse
- V81 Capability Mesh + Proactive Action Loop
- V82 Connector Reliability Fabric
- V83 Agent Evaluation + Observability
- V84 Action Inbox + Durable Operations
- V85 Visual Business Command Center
- V86 Provider Adapter & Sync Fabric
- V87 Durable Worker / Queue Runtime
- V88 Full OTLP + SLO Observability
- V89 Customer Intelligence Graph
- V90 Revenue Command Center + Business Graph

## Development
Node.js 20+.

npm test
npm run check

The repository stays dependency-light so domain contracts remain deterministic and can later be backed by managed Postgres, Redis/queue infrastructure and an OTLP collector.

## Security
1. Tenant-owned records are tenant-bound.
2. Actor × agent × skill intersection controls effective tools.
3. Risky actions require server-side approval.
4. Sync and queue work is idempotent.
5. Provider adapters are not authorization boundaries.
6. Telemetry excludes secrets, tokens and message bodies.
7. Laptop/desktop is primary; mobile is a companion surface.

## Production hardening still required
Concrete provider adapters and OAuth/token rotation, managed queue workers, authenticated OTLP export, graph indexing, live API projections, historical forecast calibration and production load/failover testing.

See docs/ROADMAP-V86-V90.md, docs/DEEP-AUDIT-V86-V90.md, docs/V86-V90-IMPLEMENTATION.md, docs/COMPETITOR-BENCHMARK-2026-09.md and docs/RELEASE-CHECKLIST-V90.md.
