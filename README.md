# Atlas Business Operating System

Atlas is a laptop-first, multi-tenant business operating system combining CRM, engagement, workflow automation, AI workforce, customer intelligence, knowledge, revenue operations, growth, integrations, governance and an owner-only platform control plane.

Current release: V81.0.0 — Capability Mesh + Proactive Action Loop.

## V81

- Actor × Agent × Skill capability intersection.
- Hard tenant-boundary enforcement.
- Approval gates for side-effect capabilities.
- Connector capability negotiation without permission escalation.
- Operational Pulse risk-to-action proposals.
- Deterministic agent-evaluation scoring primitive.
- Architecture, release and V81–V85 roadmap documentation.

## Safety model

Skills narrow capability; they never grant permissions. Every real tool call remains subject to server-side authorization, tenant checks, risk policy, approvals and audit.

## Development

Requires Node.js 20+.

Run:

    npm test

See docs/ARCHITECTURE.md, docs/V81-CAPABILITY-MESH.md, docs/V81-RELEASE-CHECKLIST.md and docs/ROADMAP-V81-V85.md.

The repository contains the V80/V81 source-of-truth engineering delta. The complete historical local V80 artifact remains referenced by the V80 source manifest.
