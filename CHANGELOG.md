## V156 — Transactional Operating System
## V157 P0 — connector/runtime hardening — 2026-10-08

- Added tenant-scoped connector operation schemas and downstream workflow output-shape propagation.
- Added execution-time typed output validation with hash-only durable step evidence.
- Added connector_action provider dispatch with verified connection binding, scope checks, external secret resolution, HTTPS/same-origin SSRF protection and deterministic idempotency.
- Added HMAC connector signing and non-secret custom request headers with internal-header collision protection.
- Added durable reconciliation resolution that atomically updates execution state and resumes confirmed-success runs through the existing workflow queue.

- Added products, variants, price books, taxes, coupons, carts, inventory reservations, quotes, orders, checkout, payment links, payment events, subscriptions, refunds and credits.
- Added evidence-bound document approval, relationship-scoped portals and dependency-safe project operations.
- Replaced process-memory provider reconciliation with deterministic database-backed reconciliation semantics.
- Added forced-tenant-RLS V156 persistence and durable idempotency constraints.
- Hardened universal business actions against credential-shaped input and payload abuse.
- Kept V153 production release metadata unchanged until V156 migration/provider/restore evidence passes.

## 153.0.0 — Authenticated Copilot Chat Hub + Public Webchat
- Added authenticated tenant-scoped Copilot Chat Hub configuration, widget embed generation, human handoff queue and agent approval inbox.
- Added public webchat sessions signed by the existing HMAC support-session gateway with exact origin allowlists and expiry.
- Connected public customer turns to the durable unified-inbox/agent-turn worker path with idempotent execution creation.
- Added real model-delta streaming persistence and authenticated fetch/SSE delivery.
- Added staging E2E coverage for session, turn, stream, history and handoff flows.
- Hardened public-origin binding, per-route rate limits, release-manifest verification, session persistence and authenticated Hub API smoke coverage.
- No live provider credentials, public endpoint, or external infrastructure are claimed without deployment evidence.

# Changelog

## 152.0.0 — Customer Support Activation and Voice Streaming
- Added signed, expiring customer-support session tokens bound to tenant, agent release and channel.
- Added hash-bound customer turn validation and reference-only enqueue envelopes.
- Connected the documented worker path for inbox input, governed agent execution, OpenAI-compatible model inference and inbox response delivery as the reviewed activation bridge.
- Added bounded voice streaming session/frame contracts with codec, duration, frame-size, sequence and tenant checks and hash-only evidence.
- Added V152 release/production gates and regression tests.
- No live customer widget, provider account, speech stack or external credential is claimed without deployment evidence.


## 151.0.0 — AI Agents, Voice Agents, n8n Runtime and Customer Support Copilot
- Added bounded deterministic n8n-style runtime handlers for collection, branching, waits, execution metadata and terminal errors.
- Added tenant-grounded customer-support Copilot runtime with confidence/handoff controls and reference-only evidence.
- Added support-agent evaluation/training curriculum using hashes, knowledge references, intents, reviewer outcomes and failure codes.
- Added hardened voice-agent turn runtime with AI disclosure, outbound consent, call-window checks, transfer/interruption budgets and reference-only transcripts.
- Added regression and release doctor gates for the V151 AI and automation surfaces.
- No live model, speech, telephony, knowledge provider or external account activation is fabricated by this release.

## 147.0.0 — Agent Journey Runtime + Durable Handoffs
- Added tenant/release-pinned agent release manifests with model-policy bounds and prompt-hash-only storage.
- Added reference-only agent journey context linking CRM, appointments, conversations, voice sessions and workflow executions.
- Added deterministic bounded agent turn planning, exact workflow invocation authorization and human handoff contracts.
- Added durable V147 turn-plan/handoff PostgreSQL tables with forced tenant RLS and API grants.
- Connected agent planning/handoff to the authenticated Growth API and runtime store.
- Extended doctor and production activation gates for V147.

## 146.0.0 — n8n-Inspired Hardened Automation Fabric
- Added bounded n8n-style workflow capabilities: looping, aggregation, split-out, sorting, duplicate removal, webhook response, error/stop nodes, execution data and chat/form/schedule-oriented catalog entries.
- Added execution governance for filtering, retry planning, protected environments, versioned templates, exact human approvals, capability-scoped MCP tools, AI workflow proposals and workflow security audits.
- Added authenticated Growth API surfaces for AI workflow proposal mode and workflow security audit.
- Kept arbitrary shell/host execution disabled, direct arbitrary network URLs rejected, secret-like workflow configuration rejected, unsafe retries blocked and production promotions protected.
- Extended doctor and production activation gates to cover V146.
- Added V146–V160 roadmap and n8n parity audit.

## 145.0.0 — Cross-product Lead-to-Booking Integration + MiroFish scenarios
- Added a tenant-scoped orchestration service connecting funnel/web lead capture, CRM contact/lead creation, deterministic qualification, follow-up planning, calendar availability/hold/booking, pipeline stage movement and redacted journey reporting.
- Added replay-stable idempotency references and fail-closed behavior for missing qualification evidence, invalid source assets and unavailable calendar slots.
- Added a provider-required voice follow-up intent without claiming external telephony execution.
- Extended `npm run mirofish:check` into deterministic stakeholder/scenario simulations covering the flagship journey, replay, tenant injection, qualification failure, calendar conflict, SEO and agent authorization boundaries.
- Added the V145+ engineering plan and release boundary documentation.
- V145 remains source/runtime-ready, not externally live: provider credentials, managed infrastructure and production evidence remain deployment gates.

## 143.0.0 — Distributed production execution fabric (V139–V143)
- Added a Redis transport abstraction with priority queues and bounded dispatch envelopes.
- Kept PostgreSQL as the durable execution authority and added explicit Redis-failure fallback/recovery semantics.
- Added bounded SLO-aware autoscaling decisions with queue-depth/utilization pressure, worker bounds and cooldown protection.
- Added failover-state evaluation for worker crash, Redis degradation and PostgreSQL outage, plus recovery-drill evidence persistence.
- Added bounded OTLP span construction and observability destination contracts.
- Added deployment evidence controls for managed PostgreSQL, Redis HA, KMS/secrets, WAF/CDN, backups/PITR, restore drills, load tests, disaster recovery, provider credentials and public origin.
- Added release doctor, production activation and focused runtime tests for V139–V143.
- External infrastructure and measured production evidence remain explicitly unverified until deployed; the repository does not claim them as live.

## 138.0.0 — Distributed runtime capacity and backpressure
- Added durable runtime-pool capacity leases with atomic pool-row arbitration.
- Added bounded global concurrency enforcement across workers in the same runtime pool.
- Added lease expiry cleanup and worker-owned slot release.
- Workers reserve capacity before claiming jobs and release unused reservations before execution.
- Capacity exhaustion now produces bounded retryable backpressure rather than uncontrolled concurrency.

## 137.0.0 — Durable observability and SLO control plane
- Added versioned runtime SLO policies for queue latency, job duration, error rate, success rate and lease recovery.
- Added durable SLO evaluation snapshots with bounded error-budget state.