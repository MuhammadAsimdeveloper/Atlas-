# Atlas V154–V158 Five-Phase Capability Program

Date: 2026-10-07

## Baseline

Atlas V153 already contains a hardened tenant boundary, PostgreSQL/RLS foundations, durable workflow state/control, unified communications contracts, Copilot/webchat, human handoff, approval controls, production activation gates and distributed-runtime control-plane foundations.

V154 starts the next product layer: governed connectors and a reusable node platform. This plan deliberately distinguishes source-level contracts from live provider activation.

## Phase 1 — Integration and workflow platform (V154)

### Build
- Connector marketplace registry and connector manifest schema.
- OAuth2, API-key, Basic, Bearer, HMAC and custom-header auth families.
- Custom API, Generic REST, GraphQL and SOAP definitions.
- Webhook trigger/response and HTTP request nodes.
- Pagination, retry, exponential backoff, rate-limit and Retry-After handling.
- Automatic token-refresh contract with rotation-safe credential references.
- Credential vault/KMS reference boundary and rotation lifecycle.
- Node marketplace metadata, community/private/certified tiers.
- Custom node/trigger/action SDK contracts.
- Loop, batch, split-in-batches, merge, wait/delay, schedule/cron, conditional, switch, router, parallel and error/DLQ definitions.
- Sub-workflows and workflow-as-tool / workflow-as-agent-tool contracts.
- Execution snapshots and version-pinned rollback evidence.
- Connector certification and health-state model.

### Harden
- No raw secrets in workflows, logs, queue payloads or snapshots.
- HTTPS-only connector endpoints; no embedded URL credentials.
- Signed webhook verification + replay/idempotency protection.
- Tenant-bound connector ownership.
- Bounded request/body/page/attempt/timeout limits.
- Stable idempotency keys across retries.
- Community nodes execute inside capability-scoped sandbox boundaries.
- Cataloged/configured/verified/live are separate states.

## Phase 2 — CRM, marketing and customer lifecycle (V155)

### Build
- Advanced custom objects, fields, associations and association labels.
- Record timelines, lifecycle stages, lead/account/predictive scoring, buyer intent and buying committees.
- Duplicate detection, merge, bulk edit, import/export and data-quality center.
- Sales sequences, email tracking/templates, meeting scheduler and sales playbooks.
- Campaign builder, visual email/SMS builders, drip/broadcast campaigns, segmentation and dynamic lists.
- Behavioral triggers, attribution, UTM management and conversion tracking.
- Facebook/Instagram/LinkedIn/TikTok integrations, scheduler, inbox, post composer, media library and analytics.
- Reputation: Google/Facebook reviews, requests, monitoring, AI responses, routing, interception and location dashboards.
- Ads: Google/Facebook/LinkedIn Ads, campaign operations, attribution and ROAS.
- Forms, surveys, NPS/CSAT and quiz builder.
- Courses, lessons, memberships, protected content, community/discussions, drip content and certificates.

### Harden
- Consent and communication-preference enforcement.
- Suppression/unsubscribe rules.
- Contact identity resolution and merge auditability.
- Attribution model versioning.
- Campaign idempotency and provider reconciliation.
- Anti-spam and upload scanning.
- PII minimization and retention policies.

## Phase 3 — Commerce, sales, service, documents and portals (V156)

### Build
- Products, variants, SKU, price books, taxes, discounts, coupons.
- Subscriptions, usage billing, inventory, orders, cart, checkout, payment links.
- Upsells/cross-sells, refunds, credits and reconciliation.
- Forecasting, sales goals, territories, quotes, proposals, CPQ and e-signatures.
- Ticketing, helpdesk, SLA, service queues, knowledge base, portal and feedback.
- Projects, tasks, subtasks, dependencies, milestones, recurring work, time tracking, workload/capacity and Gantt.
- Customer, partner, freelancer, agency and vendor portals with scoped records/tasks/messages/files/contracts/payments/appointments/reports/approvals.
- Document builder, contracts, approvals, tracking, expiry, versioning, PDF and audit trail.

### Harden
- Double-entry-safe financial ledger boundaries and immutable payment events.
- Payment idempotency and webhook reconciliation.
- Tax calculation as a provider boundary.
- Authorization by object + action + relationship.
- Signed documents and immutable evidence.
- File malware/content scanning and signed download URLs.
- Portal tenant/relationship isolation.

## Phase 4 — Enterprise, agency, identity and analytics (V157)

### Build
- SSO/SAML, SCIM, MFA/2FA, passkeys, OAuth provider.
- API keys, service accounts and machine identities.
- IP allowlists, device/session management and organization policies.
- Retention, legal holds, audit explorer and SIEM export.
- Development/staging/production environments, promotion, rollback and feature flags.
- Secrets manager/KMS, backup/restore automation and DR metadata.
- Agency accounts, sub-accounts, dashboard, white-label, custom domains, snapshots/cloning.
- SaaS plans, usage-based billing, entitlements, seats, agency/client billing and reseller model.
- Executive, CRM, sales, marketing, automation, agent, voice, inbox, revenue and customer-success dashboards.
- Funnel/attribution/cohort/retention/LTV/CAC/MRR/ARR/churn/pipeline velocity/cost/profitability analytics.
- Custom report builder: metrics, dimensions, filters, calculated fields, saved/scheduled reports and CSV/PDF export.

### Harden
- Step-up authentication for privileged actions.
- SCIM deprovisioning guarantees.
- Session revocation propagation.
- Key rotation and dual-control recovery.
- Data-residency boundaries and tenant export/delete.
- Immutable audit chain and SIEM delivery backpressure.
- Entitlement enforcement at API and worker layers, not only UI.

## Phase 5 — Production platform and developer ecosystem (V158)

### Build
- Real Redis client/wakeup integration.
- Autoscaling actuator with bounded control loops.
- Provider reconciliation/idempotency service.
- Multi-region routing/failover and measured RTO/RPO.
- Load, chaos and recovery testing.
- SLO dashboards, error budgets, OTEL export and alert routing.
- WAF, CDN, DDoS and edge security deployment contracts.
- Atlas API, SDK and MCP.
- Atlas App/Node/AI/Template/Connector marketplaces.
- Marketplace billing, developer publishing, signing, certification and version compatibility.
- Atlas Embedded Automation and white-label/agency platform.
- Public/private/community integration lifecycle.
- Connector health, deprecation and migration tooling.

### Harden
- Fail-closed production activation.
- Real external-infrastructure evidence rather than configuration claims.
- Supply-chain signing/provenance for marketplace artifacts.
- Canary promotion and automatic rollback.
- Provider reconciliation against authoritative external state.
- Disaster-recovery drills with recorded evidence.
- Capacity testing with measured SLO/error-budget results.

## Additional gaps not explicit in the request

### Platform primitives
- Global expression/template language with deterministic evaluation.
- Schema registry and versioned data contracts.
- Binary/file/object-store abstraction.
- Event bus/event schemas and dead-letter replay tooling.
- Distributed locks, leases and transactional outbox/inbox primitives.
- Saga/compensation support for multi-provider workflows.
- Cache policy and stampede protection.
- Workflow concurrency/quotas per tenant, user and connector.
- Timezone/DST-safe scheduling and business calendars.
- Workflow test fixtures, mocks, contract tests and replayable staging runs.
- Execution cost attribution and budget guards.

### Security and compliance
- Fine-grained RBAC/ABAC and resource relationship authorization.
- Secrets redaction in every log/error path.
- DLP policies and sensitive-field classification.
- Data export/delete/rectification workflows.
- Consent/preference center.
- Security event correlation and anomaly detection.
- Key hierarchy, envelope encryption and emergency rotation.
- Dependency/SBOM/signature verification and marketplace supply-chain controls.

### AI governance
- Model registry and provider routing/fallback policy.
- Prompt/version registry.
- Token/cost budgets and per-agent spend limits.
- Tool permission scopes and approval policies.
- Evaluation datasets, regression gates and red-team suites.
- Prompt-injection isolation and untrusted-content boundaries.
- AI audit trails with privacy-safe evidence.

### Customer/product operations
- Localization/timezone/currency/number/date formatting.
- Notification preferences and transactional-message policy.
- Accessibility/WCAG conformance.
- Feature discovery/onboarding/checklists.
- Search/indexing across CRM, files, tickets and knowledge.
- Global command palette and bulk operations.
- Import validation/preview/rollback.
- API/webhook developer portal and changelog.

### Reliability
- Queue starvation/fairness controls.
- Poison-message detection.
- Backpressure propagation.
- Circuit breakers and provider health scoring.
- Synthetic probes.
- Release canaries and migration rollback.
- Dependency outage mode and customer-visible status controls.

## Completion rule

A phase is complete only when:
1. The feature exists in code and has deterministic tests.
2. Tenant authorization is enforced below the UI.
3. Secrets/customer content are not leaked into durable control-plane metadata.
4. Failure/retry/idempotency behavior is explicit.
5. External dependencies have a separate activation gate.
6. Documentation and capability checks agree with the code.
7. CI and production-readiness checks pass.
8. Live status is claimed only after real deployment evidence.
