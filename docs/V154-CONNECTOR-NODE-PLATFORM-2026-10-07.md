# V154 — Connector + Node Platform

## Purpose

V154 is the first product slice after the V153 Copilot/webchat boundary. It adds a governed connector and node registry without weakening Atlas's existing tenant, approval, provider-verification or worker boundaries.

### Implemented in this release

- Connector marketplace catalog with 40+ named integrations requested for Atlas.
- Authentication families: OAuth2, API key, Basic, Bearer, HMAC, custom headers and no-auth public endpoints.
- Private connector manifest validation with HTTPS-only endpoints.
- Credential envelopes that store only opaque secret references; rotation creates a new reference.
- Bounded exponential backoff with jitter.
- Rate-limit decisions and retry-after handling.
- Pagination strategies: cursor, offset, page and link-header.
- Generic REST, GraphQL and SOAP connector definitions.
- Webhook, HTTP request/response and authentication node definitions.
- Control nodes for loops, batches, split-in-batches, merge, wait/delay, retry, error and DLQ.
- Sub-workflow and workflow-as-tool / workflow-as-agent-tool definitions.
- Immutable execution snapshots with SHA-256 evidence hashes.
- Unit tests for catalog coverage and security invariants.

## Provider truth boundary

The catalog is metadata and policy, not proof that a provider is connected. A connector becomes usable only after a tenant connection is authenticated/verified by the production provider adapter, its secret is held by the reviewed vault/KMS boundary, webhook origins/signatures are verified, consent/approval policy passes where required, and the worker action is enabled.

No provider API keys, OAuth client secrets, refresh tokens, webhook signing secrets or customer payloads are stored in this package.

## Next phases

### Phase 1 — Integration + workflow foundation
V154 connector/node platform (this release), credential lifecycle, marketplace manifests, execution snapshot contracts, connector certification gates.

### Phase 2 — CRM + marketing + customer lifecycle
Advanced custom objects/associations, import/export/data-quality center, sequences, campaigns, segmentation, attribution, reputation, social publishing/inbox, forms/surveys, course/membership/community foundations.

### Phase 3 — Commerce + sales + service + portals
Products/variants/SKUs, price books, CPQ, checkout, subscriptions/usage billing, inventory/orders/refunds/credits, proposals/contracts/e-signature, helpdesk/SLA/knowledge base, projects/tasks/Gantt/time tracking, customer/partner/freelancer/agency/vendor portals.

### Phase 4 — Enterprise + agency + analytics
SSO/SAML, SCIM, passkeys, service accounts/machine identities, device/session management, retention/legal holds, SIEM export, agency hierarchy, white-label, snapshots/cloning, feature entitlements, usage billing, custom report builder and executive/customer-success/revenue dashboards.

### Phase 5 — Production platform + developer ecosystem
Development/staging/production promotion, feature flags, secrets/KMS integration, backup/restore automation, multi-region/failover, load/chaos testing, SLO/error budgets/OTEL, WAF/CDN/DDoS, autoscaling actuator, Redis wakeup, provider reconciliation, Atlas API/SDK/MCP and the public/private app/node/template/AI marketplaces.

## Hardening rules for every phase

1. Tenant identity is mandatory for every persisted object and execution.
2. Secrets are references only; secret material is resolved only inside approved vault/KMS boundaries.
3. External side effects require verified provider state plus applicable consent/approval.
4. Webhooks require signature verification, replay protection and bounded payloads.
5. All retries are bounded and idempotency keys remain stable across attempts.
6. Queue payloads contain references, not customer content or credentials.
7. Public/community code is sandboxed and capability-scoped; no arbitrary host/network access.
8. Every release has deterministic tests, doctor/capability checks and explicit external-dependency gates.
9. “Cataloged”, “configured” and “Live” remain separate states.
10. Rollback must restore a version-pinned workflow/integration state without mutating immutable execution history.
