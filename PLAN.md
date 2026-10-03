# Atlas Full GHL + n8n Completion Plan

## Purpose

This is the canonical product-completion plan for Atlas after V110. It converts the GHL and n8n benchmark into an explicit feature-by-feature engineering backlog and prevents a feature from disappearing into a vague “future work” bucket.

The catalog in 'packages/atlas-feature-catalog/index.mjs' is the source of truth for the benchmark inventory.

## Meaning of status

- **contract** — Atlas already has a tested domain contract for the capability. This does **not** mean a live provider, authenticated API, worker fleet, external credential, production database or production UI is connected.
- **build** — the capability is explicitly assigned to a V111–V120 build stage and has an implementation anchor; it is not marked complete until tests and release gates prove it.
- **deployment** — software exists but live infrastructure/provider rollout or external verification remains.

This distinction replaces the ambiguous word “targeted”.

## Non-negotiable product goal

Atlas is not a GHL clone and not an n8n clone. It is a Business Operating System that combines:

1. GHL-class CRM, communications, marketing, websites, reputation, calendars, commerce, courses, agency/SaaS and white-label operations.
2. n8n-class visual workflow automation, arbitrary API connectivity, code/data transformation, durable execution, AI agents, RAG, MCP, source control and enterprise runtime controls.
3. Atlas-native Customer Intelligence Graph, Business Graph, AI Workforce, Revenue Command Center, security control plane and reliability fabric.

## V111–V120 build frontier

### V111 — Complete Business Object and CRM Surface
Contacts, companies, businesses, custom objects, relationships, tasks, notes, opportunities, pipelines, stages, lead scoring, timelines, import/export, bulk operations, deterministic search, CRM APIs, webhooks, calendars and services.

### V112 — Complete Communications, Marketing, Social, Reputation and Ads
Unified inbox, email, SMS/MMS, WhatsApp, Messenger, Instagram DM, live chat, phone/IVR, campaigns, email builder, forms/surveys/quizzes, blogs, social planner, social publishing/analytics, review/reputation, listings, prospecting and advertising.

### V113 — Complete n8n-Class Workflow Runtime and Connector SDK
Visual graph, triggers, actions, conditions, switch/merge/loop, waits, transforms, expressions, HTTP/GraphQL, webhooks, files/binary data, code nodes, pagination, sub-workflows, environment variables, connector SDK and provider sync.

### V114 — AI Workforce, RAG, MCP, Evaluation and Human-in-the-Loop
Agent Studio, autonomous agents, model/tool selection, structured output, memory, vector stores, embeddings, loaders, retrievers, rerankers, MCP, web/search tools, tool permissions, guardrails, evaluation, cost controls and human handoff.

### V115 — Commerce, Learning, Membership, Affiliate and Revenue Expansion
Products, prices, checkout, orders, subscriptions, invoices, dunning, refunds, POS, gift cards, loyalty, ecommerce, upsells/downsells, courses, memberships, communities, affiliates and revenue attribution.

### V116 — Agency, SaaS, White-Label, Durable Worker and API Runtime
Agency/subaccount control, SaaS plans, provisioning, rebilling, snapshots, marketplace packages, white-label, projects, contractor isolation, API gateway, queue workers, concurrency, durable execution, DLQ, replay, backpressure and environment promotion.

### V117 — Enterprise Security, IAM, Secrets and Tenant Isolation
RBAC, custom roles, 2FA, SAML/OIDC/LDAP, external secrets, secret rotation, encryption-key rotation, SSRF/risky-node controls, immutable audit, policy engine and tenant isolation.

### V118 — Source Control, Environments, Analytics and Reporting
Git/source control, dev/staging/prod, protected production, deployment diffs, rollback, dashboards, reports, attribution, workflow analytics, agent analytics, connector analytics and revenue analytics.

### V119 — OTLP/SLO, DR, Capacity, Compliance Evidence and Governance
OpenTelemetry, logs, metrics, traces, SLO/error budgets/burn rate, queue and provider health, disaster recovery evidence, restore drills, capacity profiles, compliance evidence and release gates.

### V120 — Production Providers, Launch Certification and Verified Scale
Connect real email/SMS/WhatsApp/voice/calendar/payment/social/ad/accounting/CRM providers; managed PostgreSQL/Redis/object storage/KMS/WAF/CDN; production API/auth/worker services; backup/restore/failover; carrier/provider registration; launch SEO; operational support; independently assessed compliance.

## Implementation rule
Every benchmark feature must have an immutable feature ID, domain, planned stage, Atlas code/doc anchor, explicit status, acceptance gate, and production deployment evidence before it can be called complete.

## Current V111 change set
- exhaustive GHL + n8n feature catalog;
- explicit status semantics replacing “targeted”;
- reusable tenant-bound product resource/publish contract covering major GHL resource families;
- feature-bundle integrity and permission boundaries;
- coverage checker suitable for CI/doctor integration;
- this canonical V111–V120 plan.

## Research boundary
The feature inventory tracks current HighLevel and n8n product categories as of October 2026. HighLevel's current documentation lists Ask AI, Conversation AI, Voice AI, Managed Agents, Agent Studio, Workflow AI, Funnel/Website AI, Email AI, Knowledge Base, Content AI, Reviews AI and AI Studio. HighLevel snapshots cover advertising, AI/automation, calendars, CRM, marketing, dashboards, learning, brand/design and reputation assets. n8n is the benchmark for visual workflows, integrations, code/data handling, AI agents, RAG/MCP, execution controls and enterprise operations.

Benchmark sources:
- https://help.gohighlevel.com/support/solutions/articles/155000002166
- https://help.gohighlevel.com/support/solutions/articles/48000982511
- https://docs.n8n.io/

## Production truth
V111 does not claim that every catalog feature is live today. Existing contracts remain contracts, new work remains build, and real external service rollout remains deployment. The objective is feature completeness without false production-readiness claims.
