# Atlas V94 deep audit

## Scope

Reviewed the V90 worktree's V80–V93 packages, tenant authority model, customer-agent/automation contracts, sample command-center UI, SQL migrations, release checks and new V94 Copilot/service-desk code. Current competitor notes were checked against first-party documentation for HighLevel, n8n, monday.com and HubSpot. This review covers repository code and contracts; it is not a production security assessment.

## Findings addressed in V94

| Finding | Change | Evidence |
|---|---|---|
| No operator assistant/tool gateway existed. | Added a fixed-scope Copilot runtime; reads receive trusted tenant scope, writes become pending approvals. | `packages/atlas-copilot/index.mjs` and authority/tool-boundary tests. |
| A model timeout could wait forever if an adapter ignored abort. | Added a timeout race and cancellation rejection; adapters still receive AbortSignal for cleanup. | Stalled-adapter timeout/cancel test. |
| Tenant admin prompt could ask for global tools. | Scope resolution rechecks trusted platform-owner identity; tenant tool catalog contains no platform tools. | Forged authority, cross-tenant, viewer and global tool tests. |
| No actual service case/SLA domain existed behind chatbot handoff. | Added tenant case lifecycle, stable-ID agent-handoff intake, event log, delivered-response evidence, skill/capacity ranking and elapsed pause/SLA assessment. | `packages/customer-operations/service-desk.test.mjs`. |
| Retried case commands could duplicate events or re-use an idempotency key for a different change. | Deterministic tenant/case/command event IDs, duplicate matching, conflict checks and expected-version preconditions. | Idempotency and optimistic-concurrency tests; SQL unique key. |
| Case persistence did not have its own tenant-isolated schema. | Added V94 case/event tables, forced RLS, operational indexes and append-only event policy for ordinary roles. | `infra/postgres/FINAL-MIGRATION-V94.sql`; doctor invariants. |

## Security observations

- The single configured, verified Khan platform owner remains the only global authority. Company owners/admins are tenant-scoped.
- Copilot tool output is filtered for sensitive keys, but the model can still receive customer text returned by a read adapter. Provider retention, data residency and model-side controls require production configuration.
- Prompt-injection resistance is defense-in-depth, not a proof of immunity. Tool allowlisting and server-side checks are the security boundary.
- A timeout after a pending action-store write is an ambiguous result. The action store must be atomic and idempotent; callers should reconcile against the approval inbox rather than claim the write failed.
- Delivery evidence is HMAC checked inside the domain function using `ATLAS_CASE_RECEIPT_KEY`; only internal verified outbox/receipt code may call the signer. Protect and rotate the key using the secret manager.
- Assignment ranking consumes a tenant-scoped candidate snapshot. The final application update must recheck skill, capacity, active membership and case version inside one transaction.

## Remaining product and operational gaps

- No authenticated HTTP API, signup/login, role-management UI, tenant inbox, live Copilot front end, working workflow canvas, operator chat UI, CRM, or production customer tenant persistence is shipped here.
- No connected email/SMS/WhatsApp/social/voice/calendar/review/payment provider, telephony/voice runtime, inbound channel webhook, or transactional delivery path is verified.
- V94 SLA support stores deadlines supplied by trusted intake and computes elapsed-time states. Business-hour calendars, holidays, time-zone/DST-aware schedules, tier policy evaluation and contractual SLA reporting still need an SLA service.
- No duplicate ticket/contact detector, channel-native agent percentage rollout control plane, voice transcript evaluation console, or one-click agent coaching loop is shipped.
- SQL has not run against live PostgreSQL. Redis/queue workers, KMS, object storage/CDN, WAF, OpenTelemetry exporter, backups/restore, failover and load capacity are not configured.
- The source directory has no Git metadata or remote. There is no commit/push evidence in this worktree.

## Release gate

Run `node --test`, `node scripts/check.mjs`, `node scripts/docs-check.mjs`, `node scripts/doctor.mjs`, the preview HTTP smoke and `npm audit --audit-level=moderate` where npm is available. Record exact results in the release manifest. Do not claim millions-of-users capacity, production-grade high availability, completed provider delivery or applied database migrations based on this repository alone.
