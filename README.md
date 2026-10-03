# Atlas Business Operating System

Atlas is a laptop-first, multi-tenant business operations foundation for CRM, customer service, automation, AI agents, revenue operations and governed actions.

## Current release: V102

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
- The command-center is an accessible laptop-first sample-data preview; it does not connect to an authenticated API or provider.

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

Requires Node.js 20 or newer. The source declares no third-party npm packages.

```sh
node --test
node scripts/check.mjs
node scripts/docs-check.mjs
node scripts/doctor.mjs
node scripts/smoke-http.mjs
node scripts/preview.mjs
```

Open the local address printed by the preview process. UI figures, plans and action inbox rows are sample values. Do not treat the preview as live SaaS data.

## Production readiness boundary

This repository contains deterministic domain contracts, tests, SQL migration targets and a static preview. It does not ship a complete authenticated API, account signup/login, real email/SMS/WhatsApp/social/voice adapters, calendar booking, payment checkout, campaign delivery, live tenant console, KMS-backed memory adapter, production Redis worker service or production observability exporter. Local JSON/state is development-only.

Target deployment architecture: managed PostgreSQL with forced tenant RLS; managed Redis/queue; separately scaled authenticated API, webhook ingress and workers; managed secret manager/KMS; object storage and CDN for attachments; WAF/rate limits; OpenTelemetry collection; tested backups, restores, load, failover and SLOs. No millions-of-users capacity claim is verified by this repository.

Apply SQL targets in order: V80, V85, V90, V91, V92, V93, V94, V95, V96, V99, V100, then V102. SQL has not been run against a live PostgreSQL service in this workspace. API and worker roles must not have `BYPASSRLS`, and `app.tenant_id` must be set from authenticated membership in every tenant transaction.

For GHL/n8n/monday/HubSpot analysis and explicit feature gaps, see [October 2026 competitor benchmark](docs/COMPETITOR-BENCHMARK-2026-10.md). For the V95 duplicate-case behavior see [V95 Case Intelligence](docs/V95-CASE-INTELLIGENCE.md); the [V94 Copilot and Service Desk](docs/V94-COPILOT-SERVICE-DESK.md) document describes the underlying contracts.

For findings, addressed risks and items that still need a production environment, see the [V96 deep audit](docs/DEEP-AUDIT-V96.md), [V95 deep audit](docs/DEEP-AUDIT-V95.md), [V94 deep audit](docs/DEEP-AUDIT-V94.md) and [V93 deep audit](docs/DEEP-AUDIT-V93.md).
