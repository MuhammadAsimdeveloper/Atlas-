# Atlas Five-Phase Hardened Build — 7 October 2026

## Scope

This is the implementation scope for the next Atlas expansion. Atlas keeps the existing tenant isolation, checksummed records, approval gates, idempotency contracts, bounded workflow execution, protected environments and fail-closed provider policy. New capabilities must plug into those foundations rather than bypass them.

## Five phases

| Phase | Focus | Current delivery state |
| --- | --- | --- |
| P1 | Integration + Automation Core | Implemented foundation: provider catalog, generic connector/auth primitives, encrypted credential envelope/rotation, HMAC verification, pagination/rate-limit/backoff, GraphQL/SOAP request builders, marketplace package validation, expanded workflow-node catalog and workflow tooling contracts. |
| P2 | CRM + Growth + Revenue + Experience | Capability registry + contracts: CRM intelligence, marketing, reputation, ads, education/community, forms/surveys, documents, commerce, portals, projects and agency/SaaS. Existing Atlas modules remain the source of truth for already-shipped slices. |
| P3 | Analytics + AI + Developer Platform | Capability registry + contracts: executive/reporting layer, SEO, attribution, AI/RAG/agent controls, Atlas API/SDK/MCP and marketplace surfaces. |
| P4 | Enterprise Security + Reliability | Externally gated: SSO/SAML/SCIM, MFA/passkeys, KMS/secrets, WAF/CDN/DDoS, multi-region, load/chaos, OTEL/SIEM, backups/restore and measured DR. |
| P5 | Marketplace + Production Ecosystem | Externally gated: signed community extensions, certification, private/public distribution, regional routing/recovery, production provider certification and launch proof. |

## Connector fabric

Atlas now has one provider-neutral connector contract. Providers are catalogued separately from the execution mechanism, so a connector can advertise capabilities without pretending credentials or external activation exist.

Supported catalog families include Google, Microsoft, Slack, Discord, Telegram, Stripe, PayPal, Shopify, WooCommerce, Salesforce, HubSpot, Pipedrive, Mailchimp, SendGrid, Twilio, WhatsApp, OpenAI, Anthropic, Gemini, AWS, Azure, GitHub, GitLab, Notion, Airtable, Supabase, PostgreSQL, MySQL, MongoDB, Redis, S3, Dropbox, Google Drive, Google and Microsoft calendars, Facebook, Instagram, LinkedIn and TikTok.

Authentication primitives include OAuth2, API key, Basic, Bearer and HMAC. Connector requests can use custom non-secret headers, cursor/page/link pagination, bounded retries with exponential backoff and OAuth refresh planning.

## Hardening rules

1. Tenant first — connectors, credentials, marketplace packages, execution state, records, reports and portals stay tenant-scoped.
2. No secret-in-graph — workflow configuration stores opaque credential references, never plaintext tokens, passwords, cookies or signing keys.
3. No arbitrary network escape — connector URLs require HTTPS, reject embedded credentials and reject obvious localhost/private-network destinations.
4. Side effects fail closed — provider writes, payments, publishing, messaging, calls and destructive actions require provider verification plus the applicable consent/approval/idempotency policy.
5. Retry safely — retry attempts stay bounded; non-idempotent effects cannot be duplicated by automatic retry.
6. Webhook authenticity — inbound provider events require provider-specific verification and replay-window protection before becoming trusted Atlas events.
7. Execution isolation — code-execution nodes use a separately reviewed sandbox boundary; they do not receive host access or unrestricted secrets/network access.
8. Version pinning — workflow runs, promotions, marketplace packages, credentials and provider capabilities are version-aware and auditable.
9. Redaction — execution receipts, headers and model/tool traces exclude credential material and retain bounded references.
10. External truth — source code never marks KMS, WAF, SSO/SCIM, a real provider account, a real domain or production DR/load evidence as live without deployment evidence.

## Additional features Atlas adds beyond the supplied list

The registry also tracks idempotency keys, outbox/inbox delivery, an event bus, replayable events, schema compatibility, tenant quotas, usage metering, global search, notification center, timezone/DST policy, localization, currency normalization, a consent ledger, suppression lists, webhook reconciliation, incident management, on-call routing, alert deduplication, change management, runbooks, cost anomaly detection, budget guardrails, capacity planning, data contracts, profiling, quality rules, semantic data layers, incremental sync checkpoints, conflict resolution, dead-letter repair, model-health routing, prompt versioning, evaluation regression gates, ground-truth datasets, tool-call tracing, model spend caps, provider outage failover, public status pages, developer documentation, sandbox tenants, test-data generation, contract-test fixtures and migration assistance.

## Completion standard

A capability is implemented only when its persistence or deterministic contract, authorization, side-effect boundary, retry/idempotency behavior, downstream outcome, tests and operational evidence are connected. Catalog entries, feature flags, mocks and UI placeholders do not count as live provider functionality.

## Branch delivery

This work is being built from the existing main baseline on the atlas-five-phase-build branch.
