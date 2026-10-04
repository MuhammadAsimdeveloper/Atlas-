## 115.0.0 — Durable runtime foundation
- Added tenant-bound PostgreSQL job, transactional event outbox and interval scheduler tables with forced RLS and reference-only payload validation.
- Added separate non-bypass/non-inheriting `atlas_worker` grants and database role checks. The API can enqueue only for the active tenant and cannot claim or mutate jobs.
- Added atomic Growth Center outbox records, `SKIP LOCKED` claims, lease heartbeat/completion, bounded exponential retry, dead-letter state, stale-lease recovery and schedule coalescing.
- Added a graceful handler loop with explicit handler type filters, abortable leases, a deployment-local reviewed handler module contract and an opt-in Compose worker profile.
- Added migration/role integration tests and worker behavior tests. No default workflow or provider handlers ship; workflow graph execution and provider delivery remain unavailable until reviewed handlers and services are connected.
- Integrated a tenant-aware workspace shell with a CRM/automation-style navigation hierarchy, responsive mobile menu, account/workspace/provider settings, and page-title/active-navigation synchronization when the selected customer-operations module changes. Modules without live services identify their exact unavailable dependencies.
- Restricted the optional worker container to an explicit runtime environment so reviewed handlers do not inherit unrelated API credentials from the shared environment file.
- Added Paddle-verified 14-day free trials, a sticky tenant trial-use marker, duplicate-subscription/trial guards and authenticated Paddle customer-portal links for subscription management and cancellation. Prices that lack the exact free trial remain unavailable for checkout.

## 114.0.0 — Consolidated Growth Center and SEO release
- Consolidated repository and package metadata on release 114.0.0 while preserving historical engineering and migration records.
- Connected tenant-scoped Growth Center records and builders for contacts, leads, pipelines, tasks, qualification profiles, follow-up sequences, workflow definitions, email templates, funnels, websites, social posts, affiliate campaigns and reputation policies.
- Added PostgreSQL revisions and audit events, Paddle checkout and signed subscription webhooks, and tenant-scoped agent evaluation evidence gates.
- Production now refuses elevated PostgreSQL runtime identities; the Compose example requires an injected bootstrap password and binds the API to loopback behind HTTPS.
- Expanded the public marketing SEO pipeline with canonical metadata, social cards, structured data, controlled sitemap freshness and a reusable SEO readiness evaluator. Preview builds remain noindex.
- Corrected the stale SEO title assertion that caused the current CI check to fail.
- Provider delivery, workflow workers, AI inference, scheduling, SaaS entitlements, affiliate payouts, public domains, managed infrastructure and production capacity remain deployment/product work; they are not represented as connected.

## 113.0.0 — Customer-Agent Evaluation and Complete Competitor Feature Inventory
- Added a scenario-based agent evaluation suite and bounded concurrent runner with mandatory prompt-injection, sensitive-data, human-handoff and out-of-scope coverage.
- Evaluation results retain only scenario IDs/tags, bounded issue codes, counts, cost/latency measurements and checksummed HMAC evidence; prompts, answers, model errors, knowledge text and tool arguments are omitted.
- Agent canary publish and traffic promotion now require a trusted evaluation verifier and evidence bound to the exact draft fingerprint or prior release plus target coverage. Unsigned caller-supplied scores fail closed.
- Added adversarial tests for tenant/key/candidate binding, hostile object/accessor output, unscoped citations, undeclared and write tools, provider errors, cost overrun and release-gate rejection.
- Added a source-linked inventory comparing HighLevel's major SaaS/CRM/marketing/AI feature families and n8n's workflow/agent/integration/scaling families with live, contractual, preview and missing Atlas coverage.
- Confirmed the Khan-only platform-owner boundary. No global authority is created by evaluation signatures, tenant membership or client-submitted identity fields.
- No model/channel provider, evaluation storage, Agent Studio UI, workflow engine, durable worker or production signer is connected by this domain release.

## 112.0.0 — PostgreSQL Identity and Tenant Foundation
- Replaced the V111 contract-only HTTP shell with a real, PostgreSQL-backed account API: signup, email verification/resend, password sign-in/reset, session revocation, profile update, organization creation/selection, member listing, invitations, invitation acceptance and tenant custom roles.
- Added scrypt password hashes, random one-use token hashes, strict same-origin and CSRF validation, HttpOnly SameSite session cookies, account/IP rate limits, bounded JSON bodies and generic credential/reset responses.
- Added forced-RLS identity, organization, membership, custom role, session, one-use token, rate-limit and immutable audit tables. Platform-owner authority remains a server-resolved verified Khan email and does not exist as a customer role or writable field.
- Added a migration runner with advisory locking and immutable SHA-256 migration records, plus separate restricted runtime-role grants. Production readiness now verifies database connectivity and the identity schema.
- Production API and migration connections now remove URL-level TLS overrides and enforce certificate validation, with optional mounted private-CA support; runtime grants reject superuser/BYPASSRLS/role-inheriting/table-owning `atlas_app` configurations.
- IP and account rate-limit identifiers now use secret-keyed HMAC-SHA-256 digests. The complete migration-chain integration test also caught and fixed a reserved identifier in V90 and an unavailable JSON helper reference in V96.
- Production auth throttling requires a valid client IP from the configured trusted edge. Concurrent signup email races stay enumeration-safe, and only one pending invitation can exist per tenant/email at a time.
- Added a responsive authenticated workspace UI for account creation, sign-in, live core dashboard metrics, workspace switching, team invitations and custom roles. Service-business onboarding captures industry and timezone; disconnected CRM, AI, workflow, communications and revenue modules are labeled unavailable.
- Added current HighLevel/n8n architecture notes and mapped the need for event-driven agent starts, CRM actions, structured agent-to-workflow results, execution retries, scoped sharing and promotion to existing Atlas V93–V111 contracts and future integration work.
- Added HTTP auth end-to-end tests and an ephemeral PostgreSQL-compatible V112 migration/RLS test. This workspace has no production database, mail sender, public domain, or deployed scale/failover environment.

## 111.0.0 — GHL/n8n Workflow Capability Registry and Retry Safety
- Added one shared, vendor-neutral 134-event workflow trigger catalog covering HighLevel's documented CRM, event, appointment, opportunity, affiliate, course, payment, commerce, IVR, social, community, certificate, communication, review, ads and AI-agent lifecycle events.
- Expanded the graph node catalog to 86 policy-classified node types for CRM and pipeline operations, multi-channel communications, integrations, scheduling, arrays/batching, AI, payments, marketing, affiliate/course/community, IVR, approval and sub-workflow patterns.
- Hardened graph compilation: unknown triggers fail closed; node config is deep-copied bounded JSON; accessors, cycles, prototypes, credential/private-content fields, direct destination PII, URL-like opaque refs and arbitrary network locations are rejected.
- Bounded retries to 1–10 attempts and timeouts to 1 second–10 minutes. Side-effect idempotency keys now remain stable across retries; nodes without an idempotency guard pause for review on retry. Financial, destructive, social-publish, telephony and contract actions require approval.
- Strengthened sensitive-action approvals: evidence is bound to tenant, graph checksum, execution, node and idempotency key; expires within 15 minutes; must be accepted by a trusted verifier; and rejects self-approval where a requester is known.
- Hardened AI-agent tool boundaries against accessor getters, symbol/prototype keys and overlong object keys in model arguments and connector results.
- Added regression tests for every official HighLevel trigger family, untrusted node config, retry duplication, approval expiry/scope/trust, hostile accessors, adapter requirements and reference-only message/connection data.
- Added a capability-by-capability GHL/n8n comparison and explicit execution/infrastructure limitations. The catalog and contracts do not claim live providers, persistent workflow execution or UI parity.

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
