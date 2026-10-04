# Atlas master roadmap and verified implementation status

This status describes repository behavior at V116. `DONE` means the listed bounded capability is implemented and tested in this source release. `PARTIAL` means real implementation exists but the requested feature family is incomplete. `BLOCKED BY EXTERNAL DEPENDENCY` means source contracts may exist, but end-to-end operation requires deployment, provider credentials, or missing product services.

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

## Authority and provider truth

Only the configured, verified Atlas platform-owner identity receives global authority. Company owners/admins remain within their own tenant; V115 adds a separate worker role without customer-table grants. Provider names and configuration fields do not count as connected integrations. No real model, channel, calendar, social, telephony or payment side-effect worker is claimed unless credentials, callbacks, sandbox delivery, deduplication, retries and monitoring are verified.

## Current execution boundary

V115 queue/scheduler state is persistent PostgreSQL data, not a claim that workflow actions execute. V116 adds visual authoring but no graph interpreter. There are no bundled business handlers. A deployment must supply and review a handler module before enabling the Compose `workers` profile. See [Execution Engine](EXECUTION-ENGINE.md) for contracts and limits, [V116 Workflow Studio](V116-WORKFLOW-STUDIO.md) for authoring scope, [Production Architecture](PRODUCTION-ARCHITECTURE.md) for deployment dependencies, and [n8n architecture review](N8N-ARCHITECTURE-REVIEW-2026-10.md) for the workflow capability gap list.
