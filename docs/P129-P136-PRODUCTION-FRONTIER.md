# P129–P136 — Production engineering frontier

## P129 Execution Inspector + Debug/Replay
- Durable diagnostics reference records are tenant-isolated and do not store customer payloads.
- Replay requests pin source and target workflow versions and are auditable.
- Runtime store exposes a tenant-authorized execution inspector returning execution metadata, timeline, diagnostics and replay history.

## P130 Real Scheduler
- Added cron, interval and calendar schedule definitions.
- Each schedule pins a workflow version, timezone and explicit DST policy.
- `next_run_at` remains the durable queue handoff boundary.
- A full cron/calendar calculation service and production scheduler fleet still require deployment/runtime implementation.

## P131 Advanced Event Routing
- Added ordered event routes with bounded JSON predicates and branch keys.
- Added tenant-scoped deduplication windows.
- Event payloads remain outside the routing tables.

## P132 Connector Lifecycle
- Added installation lifecycle state, opaque credential references, scope hashes, token expiry and provider health events.
- Raw OAuth tokens/secrets are intentionally absent from PostgreSQL.
- Real provider OAuth/KMS integrations remain external deployment work.

## P133 Broad Action Catalog
- Added versioned action definitions, bounded input/output schemas, risk classes and approval requirements.
- Added tenant action bindings.
- Provider-specific action implementations remain behind the existing capability/provider runtime.

## P134 AI Workforce Runtime
- Added governed agent sessions, channel identity, memory scope and human tool approvals.
- Customer context is reference-only.
- Model/knowledge providers, streaming and recursive delegation remain separately gated.

## P135 Environment Promotion
- Added draft/staging/production environment records.
- Added manifest-hash promotion records and rollback evidence.
- Credentials are not copied into releases.

## P136 Distributed Production Runtime
- Added runtime pool configuration, worker heartbeats and SLO samples.
- PostgreSQL remains the authoritative durable state boundary.
- Redis/horizontal worker deployment, load testing, failover and measured SLO evidence remain infrastructure gates.

## Production-readiness rule

These phases are implemented as durable control-plane foundations and tenant/RLS contracts. They must not be represented as externally Live until the corresponding provider, scheduler, KMS, Redis, monitoring and deployment evidence exists.