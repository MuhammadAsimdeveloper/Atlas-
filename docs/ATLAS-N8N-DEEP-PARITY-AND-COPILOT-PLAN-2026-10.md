# Atlas — Deep n8n Parity + Optional Operator Copilot Plan

Date: 2026-10-07
Status: roadmap authority for the n8n-parity and chatbot/operator-control surface.

## Product directive

Atlas must become a business operating system that a non-technical customer can operate without learning n8n terminology.

Primary experience: describe the desired business outcome in plain language; Atlas can plan it, build it, navigate to the right screen, configure it, test it, run it, monitor it, explain failures, and repair safe failures.

The chatbot/operator assistant is optional. Every capability must remain usable through normal Atlas UI, visual workflow authoring, forms and direct controls. Users who never use the chatbot must still be able to operate the complete product.

The chatbot may use commands to navigate Atlas, but navigation is not the authority layer. The same governed application services back chatbot actions, UI actions, APIs, scheduled runs and workers.

## Core objective — deep n8n feature parity

Use current n8n product behavior as the benchmark and build deep functional parity, not a shallow list of node names.

### Workflow authoring
- Large visual canvas with pan/zoom, node search, grouping, notes, connections, branching and reusable components.
- Typed node schemas, required/optional fields, expressions, mapped data, defaults, validation and field-level errors.
- Triggers, actions, transformations, conditions, switches, merge/join, loops/batching, waits/delays, sub-workflows and workflow-to-workflow invocation.
- Manual/test execution, step inspection, pin/mock data, rerun node/branch and compare runs.
- Draft/published lifecycle, immutable versions, diff, rollback and environment promotion.
- Documented Atlas workflow import/export without exporting raw credentials or secrets.

### Trigger and event fabric
- Webhook/event triggers, schedules/cron/intervals, application events through connectors, forms/chat/manual triggers, workflow chaining and polling where a provider lacks webhooks.
- Replay-safe event ingestion, deduplication and bounded event payloads.

### Execution engine
- Durable states: queued, running, waiting, retryable, failed, succeeded and cancelled.
- Bounded concurrency, priorities, leases, retries with backoff, dead-letter handling and recovery.
- Per-step input/output/status/timing/error inspection with redacted payload views.
- Continue-on-failure and explicit error branches where policy permits.
- Timeouts, cancellation, execution budgets and idempotency keys.
- Safe replay from a pinned workflow release and explicit reconciliation for unknown external outcomes.

### Error handling and reliability
- Workflow-level error handlers plus node/branch recovery policies.
- Retry rules, fallback branches, recovery queues and operator alerts.
- Deterministic diagnostics that explain what failed, why, last known state and what Atlas can safely repair.
- Never hide an external provider failure behind a green status.

### Data transformation
- Mapping/expressions; set/edit fields; filter/sort/aggregate/dedupe; merge/join; split/batch.
- JSON/CSV/XML/text transforms; date/time and math utilities; binary/file metadata and controlled file movement.
- Schema validation and structured output.

### Code and advanced execution
- Sandboxed JavaScript/TypeScript/Python-style steps only where deployment policy enables them.
- Typed and observable code-step inputs/outputs.
- No arbitrary shell/OS/network escape through a workflow node.
- Generic HTTP only through named, tenant-granted connector operations with SSRF protection, credential isolation and outbound policy.
- Reviewed extension boundary for custom/private nodes; no arbitrary runtime code loading.

### Credentials and connections
- Tenant-scoped credential records, OAuth lifecycle, API keys, refresh/rotation state, health tests and connection status.
- Secret-store/KMS adapter boundary.
- Credential references only in definitions, logs, traces, exports and execution queues.
- Safe reauthentication/repair flows where possible.
- Connection tests prove the required capability, not merely credential existence.

### Integration and node ecosystem
- Broad connector catalog for CRM, marketing, email, calendar, messaging, project management, storage, databases, payments, commerce, analytics, developer, AI and utility services.
- Verified native adapters plus generic API operations for unsupported services.
- Reusable connector schemas, auth, pagination, rate limits, retries and webhook normalization.
- Searchable connector/action marketplace and versioned connector releases.

Atlas must make connector discovery task-oriented: users should be able to say what they want instead of knowing node names. n8n currently advertises 500+ integrations on its product pages and a large current catalog, so Atlas should treat breadth as a continuously maintained benchmark rather than a static checkbox.

### AI workflow and agent parity
- Natural-language workflow generation.
- Agent builder with models, instructions, tools, memory, schedules, channels and bounded sub-agents.
- Workflow-as-tool and workflow-to-agent invocation.
- MCP client/server support under explicit authorization.
- Structured outputs and schema enforcement.
- Human-in-the-loop tool approvals.
- AI workflow evaluation datasets and release gates.
- Session/execution inspection, replay and streaming where supported by Atlas runtime.
- Model/provider abstraction with bring-your-own-provider support.

n8n's current public AI surface includes AI Workflow Builder, Chat Hub, MCP and first-class Agents. Atlas should meet the same class of capability while preserving its tenant and approval boundaries.

### Templates and reusable automation
- Template gallery by business outcome, connector, industry and difficulty.
- Import/adapt templates with credential mapping and safe placeholders.
- Reusable sub-workflows/components.
- Versioned template releases and rollback.
- AI-generated template explanations and setup checklists.

### Forms, chat and human interaction
- Form-trigger workflows and validated user input.
- Optional customer/employee chat entry points.
- Approval tasks and operator inbox.
- Pause/resume executions waiting for human input.
- Expiring approvals bound to exact tenant, release, execution, node and action.

### Observability and governance
- Search/filter execution history.
- Redacted execution logs, metrics, traces and alerts.
- Audit ledger for workflow changes, credential events, approvals and sensitive actions.
- Usage/cost/token dashboards.
- Per-tenant quotas, rate limits and execution budgets.
- RBAC and permission-aware tool catalogs.
- Development/staging/production separation, promotion and rollback.
- Source-control-friendly workflow diffs and release artifacts.
- Retention controls and customer-visible deletion/cleanup.

## Optional Operator Copilot — Do the work for me

The Atlas Copilot is an optional natural-language control plane over the same governed services.

### Example requests
- Create a follow-up workflow for every new lead.
- When a form is submitted, create/update the contact, assign a salesperson, wait two hours, send the approved SMS template, and notify the owner.
- Show me why yesterday's lead workflow failed.
- Open the workflow and fix the broken mapping.
- Turn this workflow on every weekday at 9 AM.
- Clone this workflow for another location.
- Test it with the last 20 representative leads.
- Take me to the connector settings.
- Build the same automation without me touching the canvas.

### Command and navigation model
- Natural language plus concise typed and slash-style commands.
- Navigation commands such as open workflows, open failed runs, open integrations, open approvals and open settings.
- Prefer direct application/API actions for reliable work.
- Use UI navigation only when it improves presentation or the user explicitly asks to be guided visually.
- Never implement business authority as browser-coordinate automation.

### Operating modes
1. Ask — inspect, explain and recommend without mutations.
2. Plan — show intended steps, affected resources, required credentials, risk and side effects.
3. Do — execute authorized low-risk actions directly.
4. Confirm — require explicit approval for consequential actions.
5. Repair — diagnose and propose fixes; auto-apply only policy-approved safe repairs.
6. Navigate — open the exact Atlas screen/object when that improves user control.

### Safety rules
- Never bypass tenant permissions, connector policy, approvals, quotas or audit logging.
- Never invent credentials, providers, executions or success.
- Sensitive writes, external communications, payments, destructive operations, production deployment and permission changes use existing approval policy.
- Model arguments cannot choose another tenant, raw secret, arbitrary SQL, arbitrary shell or unbounded HTTP destination.
- Mutations are idempotent where possible and carry an auditable command/execution identity.
- Unknown external outcomes become reconciliation states, not blind retries.
- Chat history follows the same data-retention, redaction and tenant-isolation policies as other Atlas agent surfaces.

## Canonical architecture

User → Atlas Copilot (optional) or UI → Intent/Command Parser → Plan → Policy/Authorization → Application Service → Workflow/Connector/Execution Engine → Worker → Evidence/Audit

Rules:
- Copilot never owns business logic.
- UI and Copilot call the same application services.
- Nodes, connector actions and agent tools are registry-backed and schema-validated.
- Execution reuses the existing durable queue/worker/control-plane architecture.
- Browser/UI automation is never the canonical execution method.
- Reuse Aira for cross-product orchestration where applicable; Atlas remains authority for tenant business operations.
- Reimplement documented behavior; do not copy n8n proprietary source, branding, UI assets or private implementation details.

## Delivery phases

### P0 — Foundation parity
Unify workflow graph model, typed node/action registry, expression engine, execution state machine, error model, credential references and test/preview runtime.

### P1 — Core workflow parity
Triggers, actions, branching, loops, merge, data transforms, waits, sub-workflows, retries, error workflows, execution inspector, replay and cancellation.

### P2 — Connector parity
Connector SDK, OAuth/API-key lifecycle, webhook normalization, pagination/rate limits, health checks and a broad verified catalog.

### P3 — AI and agent parity
AI workflow builder, agent runtime, tools, memory, MCP, structured outputs, evaluations, streaming, approvals and optional Copilot.

### P4 — Collaboration and environments
Projects, RBAC, templates, sharing, version diff, source control, environments, promotion/rollback and governance.

### P5 — Scale and operations
Queue workers, concurrency, execution retention, binary/file storage, observability, quotas, cost controls, disaster recovery and production SLO evidence.

### P6 — Zero-training customer experience
Business-outcome wizard, chatbot/command UI, guided setup, automatic field mapping, credential onboarding, fix-this recovery, explainable history and no-training operation.

## Definition of done

A parity item is complete only when:
1. Real Atlas contract and implementation exist.
2. Tenant authorization and risk policy are enforced.
3. Unit/integration tests cover normal, failure, replay and authorization paths.
4. Representative end-to-end evidence exists where external services are available.
5. UI and Copilot invoke the same capability.
6. Docs and the feature matrix are updated.
7. External dependencies are explicitly marked NOT_CONFIGURED, BLOCKED or UNVERIFIED rather than implied live.

## Competitive benchmark rule

Use n8n as a moving benchmark and re-check public n8n docs before each major parity release because integrations, AI features and availability evolve.

## Success metric

Atlas wins when a non-technical business owner can describe a business outcome in one sentence, receive a reviewable automation plan, optionally let Copilot build or navigate it, test safely, publish it, and later diagnose or repair it — while an advanced user still gets n8n-class depth, control and extensibility.

