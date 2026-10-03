# V94 — Atlas Copilot and Service Desk

V94 adds two related tenant-scoped contracts: an operator Copilot tool gateway and a support-case/SLA domain. They are deterministic package contracts with tests and a PostgreSQL migration. They do not make this preview an authenticated or provider-connected SaaS product.

## Authority and tool execution

`atlasCopilotToolManifest` calls the existing trusted authority checks. Tenant tools receive a tenant id only from the resolved authority and requested tenant must match the active membership. Tenant viewers get read-only tools. Tenant owner/admin roles can see bounded write proposals. Platform scope checks the internally resolved, verified Khan identity and offers only global read tools; tenant users cannot request it and no global write tool is exposed.

`runAtlasCopilotTurn` enforces:

- a fixed tool catalog and per-tool argument schema; unknown tools/arguments, credentials, identity/role fields, arbitrary URLs and executable code are rejected;
- a maximum of six model turns, a timeout for each model/tool/persistence call, and abort cancellation even if an adapter ignores its signal;
- 12 retained history messages, bounded request/context/output sizes and a tiny allowlist of server-provided UI context fields;
- server-derived tenant/actor scope on every read adapter call; cross-tenant results are blocked before the model receives them;
- tool result data treated as untrusted prompt content, sensitive result keys removed, and all model-authored writes routed to an action store as pending approval;
- stable tenant/actor/conversation/tool/action idempotency identity and deterministic action ID. The action store must enforce atomic uniqueness on `(tenant_id, idempotency_key)` and return the existing action's ID, state and action-binding hash on retry. The Copilot verifies tenant, status, idempotency key, action ID and binding hash before it reports a proposal.

The `read` adapter is for reads only. There is no arbitrary function tool. The Copilot module does not dispatch a CRM mutation, publish a workflow or deliver a message. The integration layer must load the approval record again, revalidate tenant authorization, template/version, consent, suppression and provider policy, then require signed action approval before running the existing action worker. If persistence times out after a request was sent, the outcome is unknown; check the approval inbox before retrying.

Do not pass client-controlled `serverContext`, memberships or records into the runtime. The API builds context after session resolution and database reads. Adapters must use parameterized queries, transaction-local `app.tenant_id`, forced RLS and per-tool resource authorization. Knowledge and customer record text remain untrusted even when stored in Atlas.

## Support case contract

`packages/customer-operations/service-desk.mjs` creates references-only cases with a bounded subject. Conversation bodies are not copied into the case or the append-only event metadata. The trusted intake adapter computes policy-specific response and resolution deadlines and supplies the deadline snapshots.

The lifecycle supports open, in progress, waiting on a customer, waiting internally, resolved and closed states. A customer-agent `handoff` result can create a case with a deterministic ID derived from the inbound event, so webhook retries do not duplicate tickets. Assignment suggestions rank active same-tenant users who match required skills and still have capacity. A suggestion is not an assignment: an authorized tenant teammate confirms it against a fresh eligible-team snapshot. Status and assignment writes require an expected case version, append a deterministic command event, and reject key reuse for a different command. The database update and event insert must happen in one transaction.

The first-response clock is satisfied only by a delivered receipt signed with the server-side `ATLAS_CASE_RECEIPT_KEY` (32 or more bytes), after a trusted outbox adapter has verified the provider webhook for the same tenant and conversation. This key must be shared across replicas and kept in the secret manager; a browser/customer cannot be allowed to call the signer. The contract accounts for elapsed-time pauses while waiting on the customer. It does not calculate local business hours, holidays, time-zone calendars or contract-specific pause rules. The API/SLA service must compute due dates according to its current published tenant SLA policy before opening the case.

V94 SQL creates `atlas_support_cases` and `atlas_support_case_events` with tenant-composite keys, forced RLS and queue/SLA indexes. Event rows are append-only for ordinary application roles. Use optimistic version updates and insert the matching event atomically. Neither API nor worker roles may bypass RLS.

## Operator experience and service-business use

The best initial Atlas use cases are missed-call follow-up, appointment changes/reminders, lead qualification, billing questions and service recovery. Copilot can summarize scoped records and draft responses; task/contact/workflow/message requests become explicit review proposals. Low-confidence answers, frustrated customers, policy blocks, repeated tool errors and requested humans can open a stable-ID handoff case. The case service then suggests a skilled, available teammate; human confirmation remains the boundary for assignment and sensitive actions.

The laptop-first command-center continues to show sample records. The current preview does not call `runAtlasCopilotTurn`, persist a support case or connect to an inbox. Add those surfaces only after authenticated endpoints and adapters are deployed.

## n8n / HighLevel / monday / HubSpot learning

Atlas adopts useful patterns—bounded AI tools, approval gates, tenant-pinned reusable workflows, queues, explicit execution outcomes, schedule/event triggers, evaluation gates, customer-channel routing, human handoff, skill-based case suggestions and measurable SLA state—through Atlas domain contracts. It does not reuse their product UI or branding.

Current first-party competitor reading shows the value of ticket summaries and recommended actions, skill-aware routing, duplicate awareness, percentage-based agent rollout, draft/test-before-deploy and batch testing. These are useful next integrations; V94 implements case/SLA state and proposal-safe Copilot foundations but not duplicate-case detection, automated transcript batch evaluation, native team inbox channels or skill-based live routing.

## Production integration checklist

1. Resolve the user session, verified actor identity and tenant membership in the API; never accept role or tenant authority from the browser/model.
2. Read/write only inside a PostgreSQL transaction with trusted `SET LOCAL app.tenant_id`; run a separate migration role and keep app/worker roles without `BYPASSRLS`.
3. Make `actionStore.createPending` atomic and unique on `(tenant_id, idempotency_key)`; return the persisted action-binding hash, preserve unknown timeout outcomes for reconciliation and never create a second approval after retry.
4. Verify case delivery receipts against tenant, conversation and outbox intent. Re-evaluate current consent and suppression immediately before messaging.
5. Re-check candidate membership, active state, skills, capacity and case version inside the assignment transaction.
6. Derive case due timestamps from a versioned SLA policy and persist the policy reference/snapshot. Add business-hours and holiday calendars before claiming contractual SLA compliance.
7. Store `ATLAS_CASE_RECEIPT_KEY` in managed secrets, use the same key on receipt-verification workers, and rotate it with an overlap window for in-flight receipt callbacks.
8. Add provider model allowlists, retention/data-region policy, request budgets, output moderation, safe citations, prompt-injection tests and tenant-specific evaluations before connecting a model.
9. Export only redacted IDs/statuses and timing to OTel; do not export message, prompt, contact or credential values.
