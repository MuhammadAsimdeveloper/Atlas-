# Atlas Architecture

Atlas is a laptop-first, multi-tenant Business Operating System unifying CRM, engagement, workflow automation, AI workforce, customer intelligence, knowledge, revenue operations, growth, integrations and a platform-owner control plane.

## Trust boundaries

Platform owner: global control-plane operations, tenant lifecycle, provider and infrastructure governance, and system-wide observability.

Tenant owner/admin: business configuration inside one tenant, subject to platform policy.

AI agent: never receives authority merely because a skill is assigned. It operates through server-side authorized tools and is constrained by actor permissions, agent configuration, skill capabilities, risk policy and approvals.

## Execution path

user or trigger -> actor authorization -> agent policy -> skill intersection -> risk/approval -> tool -> connector/provider -> audit/telemetry

## Proactive path

business signals -> Operational Pulse -> risk classification -> action proposal -> approval -> durable execution -> audit

## Data isolation

Every tenant-owned record and capability assignment must carry tenant_id. Cross-tenant access is a hard failure.

## Product posture

Laptop and desktop web are the primary operating environment. Mobile is a companion surface for notifications, approvals and lightweight monitoring.
