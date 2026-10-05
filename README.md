## V144 — Runtime control-plane integration

V144 closes the repository-side control/observability gap: durable dispatch state is recorded by the worker, bounded runtime control events provide an auditable decision ledger, and optional OTLP HTTP export is best-effort so telemetry can never block customer work.

**Production truth boundary:** external Redis HA, managed infrastructure, credentials, WAF/CDN, backups, restore drills, load tests and OTLP collectors remain deployment evidence.

## V139–V143 — Distributed production execution fabric

Atlas now contains the repository-side distributed runtime layer across V139–V143:

- **V139:** Redis priority dispatch, bounded envelopes, distributed wakeup transport and PostgreSQL durability fallback.
- **V140:** SLO-aware autoscaling decision logic with min/max bounds and cooldown protection.
- **V141:** worker/Redis/PostgreSQL failure-state evaluation plus recovery-drill evidence.
- **V142:** bounded OTLP span construction and observability destination contracts.
- **V143:** deployment-evidence gates for managed PostgreSQL, Redis HA, KMS/secrets, WAF/CDN, backups/PITR, restore drills, load testing, disaster recovery, provider credentials and the public HTTPS origin.

**Production truth boundary:** these repository controls do not pretend that managed infrastructure, Redis HA, provider credentials, DNS/WAF, backup/restore evidence or measured failover are live. The deployment gate stays unready until those external controls are actually configured and evidenced.

See [Distributed Production Fabric](docs/DISTRIBUTED-PRODUCTION-FABRIC.md).

## V138 — Distributed runtime capacity and backpressure

V138 adds durable global concurrency control for worker pools. Workers acquire bounded capacity leases before claiming jobs, release unused reservations, and release each completed slot. Expired leases are recoverable, so a crashed worker cannot permanently consume pool capacity. This is the PostgreSQL authority layer; Redis acceleration remains a subsequent deployment/runtime adapter rather than a fake configuration claim.

## V137 — Durable observability and SLO control plane

V137 turns V136's runtime samples into an operational control plane: bounded SLO policies, evaluation windows, error-budget state, deterministic alerts and critical incidents. Workers emit only metric values and opaque runtime identifiers; no customer payloads, secrets or message bodies enter telemetry. External OTel collectors, paging integrations and production SLO evidence still require deployment.

## V129–V136 — Production automation frontier

Atlas now contains the durable control-plane foundations for execution inspection/replay, timezone-aware schedules, event routing and deduplication, connector lifecycle/health, governed action catalog bindings, AI workforce sessions/tool approvals, environment promotion/rollback, and distributed runtime capacity/SLO evidence. These are tenant-isolated and reference-only where secrets/customer content would otherwise leak.

The repository deliberately distinguishes **implemented control-plane code** from **externally live infrastructure**. Real OAuth providers, KMS/vault, model providers, Redis, WAF, object storage, production scheduler fleet, load/failover testing and SLO telemetry still require deployment evidence.

## V128 — Durable workflow wake/resume control

V128 closes a critical execution gap after V127: durable `waiting` and `retryable` workflow states are now re-queued when their `resumeAt` or `retryAt` becomes due. The wake path is tenant-safe, uses `FOR UPDATE SKIP LOCKED`, creates only opaque `workflow.execute` references, and keeps actual execution behind the reviewed V125 worker/provider boundary.

This makes delayed/retryable automation resumable instead of merely persisted. Full schedule UI, richer predicates/routing, connector lifecycle, broad action catalog, AI agent sessions, environment promotion and distributed Redis/load evidence remain subsequent production phases.

See [P128 durable workflow wake/resume control](docs/P128-DURABLE-WORKFLOW-WAKE.md).

## V127 — Automation execution control plane

V127 begins the next production layer after the unified inbox: tenant-authenticated event ingress now records replay-safe automation events, resolves published workflows by trigger type, creates durable version-pinned executions, and reports matched/failed workflow starts. Event/resource payloads are reference-only; raw customer payloads are never persisted in the trigger ledger. Ingress is fail-closed behind `ATLAS_WORKFLOW_EVENT_INGRESS_ENABLED` plus the existing production workflow-handler gate.

This closes the first major gap between Atlas's workflow contracts and a live n8n/HighLevel-style event-driven automation loop. Scheduling, durable wait/resume, full execution inspector, connector lifecycle, AI agent runtime and broad app/action catalog remain subsequent phases.

See [P127 Automation Execution Control Plane](docs/P127-AUTOMATION-EXECUTION-CONTROL-PLANE.md).

## V126 — Unified communications and production inbox

V126 finishes the first real unified communications layer on top of V125: tenant-scoped conversation queues, message timelines, human handoff/read state, atomic outbound queueing, provider-worker delivery, inbound webhook threading and delivery receipts. Message bodies and attachments remain behind a deployment-reviewed encrypted content-store module; PostgreSQL and queue payloads contain only opaque references. Provider callbacks are deduplicated and reconciled into durable message state.

See [P126 Unified Communications](docs/P126-UNIFIED-COMMUNICATIONS.md).

## V125 — Production worker and provider action runtime

V125 activates the durable workflow executor with a deployment-reviewed production handler, lease-bound provider connection lookup, KMS/vault secret resolver boundary, explicit consent/approval enforcement, bounded provider requests, deterministic retry/dead-letter behavior and provider-neutral action dispatch for Postmark, Twilio, WhatsApp Cloud, Zapier and Jobber. Provider source presence still does not mean Live: each tenant connection must be verified and tested end-to-end before delivery is enabled.

See [P125 Production Worker Runtime](docs/P125-PRODUCTION-WORKER-RUNTIME.md).

# Atlas Business Operating System

## V124 — Production activation and trust gate

V124 hardens the production boundary around the V123 provider/service-operations integration fabric. It adds a deterministic activation gate for release metadata, critical configuration, API security wiring, worker isolation, provider fail-closed behavior, non-root deployment and CI least-privilege permissions. See [V124 Production Activation](docs/V124-PRODUCTION-ACTIVATION.md).

Atlas is a laptop-first, multi-tenant business operating system for CRM, customer service, automation, AI agents, revenue operations, governed actions and service-business operations.

## V123 — Production integrations and service operations

V123 adds provider-neutral integration plumbing plus concrete Postmark, Twilio messaging/voice, WhatsApp Cloud, Zapier webhook and Jobber GraphQL adapters, hardened OAuth state/code exchange, service-request/job/visit/quote/invoice persistence and API contracts. Provider accounts, credentials and end-to-end verification remain deployment responsibilities; source presence never implies Live status.

# Atlas Business Operating System

## V122 — Complete capability fabric

V122 adds a hardened runtime foundation for the complete 60-capability surface: unified communications and channel adapters, durable workflow execution, signed webhook/event ingress, OAuth/credential references, advanced CRM and marketing definitions, AI/SaaS/agency capability policy, and enterprise security/DR control metadata. See [V122 capability fabric](docs/V122-COMPLETE-CAPABILITY-FABRIC.md). External providers remain fail-closed until credentials, callbacks, sandbox delivery and monitoring are verified.

Atlas is a laptop-first, multi-tenant business operations foundation for CRM, customer service, automation, AI agents, revenue operations and governed actions.

## Current release: V126

V120 adds security hardening on top of V119 on top of the V117 safe preview and V115 queue foundation. Saved published workflows now have version-pinned execution state, durable step history, approval/cancel/replay controls, immutable execution timeline events, and an atomic `workflow.execute` queue handoff. Package metadata is normalized to 120.0.0; historical migration and engineering documentation remains available.

V121 adds the first post-MiroFish activation slice: a tenant-scoped outcome checklist, bounded durable workflow waits/resume, and operator execution-history filters. V120 hardens the API and worker trust boundaries with centralized browser security headers, production health-token gates, distributed mutation/webhook throttling and lease-bound worker execution access. V114 Growth Center modules remain connected to authenticated tenant-scoped PostgreSQL APIs and a laptop-first UI: Contacts, Leads, Pipelines, Tasks, AI Lead Qualification profiles, AI Follow-up sequences, Workflow definitions, Email templates, Funnels, Websites, Social Planner posts, Affiliate campaigns and Reputation policies. V115 makes Growth Center mutation events transactional with the outbox. V116 adds visual workflow authoring, V117 adds safe preview, and V119 adds durable execution state/control. Queue payloads remain resource references, not customer message contents or secrets. Read the [execution engine](docs/EXECUTION-ENGINE.md), [V119 durable workflow engine](docs/V119-DURABLE-WORKFLOW-ENGINE.md), [master roadmap](docs/ATLAS-MASTER-ROADMAP.md), [Growth Center guide](docs/V114-GROWTH-CENTER.md), [V116 Workflow Studio](docs/V116-WORKFLOW-STUDIO.md) and [HighLevel/n8n feature matrix](docs/COMPETITOR-FEATURE-MATRIX-2026-10.md).

Paddle plans now support a verified 14-day free trial with Paddle-hosted cancellation and payment management. Atlas verifies the configured price before enabling checkout and records trial use per workspace. Setup requires real Paddle sandbox/live plan prices, API permissions, webhook configuration and credentials; see the [trial setup guide](docs/14-DAY-FREE-TRIAL.md).

Customer records and builder definitions are live after migrations and a managed database are configured. V119 supplies durable workflow execution state and control APIs, but production execution remains feature-gated and V115/V119 ship no default business handler module; durable queue state therefore does not imply that workflow graph nodes or customer messages are actually executed. AI inference/chat sessions, social publishing, public websites, affiliate attribution/payouts, review collection and SaaS plan enforcement still need their provider services. P126 supplies the first production unified inbox path for email, SMS, WhatsApp and voice, but real deployment still requires verified provider accounts, webhooks and the reviewed content/secret modules. No user-facing label implies a provider is connected when it is not. This release does not verify millions-of-users capacity.

Production startup verifies the restricted `atlas_app` database role. The production Compose template requires a bootstrap password from deployment secrets and exposes the API only on loopback for a local HTTPS proxy. See [API deployment instructions](apps/api/README.md).

## Previous release: V113

V113 adds a scenario-based agent evaluation runner for customer-facing AI releases. It requires prompt-injection, sensitive-data, human-handoff and out-of-scope test coverage, emits only redacted result metadata, signs evaluation evidence server-side and binds the evidence to the exact agent draft or promotion target. Publishing and traffic promotion now fail closed unless the trusted API/service layer verifies the report. Read the V113 agent evaluation guide at docs/V113-AGENT-EVALUATIONS.md and the current HighLevel/n8n feature inventory at docs/COMPETITOR-FEATURE-MATRIX-2026-10.md.

The feature inventory documents that broad product coverage is not runtime parity: active workflow execution, schedules, real channel/provider connections, Agent Studio and a full customer inbox remain work in progress. A feature catalog entry does not mean a service is connected.

See the V112 identity and tenant foundation at docs/V112-IDENTITY-TENANT-FOUNDATION.md for the detailed identity/API contracts and infrastructure boundaries.

## Previous release: V111

V111 expands the workflow registry against current HighLevel workflow trigger/action documentation and n8n orchestration/agent patterns. The graph compiler validates a canonical 134-event catalog and 86 policy-classified node types, rejects credentials/private message content and direct recipient/URL values even inside reference fields, bounds retries and timeouts, and keeps stable idempotency across attempts. High-risk approvals are bound to the exact tenant, graph, execution, node and action key, expire quickly, and require trusted verification. AI tool objects reject accessors without invoking them. This remains a hardened contract layer; external actions still need authenticated APIs, durable persistence, worker execution and provider adapters.

See [V111 workflow capability registry](docs/V111-WORKFLOW-CAPABILITY-REGISTRY.md) for the feature-by-feature comparison and remaining coverage gaps.

## Previous release: V104–V110

V104–V110 adds the provider adapter and sync fabric, production website/SEO publish gate, unified communication policy, USD financial operations, freelancer/agency work controls, explicit GHL capability coverage, integrity-protected snapshots, and trust/DR/SLO release gates. Live providers and managed production infrastructure remain deployment work.

See [V104–V110 Production Hardening](docs/V104-V110-PRODUCTION-HARDENING.md).

V102 adds the hardened target layer for CRM objects, customer automation nodes, booking calendars and bounded AI-agent execution. It is composed with the V91–V100 authority, automation, service-desk, SLA and voice foundations. The target modules and migration are deterministic contracts; real provider/API/database connections remain deployment work.

See [V102 CRM, Nodes, Calendars and Agents](docs/V102-CRM-NODES-CALENDARS-AGENTS.md).

V100 completes the current voice foundation: V99's verified-event call lifecycle, pinned agent releases, outbound consent and local call-window gates, AI disclosure, capped specialist transfers, human handoff and optional consent-gated recording are paired with V100 call-quality evaluation, privacy-safe coaching codes and per-release service-business metrics. Reviews retain criterion scores and structured evidence references, not transcripts or audio. The laptop-first command center includes non-live journey and quality previews. No provider is connected and no call is placed.

See [V99 Voice Operations](docs/V99-VOICE-OPERATIONS.md), [V100 Voice Quality and Coaching](docs/V100-VOICE-QUALITY.md) and the [V100 deep audit](docs/DEEP-AUDIT-V100.md). The SQL migrations target `infra/postgres/FINAL-MIGRATION-V99.sql` and `infra/postgres/FINAL-MIGRATION-V100.sql`; migrations are shipped for review and have not been applied to a production database.

## V98 — Safe Tenant Message Rendering

V98 closes the outbound-template rendering gap found during the customer-operations audit. A tenant-bound renderer now creates deterministic email/SMS/chat message drafts from immutable template releases. Email HTML uses a small formatting allowlist and escapes personalized text; missing merge fields produce `needs_data` with no partial sendable content, and subject data cannot inject headers. This prepares a draft only; consent/provider rechecks and actual delivery remain worker/integration responsibilities.

See [V98 message rendering](docs/V98-MESSAGE-TEMPLATE-RENDERING.md) and [V98 deep audit](docs/DEEP-AUDIT-V98.md).

## V97 — Domain-Independent SEO and Preview Publishing

V97 adds a domain-independent marketing-site build with explicit preview/public indexing modes. Preview output is `noindex` with a deny-all robots file; public output refuses to build without a real HTTPS origin and includes a canonical URL, social metadata, JSON-LD, robots sitemap reference and a one-page sitemap. The sample command center remains `noindex` and is never listed in the sitemap.

There is no public Atlas domain yet. The default preview build does not invent one:

```sh
node scripts/build-site.mjs
node scripts/seo-check.mjs
```

Once Atlas has a real domain and HTTPS is active, generate indexable output with `ATLAS_PUBLIC_ORIGIN=https://your-real-domain` and `node scripts/build-site.mjs --mode public` (PowerShell: `$env:ATLAS_PUBLIC_ORIGIN='https://your-real-domain'`). See [SEO deployment](docs/SEO-DEPLOYMENT.md) for the launch checklist.

## V96 — Business-Hours SLA Engine

V96 adds business-hours SLA calculation for the service desk.

- Tenant owners/admins create immutable calendar revisions with an IANA timezone, weekly hours, holiday dates and date-specific exceptions.
- The engine calculates first-response and resolution deadlines in business minutes, handles DST transitions, and pins the exact calendar revision to each case.
- Customer-wait time is reconstructed from the case audit timeline and pauses only during scheduled working minutes. A calendar edit creates a new revision and does not change an existing case's deadline rules.
- Calendar snapshots are checksummed and tenant-bound. API handlers must load a calendar by `(tenant, calendar ID, version)` from trusted storage instead of accepting a caller-provided schedule.

See [V96 Business-Hours SLA](docs/V96-BUSINESS-SLA.md) for supported rules and limits.

V95 adds support-case intelligence and safer Copilot retries.

- Recent duplicate suggestions compare same-conversation cases or similar subjects for the same contact within a bounded window. The system never merges automatically.
- An authorized tenant admin can link a duplicate to an active canonical case. Both records remain in history; the explicitly linked case is closed with an auditable relation and version preconditions.
- Copilot retries use a deterministic tenant/action identity and verify the stored action-binding hash, so timeout/replay reconciliation can return the same pending approval.

V94 adds the operator-side AI Copilot and tenant-scoped service desk contracts.

- Copilot receives an allowlisted tool manifest derived from a trusted server-resolved authority. Reads receive tenant scope from the server; model arguments cannot choose another tenant or request credentials, arbitrary HTTP, SQL or code execution.
- Tenant writes create durable, idempotent pending-approval proposals. Copilot does not directly execute CRM, workflow or message writes. A late persistence timeout is treated as an unknown outcome; the approval inbox must be checked before retrying.
- Only Khan's verified platform-owner authority can enter platform scope. It receives global read-only tools; customer company owners/admins cannot get platform tools or global privileges.
- Service desk case records keep contact/conversation references and a short subject, not the full conversation body. Agent handoffs can open a stable-ID case; assignment suggestions consider tenant membership, skills and current capacity but do not assign automatically. A human confirms assignment and status changes use expected versions.
- SLA contracts track first response and resolution deadlines, record a response only from a trusted delivery receipt, flag at-risk/breached work, and pause timers while a case waits on the customer. V96 applies each case's pinned business calendar, timezone, holidays and working-day schedule.

## V94 — AI Copilot and Service Desk

V94 added the bounded operator Copilot, safe tenant support-case intake, human-approved actions, receipt-backed first response, SLA state and skill/capacity assignment suggestions. See [V94 AI Copilot and Service Desk](docs/V94-COPILOT-SERVICE-DESK.md).

## V93 — Customer Operations Hardening

V93 hardens the customer-operations layer with immutable message-template versions and additional CRM workflow actions.

- Email/SMS/chat/social/voice message workflow steps must pin a checksummed template release from the same tenant. Channel and purpose must match the workflow step.
- Automation actions include tasks, contact-field updates, add/remove contact tags, tenant-pinned sub-workflows and tenant-pinned customer-agent deployments.
- Contact update commands are bounded, idempotent and stored using an RLS-protected invocation target that carries references and a configuration hash rather than copying a mutable action payload.
- Customer agents use evaluation-gated immutable releases, channel/segment routing, time-aware availability, handoff rules, bounded tool calls, exact-scope approval and explicitly consented short-term memory.
- Messaging intents require fresh policy, consent, suppression and frequency evidence; workers must recheck these immediately before provider delivery.
- Business recipe descriptors cover lead intake/follow-up, appointment reminders and no-show recovery, missed calls, after-call follow-up, service reviews, failed payments, abandoned checkout and course onboarding.
- The legacy `/app/` command-center surface is an accessible laptop-first sample-data preview. The V114 workspace is a separate authenticated API-backed surface and does not use those sample rows as live data.

## Authority boundary

Only the single configured and verified `ATLAS_PLATFORM_OWNER_EMAIL` account can receive global Atlas authority. Tenant owners and admins can manage their own company only. A request-body role, `platformOwner` flag, or caller-supplied email never grants global access. See [authority implementation](packages/atlas-core/authority.mjs) and [V93 operations notes](docs/V93-CUSTOMER-OPERATIONS.md).

Configure Khan's verified owner identity through deployment secrets. The setting is intentionally absent from source. API handlers must resolve identity and tenant membership from trusted session/storage before invoking these domain contracts.

## V80–V92 foundations

- Tenant-scoped skills and actor/agent/skill capability intersection.
- Provider, webhook, sync and idempotent action contracts.
- Durable-queue lease, worker heartbeat, retry and dead-letter primitives.
- OpenTelemetry-shaped redacted traces and SLO/error-budget calculations.
- Tenant-bound customer graph, revenue cockpit and command-center preview.
- Customer-agent routing, evaluation gates, channel canaries, memory-consent contracts and human handoff.
- Lifecycle triggers, message outbox/receipts, consent/suppression snapshots, forward-only workflow branches and pinned sub-workflows/agents.

## Run locally

Requires Node.js 20 or newer and npm. Install the locked runtime/test dependencies before running checks.

```sh
npm ci
node --test
node scripts/check.mjs
node scripts/docs-check.mjs
node scripts/doctor.mjs
npm run smoke:e2e
npm audit --audit-level=moderate
node scripts/preview.mjs
```

For the authenticated workspace, configure a development Postgres connection, apply `npm run db:migrate`, then run `npm run start:api` and open `http://localhost:8080/`. Development email verification links are printed to the API terminal. The older `npm run preview` demo continues to use illustrative metrics, plans and action rows and must not be treated as live SaaS data.

## Production readiness boundary

V112 established the authenticated account/tenant API, Postgres identity, account screens and role-scoped organization controls. V114 adds tenant-scoped CRM/builder records and Paddle checkout/subscription state; V115 adds a PostgreSQL queue and handler loop; V117 adds safe workflow preview; V119 adds durable execution state and operator controls. Production PostgreSQL connections enforce TLS certificate verification; use `ATLAS_DATABASE_SSL_CA_FILE` when the managed provider requires a private root CA. Production auth throttling requires `ATLAS_TRUST_PROXY=true` behind an HTTPS edge that overwrites `X-Real-IP`. TOTP/2FA, SSO/OAuth, API keys, configured business handlers, customer chat sessions/inbox, model/agent provider execution, real email/SMS/WhatsApp/social/voice adapters, calendar provider sync, Paddle entitlements/customer portal, KMS-backed memory and production observability export remain future work; V120 also requires a production health token and removes direct worker workflow-table access. Local JSON/state remains development-only. Live workflow starts additionally require `ATLAS_WORKFLOW_EXECUTION_ENABLED=true` and `ATLAS_WORKFLOW_EXECUTION_HANDLER_READY=true`, plus a deployment-reviewed worker module containing the `workflow.execute` handler.

Target deployment architecture: managed PostgreSQL with forced tenant RLS and durable V115 jobs; optional managed Redis for ephemeral acceleration; separately scaled authenticated API, webhook ingress and workers; managed secret manager/KMS; object storage and CDN for attachments; WAF/rate limits; OpenTelemetry collection; tested backups, restores, load, failover and SLOs. No millions-of-users capacity claim is verified by this repository.

Apply SQL targets in order with `npm run db:migrate`: V80, V85, V90–V96, V99, V100, V102–V115, V119. The migration runner checks immutable SHA-256 migration records and serializes migration sessions. V115 migration and RLS behavior are exercised against ephemeral PGlite, but SQL has not been applied to a managed production PostgreSQL service in this workspace. Apply the V112, V114, V115 and V119 role grants as a database owner after migrating. Configure a separate `ATLAS_WORKER_DATABASE_URL` for the non-bypass `atlas_worker` role and mount a reviewed handler file before enabling the Compose `workers` profile.

For GHL/n8n/monday/HubSpot analysis and explicit feature gaps, see [October 2026 competitor benchmark](docs/COMPETITOR-BENCHMARK-2026-10.md). For the V95 duplicate-case behavior see [V95 Case Intelligence](docs/V95-CASE-INTELLIGENCE.md); the [V94 Copilot and Service Desk](docs/V94-COPILOT-SERVICE-DESK.md) document describes the underlying contracts.

For findings, addressed risks and items that still need a production environment, see the [V96 deep audit](docs/DEEP-AUDIT-V96.md), [V95 deep audit](docs/DEEP-AUDIT-V95.md), [V94 deep audit](docs/DEEP-AUDIT-V94.md) and [V93 deep audit](docs/DEEP-AUDIT-V93.md).


## V145 — Real Redis runtime acceleration

V145 adds a bounded native Redis RESP2 client and worker wakeup integration. Redis can now wake workers through BRPOP/LPUSH, while PostgreSQL remains the durable execution authority and polling fallback remains active when Redis is unavailable.
