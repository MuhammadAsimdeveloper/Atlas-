# Atlas V93 — Customer operations hardening

V93 closes a release-time safety gap and adds common CRM actions to Atlas automations. A workflow that sends a message must now pin a valid immutable template version from its own tenant, and the template channel and purpose must match the workflow step. Workflows can also update a tenant-defined contact field with a bounded literal or add/remove a tenant-defined tag through idempotent, tenant-bound action contracts.

## Implemented

- `createMessageTemplateVersion()` creates an immutable, checksummed template version. Email templates require a subject; templates are bounded by channel, purpose, locale and size. Placeholder identifiers cannot expose credential or sensitive-payment fields.
- `publishAutomationWorkflow()` validates every message step against the exact same-tenant template ID/version, channel and purpose. The workflow checksum pins the template checksum. Missing, cross-tenant, altered, unused or mismatched dependencies fail publication.
- `planAutomationStep()` checks the pinned template again before it creates an outbound-message intent. Missing or altered template snapshots go to `needs_review`.
- New `update_contact_field` and `manage_contact_tag` steps generate tenant-scoped idempotent business-action commands. Resume callbacks require the exact pending action kind and idempotency key.
- `FINAL-MIGRATION-V93.sql` adds the RLS-protected durable business-action invocation table. It stores only the contact reference and step-configuration hash; workers must reload the exact step from the immutable workflow release rather than accepting a caller-provided payload.
- The lead-intake recipe now covers status update, lead tagging and owner-task assignment. Recipe descriptors still need tenant templates, field/tag IDs, connectors and policies configured before use.

Example release setup:

```js
const template = createMessageTemplateVersion({
  tenantId: trustedTenantId,
  id: 'appointment-reminder',
  version: 3,
  channel: 'email',
  purpose: 'appointment',
  subjectTemplate: 'Your appointment is coming up',
  bodyTemplate: 'Hello {{contact.first_name}}, your visit is at {{appointment.start_time}}.',
  publisherAuthority: authorityResolvedByServer
});

const release = publishAutomationWorkflow({
  draft,
  publisherAuthority: authorityResolvedByServer,
  templateDependencies: [template]
});
```

V98 adds `renderMessageTemplateVersion()` for deterministic tenant-bound personalization. The worker still has to load the pinned release and merge data from trusted tenant-scoped storage, re-check consent/suppression/frequency immediately before delivery, then send through an idempotent provider adapter. Rendering creates a draft only; no message is sent by this repository.

## Platform authority

Only the configured, verified Khan account can receive `platform_owner` authority. Company owners and administrators can publish only within their own tenant. The new template and workflow actions use the same trusted tenant-authority object and cannot set global roles. A deployment handler must resolve identity and membership from the authenticated session and trusted storage; it must not accept authority claims from JSON.

## HighLevel / GHL audit — checked 2 October 2026

HighLevel's current workflow catalog documents contact, communication, appointment, opportunity, payment, e-commerce, social, course, community, affiliate, IVR and certificate events. Its action catalog includes communication and internal actions, record updates, AI workflow actions, appointment and payment capabilities. The current Workflow AI helper can propose triggers/actions from natural language; current AI Agent workflow actions can use configured tools and conversation memory; Voice AI templates can update contact fields/tags, send follow-up, trigger workflows, call custom actions, transfer callers and book appointments. See [triggers](https://help.gohighlevel.com/support/solutions/articles/155000002292), [actions](https://help.gohighlevel.com/support/solutions/articles/155000002294-a-list-of-workflow-actions), [AI Agent action](https://help.gohighlevel.com/support/solutions/articles/155000007600-workflow-action-ai-agent), [Workflow AI assistant](https://help.gohighlevel.com/support/solutions/articles/155000003970), [Voice AI templates](https://help.gohighlevel.com/support/solutions/articles/155000008604-how-to-use-voice-ai-flow-builder-templates-and-guided-setup) and [Voice AI actions](https://help.gohighlevel.com/support/solutions/articles/155000004107).

Atlas now has lifecycle trigger names, bounded waits/reply handling, email/SMS/social/webchat/voice intent contracts, message templates, contact field/tag commands, task creation, opportunity/payment/course event names, tenant-pinned agent calls, forward-only branches and pinned child workflows. Useful next niche features are a calendar availability/booking adapter, opportunity-stage mutation, review request/response provider, lead-source attribution, customer-facing no-code journey canvas, and human-readable execution inspector. These require authenticated APIs and real provider/storage adapters; a trigger name or recipe is not a connected feature.

## n8n architecture audit — checked 2 October 2026

The current n8n Agent Builder documentation describes agents as published project artifacts composed from model, instructions, tools, web search, skills, channels, schedules, sub-agents, knowledge and memory. It separates editable draft from immutable published snapshots, supports preview/session review, agent calls from workflows, JSON-schema-constrained replies, and tool-specific human approval. n8n marks agents as Preview and currently warns that queue mode does not support agents yet. Atlas adopts pinned releases, preview/evaluation gates, scoped tools, explicit approvals, consent-gated memory and workflow-to-agent calls, but it has no n8n-like graph editor or live session UI. See [n8n agents](https://docs.n8n.io/build/build-and-manage-agents) and [human approval for tools](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools).

n8n queue mode separates trigger/webhook intake from workers: the main process queues execution IDs through Redis, workers load workflow data from shared PostgreSQL, execute and publish completion. Webhook processors can scale separately; large/binary payloads need shared object storage. The current documentation also warns against routing editor/UI traffic through webhook/worker pools and documents large webhook-response relay limits/offloading. Atlas already has queue lease, retry, dead-letter, heartbeat, trace and SLO contracts, but no running queue, Redis consumer, API/webhook fleet, object-store adapter, autoscaler, load balancer or load/failover results. Crucially, n8n's current agent queue-mode limitation must not be mistaken for a verified Atlas scale claim. See [n8n queue mode](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode), [external storage](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/external-storage) and [sub-workflows](https://docs.n8n.io/build/flow-logic/break-workflows-into-smaller-parts).

Atlas-specific decisions: store large attachments outside the hot relational store; keep event data and queue messages reference-based; measure per-tenant queue fairness; expose job retry/redrive only to authorized tenant roles; separate webhook ingress from the interactive desktop/API fleet; give every adapter bounded timeouts and idempotency; record redacted traces and outcome evaluations; require explicit memory consent and revocation/erasure; treat ambiguous external writes as human review rather than blind retries.

## Release and checks

Apply database changes in order: V80, V85, V90, V91, V92, then V93. Each API/worker transaction must set `app.tenant_id` from trusted membership data. No runtime role should have `BYPASSRLS`.

The V93 domain tests exercise cross-tenant template rejection, channel/purpose mismatch, checksum tampering, missing template release, tenant-bound contact actions and action-resume idempotency. Database execution, provider sandbox tests, real consent source revocation and multi-node failure testing remain deployment checks.
