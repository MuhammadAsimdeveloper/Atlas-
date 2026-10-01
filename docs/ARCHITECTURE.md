# Atlas Architecture

Atlas is a laptop-first, multi-tenant Business Operating System unifying CRM, engagement, workflow automation, AI workforce, customer intelligence, knowledge, revenue operations, growth, integrations and a platform-owner control plane.

## Trust boundaries
Platform owner: global control-plane operations, tenant lifecycle, provider and infrastructure governance, and system-wide observability.

Tenant owner/admin: business configuration inside one tenant, subject to platform policy.

AI agent: never receives authority merely because a skill is assigned. It operates through server-side authorized tools constrained by actor permissions, agent configuration, skill capabilities, risk policy and approvals.

Provider adapter: translates external systems into Atlas contracts. It never becomes an authorization boundary.

Worker: receives a tenant-bound durable job lease. UI state is never treated as proof of execution.

## Execution path
user or trigger -> authorization -> agent -> skill -> risk/approval -> durable action/job -> provider adapter -> audit/telemetry

## Synchronization path
provider event/pull -> adapter contract -> webhook dedupe or sync cursor -> tenant-bound mutation -> graph projection -> revenue/command-center projection

## Proactive path
business signals -> Operational Pulse -> risk classification -> action proposal -> approval -> durable execution -> audit

## Customer and revenue graph
contacts + companies + deals + activities + knowledge + support + finance -> customer intelligence graph -> revenue cockpit -> governed action proposals

Graph traversal is bounded. Production persistence should use indexed graph projections and temporal history.

## Observability
Agent, action, queue, connector and provider operations expose stable identifiers for OTLP-compatible tracing. SLO windows track good/total events, targets and error-budget consumption.

## Data isolation
Every tenant-owned record and capability assignment carries tenant_id. Cross-tenant access is a hard failure.

## Product posture
Laptop and desktop web are primary. Mobile is a companion surface for notifications, approvals and lightweight monitoring.
