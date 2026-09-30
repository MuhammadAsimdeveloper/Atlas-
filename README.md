# Atlas Business Operating System

Atlas is a laptop-first, multi-tenant business operating system combining CRM, engagement, workflow automation, AI workforce, customer intelligence, knowledge, revenue operations, growth, integrations, governance, and an owner-only platform control plane.

Current release: **V80.0.0** — Agent Skills Fabric + Operational Pulse.

## Architecture
- Platform Owner: global Atlas control-plane authority.
- Customer Owner/Admin: tenant-scoped business administration only.
- AI agents: governed tools, approvals, memory, workflows, knowledge and customer context.
- Agent Skills Fabric: reusable capability bundles that narrow an agent's tool set.
- Operational Pulse: deterministic business-risk snapshot for proactive operations.
- Production target: managed PostgreSQL + Redis + object storage + CDN/WAF + OpenTelemetry.

See docs/ for the living engineering and competitive research documents.
