## 110.0.0 — V104–V110 Production Hardening Frontier
- Added provider adapter definitions with webhook verification, rate limits, incremental sync checkpoints and circuit-breaker health states.
- Added tenant-bound website/domain/publish contracts with HTTPS, verified-domain and preview noindex gates.
- Added communication delivery envelopes with idempotency, consent, suppression, frequency and quiet-hour controls.
- Added USD integer-minor usage metering, deterministic invoices and duplicate-safe provider payment reconciliation.
- Added project-scoped freelancer/agency permissions, secret scopes, milestone budget bounds and deliverable evidence.
- Added a concrete GHL capability catalog and integrity-protected snapshot manifests.
- Added trust-control evidence, measured recovery-drill, SLO/error-budget and release-gate contracts.
- Added V104–V110 PostgreSQL tenant-RLS persistence targets and release doctor coverage.

## 103.0.0 — Trust, Commerce & Connector Fabric
- Added scoped third-party connector definitions and tenant grants with operation/scope/expiry enforcement.
- Added A-to-B automation contracts with bounded records, idempotency and risky-action approval gates.
- Added USD-first financial safety controls: spend limits, approval thresholds, balanced immutable-ledger target and refund approval.
- Added freelancer/agency project workspace authorization separated from financial authority.
- Added deterministic website SEO metadata contract.
- Added security control-plane contracts for step-up authentication and dual-control break-glass actions.
- Added V103 PostgreSQL tenant-RLS persistence targets and release doctor checks.
- Defined V104–V110 roadmap for provider adapters, communications, websites/SEO, financial OS, freelancer work OS, GHL capability sweep and trust certification.

## 102.0.0 — Hardened CRM, Workflow Nodes, Booking Calendars and AI Agents
- Added a provider-neutral CRM target for contacts, companies, leads, deals, tickets, tasks, notes, appointments and custom records with typed properties, associations, deterministic search, optimistic versioning and pipeline governance.
- Added a checksummed workflow graph target covering triggers, conditions, switches, waits, transforms, CRM actions, messaging, availability, appointment lifecycle, sub-workflows, approvals, webhooks and terminal nodes, with risk/guard/retry/timeout metadata.
- Added customer-facing booking-calendar contracts distinct from SLA calendars: time zones, holidays, overrides, buffers, capacity, host routing, availability, holds, idempotent booking, rescheduling and cancellation.
- Added a reusable AI-agent runtime envelope with tenant/release pinning, exact approval binding, turn/tool/execution budgets, lease-bound sessions and bounded structured outputs.
- Added V102 tenant-RLS persistence targets, focused tests and release doctor invariants. Provider adapters, authenticated API, production queues, live calendar sync and database execution remain unverified.

# Changelog

## 111.0.0 — Full GHL + n8n Feature Completion Foundation
- Added an exhaustive machine-readable GHL + n8n feature catalog covering CRM, communications, marketing, websites/SEO, calendars, commerce, reputation, learning/community, affiliates, agency/SaaS/white-label, AI, workflow runtime, integrations, queues, security, DevOps and observability.
- Replaced the ambiguous “targeted” label with explicit contract/build/deployment boundaries.
- Added tenant-bound, checksummed product-resource contracts for websites, campaigns, ads, connectors, payments, subscriptions, courses, memberships, affiliates, agency projects, workflows, agents and related resources.
- Added publish gates for verified domains, provider grants, ad spend, payment readiness, dependencies, step-up authentication and dual approval.
- Added feature-bundle integrity and scoped-secret/financial permission safeguards.
- Added a CI-ready feature coverage checker and canonical V111–V120 completion plan.


## 100.0.0 — Voice Quality Reviews and Agent Coaching
- Added authenticated, tenant-pinned voice QA for completed calls with a fixed six-part rubric covering policy/privacy, disclosure, booking/intake completion, grounded answers, handoff quality and approved follow-up.
- Added immutable checksummed reviews with bounded scores, confidence and structured evidence references; the review record never accepts or stores transcripts, audio, prompts or free-text notes.
- Added deterministic coaching codes, urgent safety escalation for low policy/disclosure scores, and release-level intent-attributed booking conversion, task completion, handoff, talk-duration and criterion metrics.
- Added an advisory readiness report that requires at least 20 reviewed calls, a score of 85 or higher, task completion of 80 or higher and zero critical policy/disclosure failures; existing agent publication authorization remains separate and stricter.
- Added V100 forced tenant RLS and append-only Postgres tables, laptop-first sample-only QA panels, adversarial privacy/tenant tests, and updated HighLevel/n8n findings. No production reports or call provider are connected.

## 99.0.0 — Voice Operations and Call Lifecycle
- Added tenant-bound voice call sessions pinned to checksum-verified, published agent releases that expose a voice route.
- Added disclosure-before-agent transitions, bounded specialist-agent transfer with loop prevention, authenticated human queue handoff, booking references and terminal call outcomes.
- Added strict outbound call authorization for explicit contact voice consent, DNC/frequency checks, separate provider terms, atomic-capacity reservations and tenant-configured local call windows with overnight/DST handling.
- Added recording-off/consent-required state transitions; recording starts only after caller consent evidence and normal completion requires a stop event.
- Added V99 forced-RLS session/event schema, append-only call events, idempotency and version columns; added command-center voice journey previews explicitly marked as non-live.
- Added adversarial lifecycle and policy tests plus first-party HighLevel/Twilio research notes. No telephony, speech, calendar, recording or production adapter is claimed as connected.

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
