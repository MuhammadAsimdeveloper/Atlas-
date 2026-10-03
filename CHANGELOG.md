# Changelog

## 98.0.0 — Safe Tenant Message Rendering
- Added a deterministic renderer for immutable message-template releases; it requires exact trusted tenant scope and valid release checksum and returns a send-ready draft shape without sending it.
- Limited merge variables to approved business-data roots and own data properties; credential/payment fields, prototype paths, getters, object coercion, unsafe controls and email subject header injection are rejected.
- Added a conservative email HTML subset (basic text formatting and fixed HTTPS anchors only). Variables are escaped in HTML text, cannot appear in attributes, and script/style/event or unknown markup is rejected. SMS and other channels remain plain text.
- Missing merge data now returns `needs_data` with the missing field names and no partial message body or subject.
- Added tenant-bound renderer, adversarial HTML, message header, getter, cross-tenant, tamper, missing-data and plain-text channel tests; added release doctor invariant and updated the audit.

## 97.0.0 — Domain-Independent SEO and Preview Publishing
- Added a static marketing-site build with preview mode defaulting to `noindex,nofollow` and deny-all `robots.txt`; the Atlas sample command center remains noindex in all builds.
- Added a public build mode that requires an explicit HTTPS origin, rejects reserved/local/IP origins, and emits canonical, Open Graph/Twitter metadata, visible-content-matched Organization/WebSite/SoftwareApplication/FAQ JSON-LD, `robots.txt` and a sitemap containing only the marketing root.
- Added an SEO build check for preview/public output, metadata, structured data, sitemap scope and command-center exclusion.
- Removed third-party font fetching so the landing page works without a font CDN request and avoids an unnecessary visitor-data dependency.
- Added domain launch instructions. Atlas has no public domain today; DNS, TLS, Search Console registration and indexing are not claimed as complete.

## 96.0.0 — Business-Hours SLA Engine
- Added tenant-admin-owned, immutable support business-calendar revisions with IANA timezone validation, weekday hours, holidays and date-specific overrides.
- Added DST-aware calculation of business-minute SLA deadlines; spring-forward gaps advance to the next real local minute and repeated fall-back hours are counted by their actual elapsed time.
- Support cases now pin the exact calendar revision used to calculate first-response and resolution deadlines. Customer-wait intervals are reconstructed from the append-only case timeline and pause only scheduled business minutes.
- Added a V96 tenant-RLS PostgreSQL migration, append-only revision trigger, composite case/calendar foreign key, documentation, release doctor invariants and DST/holiday/cross-tenant tests.
- Updated the competitive review with current published HighLevel workflow/agent capabilities and n8n agent runtime behavior. No provider or production service is claimed as connected.

## 95.0.0 — Case Intelligence and Safer Copilot Retries
- Added tenant-bounded recent duplicate-case detection using shared conversation identity or contact plus subject similarity. Results are suggestions only.
- Added an admin-confirmed duplicate link that preserves both case records, closes only the explicitly linked duplicate, writes an immutable audit event and rejects stale versions/cross-tenant links.
- Fixed Copilot action replay identity: retries now reuse a deterministic action id and verify the action-binding hash returned by the idempotent approval store.
- Added the V95 migration for tenant-composite duplicate references and duplicate-link event constraints.
- Refined service desk, Copilot and competitor documentation; the live preview remains sample data.

## 94.0.0 — Atlas Copilot and Service Desk
- Added a bounded operator Copilot runtime with tenant-resolved read tools, fixed tool schemas, prompt-injection boundaries, output filtering, request timeouts/cancellation and a strict model-step cap.
- Copilot writes are stored as tenant-bound pending approval actions with stable idempotency keys; platform scope exposes global read-only tools to Khan's verified platform-owner authority only.
- Added a tenant-scoped support case lifecycle, append-only idempotent case events, optimistic concurrency, skill/capacity-based assignee suggestions, human-confirmed assignment, delivery-confirmed first response and SLA status/pause accounting.
- Added V94 Postgres tables and forced RLS policies, release doctor checks, security tests, and service-desk/Copilot integration contracts.
- Updated the laptop-first preview and V94 audit/competitor notes. Provider adapters, authenticated API, business-hour calendar calculation and connected production inbox remain external integration work.

## 93.0.0 — Customer Operations Hardening
- Added tenant-owned immutable, checksummed message-template versions and release-time validation of exact template version, channel, purpose and tenant.
- Workflow release integrity now pins template checksums, and each message step re-verifies its template release before it creates an outbound intent.
- Added idempotent automation commands for tenant-defined contact-field updates and contact-tag add/remove, plus an RLS-protected durable invocation table.
- Added a lead intake recipe that updates the contact status, applies a tag and creates an owner follow-up task.
- Deepened the October 2026 HighLevel/n8n review from current vendor docs, including their AI Agent workflow features, voice templates, agent publish/memory/approval patterns, queue architecture and current n8n queue limitation for agents.
- Updated release status and sample command-center copy to V93. Provider/API/runtime integrations are still not claimed as connected.

## 91.0.0 — Customer Agent Operations
- Added server-resolved, verified-email platform-owner authority and tenant-membership checks. Caller-provided role flags do not grant global access.
- Added customer agent channel/destination/tag routing, direct assignment priority, time-zone-aware schedules, stable traffic cohorts and fail-closed ambiguity handling.
- Added evaluation-gated immutable canary releases (10% initial coverage), staged promotions, pause semantics, knowledge/failure/frustration/turn-limit handoffs and evidence-based resolution metrics.
- Added tenant-scoped Postgres persistence targets with RLS, immutable release snapshots and route-decision idempotency.
- Added an accessible system/light/dark theme selector and labeled sample data; removed demo buttons that pretended to approve server actions.
- Updated the competitor review with October 2026 first-party HighLevel, HubSpot, n8n and monday.com documentation.
- No provider delivery, authenticated API, or production deployment is claimed by this release.

## 90.0.0 — V86–V90 Frontier Foundation
### V86
- Provider adapter contract validation, incremental sync cursors and webhook receipt deduplication.
### V87
- Tenant-bound queue jobs, idempotency, worker leases, heartbeats, retries and dead-letter recovery.
### V88
- OTLP trace request construction and SLO/error-budget calculations.
### V89
- Tenant-scoped customer intelligence graph nodes, edges, bounded paths and deterministic health scoring.
### V90
- Revenue cockpit aggregation and business graph composition.
- Updated architecture, observability, benchmark, roadmap and release documentation.

Earlier releases: V80–V85 established the agent skills, capability, reliability, evaluation, durable action and command-center foundations.
