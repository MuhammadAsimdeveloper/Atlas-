# Atlas master roadmap and verified implementation status

This branch advances the verified status to V122. V122 implements the internal capability fabric for all 60 requested capabilities while keeping external-provider and infrastructure claims fail-closed.

This status describes repository behavior at V121. `DONE` means the listed bounded capability is implemented and tested in this source release. `PARTIAL` means real implementation exists but the requested feature family is incomplete. `BLOCKED BY EXTERNAL DEPENDENCY` means source contracts may exist, but end-to-end operation requires deployment, provider credentials, or missing product services.

| Phase | Status | Verified scope and outstanding work |
|---|---|---|
| V123. Production integration + service operations | **IMPLEMENTED / EXTERNALLY GATED** |
| V122. Complete capability fabric | **IMPLEMENTED / EXTERNALLY GATED** | All 60 requested capabilities have registered policy, tenant-scoped persistence and runtime/API boundaries. Communication adapters, signed webhooks, durable workflow execution and enterprise controls are implemented; real provider/KMS/WAF/IdP/DR evidence still requires deployment. |
| 0. Foundation | **PARTIAL** | V115 adds a tenant-scoped PostgreSQL queue, atomic Growth Center outbox writes, interval scheduler, bounded retry/lease recovery, restricted worker role and graceful handler loop. Redis broker, object storage, KMS, OTel export, production handlers and capacity tests remain absent. |
| 1. Core SaaS | **PARTIAL** | Authenticated accounts, sessions, tenant memberships, invitations and custom tenant roles exist. 2FA, SSO/OAuth, API keys, full team lifecycle and tenant entitlements are incomplete. |
| 2. CRM | **PARTIAL** | Tenant-backed contacts, leads, pipelines and tasks include bounded validation, relationship checks, search, revisions, audit events and lead-stage policy. Imports/exports, custom objects, dedupe/merge and full CRM timeline are incomplete. |
| 3. Workflow engine | **PARTIAL** | V117 safe preview and V119 durable execution state/control now provide version-pinned runs, bounded step history, approval/cancel/replay state, execution timeline events and atomic queue handoff. Live event ingestion, reviewed worker handlers, durable waits/resume, provider actions and a full execution inspector remain incomplete. |
| 4. Connector fabric | **BLOCKED BY EXTERNAL DEPENDENCY** | Connector/trust contracts exist. OAuth, encrypted credential vault, production provider connections, health checks and inbound/outbound reconciliation are not shipped as connected services. |
| 5. Communications | **BLOCKED BY EXTERNAL DEPENDENCY** | Consent, templates and message policy contracts exist. Inbox, channel adapters, delivery workers, receipts and provider credentials are not configured. |
| 6. Calendar and service desk | **PARTIAL** | Booking/calendar and service-desk policy contracts, cases, SLA and voice lifecycle structures exist. Live calendar sync, booking provider, staffed inbox and operational escalation delivery are absent. |
| 7. AI platform | **PARTIAL** | Agent/tool safety contracts, customer operations policies and signed evaluation gates exist. Live model provider, streaming runtime, Agent Studio, durable memory and real tool handlers are not connected. |
| 8. Websites and marketing | **PARTIAL** | Tenant-backed funnel/site drafts, safe previews, social plans and reputation policies exist. Verified-domain hosting, forms, analytics, social OAuth/publishing and review ingestion are absent. |
| 9. Financial OS | **PARTIAL** | Paddle checkout verifies active recurring prices with a free 14-day trial, signed subscription events persist trial use, and billing managers can open Paddle's cancellation/payment portal. Entitlements, invoices, refunds, usage billing, payouts and reconciliation UI remain incomplete. Real Paddle prices, permissions, credentials and webhooks still require setup. |
| 10. Advanced GHL surface | **BLOCKED BY EXTERNAL DEPENDENCY** | Affiliate rules and selected course/social/voice contracts exist; ads, ecommerce, courses, memberships, community and advanced attribution/reporting are not operational products. |
| 11. Agency/SaaS | **BLOCKED BY EXTERNAL DEPENDENCY** | Tenant identity and Khan-only platform authority are implemented. Sub-account provisioning, reseller billing, snapshots, marketplace, white-label and global control-plane operations are absent. |
| 12. Production hardening | **PARTIAL** | Security checks, RLS tests, migration hashes, deploy references and restricted-role startup gates exist. Managed production deployment, backups/PITR restore drills, WAF/CDN, load/failover tests, compliance evidence and SLOs are external and unverified. |

## V123 implementation — production integration + service operations

V123 adds a production integration runtime, OAuth state/code exchange, tenant-isolated service operations, Jobber GraphQL boundary, Zapier webhook actions, retries/timeouts and webhook deduplication. It incorporates current Zapier and Jobber product lessons: governed app/action execution, reusable data/interfaces, field-service requests, scheduling, routing, crews, checklists, quotes, invoices and client-service workflows.

## V122 implementation — complete capability fabric

V122 is the first release that treats the user's full 60-item gap list as one governed capability surface. It adds communication threading/handoff, provider adapters, production workflow execution, signed inbound event normalization, OAuth/credential references, advanced CRM/marketing definitions, agency controls and enterprise security/DR metadata. The capability registry contains exactly 60 entries and CI checks that every requested domain is represented.

The phrase **implemented** means the Atlas source can represent, validate, authorize and persist the capability. It does not mean an external provider account, identity provider, KMS/HSM, WAF or production infrastructure is connected. Those systems remain explicitly gated and cannot be faked by configuration rows.

## V119 current implementation — durable execution

V117 is the first post-MiroFish implementation slice. It adds a tenant-authenticated workflow preview runtime that reuses the existing checksummed graph and approval contracts. Preview mode can traverse native nodes, branch conditions, pause on approvals, and represent adapter/model work as simulated steps without performing external side effects.

V119 now provides durable execution history, replay state, approval/cancel controls and an atomic queue handoff. V121 adds bounded durable delay/wait-until resume, execution triage filters, and a tenant-scoped activation checklist built around the first-outcome journey. The production workflow engine remains **PARTIAL** because provider handlers, live event ingress, durable waits/resume and the final execution inspector are still future work.

See [V117 Workflow Preview](V117-WORKFLOW-PREVIEW.md), [V119 Durable Workflow Engine](V119-DURABLE-WORKFLOW-ENGINE.md), [post-MiroFish roadmap](ATLAS-POST-MIROFISH-ROADMAP-2026-10.md) and [flagship workflow plan](ATLAS-KILLER-WORKFLOW-PLAN.md).

## Authority and provider truth

Only the configured, verified Atlas platform-owner identity receives global authority. Company owners/admins remain within their own tenant; V115 adds a separate worker role without customer-table grants; V120 additionally removes direct workflow-execution table access and mediates it through lease-bound RPCs. Provider names and configuration fields do not count as connected integrations. No real model, channel, calendar, social, telephony or payment side-effect worker is claimed unless credentials, callbacks, sandbox delivery, deduplication, retries and monitoring are verified.

## Current execution boundary

V120 also centralizes API security headers, production health-token requirements and distributed rate limiting for sensitive mutation/webhook paths. V115 queue/scheduler state is persistent PostgreSQL data, V117 adds safe preview, and V119 adds durable execution state/control plus a feature-gated `workflow.execute` queue handoff. There are still no bundled business handlers, so a deployment must supply and review the `workflow.execute` handler before enabling live workflow starts. A deployment must supply and review a handler module before enabling the Compose `workers` profile. See [Execution Engine](EXECUTION-ENGINE.md) for contracts and limits, [V116 Workflow Studio](V116-WORKFLOW-STUDIO.md) for authoring scope, [Production Architecture](PRODUCTION-ARCHITECTURE.md) for deployment dependencies, and [n8n architecture review](N8N-ARCHITECTURE-REVIEW-2026-10.md) for the workflow capability gap list.
