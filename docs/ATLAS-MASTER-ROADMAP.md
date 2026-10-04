# Atlas master roadmap and verified implementation status

This document is the authoritative implementation inventory for the Atlas Business Operating System build program. It was expanded by a full repository audit performed against the `main` branch at V116 (commit `f91f207`, 2026-10-04).

## How to read this document

`DONE` means the bounded capability is implemented in this source release, wired to real runtime state, and covered by passing tests. `PARTIAL` means real, tested implementation exists but the feature family is incomplete. `BLOCKED BY EXTERNAL DEPENDENCY` means contracts, migrations, or adapters may exist in source, but end-to-end operation requires deployment infrastructure, provider credentials, or product services that do not exist yet.

A table, migration, config field, or UI screen is never evidence of a `DONE` capability on its own. `DONE` requires UI + API + persistence + authorization + tests working together, per the build program's quality bar.

## Audit verification evidence (2026-10-04)

Every claim below was checked against the actual source, not against prior documentation:

| Gate | Result |
|---|---|
| `npm test` | 192/192 tests passed |
| `npm run doctor` | 70/70 checks passed |
| `npm run check` | All modules pass syntax validation |
| `npm run docs:check` | 57 Markdown files, 0 errors |
| `npm run seo:check` | 38/38 assertions passed |
| `npm run launch:check` | 6/6 checks passed |
| `npm run production:check` | 29/29 checks passed |

Repository shape verified during the audit: 180 files, ~14,000 lines of source and tests, 20 forward-only PostgreSQL migration files creating 80 tables (all tenant tables with `FORCE ROW LEVEL SECURITY`), 12 shared packages, 4 applications (api, worker, command-center, marketing-site), and one CI workflow running the full gate chain plus a container build and `npm audit` on Node 20 and 22.

## Phase summary

| Phase | Status | Verified scope and outstanding work |
|---|---|---|
| 0. Foundation | **PARTIAL** | V115 adds a tenant-scoped PostgreSQL queue, atomic Growth Center outbox writes, interval scheduler, bounded retry/lease recovery, restricted worker role and graceful handler loop. Redis broker, object storage, KMS, OTel export, production handlers and capacity tests remain absent. |
| 1. Core SaaS | **PARTIAL** | Authenticated accounts, sessions, tenant memberships, invitations and custom tenant roles exist. 2FA, SSO/OAuth, API keys, full team lifecycle and tenant entitlements are incomplete. |
| 2. CRM | **PARTIAL** | Tenant-backed contacts, leads, pipelines and tasks include bounded validation, relationship checks, search, revisions, audit events and lead-stage policy. Imports/exports, custom objects, dedupe/merge and full CRM timeline are incomplete. |
| 3. Workflow engine | **PARTIAL** | Validated graph definitions, authenticated visual authoring, a tenant-authorized trigger/node catalog, durable job and outbox primitives, scheduler, leases and retries exist. Graph execution, live event ingestion, durable waits, approval resume, replay and execution inspector are missing. |
| 4. Connector fabric | **BLOCKED BY EXTERNAL DEPENDENCY** | Connector/trust contracts exist. OAuth, encrypted credential vault, production provider connections, health checks and inbound/outbound reconciliation are not shipped as connected services. |
| 5. Communications | **BLOCKED BY EXTERNAL DEPENDENCY** | Consent, templates and message policy contracts exist. Inbox, channel adapters, delivery workers, receipts and provider credentials are not configured. |
| 6. Calendar and service desk | **PARTIAL** | Booking/calendar and service-desk policy contracts, cases, SLA and voice lifecycle structures exist. Live calendar sync, booking provider, staffed inbox and operational escalation delivery are absent. |
| 7. AI platform | **PARTIAL** | Agent/tool safety contracts, customer operations policies and signed evaluation gates exist. Live model provider, streaming runtime, Agent Studio, durable memory and real tool handlers are not connected. |
| 8. Websites and marketing | **PARTIAL** | Tenant-backed funnel/site drafts, safe previews, social plans and reputation policies exist. Verified-domain hosting, forms, analytics, social OAuth/publishing and review ingestion are absent. |
| 9. Financial OS | **PARTIAL** | Paddle checkout verifies active recurring prices with a free 14-day trial, signed subscription events persist trial use, and billing managers can open Paddle's cancellation/payment portal. Entitlements, invoices, refunds, usage billing, payouts and reconciliation UI remain incomplete. Real Paddle prices, permissions, credentials and webhooks still require setup. |
| 10. Advanced GHL surface | **BLOCKED BY EXTERNAL DEPENDENCY** | Affiliate rules and selected course/social/voice contracts exist; ads, ecommerce, courses, memberships, community and advanced attribution/reporting are not operational products. |
| 11. Agency/SaaS | **BLOCKED BY EXTERNAL DEPENDENCY** | Tenant identity and Khan-only platform authority are implemented. Sub-account provisioning, reseller billing, snapshots, marketplace, white-label and global control-plane operations are absent. |
| 12. Production hardening | **PARTIAL** | Security checks, RLS tests, migration hashes, deploy references and restricted-role startup gates exist. Managed production deployment, backups/PITR restore drills, WAF/CDN, load/failover tests, compliance evidence and SLOs are external and unverified. |

## Live API surface (verified in `apps/api`)

The authenticated API today exposes exactly these route families. Anything not listed here is not a live endpoint:

- `/api/v1/auth/*` — signup, email verification, verification resend, login, password forgot/reset, logout
- `/api/v1/me`, `/api/v1/organizations`, `/api/v1/organizations/*`, `/api/v1/invitations/accept`, `/api/v1/dashboard/summary`
- `/api/v1/growth/*` — tenant-scoped CRUD, transitions and search for the thirteen Growth Center modules, plus `/api/v1/growth/overview` and `/api/v1/growth/workflows/catalog`
- `/api/v1/billing/*` — plan catalog, subscription state, Paddle checkout, Paddle billing portal
- `/api/v1/webhooks/paddle` — raw-body, signature-verified Paddle webhook ingestion
- `/health/live`, `/health/ready`, `/api/v1/status`

## Product surface inventory

Status of the eighty-six product surfaces from the build program, grouped by family.

### Workspace and identity

| Surface | Status | Notes |
|---|---|---|
| Workspace | DONE | V112 organizations, tenant selection, memberships, invitations, custom roles; forced RLS verified by migration tests. |
| Team administration | PARTIAL | Memberships, invitations and roles work; no full lifecycle UI, API tokens, 2FA or SSO. |
| Platform administration | PARTIAL | Verified platform-owner boundary enforced server-side; no control-plane UI. |
| Security center | PARTIAL | Security events, rate limits, session controls and audit records exist; no operator-facing security center UI. |
| API | PARTIAL | Authenticated v1 API with CSRF, origin checks, rate limiting and bounded bodies; no public API tokens or developer portal. |

### CRM and customer data

| Surface | Status | Notes |
|---|---|---|
| CRM | PARTIAL | Live tenant-backed contacts, leads, pipelines, tasks via Growth Center; V102 object contracts cover the wider model. |
| Contacts | DONE | CRUD, search, revisions, audit events and consent flags persist through forced-RLS PostgreSQL. |
| Companies | PARTIAL | V102 record contracts and persistence target; no live API or UI module. |
| Custom objects | PARTIAL | Contract layer only. |
| Pipelines | DONE | Bounded stages, transition rules and lead movement persist with version checks. |
| Opportunities/deals | PARTIAL | Leads carry stage, value and status; full opportunity object and board remain contract-level. |
| Tasks | DONE | CRUD with ownership, priority and status persistence. |
| Notes | PARTIAL | Contract level; no live notes module. |
| Engagement score | PARTIAL | Engagement contracts and lead scoring policy exist; no live scoring pipeline. |
| Import / export | BLOCKED BY EXTERNAL DEPENDENCY | Not implemented; needs file storage and background workers. |
| Duplicate detection and merge | PARTIAL | Service-desk duplicate suggestions exist (V95); CRM merge requires human confirmation flow and is not live. |
| Activity timeline | PARTIAL | Revision and audit events persist per record; no unified customer timeline UI. |

### Conversations and messaging

| Surface | Status | Notes |
|---|---|---|
| Conversations | PARTIAL | Conversation and suppression contracts exist; no operator inbox. |
| Unified inbox | BLOCKED BY EXTERNAL DEPENDENCY | Needs channel adapters and delivery workers. |
| Email | PARTIAL | V98 safe template renderer produces deterministic drafts; delivery needs a configured provider. |
| SMS | PARTIAL | Template and consent contracts; no telephony provider. |
| WhatsApp | PARTIAL | Consent flags captured on contacts; no Meta connection. |
| Facebook messaging | BLOCKED BY EXTERNAL DEPENDENCY | Contract only. |
| Instagram messaging | BLOCKED BY EXTERNAL DEPENDENCY | Contract only. |
| Web chat | BLOCKED BY EXTERNAL DEPENDENCY | Contract only. |
| Message templates | DONE | Growth Center email-template module persists tenant-scoped templates; V98 renderer escapes personalized fields and fails closed on missing data. |
| Consent and suppression | PARTIAL | Consent flags, channel suppressions and quiet-hours policy contracts exist; enforcement at send time requires delivery workers. |

### Voice

| Surface | Status | Notes |
|---|---|---|
| Voice/calling | PARTIAL | V99 verified-event call lifecycle, consent and call-window gates; no telephony provider connected. |
| Call tracking | PARTIAL | Call session/event persistence targets exist. |
| AI voice agents | PARTIAL | Receptionist/qualification/booking agent contracts with disclosure and handoff gates. |
| Voice quality | PARTIAL | V100 rubric-based reviews with structured evidence references; sample UI is clearly labeled. |

### AI platform

| Surface | Status | Notes |
|---|---|---|
| AI conversation agents | PARTIAL | Safety envelopes, tool binding and budgets in contracts; no live model runtime. |
| AI workflow agents | PARTIAL | Invocation contracts and persistence targets exist. |
| Agent Studio | BLOCKED BY EXTERNAL DEPENDENCY | No agent authoring UI or runtime yet. |
| Knowledge base | PARTIAL | Knowledge contracts exist; no retrieval service. |
| Agent memory | PARTIAL | `atlas_agent_memory_facts` persistence target and consent-aware policy exist; no runtime writer. |
| Human handoff | PARTIAL | Handoff contracts and approval lineage exist. |
| AI evaluation | DONE | V113 scenario-based evaluation runner with signed evidence bound to the exact agent release; publishing fails closed without verified reports. |
| AI Copilot | PARTIAL | Copilot package with action binding and safe retry identity; the command-center preview is static and labeled as such. |
| AI cost governance | PARTIAL | Budget and quota contracts exist; no live metering. |
| Model provider fabric | BLOCKED BY EXTERNAL DEPENDENCY | No provider adapters yet. |

### Workflow and automation

| Surface | Status | Notes |
|---|---|---|
| Workflow Studio | PARTIAL | V116 authenticated visual authoring against the canonical catalog persists versioned definitions; there is no graph interpreter yet. |
| Workflow templates | BLOCKED BY EXTERNAL DEPENDENCY | Only starter examples; no template library. |
| Workflow execution history | PARTIAL | Execution/step tables exist; no executions are produced because no handlers ship. |
| Workflow retry/replay | PARTIAL | Queue retry, lease recovery and dead-letter primitives are tested; graph-level replay is missing. |
| Workflow scheduling | PARTIAL | V115 interval scheduler persists and fires schedules; cron expressions and timezone calendars are not implemented. |
| Webhooks (inbound triggers) | PARTIAL | Paddle webhook is live with signature verification and dedupe; generic verified-webhook ingestion is contract-level. |
| Event catalog | DONE | Canonical 134 trigger types and 86 policy-classified node types ship as a tested, tenant-authorized catalog. |
| Durable queue and outbox | DONE | V115 PostgreSQL queue with atomic outbox writes, bounded retries, leases, lease-loss recovery and a restricted worker role, covered by worker runtime tests. |
| Execution workers | PARTIAL | The worker loop is real and tested; it refuses to claim unregistered work and ships no business handlers by default. |

### Calendar, booking and service desk

| Surface | Status | Notes |
|---|---|---|
| Calendars | PARTIAL | Booking calendar and immutable business-calendar revision contracts exist. |
| Appointment booking | PARTIAL | Hold/book/reschedule/cancel contracts; no transactional booking API. |
| Services and availability | PARTIAL | Contract level. |
| Reminders | PARTIAL | Scheduler primitives exist; reminder handlers do not ship. |
| No-show recovery | PARTIAL | Contract level; listed as a priority recipe. |
| Service desk | PARTIAL | V93–V95 case, duplicate-suggestion and intelligence packages are tested; no live API or inbox UI. |
| SLA management | PARTIAL | V96 business-hours SLA engine computes deadlines from pinned calendar revisions with DST handling, fully unit tested; not wired to a live case API. |

### Websites, funnels and SEO

| Surface | Status | Notes |
|---|---|---|
| Websites | PARTIAL | Growth Center website drafts persist with SEO metadata; no hosting or publishing pipeline. |
| Landing pages | PARTIAL | Same draft-level support. |
| Funnels | PARTIAL | Funnel drafts with pages, blocks and lead-form sections persist per tenant. |
| Forms | PARTIAL | Form blocks exist inside page drafts; no standalone form builder or submission ingestion. |
| Surveys and quizzes | BLOCKED BY EXTERNAL DEPENDENCY | Trigger types exist in the catalog; no builder. |
| SEO | DONE | Deterministic metadata, JSON-LD, sitemap, robots and noindex preview modes with 38 passing assertions; public builds fail closed without a real HTTPS origin. |
| Domains/DNS | BLOCKED BY EXTERNAL DEPENDENCY | No domain is registered; publish gate requires a real HTTPS origin. |
| Marketing site | DONE | Static build with preview/public modes wired into CI. |

### Marketing and growth

| Surface | Status | Notes |
|---|---|---|
| Social publishing | PARTIAL | Social Planner persists scheduled posts with approval flags; no social OAuth or publishing adapter. |
| Reputation/reviews | PARTIAL | Review-request policies persist; no review ingestion or monitoring. |
| Ads/audiences | BLOCKED BY EXTERNAL DEPENDENCY | Contract level. |
| Attribution | BLOCKED BY EXTERNAL DEPENDENCY | Contract level. |
| AI lead qualification | PARTIAL | Qualification profiles and human-reviewed evaluations persist; scoring is recorded by authorized users, not by a live model. |
| AI follow-up sequences | PARTIAL | Sequence definitions with approval gates persist; no send runtime. |
| Affiliate management | PARTIAL | Affiliate campaign definitions persist; attribution and payouts are contract level. |

### Financial OS

| Surface | Status | Notes |
|---|---|---|
| Payments | PARTIAL | Paddle checkout with verified active recurring prices; charge/refund actions are not exposed. |
| Checkout | DONE | Verified Paddle checkout creation for the three plan tiers, guarded by billing-manager authority. |
| Subscriptions | PARTIAL | Paddle subscription state and signed webhook events persist; trial use is recorded per workspace. |
| Free trial | DONE | Verified 14-day trial gating with cancellation through Paddle's hosted portal. |
| Invoices | PARTIAL | Financial document contracts (V107) use integer USD minor units; no invoice API. |
| Usage billing | BLOCKED BY EXTERNAL DEPENDENCY | Metering contracts exist; no metered usage pipeline. |
| Credits/wallets | PARTIAL | Contract level. |
| Refunds and disputes | PARTIAL | Approval-bound contracts exist; no money-movement endpoints. |
| Reconciliation | PARTIAL | Webhook events persist with payload hashes; provider reconciliation jobs are not implemented. |
| Billing ledger | PARTIAL | Append-only ledger target exists in migrations. |

### Platform programs

| Surface | Status | Notes |
|---|---|---|
| Ecommerce integrations | BLOCKED BY EXTERNAL DEPENDENCY | Shopify trigger types exist in the catalog; no adapter. |
| Courses and memberships | PARTIAL | Trigger types and access contracts exist; no product surface. |
| Community | BLOCKED BY EXTERNAL DEPENDENCY | Trigger types only. |
| Agency/sub-account hierarchy | PARTIAL | Freelancer/agency workspace contracts with separated financial authority; no provisioning UI. |
| Freelancer/project work | PARTIAL | V108 workspace, milestone and evidence contracts. |
| Snapshots/templates | PARTIAL | V109 integrity-protected snapshot manifests; no deployment flow. |
| Marketplace | BLOCKED BY EXTERNAL DEPENDENCY | Manifest format exists; no marketplace service. |
| White-label | BLOCKED BY EXTERNAL DEPENDENCY | Not implemented. |
| SaaS provisioning | PARTIAL | Plan tiers and trial checkout exist; entitlement enforcement is not wired. |
| MCP/connectors | PARTIAL | Connector capability snapshots and grants contracts exist. |
| Analytics | PARTIAL | `/api/v1/growth/overview` returns live tenant counts; all other dashboards show clearly labeled sample data. |
| Revenue intelligence | PARTIAL | Revenue snapshot contracts exist; the command-center revenue panel is labeled sample data. |
| Trust center | PARTIAL | V110 trust evidence, SLO windows and release-gate persistence targets exist. |
| Usage/cost monitoring | PARTIAL | Quota contracts exist; no live metering or alerts. |

## Security invariants verified in this audit

These boundaries were checked in source and by the passing gate chain, and must not be weakened by future work:

- All tenant tables use `ENABLE` and `FORCE ROW LEVEL SECURITY`; the API role is unprivileged (`NOBYPASSRLS`, no superuser/createdb/createrole) and a distinct restricted worker role cannot read customer tables.
- Session identity, CSRF tokens and same-origin checks guard every mutation; authority is resolved server-side from the session and database, never from request JSON.
- Platform-owner authority is bound to the configured verified owner identity and cannot be granted through roles, invitations or API payloads.
- Queue payloads and outbox events carry resource references only; customer message content and secrets are rejected by contract validation.
- High-risk approvals are bound to tenant, graph, execution, node and action key, expire quickly, and are verified server-side.
- The Paddle webhook path captures the raw body, verifies the signature before parsing, and deduplicates by provider event.
- The worker refuses to run without explicitly registered, reviewed handlers, so no silent fake execution is possible.

## Repository hygiene findings

Non-blocking issues found during the audit, recommended as a separate cleanup change:

1. Release archives `atlas-v115.0.0-final.zip` and `atlas-v116.0.0-source-release.zip` (~1 MB total) are committed to git history. Release binaries belong in GitHub Releases; keeping them in the tree permanently bloats every clone.
2. The CI workflow uploads an artifact named `atlas-v115-static-preview-*` while the release is V116; the name should track the current release.
3. Two pull requests remain open: #6 (V111 feature-completion foundation, current) and #1 (V100 launch hardening), the latter based on an obsolete `main` and likely superseded.
4. Seven merged or closed feature branches remain undeleted.
5. `main` has no branch protection; enabling required reviews and green CI before merge would match the repository's own governance posture.
6. `.env.example` contains a personal note naming an individual's mailbox; a generic instruction is preferable in a public repository.

## Recommended next increments

Following the build program's phase order, the highest-leverage next increments are:

1. **Graph interpreter for the workflow engine (Phase 3).** The catalog, persistence targets, queue, outbox, scheduler and worker loop already exist; an interpreter that executes validated graphs through the existing approval and idempotency architecture converts the largest contract surface into live behavior without new external dependencies.
2. **CRM API completion (Phase 2).** Companies, notes and opportunity objects can extend the proven Growth Center store pattern with no new infrastructure.
3. **Service desk API (Phase 6).** The case, SLA and intelligence packages are tested and ready to be exposed through the same authenticated route pattern.
4. **First provider adapter with test mode (Phase 4/5).** One email adapter (Postmark-class) with sandbox support, signature verification and clearly labeled test mode would validate the connector fabric end to end.
5. **Execution inspector API (Phase 3).** Execution and step tables exist; read-only inspector endpoints make the queue's behavior observable before handlers ship.

## Authority and provider truth

Only the configured, verified Atlas platform-owner identity receives global authority. Company owners/admins remain within their own tenant; V115 adds a separate worker role without customer-table grants. Provider names and configuration fields do not count as connected integrations. No real model, channel, calendar, social, telephony or payment side-effect worker is claimed unless credentials, callbacks, sandbox delivery, deduplication, retries and monitoring are verified.

## Current execution boundary

V115 queue/scheduler state is persistent PostgreSQL data, not a claim that workflow actions execute. V116 adds visual authoring but no graph interpreter. There are no bundled business handlers. A deployment must supply and review a handler module before enabling the Compose `workers` profile. See [Execution Engine](EXECUTION-ENGINE.md) for contracts and limits, [V116 Workflow Studio](V116-WORKFLOW-STUDIO.md) for authoring scope, [Production Architecture](PRODUCTION-ARCHITECTURE.md) for deployment dependencies, and [n8n architecture review](N8N-ARCHITECTURE-REVIEW-2026-10.md) for the workflow capability gap list.
