# Atlas V145+ Development & Integration Plan — 5 October 2026

## Purpose

This plan is the execution baseline after the V144 runtime-control-plane merge. It converts the repository audits, the current HighLevel/n8n capability matrix, and the 5 October 2026 MiroFish decision record into an implementation sequence focused on connected end-to-end business outcomes, not isolated feature catalogs.

## Verified baseline

- Main is on V144 after merging PR #28, “V144: integrate runtime control plane and OTLP export”.
- The repository contains 299 tracked files and 49 automated test files.
- V114+ Growth Center modules are tenant-backed and include contacts, leads, pipelines, tasks, AI qualification/follow-up, workflows, email templates, funnels, websites, social planner, affiliate and reputation records.
- V125/V126 provide the production worker/provider and unified communications control-plane boundaries.
- V127/V128 provide event ingress and durable workflow wake/resume control.
- V129–V143 provide schedules, event routing/deduplication, connector/action/agent control metadata, promotion/rollback, capacity/SLO controls and distributed runtime evidence gates.
- V144 integrates runtime control events and optional OTLP export into the worker/control plane.
- The repository deliberately does not claim external providers or infrastructure are live merely because source contracts exist.

## MiroFish decision constraints

The repository’s 5 October 2026 MiroFish decision record says the next cycle should prioritize end-to-end workflows over further catalog expansion and identifies this flagship journey:

**Lead → CRM → qualification → automated follow-up → appointment → pipeline update → reporting**

It also treats trust/security as a first-class differentiator and states that MiroFish findings are hypotheses to validate with real users.

For engineering, the repo-integrated MiroFish test must stress:
1. product value from an end-to-end journey,
2. cross-module state consistency,
3. safe automation and human handoff,
4. provider failure/degradation,
5. tenant isolation,
6. time/calendar correctness,
7. observable outcome reporting,
8. no false “connected/live” claims.

## Release strategy

### V145 — Cross-product Lead-to-Booking Control Plane (current build)

Build one canonical, provider-neutral journey service that composes existing hardened primitives.

Acceptance:
- Funnel/web form lead capture produces a tenant-scoped contact and lead.
- Lead is attached to a valid pipeline/stage.
- Qualification is deterministic, explainable and evidence-backed.
- A successful qualification produces a versioned journey event and a workflow command.
- Follow-up is represented as a durable, idempotent action plan using existing message/provider references.
- Calendar availability/hold/booking uses the existing timezone-aware calendar contracts.
- Booking creates a durable appointment reference and a journey event.
- Opportunity/pipeline stage update is version-checked and produces an audit event.
- Voice follow-up can be authorized from the same contact/journey context without ever bypassing consent/suppression/provider gates.
- Reporting receives redacted journey outcomes and can compute funnel-to-booking conversion.
- Every step is tenant-bound and carries stable correlation/idempotency references.
- Provider actions remain fail-closed unless deployment credentials, callback verification and health evidence exist.

### V146 — Agent Workforce + Session Runtime

Build the connected AI agent product surface:
- Agent Studio configuration and release browser.
- Persistent agent sessions and turn/tool history using redacted metadata.
- Model-provider adapter interface with bounded timeout, token/step budget and cancellation.
- JSON-schema constrained outputs through the existing validator.
- Tool capability intersection across actor/tenant/agent/skill/deployment.
- Human approval inbox for write/network/financial/destructive tools.
- Agent-to-workflow and workflow-to-agent invocation with exact release pins.
- Delegation limits: max depth, fan-out, per-tenant quotas, trace ancestry, approval propagation.
- Batch agent evaluation runner and regression evidence viewer.
- Streaming/session API boundary; no source claim of a live model provider until credentials and delivery tests are present.

### V147 — AI Voice Calling + Inbox Loop

Connect voice lifecycle to CRM, inbox, calendar and workflow:
- Contact/conversation identity and voice session correlation.
- Consent, suppression, frequency, call-window and provider-terms rechecks at attempt time.
- Twilio/provider-neutral adapter execution through the existing provider runtime.
- Call-start/disclosure/agent-connect/transfer/complete callbacks with replay-safe reconciliation.
- Appointment booking during or after call with exact appointment reference.
- Human handoff queues and unresolved-call escalation.
- Post-call outcome -> CRM timeline/opportunity -> workflow event.
- Privacy-safe quality scoring and coaching evidence.
- Explicit “provider configured/verified” status rather than fake connected indicators.

### V148 — Funnel + Website + Forms Conversion Fabric

Turn marketing assets into connected acquisition surfaces:
- Reusable website/funnel page blocks with form definitions.
- Form submission endpoint/webhook with anti-abuse/rate limits and tenant routing.
- Contact/lead creation and dedupe reference.
- Source/UTM/affiliate attribution references.
- Funnel step/view/form-submit/booking outcome events.
- CTA wiring to calendar and agent flows.
- Draft/preview/public release separation.
- Domain verification and HTTPS-only public indexing gate.
- Tenant analytics events with privacy-safe aggregation.
- Builder preview, publish, rollback and diff checks.

### V149 — Calendar + Service Operations

Finish operational scheduling:
- Availability provider adapter interface and live provider callback boundary.
- Appointment create/reschedule/cancel event catalog and dedupe.
- Booking ownership/host routing, capacity and buffers.
- Reminder workflow linkage.
- No-show/missed-appointment trigger.
- Service request/job/visit/quote/invoice relationship continuity.
- Business-hours SLA and escalation scheduling.
- Operator calendar administration UI.
- Human/hybrid booking fallback.

### V150 — CRM Intelligence + Timeline + Data Portability

Strengthen CRM for real business operations:
- Unified contact/customer timeline across calls, messages, appointments, workflow runs, tasks and opportunity changes.
- Deterministic dedupe candidates and human-approved merges.
- Import/export with schema validation, dry run and audit evidence.
- Custom objects/associations using tenant RLS.
- Lead-source and attribution model.
- Saved views, filters, bulk actions and optimistic concurrency.
- Lifecycle automation hooks from CRM events.
- Redacted reporting aggregates and retention/deletion controls.

### V151 — Security, Trust and Enterprise Controls

Close the security gaps that could block production trust:
- External secrets/KMS integration boundary and rotation/revocation.
- Webhook signature verification coverage matrix.
- API/public-webhook/rate-limit separation.
- Tenant isolation adversarial tests for API, worker, callbacks, jobs and exports.
- Platform-owner versus tenant-admin negative tests.
- PII/secret redaction tests for logs, traces, queue payloads, eval reports and exports.
- Action authorization and approval-chain integrity.
- Replay/deduplication abuse tests.
- Security headers, CSRF/origin controls where applicable, SSRF-safe connector boundaries.
- Dependency and container vulnerability gates.
- Recovery, deletion and data-retention evidence.

### V152 — SEO + Growth Analytics

Make SEO a real product capability:
- Tenant page-level SEO metadata APIs.
- Canonical URL, robots, sitemap, Open Graph/Twitter, JSON-LD.
- Preview = noindex; public = verified HTTPS domain only.
- Keyword/content quality checks and internal-link coverage.
- Structured lead-form conversion schema.
- Search console/provider integration boundary.
- Page performance and crawlability evidence.
- Funnel attribution linked to SEO landing pages.
- Rollback-safe public releases.

### V153 — Distributed Production Proof

Move from repository readiness to measured production evidence:
- Real Redis client and worker wake-up adapter.
- Queue fairness, priority and backpressure tests.
- Autoscaler actuator integration with bounded cooldown and error-budget policy.
- OTLP collector/metrics destination verification.
- Managed PostgreSQL/Redis/KMS/WAF/CDN/object storage deployment evidence.
- Load tests at representative concurrency.
- Backup/PITR restore and disaster-recovery drills.
- Provider reconciliation/idempotency at real callback volume.
- Regional/network failure simulation.
- SLO burn-rate alerts and paging evidence.

## Canonical cross-module data contracts

Every business journey must carry:

- tenantId
- journeyId
- contactRef
- leadRef/opportunityRef
- workflowReleaseRef
- agentReleaseRef when applicable
- appointmentRef when applicable
- conversationRef when applicable
- voiceSessionRef when applicable
- stable idempotencyKey
- sourceRef/attribution reference
- redacted traceRef

Raw message bodies, credentials, transcripts, recordings and arbitrary network destinations must not cross control-plane boundaries.

## MiroFish-style engineering simulation

`npm run mirofish:check` currently protects the decision record itself. V145 extends it with a deterministic multi-stakeholder scenario suite that exercises the flagship journey.

Synthetic stakeholders:
- SMB owner
- sales operator
- marketer
- service coordinator
- AI-ops reviewer
- security reviewer
- finance operator
- agency operator
- customer-support lead
- platform operator

Scenarios:
1. healthy lead-to-booking happy path;
2. duplicate form submission;
3. qualification missing evidence;
4. provider outage during follow-up;
5. calendar slot conflict;
6. voice consent missing;
7. tenant-crossing payload injection;
8. workflow replay/duplicate event;
9. public-site build without verified HTTPS;
10. agent tool requesting forbidden network/secret data.

Pass conditions:
- business outcome is preserved where safe;
- unsafe actions fail closed;
- tenant scope never crosses;
- no duplicate side effect is produced by a replay-safe command;
- all outcome references are observable without customer payload leakage;
- a scenario cannot become “Live” without external activation evidence.

This is scenario simulation/regression engineering, not a forecast that replaces real user research or a hosted MiroFish run.

## Test pyramid

Every V145+ change follows:
1. failing focused unit test,
2. minimal implementation,
3. focused integration tests,
4. full Node 20/22 CI,
5. `check`, `doctor`, `mirofish:check`, `docs:check`, `seo:check`,
6. build/smoke/launch/production activation gates,
7. browser/API E2E where a reachable deployment exists.

No skipped tests. No test should assert merely that a feature name exists when the feature is described as operational.

## “Connected” definition

A capability is **Connected** only when:
- its authenticated API/service boundary exists,
- persistence is tenant-scoped,
- its event/action path reaches the next module,
- retries/deduplication are defined,
- failure/handoff behavior is defined,
- tests prove the path,
- external dependencies are explicitly marked Ready/Blocked,
- UI labels reflect the actual state.

A catalog entry, database row, mock provider or preview screen is not sufficient evidence of connection.

## Current blockers that cannot be solved by source code alone

- Real model-provider credentials and production inference.
- Real telephony/email/WhatsApp/calendar/social credentials and callback verification.
- Managed PostgreSQL/Redis/KMS/WAF/CDN/object storage.
- Public HTTPS DNS/domain and certificate.
- Real backup/PITR/failover measurements.
- Real OTLP destination/paging.
- External security/compliance review.

These remain explicit release gates rather than hidden assumptions.

## V145 immediate implementation files

- `packages/atlas-journey/index.mjs`
- `packages/atlas-journey/index.test.mjs`
- `scripts/mirofish-check.mjs` (extended deterministic scenario suite)
- `docs/V145-LEAD-TO-BOOKING.md`
- package version/changelog/roadmap integration
- later API/store wiring after the pure orchestration contract is proven

## V145 acceptance target

The codebase must be able to execute a deterministic in-memory **Lead → CRM → Qualification → Follow-up → Appointment → Pipeline → Reporting** journey while preserving existing security invariants and without performing external side effects.
