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

## Platform admin portal priority
Read `docs/PLATFORM-ADMIN-PORTAL-PLAN-2026-10-10.md` and `docs/PLATFORM-ADMIN-COMPETITOR-REVIEW-2026-10-10.md` before admin-console changes. The owner-only console must include user/workspace management, content moderation, payments/transactions, notifications, reports, audit/security, and platform settings. The current first pass provides the shell and read-only overview/users/payment/audit/report endpoints. Content moderation, notification delivery, audited write operations, and production-role/RLS qualification are still gates—not completed features. Do not expose destructive controls until their persistence, approval, idempotency, audit and tests exist.

The linked private `MuhammadAsimdeveloper/Vibe-coding-` repository is an MIT-licensed engineering workflow toolkit. Reuse its QA/review/security/release discipline where appropriate; do not assume it contains an admin product or copy unrelated developer CLI modules into Atlas.
