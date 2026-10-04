# HighLevel and n8n feature inventory vs Atlas V115 — 3 October 2026

This is a current, source-linked inventory of the products' major user-facing and platform capability families, compared with the actual Atlas V115 repository, including authenticated Growth Center, Paddle billing routes, workspace UI and durable queue/scheduler foundation. It is not an exhaustive list of every vendor integration, UI control, plan limit or newly released feature. HighLevel's permission catalog covers 80+ controllable features and its workflow catalogs change; n8n's integration catalog is a changing set of hundreds of first-party/community integrations. Those catalogs are dynamic, so Atlas records the stable product areas and representative operations rather than pretending a static feature list proves connector parity.

## How to read Atlas coverage

- **Live service**: authenticated API and real persistence exist in this repository. V112 covers identity/workspace/team; V114 covers tenant-scoped Growth Center records/revisions and Paddle checkout/subscription-webhook state, conditional on PostgreSQL migrations, runtime grants and the relevant provider configuration.
- **Implemented contract**: tenant-bounded domain code, policy checks, migration target or deterministic command exists and has tests, but no connected product API/worker/provider surface executes it end to end.
- **Preview only**: illustrative front-end sample or marketing preview. It is not live customer data.
- **Missing**: no meaningful current implementation. A catalog name, roadmap note, or generic provider interface is not counted as the product feature.

## V114 delivered scope

V114 implements the 13 requested areas as tenant-authenticated, database-backed records: Contacts, Leads, Pipelines, Tasks, AI Lead Qualification, AI Follow-up, Workflow Builder, Paddle Billing, Email Builder, Funnel Builder, Website Builder, Social Planner, Affiliate System and Reputation Management. It adds a desktop workspace UI, immutable revisions, activity events, scoped search, same-tenant relationship checks and Paddle subscription checkout/webhook reconciliation. Leads can move through policy-checked pipeline stages, and published qualification rubrics can score operator-entered ratings with evidence references. That score is deterministic and human-reviewable; it is not an LLM inference.

External email, AI, social and page providers are not connected. In particular, saved follow-up/workflow definitions do not send messages or execute automatically, and page drafts cannot be published before domain verification and hosting are configured.

## V115 delivered scope

V115 adds PostgreSQL-backed durable jobs, tenant-scoped transactional Growth Center outbox records, interval schedules, worker-specific claims, lease heartbeat/recovery, bounded retry and dead-letter state. The generic worker only calls explicitly registered handler types; no workflow graph executor or real channel/provider handler is bundled. The workflow UI remains a JSON definition editor.

## HighLevel product inventory

HighLevel combines a multi-location CRM, customer communications, marketing automation, booking, web assets, monetization and an agency/sub-account model. Its permission catalog groups account settings/tools, automation, blogs, calendars, certificates, communities, contacts, conversations, dashboards, forms, funnels, integrations, launchpad, marketing/social planner, media, memberships, opportunities, orders, payments, products, quizzes, reputation, subscriptions, surveys, tax, transactions and WordPress. Product availability and permissions vary by account/plan.

| HighLevel feature family | Representative current functions | Atlas comparison |
| --- | --- | --- |
| Agency, SaaS and multi-location | Agency account, client sub-accounts, SaaS plans, white label/app/domain controls, reseller/rebilling, feature permissions | **Partial live/contract**: V112 tenant identity/roles are live; V114 adds tenant plan checkout state through Paddle. Khan-only platform authority remains separate. Entitlements/feature enforcement, onboarding/provisioning, usage and seat metering, SaaS rebilling, white label and global control-plane UI/API remain missing. |
| Contacts and CRM | Contacts, custom fields/objects, companies, Smart Lists, associations, imports/exports, activity/timeline, tasks and notes | **Live V114 basics**: authenticated contacts/tasks, lead and pipeline records with workspace scope, typed validators, relationship and assignee checks, search, idempotent creation, immutable revisions and audit history. Atlas's richer V102 typed custom-object/schema/association contracts still need integration into these routes. CSV import/export, smart-list filters, custom fields, bulk merge/dedupe and a full CRM activity timeline UI remain missing. |
| Sales | Opportunity pipelines/stages, assignment, status/value, follow-up tasks and sales reporting | **Live V114 basics**: pipeline stage definitions, lead status/score/value and same-tenant contact/pipeline/stage references, plus version-checked adjacent-stage movement with skip/backward policy enforcement. Approval for backward moves, assignment queues, weighted forecast and sales dashboards are not connected. |
| Conversations and communications | Unified conversation inbox, email, SMS, phone/IVR, WhatsApp/social DMs, web chat, templates, internal assignments, call/chat workflow triggers | **Implemented policy contracts**: channels, tenant agent routes, safe message rendering, consent/suppression/frequency policies, handoffs, voice session lifecycle and workflow action types. No live inbox, email/SMS/WhatsApp/social/phone delivery, inbound webhook adapters or human operator queue UI. |
| Campaigns and nurture | Email/SMS campaigns, sequences, templates, forms/lead sources, segmentation and event-driven follow-up | **Live definitions, no delivery**: V114 persists approved email-template and AI follow-up definitions, with version/lifecycle states. Campaign audiences, segment builder, transactional send jobs, consent/suppression recheck, bounce/unsubscribe processing, durable schedule runner and channel adapters are missing. |
| Workflow automation | Event triggers across CRM, forms/surveys/quizzes, email, appointments, opportunities, payments, ecommerce, IVR, social, courses, affiliates, communities, certificates and ads; branching, waits, data/CRM/message actions, webhooks and chaining | **Persisted definitions**: V114 makes workflow graphs tenant-backed, versioned and publishable after compiler integrity checks. V111 still supplies triggers/actions/retry contracts. The Growth Center editor is a validated JSON definition form, not a visual node canvas; there is no active event ingress, execution timeline, worker, schedule runner, retry/replay API or provider action delivery. |
| Booking and services | Calendar types, availability, assignments, appointment/service/rental booking, rescheduling, cancellations, reminders and payment at booking | **Implemented contracts**: timezone-aware calendar, holidays, capacity, host, availability, holds and versioned lifecycle. No live Google/Outlook sync, booking API/widget, transactional store or provider calendar connection. |
| Websites and acquisition | Sites, blogs, landing pages/funnels, domains, forms, surveys, quizzes, tracking pixels, SEO and lead-capture widgets | **Draft builder live**: V114 persists bounded Funnel/Website page sections, SEO fields and safe previews. Publication/indexing is blocked without verified workspace domain. Hosting/CDN, forms/API submissions, blogs, surveys/quizzes, tracking, attribution and custom-domain setup are missing. |
| Social and growth | Social planner/publishing, review requests, business reputation/listings, ad audience and conversion tracking, prospecting | **Draft policies live**: V114 supports scheduled social-post definitions with approval, affiliate campaign/commission rules, and unbiased review-request policy. Social account OAuth, multi-channel previews, media upload, recurring/category queues, publishing, analytics, review ingestion/responding, affiliate portal/attribution/payouts, ads and lead prospecting are missing. |
| Payments and commerce | Products/prices, checkout/order forms, store, payment links, invoices/recurring invoices, subscriptions, refunds, taxes, receipts, dunning, POS and multiple payment channels/providers | **Paddle subscription path live**: V114 can create server-side Paddle checkout, verify raw-body signed lifecycle webhooks, deduplicate events and store tenant subscription state. Plan/price setup is external. Plan entitlements, portal, seat/usage billing, proration, dunning, refunds, tax view, products/catalog, invoices, store/POS and alternate processors remain missing. V103/V107 financial contracts are not payment execution. |
| Learning and community | Courses, modules/lessons, offers, learner portal, quizzes, assignments, certificates, paid access, communities/groups/channels/events and gamification | **Catalog/contracts only**: workflow nodes and triggers model course/community access and lifecycle. No course authoring, member community surface, delivery or payment-backed entitlements. |
| Affiliates and events | Affiliate enrollment/campaigns, attribution/commission events, ticketed/RSVP events and registrations | **Catalog/contracts only**: affiliate and event/payment-related workflow vocabulary exists; attribution engine, public event product and payout operations are missing. |
| Analytics and administration | Dashboards, workflows stats/logs, account settings, media library, launchpad, integrations marketplace, APIs and webhooks | **Limited live core**: V112 reports real members, invitations and audit rows; V114 shows permission-filtered Growth module counts. Workflow execution analytics, campaign revenue, agent outcomes, media library, integrations catalog, owner control-plane UI and global account operations remain missing. |
| Mobile | HighLevel mobile companion for leads, inbox, communications, scheduling and account operations | **Missing**: Atlas is laptop-first; mobile companion surfaces have not been built. |

### HighLevel AI inventory

| AI feature | Product purpose | Atlas comparison |
| --- | --- | --- |
| Ask AI | In-app copilot for questions, data retrieval, creation and supported actions | **Contract**: Atlas operator Copilot can propose governed reads/writes, but no connected authenticated product UI. |
| Conversation AI | Customer chat/DM, FAQ, lead qualification, data collection, appointment booking, suggestive vs autopilot behavior | **Not connected**: V114 persists qualification and follow-up policies, and adds transparent weighted scoring against operator-entered criterion ratings/evidence. It has no model inference path. Existing tenant/channel/runtime contracts cover bounded tools, knowledge grounding, consented memory, approvals and human handoff. Live chatbot/session API, operator inbox, model/provider adapters, calendar execution and customer conversation history remain missing. |
| Conversation prompt optimizer | Scenario simulation and prompt improvement against a cloned agent | **V113 implemented domain service**: required safety scenario suites, deterministic expectation checks and signed release evidence. No Agent Studio UI, persisted evaluation dataset or provider adapter. |
| Voice AI and voice prompt optimizer | Inbound/outbound voice, call routing, booking, transfer, test calls and post-call outcomes | **Contracts**: disclosure/consent, transfer/handoff, booking evidence, call lifecycle, content-minimal QA/coaching. No telephony/speech providers or call reports. |
| Agent Studio, Managed Agents, Skills/SuperAgents | Flow/skill-based agents and event-driven CRM/app actions; more autonomous multi-step work | **Agent/skill/tool contracts**: versioned deployments, bounded loops and approval gates. Recursive multi-agent delegation, session browser, persistent agent service, schedules and provider credentials are missing. |
| Workflow AI | Generate, explain and edit automations from natural-language instructions | **Missing**: V114 adds tenant-backed workflow graph definitions and version editing, but no natural-language plan generator, clarifying-question flow or human-reviewed generated diff. |
| Content/Email/Reviews/Funnel AI and AI Studio | Generate/refine marketing content, review responses, websites, forms and pages | **Missing**, except safe template rendering and static marketing preview. |
| Knowledge Base | Tenant business knowledge from approved websites, FAQs, tables, text and files | **Contract**: retrieval adapter contract with tenant checks; knowledge ingestion/indexing/source administration is not connected. |

## n8n platform inventory

n8n is a general-purpose workflow/automation platform with first-party and community integrations. The important product capability families are broader than any one node catalog:

| n8n feature family | Representative capabilities | Atlas comparison |
| --- | --- | --- |
| Visual workflow builder | Node canvas, connection ports, expressions/data mapping, debug execution, test/manual runs and starter templates | **Persisted definitions, limited UI**: V114 adds a tenant-backed JSON definition editor, version history and lifecycle actions around the graph compiler. No node canvas, expression mapper, sample-data simulator, execution debug pane or template gallery. |
| Integration catalog | App/action/trigger nodes, polling/webhook events, credentials, generic HTTP/API calls, community/private nodes | **Limited contracts**: 86 typed action classes, provider adapter/connector grants, webhook/sync policy. No broad connector catalog, OAuth setup, credential vault, private connector SDK or sandboxed user code. |
| Flow logic | If/switch/merge, loops/batches, wait, schedule, error workflows, sub-workflows and workflow call/return data | **Partial**: branches, arrays, batching, waits, named child releases and event catalog are modeled. No durable workflow runner, timer/scheduler, replay service or end-to-end execution data mapping. |
| Workflow lifecycle | Draft vs active execution, version history, import/export, source control and environment promotion | **Partial live**: draft records/revisions are persisted and publish is gated by graph/domain/approval contracts. Published revisions are not executed; there is no diff/rollback UI, import/export or Git environment promotion. |
| Execution control | Running/success/failed/waiting status, per-run/step data, filtered execution history, retry original/current version, cancellation/replay | **Partial contracts**: retry/idempotency, approval and redacted execution-summary shapes. No persisted full execution timeline, replay/retry UI, run cancellation API or operator inspector. |
| Credential management | Encrypted credentials, scoped sharing, external secrets, credential references, security audit | **Policy only**: configuration accepts opaque references and rejects secret payloads. No encrypted secret vault, OAuth grant/revoke UX or provider-level permission audit. |
| AI workflow tools | Agent Builder; model/instructions; built-in, workflow, JSON-schema and MCP tools; skills; web search; uploaded knowledge; session and episodic memory; sub-agents; Slack/Telegram/Linear channels; schedules; inline and workflow-invoked agents; approval pauses; published snapshots/revert; streamed and JSON-schema-constrained replies | **Partial**: tenant-bound agent/skills, bounded tool loop, consent-based memory, structured output validation, workflow invoke, handoff and V113 deterministic evaluations. No connected model/knowledge provider, public channels, agent session API/history UI, streaming, schema-constrained live response or recursive delegation. n8n currently marks Agents Preview; its official guide says queue mode is not supported for agents yet, even though ordinary workflows use a Redis-backed queue. |
| AI authoring and MCP | AI Workflow Builder to create/refine/debug workflows from natural language; Ask n8n AI; Chat Hub; instance-level MCP server for managing workflows and agents | **Missing product surface**: Atlas Copilot can create governed tenant write proposals, but there is no connected workflow-building assistant, agent chat hub or MCP management API. |
| Human-in-the-loop | Pause before selected tools/steps, send-and-wait actions, approval and resume outcomes | **Narrow lifecycle state live**: social posts can be submitted for and receive an authenticated tenant approval. Existing exact-action agent/workflow approval contracts have no connected execution wait/resume or general approval inbox. |
| Resilience and scaling | Main/webhook ingress, Redis queue, worker pools/concurrency, separate webhook processors, PostgreSQL persistence, object/binary storage, health checks, multi-main, timeouts and graceful shutdown | **Target architecture/contracts**: Postgres identity, queue leases/retries/dead letters, provider/webhook contracts, OTel-shaped redacted traces and storage/recovery targets. No deployed Redis/worker/scheduler/webhook fleet, object storage, autoscaling, multi-region or measured capacity. Agent execution needs its own scale path: n8n docs currently mark Agents Preview and state queue mode is not supported for agents. |
| Observability and governance | Execution log filters/retry, worker/queue metrics, audit, security scanner, OpenTelemetry/log exports, evaluations/guardrails and data pruning | **Partial**: SLO/error budget shapes, event audits, quality reviews and V113 signed evaluation evidence. No production OTel collector, live alerts, full execution log UI, policy scanner or retention service for all execution records. |
| Templates and community | Public templates, community nodes, exportable/reusable workflows and self-host extensions | **Contracts/preview only**: service-business recipe definitions, connector manifests and snapshot integrity foundations. No workflow template marketplace/community node runtime. |

## Highest-impact Atlas gaps after V114

These gaps mean Atlas is not a live replacement for HighLevel or n8n yet, even though its source contains broad contracts.

1. **Build the customer inbox and chatbot**: persistent conversation/thread API and UI, provider events, assignments, agent reply/handoff, delivery receipts, consent/suppression and booking actions.
2. **Run customer AI and lead qualification**: model provider, source administration/knowledge ingestion, retrieval, evaluation UI/dataset, session history and safe action adapters with human review.
3. **Run automations for real**: managed queue/scheduler, event/webhook intake, execution/step store, inspection/replay/cancel, durable waits and per-tenant fair scheduling.
4. **Create a narrow, reliable provider catalog**: email, SMS, calendar, social and payout OAuth grants, tenant secret vault, rotation/revocation, provider quotas, callback verification and reconciliation. Paddle is only the tenant SaaS checkout/subscription path.
5. **Build the product surface**: visual workflow and page builders, AI Studio, reusable template/recipe gallery, release diff/rollback, data-bound test simulation, recurring/queue social planner and signed evaluation viewer.
6. **Finish business operations**: billing entitlements/portal/usage metering, affiliate attribution/payouts, review ingestion/reporting, public custom domains, tenant data export/deletion and business analytics.
7. **Deploy and prove scale**: managed Postgres/Redis/object storage/CDN/WAF/OTel, worker/autoscaler deployment, queue fairness, rate limits, restore/failover evidence and representative load tests. No millions-of-users capacity claim is verified.

Do not close these gaps with sample-data screens or marking catalog entries as “connected.” Database contracts, names in a trigger/action catalog, a provider manifest, and a product mock are not successful provider execution.

## n8n-inspired design choices Atlas should keep

- Use node-specific schemas and typed outputs; allow generic HTTP only through a named, tenant-granted connector operation, never a free URL.
- Keep workflows deterministic and agents bounded. Pin every runtime to immutable workflow/agent releases and bind retries to a stable idempotency identity.
- Resume waits and approvals from durable records. The human decision must be bound to exact tenant, release, execution, step, action and arguments.
- Store credential references in definitions and resolve secret values only inside a trusted adapter. Never include secrets in prompts, workflow payloads, logs, traces, exports or evaluation reports.
- Split public webhook intake, authenticated application/API, interactive agent sessions and background workers. Apply separate limits, queues and failure budgets.
- Inspect redacted run outcomes and replay safely. Make sensitive-data retention purpose-specific, tenant-configurable, bounded and deletable.
- Use dataset-based agent evaluation to block releases for deterministic safety failures. Evaluation results inform rollout; they never substitute for authorization or grant more tools.

## Sources checked 3 October 2026

**HighLevel**

- [Feature permission catalog (80+ configurable features)](https://help.gohighlevel.com/support/solutions/articles/155000008587-how-to-manage-feature-permissions-for-subaccounts)
- [Current AI product inventory](https://help.gohighlevel.com/support/solutions/articles/155000002166-ai-tools-in-highlevel)
- [Complete workflow triggers and trigger families](https://help.gohighlevel.com/support/solutions/articles/155000002292)
- [Workflow action categories and action list](https://help.gohighlevel.com/support/solutions/articles/155000002294-what-are-workflow-actions-complete-list-)
- [Agent Skills Platform and governed capabilities](https://help.gohighlevel.com/support/solutions/articles/155000008315)
- [Payment channels/provider matrix](https://help.gohighlevel.com/support/solutions/articles/155000006075)
- [Course/membership sites](https://help.gohighlevel.com/support/solutions/articles/48001141015)
- [Communities](https://help.gohighlevel.com/support/solutions/articles/155000000280)
- [HighLevel pricing guide](https://help.gohighlevel.com/support/solutions/articles/155000001156-highlevel-pricing-guide) (pricing excluded from this capability comparison because it changes)
- [Current AI product inventory, updated September 2026](https://help.gohighlevel.com/support/solutions/articles/155000002166)
- [Agent Studio multi-agent builder](https://help.gohighlevel.com/support/solutions/articles/155000007609)
- [Workflow AI assistant, updated August 2026](https://help.gohighlevel.com/support/solutions/articles/155000003970)
- [Lead pipeline and opportunity setup, updated August 2026](https://help.gohighlevel.com/support/solutions/articles/155000005062-getting-started-setup-pipelines-and-opportunities)
- [Social Planner current setup and feature overview, updated August 2026](https://help.gohighlevel.com/support/solutions/articles/155000005063-launchpad-setup-social-planner)
- [Social post approval flow](https://help.gohighlevel.com/support/solutions/articles/48001229834-post-approval-flow-in-social-planner)
- [Social Planner performance analytics](https://help.gohighlevel.com/support/solutions/articles/155000004101-social-planner-track-social-performance-using-advance-analytics)
- [Email templates in workflow steps](https://help.gohighlevel.com/support/solutions/articles/155000005553-managing-email-templates-in-workflow-steps)
- [Affiliate Manager enrollment, tracking and commissions](https://help.gohighlevel.com/support/solutions/articles/155000003637-how-does-the-affiliate-manager-work-)
- [Affiliate payout permissions and processing](https://help.gohighlevel.com/support/solutions/articles/155000003657-how-to-pay-your-affiliates)
- [Review response AI agents](https://help.gohighlevel.com/support/solutions/articles/155000005156)
- [HighLevel SaaS Mode and custom payment providers](https://help.gohighlevel.com/support/solutions/articles/155000006276-custom-payment-providers-in-saas-mode)

**n8n**

- [Official documentation and integration catalog](https://docs.n8n.io/)
- [Agent Builder, tools, skills, channels, session/episodic memory, sub-agents, schedules, approvals, streaming and workflow invocation](https://docs.n8n.io/build/build-and-manage-agents.md)
- [AI Workflow Builder, Ask n8n AI, Chat Hub, MCP, templates and agent tools](https://docs.n8n.io/build/ways-of-building-workflows.md)
- [Queue mode, Redis workers, webhook processors, concurrency and worker health](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode.md)
- [Execution inspection, filtering and retry](https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions.md)
- [Source control, version comparison and environment promotion](https://docs.n8n.io/administer/use-source-control-and-environments.md)
- [Credential management and external secret stores](https://docs.n8n.io/administer/manage-credentials.md)
- [Security audits](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/run-security-audits.md)
- [OpenTelemetry execution tracing](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/trace-executions-with-opentelemetry.md)
- [AI workflow evaluations](https://docs.n8n.io/build/integrate-ai/test-and-improve-ai-workflows.md)
- [Sub-workflow calls](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow.md)
- [Paddle webhook signature verification: raw request data and five-second tolerance](https://developer.paddle.com/webhooks/about/signature-verification/)
- [Paddle subscription checkout custom data propagation](https://developer.paddle.com/build/transactions/custom-data/)
- [Paddle subscription provisioning and webhook lifecycle](https://developer.paddle.com/build/subscriptions/provision-access-webhooks/)
- [Current documentation index and built-in/community integration catalog](https://docs.n8n.io/sitemap.md)

Vendor capabilities, preview status and plan availability may change. This document compares public product documentation with Atlas repository implementations and does not rely on marketing uptime or throughput claims.
