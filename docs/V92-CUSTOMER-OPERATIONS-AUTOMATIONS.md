# Atlas V92 — Customer agents and business automations

V92 deepens the tenant-scoped customer operations layer. It connects approved customer-agent deployments to workflow automations, adds safe event branches and sub-workflow calls, establishes an explicit memory consent contract, and expands the trigger and business-recipe catalog for service businesses and agencies.

## V92 implementation

- Customer agent deployments remain immutable, tenant-bound releases with evaluation-gated rollout, channel routing, knowledge coverage checks, explicit human handoff, tool permission intersections and exact-scope approvals.
- Workflow releases may pin published same-tenant child workflows and published same-tenant agent deployment releases. A release checksum covers its complete dependency snapshots, so a later edit cannot silently change an already-published journey.
- A workflow may invoke a pinned customer agent. The queued action contains tenant, agent release, conversation, contact, source-event and idempotency references; it does not contain the customer message. The trusted worker must fetch the message through the tenant-scoped conversation store.
- The parent automation waits for the matching child workflow or agent command. Resume callbacks check tenant, parent/child IDs, action kind and idempotency key. Task results cannot accidentally complete a pending agent call.
- `branch` steps use exact comparisons over safe trigger inputs or a completed agent outcome. Branches only point forward in the immutable step list; this prevents authored workflow loops.
- `workflow.called` events are internal child-workflow starts. Upstream request handlers must not allow a public caller to forge `parentEnrollmentId` or event identity.
- Email/SMS/WhatsApp/social/voice message intent creation requires fresh tenant/contact/channel/purpose policy, consent, suppression and frequency snapshots. Marketing intent requires explicit consent. Workers repeat those checks immediately before delivery. Complaint, unsubscribe and hard-bounce receipts suppress further sends.
- Customer memory uses conversation or contact scope, a maximum 90-day policy, structured short facts, 8 KiB model-context limit, redaction checks, explicit server-verified consent evidence and bounded adapter timeouts. The database target stores only envelope-encrypted memory values and evidence references; the application must use a tenant-aware key-management service.
- AI model, knowledge, memory, approval and tool adapters have bounded request deadlines. A timed-out write tool is treated as an unknown outcome and handed to a person; the runtime does not automatically retry it.
- Recipes now cover lead follow-up/qualification, appointment reminders and recovery, missed-call text-back, voice-agent after-call follow-up, post-service reviews, failed payments, abandoned checkouts and course onboarding.

The recipe catalog is a template index, not a running workflow. A tenant must configure message templates, provider connections, channel consent, agent releases, task templates and business rules before publishing a journey.

## Public service boundary

The current repository supplies pure domain contracts, PostgreSQL targets, a static sample-data dashboard and tests. It does **not** expose a production HTTP API. A future authenticated handler must resolve the actor and active tenant membership from the session and trusted storage before calling these functions. Never accept `role`, `platformOwner`, membership, consent, provider receipt, `parentEnrollmentId` or `publisherAuthority` as trusted request claims.

The intended server contract is:

```text
HTTP session + route
  -> authenticate user
  -> resolve active tenant membership from trusted storage
  -> verify owner email only for the one Atlas platform owner
  -> validate request shape; derive events and current consent/policy snapshots
  -> run the Atlas domain contract
  -> commit tenant-scoped rows with SET LOCAL app.tenant_id in a transaction
  -> enqueue durable idempotent actions by opaque references
  -> workers re-check tenant, consent, suppression, provider connection and approvals
```

The central authority contract is implemented by `packages/atlas-core/authority.mjs`: Khan's configured, verified account is the only global Atlas owner. Customer owners/admins can publish and manage releases inside their own tenant only. A platform-owner label supplied by a customer is rejected.

## Workflow contract examples

The methods below are library contracts; they are not HTTP routes:

```js
const draft = createAutomationWorkflowDraft({
  id: 'support-qualification', tenantId: trustedTenantId,
  name: 'Qualify and route a support lead', triggerType: 'message.received',
  steps: [
    { id: 'support-agent', type: 'invoke_agent',
      agentRef: { deploymentId: 'support-deploy', releaseId: 'support-release-v1', version: 1 },
      inputMap: { conversation: 'conversationRef', contact: 'contactRef' } },
    { id: 'outcome', type: 'branch', source: 'lastAgentOutcome', operator: 'equals', value: 'answered',
      thenStepId: 'resolved-task', elseStepId: 'handoff-task' },
    { id: 'resolved-task', type: 'create_task', taskTemplateRef: { id: 'qa-review', version: 1 } },
    { id: 'handoff-task', type: 'create_task', taskTemplateRef: { id: 'human-follow-up', version: 1 } }
  ]
});

const release = publishAutomationWorkflow({
  draft, publisherAuthority: authorityResolvedByServer,
  agentDependencies: [publishedSameTenantAgentRelease]
});
```

At execution time `planAutomationStep()` returns `invoke_customer_agent` with opaque references and an idempotency key. The worker calls `runCustomerAgentTurn()` after it fetches the inbound message in a tenant-scoped transaction. `resumeAutomationAgent()` records only a bounded outcome (`answered`, `human_handoff`, `needs_approval` or `failed`); it does not place the model's message body into the automation cursor.

## Memory adapter contract

The service layer calls `runCustomerAgentTurn()` with `memoryConsentEvidence` only after loading a current grant for the exact tenant, agent, contact and conversation. The store methods receive an explicit tenant and scope on every call:

```text
loadForAgent({ tenantId, agentId, scope, scopeRef, retentionDays, now, signal })
  -> { tenantId, agentId, scope, scopeRef, items: [{ id, tenantId, agentId, scope, scopeRef, key, value, createdAt }] }

saveFacts({ tenantId, agentId, scope, scopeRef, consentEvidenceRef, consentRevision,
            expiresAt, facts, trust, signal })
  -> { tenantId, agentId, scope, scopeRef }
```

The memory database schema has `encrypted_value BYTEA`, key version and value hash fields, but no plaintext-value column. Implementations must encrypt/decrypt through a managed KMS or secret store, check revocation before load, delete on revocation/expiry and implement customer erasure. No concrete KMS-backed adapter is shipped here.

## Trigger and workflow coverage

The catalog now has normalized event IDs across contact changes, tags, forms/surveys/quizzes, lead sources, page/tracking events, appointments, missed calls/transcripts, opportunities, invoices/subscriptions/orders, affiliate and course progress, communities/certificates, review events, email delivery/complaint/unsubscribe, consent changes, schedules, webhooks and agent/workflow outcomes.

An event name in the catalog does not mean its source provider is connected. Webhook authentication, source signatures, deduplication, tenant attribution and event payload minimization belong in the upstream adapter. Scheduled triggers need a durable scheduler. No trigger source can set tenant or authority based only on JSON supplied by an unauthenticated caller.

## Competitor capability audit

HighLevel's official product pages list website/funnel building, CRM/pipelines, conversation and voice AI, email/SMS marketing, unified inbox, calling, workflows, calendars, ad management, review management, prospecting, payments/invoices, courses/communities, API access and many usage-priced add-ons. Its published platform plans are $97, $297 and $497 monthly before usage and optional add-ons. Its workflow catalog spans contacts, communication, appointments, opportunities, affiliates, courses, payments, ecommerce, IVR, social, communities and certificates. Its current Voice AI setup also covers transfer, workflow, SMS, contact updates, appointment booking, custom webhook actions and after-call actions. See the [HighLevel pricing and feature catalog](https://www.gohighlevel.com/pricing), [workflow trigger catalog](https://help.gohighlevel.com/support/solutions/articles/155000002292), [workflow action catalog](https://help.gohighlevel.com/support/solutions/articles/155000002294-a-list-of-workflow-actions), [Voice AI guide](https://help.gohighlevel.com/support/solutions/articles/155000004107) and [SaaS plan configurator guide](https://help.gohighlevel.com/support/solutions/articles/155000008015-getting-started-with-the-saas-configurator).

| HighLevel capability | Atlas in V92 | Evidence boundary |
| --- | --- | --- |
| Customer AI, controlled tools, approvals and human handoff | Domain runtime and release contracts | Chat/voice vendor channels are not connected. |
| Contact messaging and nurture | Safe message intent/outbox/receipt contracts and event workflows | Email/SMS/WhatsApp/social adapters and campaigns are not connected. |
| Workflow automation | Timers, reply waits, messages, tasks, conditions, pinned sub-workflows and pinned agent calls | No visual drag-and-drop editor or production API/worker deployment. |
| Appointment and call follow-up | Event catalog and recipes | No calendar availability/booking engine or telephony provider. |
| SaaS billing and plan pricing | Target plan metadata only in `packages/pricing` | No checkout, subscription ledger, invoicing, tax, payment provider or usage reconciliation. |
| Websites, funnels, forms, ads, review management, affiliate system, courses and communities | Selected inbound event names and recipes | Product surfaces and provider integrations remain absent. |
| Theme and desktop operations dashboard | Accessible laptop-first sample dashboard | Values are sample data, not a live operations console. |

The target subscription prices at exactly half the current public HighLevel monthly tiers are $48.50, $148.50 and $248.50; this is a planning target, not a live purchasable Atlas plan. Usage, telecom, AI, add-ons, processing and tax costs are separate.

Current n8n documentation describes agent artifacts with model/instructions/tools/skills/knowledge/memory, published versions, preview, sessions, sub-agents, schedules, channel connections and workflow agent calls. It also documents human approval before sensitive tool calls. n8n currently warns that its agents are in Preview and that its queue mode is not supported for agents yet. Atlas adopts tenant-scoped release snapshots, strict tool approvals, consent-gated memory, structured branches, pinned sub-workflows, workflow-to-agent actions and idempotent database invocation records, while remaining honest that no durable worker service is deployed. See [n8n agent docs](https://docs.n8n.io/build/build-and-manage-agents), [queue mode](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode), [conditional paths](https://docs.n8n.io/build/flow-logic/split-with-conditionals), [sub-workflows](https://docs.n8n.io/build/flow-logic/break-workflows-into-smaller-parts) and [human approval for tools](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools).

## Database and rollout

Apply migrations in order: V80, V85, V90, V91, V92. V92 adds immutable workflow releases, enrollments/cursors, versioned templates, a safe message outbox, provider receipts, channel suppressions, durable agent invocation rows and encrypted-memory fact metadata. It also enables and forces RLS on tenant-owned tables with an explicit transaction-local tenant setting.

The API/worker database role must not have `BYPASSRLS`. The platform-owner service still sets `app.tenant_id` for each scoped action; global product-owner authority is an application authorization decision, never an implicit database superuser grant.

## Remaining production work

- Authenticated API/middleware, account signup/login, account recovery, MFA and tenant membership persistence.
- A working desktop product UI including workflow canvas, inbox, admin/customer settings, import/export, version diff/review, execution inspector, retries, redrive and templates.
- Concrete OAuth/provider integrations for email, SMS, WhatsApp, social, voice, calendar, CRM, payment, website/funnel, review and course/community services.
- Managed secret-manager/KMS, OAuth refresh/token rotation, signed webhook adapters, consent/suppression service, Postgres and Redis workers, durable schedule service, object storage/CDN/WAF and OpenTelemetry collector/exporter.
- Subscription lifecycle, usage metering/reconciliation, tax, refunds, checkout, invoice state and idempotent payment webhooks.
- Postgres migration execution, security review against deployed roles, provider sandbox E2E tests, load/failover/restore exercises, production data retention policy and operational SLO evidence.

Local JSON/state is development-only. The command center is explicitly sample data. No customer message is sent, no subscription is charged, and no millions-of-users capacity claim is verified by this repository.
