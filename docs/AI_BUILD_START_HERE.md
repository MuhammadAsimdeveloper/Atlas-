## Mandatory product direction — V157

Atlas must support an optional Operator Copilot so non-technical users can complete automation work by plain-language request or command, while every feature remains fully usable through the visual UI. The Copilot can plan, build, navigate, test, inspect, repair and explain work, but it never bypasses tenant permissions, approvals, credentials, quotas or audit logging.

Atlas also has a deep n8n parity target. Read [docs/ATLAS-N8N-DEEP-PARITY-AND-COPILOT-PLAN-2026-10.md](ATLAS-N8N-DEEP-PARITY-AND-COPILOT-PLAN-2026-10.md) before implementing workflow or agent changes. Parity means the actual workflow engine, triggers, branching, loops, data transforms, waits, sub-workflows, error handling, execution inspector, retries/replay, credentials, connector ecosystem, AI workflow builder, agents, MCP, approvals, templates, environments, observability, governance and scale — not merely UI or catalog entries.

Implementation rule: extend the existing Atlas V-series workflow/runtime contracts and durable execution/control plane. Do not greenfield a second automation engine and do not copy n8n proprietary source, UI or branding. Reimplement documented behavior behind Atlas's tenant-safe, approval-aware contracts.

# AI BUILD START HERE — Atlas

## Authority
Read this file first, then:
- `docs/INDUSTRY_TOOL_ARSENAL.md`
- `docs/ZEE_TOOLS_ECOSYSTEM.md`
- latest V-series production/control-plane docs and the README.

## Mission
Build Atlas as the business operating system: CRM, marketing, funnels, unified communications, support, customer knowledge, business automation, approvals, analytics and tenant-safe AI agents.

## Boundary
Consume Aira/Build Vibe shared orchestration and utilities through stable adapters. Atlas owns business-specific actions and tenant data. Never fork shared implementations without a documented runtime reason.

## Execution
Inspect current V-series architecture and production truth boundary first. Use TDD for behavior changes. Preserve tenant isolation, durable execution, approval gates, audit ledger, quotas, provider boundaries and fail-closed deployment gates. Never claim external infrastructure is live without evidence.

## Priority
Business agents → event/automation engine → connector lifecycle → unified inbox/communications → approvals → knowledge → analytics/SLOs → shared SEO/API/audit utilities → production deployment evidence.

Implement the next unfinished capability from the roadmap and update its V-series documentation.

## Current V157 build state

Two V157 P0 foundation slices are implemented:

- [Typed Action Registry and Schema Enforcement](V157-P0-TYPED-ACTION-REGISTRY.md)
- [Declarative Expression Engine](V157-P0-EXPRESSION-ENGINE.md)

Together they make action schemas executable, add an immutable action registry, execute a bounded declarative expression language through the existing mapping path, and resolve safe expression-bound action inputs before typed schema/provider/approval enforcement.

The unified workflow-node schema registry and graph-to-action binding layer is now implemented as a foundation slice in [V157 P0 — Unified Workflow Node Schema Registry](V157-P0-WORKFLOW-NODE-SCHEMA-REGISTRY.md).

Typed outputs, deterministic execution-error classification, and durable reconciliation state are now implemented as a foundation slice in [V157 P0 — Typed Outputs and Deterministic Workflow Errors](V157-P0-TYPED-OUTPUTS-AND-ERRORS.md).

The next unfinished P0 capability is automatic output-shape propagation into downstream node input validation plus connector-derived input/output schemas. Continue by extending the existing workflow execution/control-plane and connector registry contracts; do not create a second automation engine.
