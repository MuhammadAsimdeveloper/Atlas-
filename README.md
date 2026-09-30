# Atlas Business Operating System

Atlas is a laptop-first, multi-tenant Business Operating System combining CRM, engagement, workflow automation, AI workforce, customer intelligence, knowledge, revenue operations, growth, integrations, governance and a platform-owner control plane.

## V85 — Integrated Platform Foundation

V82 Connector Reliability → V83 Agent Evaluation + Observability → V84 Action Inbox + Durable Operations → V85 Visual Business Command Center

### Core packages

- packages/atlas-core/ — authorization/capability primitives from V81.
- packages/agent-skills/ — V80 Agent Skills Fabric.
- packages/atlas-platform/ — V82–V85 reliability, evaluation, telemetry, durable-action and command-center domain primitives.
- apps/command-center/ — laptop-first operational dashboard.
- infra/postgres/FINAL-MIGRATION-V85.sql — V82–V85 persistence additions.

## Safety architecture

Skills narrow capability; they never grant authority. Tool execution remains subject to server-side authorization, tenant boundaries, risk policy and approvals.

Durable actions use an explicit lifecycle and tenant-scoped idempotency. Approval is a server-side state transition, not merely a UI control.

## Development

Node.js 20+.

npm test
npm run check

The command center can be opened locally from apps/command-center/index.html.

## Roadmap after V85

Provider-specific reliability adapters and contract tests; durable queue workers and recovery/replay; full OTLP exporter and production telemetry pipeline; customer intelligence graph visualization; revenue cockpit; deeper CRM/workflow/finance synchronization; platform-owner command center.