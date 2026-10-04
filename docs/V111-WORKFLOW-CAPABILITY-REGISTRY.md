# Atlas V111 — Workflow capability registry and competitor coverage

Checked 3 October 2026 against the linked vendor documentation. This is a capability audit of the current GitHub source, not a claim of feature parity or a live production deployment. `Catalogued` means the compiler can identify and validate a typed definition; `contract` means a deterministic domain function exists; `adapter required` means a real provider/runtime is still needed; `missing` means the product surface or durable service is not implemented.

## What V111 implements

- One shared registry now drives customer-operations enrollment and workflow-graph trigger validation: **134 canonical event names**.
- The graph compiler recognizes **86 node types** across CRM, communications, sales, booking, marketing, commerce, voice, integrations, AI, finance, education, orchestration, data and governance.
- Node definitions expose risk, guard, execution class, adapter requirement, retry safety and approval requirements. High-risk financial, destructive, social-publishing, telephony and contract actions require approval.
- Saved node configuration is cloned as bounded JSON. The compiler rejects cycles, accessors, prototypes, non-finite values, oversized structures, credential/private-content fields, direct recipient fields and direct network locations. Required provider connection, template, operation and record references must be present and cannot contain email addresses, phone-like values or URLs.
- Retry attempts are capped at 10, timeouts at 1 second to 10 minutes. A logical node action now reuses the same idempotency key for every attempt. An action with no declared idempotency-safe retry contract stops at `retry_blocked` instead of silently creating a duplicate side effect.
- High-risk approval evidence must match the tenant, graph checksum, execution, node and idempotency key; carry an approver, issue/expiry time and approval ID; expire within 15 minutes; and pass a trusted verifier supplied by the persistence/security boundary. When a human requester is known, self-approval is rejected. Missing, stale, accessor-backed, cross-execution or verifier-rejected evidence remains `needs_approval`.
- Customer-agent tool arguments and connector results are now copied without invoking getters. Symbols, accessor properties, prototype keys and overlong keys fail closed before data reaches an adapter or model context.
- V111 adds no new SQL tables. The definitions remain pure contracts until an authenticated API, trusted event ingress, durable repository, worker and provider adapter are connected.

## HighLevel workflow triggers

HighLevel's current trigger guide organizes workflow starts across contacts, events, appointments, opportunities, affiliates, courses, payments, ecommerce, IVR, social, communities, certificates, communications and ads. Atlas maps that inventory into canonical events. These names do **not** mean the corresponding source connector is live.

| Atlas event family | Canonical event types |
| --- | --- |
| CRM and tasks | `contact.created`, `contact.updated`, `contact.tag_added`, `contact.tag_removed`, `contact.dnd_changed`, `contact.note_added`, `contact.note_changed`, `contact.engagement_threshold`, `contact.birthday_due`, `contact.custom_date_due`, `contact.phone_validation_completed`, `lead.score_changed`, `prospect.generated`, `task.created`, `task.completed`, `task.reminder_due` |
| Forms and events | `form.submitted`, `survey.submitted`, `quiz.submitted`, `trigger_link.clicked`, `funnel.page_viewed`, `video.threshold_reached`, `tracking.external_event`, `lead_form.facebook_submitted`, `lead_form.instagram_submitted`, `lead_form.tiktok_submitted`, `lead_form.linkedin_submitted`, `lead_form.google_submitted` |
| Appointments | `appointment.booked`, `appointment.confirmed`, `appointment.rescheduled`, `appointment.canceled`, `appointment.no_show`, `appointment.completed`, `appointment.reminder_due`, `appointment.service_booked`, `rental.booked` |
| Sales pipeline | `opportunity.created`, `opportunity.updated`, `opportunity.stage_changed`, `opportunity.status_changed`, `opportunity.stale` |
| Affiliates | `affiliate.created`, `affiliate.sale`, `affiliate.campaign_enrolled`, `affiliate.lead_created` |
| Courses and community | `course.signup`, `course.category_started`, `course.category_completed`, `course.lesson_started`, `course.lesson_completed`, `course.product_started`, `course.product_completed`, `course.access_granted`, `course.access_removed`, `course.user_login`, `community.group_access_granted`, `community.group_access_revoked`, `community.private_channel_granted`, `community.private_channel_revoked`, `community.level_changed`, `certificate.issued` |
| Payments and documents | `invoice.created`, `invoice.sent`, `invoice.due`, `invoice.overdue`, `invoice.paid`, `payment.received`, `payment.failed`, `payment.refunded`, `order.form_submitted`, `order.submitted`, `document.sent`, `document.signed`, `document.declined`, `estimate.sent`, `estimate.accepted`, `estimate.declined`, `subscription.created`, `subscription.updated`, `subscription.paused`, `subscription.resumed`, `subscription.canceled`, `coupon.applied`, `coupon.redeemed`, `coupon.limit_reached`, `coupon.expired` |
| Ecommerce | `store.order_placed`, `store.order_fulfilled`, `store.checkout_abandoned`, `store.product_review_submitted`, `store.shopify_abandoned_cart`, `store.shopify_order_placed`, `store.shopify_order_fulfilled` |
| Voice and IVR | `ivr.started`, `ivr.input_received`, `call.started`, `call.answered`, `call.missed`, `call.ended`, `call.details_matched`, `call.transcript_generated` |
| Social and reputation | `social.facebook_comment`, `social.instagram_comment`, `social.tiktok_comment`, `social.click_to_whatsapp_started`, `review.received` |
| Conversations and email | `message.received`, `message.delivery_failed`, `message.sms_error`, `message.customer_replied`, `conversation.ai_triggered`, `conversation.handed_off`, `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.spam_complaint`, `email.spam`, `email.unsubscribed` |
| Atlas agent and orchestration | `agent.started`, `agent.tool_approval_requested`, `agent.needs_human`, `agent.resolved`, `agent.failed`, `agent.evaluation.completed`, `workflow.completed`, `workflow.failed`, `workflow.called`, `schedule.fired`, `webhook.received`, `custom.event`, `consent.granted`, `consent.revoked` |

Provider adapters must normalize vendor payloads into these event names, attach an authenticated tenant and stable provider-event identity, verify signatures before `webhook.received`, and deduplicate before creating workflow enrollments. `custom.event` is an internal event class; it must not be exposed as an unauthenticated public trigger. Shopify-specific legacy triggers are listed because HighLevel's guide still lists them; connector implementation must follow the vendor's current deprecation status.

## HighLevel workflow actions and Atlas graph nodes

The action registry groups equivalent capabilities without adopting HighLevel's labels or interface.

| Capability group | Atlas node types |
| --- | --- |
| Workflow structure and timing | `trigger`, `condition`, `switch`, `goal`, `random_split`, `delay`, `wait_until`, `await_event`, `rate_limit_batch`, `split_batches`, `sub_workflow`, `remove_from_workflow`, `stop`, `approval` |
| Data shaping | `transform`, `map_array`, `filter_array`, `merge`, `text_format`, `math`, `set_custom_value` |
| Contact and CRM | `find_contact`, `create_contact`, `copy_contact`, `delete_contact`, `set_field`, `tag`, `assign_contact`, `remove_contact_assignment`, `manage_contact_followers`, `update_engagement_score`, `set_contact_dnd`, `add_note`, `create_task`, `associate`, `manual_action` |
| Conversations and channels | `edit_conversation`, `send_message`, `reply_in_conversation`, `reply_social_comment`, `notify_internal`, `send_review_request`, `call_contact`, `send_document_contract` |
| Opportunities | `create_opportunity`, `update_opportunity`, `remove_opportunity` |
| Appointments and IVR | `find_availability`, `book_appointment`, `generate_booking_link`, `reschedule_appointment`, `cancel_appointment`, `update_appointment_status`, `ivr_gather_input`, `ivr_play_message`, `ivr_transfer_call`, `ivr_connect_call`, `ivr_end_call`, `record_voicemail` |
| Integrations and data delivery | `webhook`, `http_request`, `spreadsheet_upsert` |
| AI and knowledge | `invoke_agent`, `ai_generate`, `ai_classify`, `ai_summarize`, `ai_intent_detect`, `knowledge_search` |
| Payments | `create_payment_link`, `charge_payment`, `send_invoice`, `issue_refund` |
| Marketing and ads | `publish_social_post`, `add_to_audience`, `remove_from_audience`, `record_conversion`, `send_analytics_event`, `add_google_ads_audience`, `remove_google_ads_audience`, `facebook_conversion_event` |
| Affiliate, courses and community | `affiliate_action`, `update_affiliate`, `manage_affiliate_campaign`, `grant_course_access`, `revoke_course_access`, `set_community_access` |

`Custom Code` is intentionally not an executable node. Atlas needs an isolated task-runner sandbox and package/network policy before tenant-authored code can execute safely. `http_request` requires a named connector operation; arbitrary URLs are rejected to constrain SSRF. Payment nodes never accept card data and require provider tokenization, spend policy, approval and reconciliation.

## HighLevel product capability comparison

HighLevel's documented product includes CRM and custom data, sales pipelines, conversations and messaging, email/SMS/WhatsApp/phone, AI Conversation/Voice/Agent features, appointment calendars and services, workflow automation, forms/surveys/quizzes, websites/funnels/domains/SEO, social publishing, reputation/reviews, ad audiences and attribution, invoicing/payments/subscriptions/ecommerce, affiliates, courses/communities/certificates, agency subaccounts, SaaS/white-label, snapshots/templates, marketplace, APIs/webhooks and reporting.

| Area | Atlas source coverage now | Operational status |
| --- | --- | --- |
| Contacts, custom objects, associations, pipelines | V102 CRM contracts and V111 workflow action definitions | No authenticated tenant API or durable CRM repository |
| Workflows and trigger/action catalog | V92 customer automations, V102 graph, V111 134-trigger/86-node catalog | Graph definitions compile and test; no durable worker or interactive editor |
| AI customer agents and approvals | V91/V93 agent releases, V102 runtime envelope, workflow tool types | Provider/model, session UI, streaming and tool connections are not live |
| Messages, calls and voice QA | V98 templates, V99/V100 call lifecycle and review, V106 communication policy | No email/SMS/WhatsApp/social/phone provider delivery |
| Calendars and appointments | V102 timezone-aware availability/holds/versioned lifecycle | Calendar sync and transactional database booking are not connected |
| Sites, funnels, forms, quizzes and SEO | V97 site SEO build; V105 publish contracts | No tenant website editor, domain/DNS control plane or form submission API |
| Payments, invoices and subscriptions | V103/V107 financial controls, usage and reconciliation contracts; V111 action definitions | No checkout, processor, metering worker or merchant account is connected |
| Ads, review management, affiliate, courses and communities | V109 capability inventory; V111 event/action contracts | No provider connections or user-facing management surfaces |
| Snapshots, marketplace, SaaS/white-label, agency | V108/V109 project and package contracts | No marketplace, tenant provisioning, reseller billing or white-label launch |
| Reporting and analytics | V85/V88/V90/V100/V110 summary, SLO and trust contracts | No live event pipeline, customer analytics screen or scheduled reports |
| Global administration | Single configured Khan platform-owner boundary in V91+ | Platform-owner global control plane UI/API is not deployed |

`Catalogued` does not mean a vendor connector or product UI exists. HighLevel documents triggers by category and actions by category; Atlas now has event/action contracts across them, but its launch-critical API, storage, worker and live integrations remain incomplete.

## n8n workflow, agent and infrastructure comparison

| n8n capability family | Atlas status in current source |
| --- | --- |
| Workflow graph, branches, waits, sub-workflows, schedules, triggers and webhooks | Deterministic graph and customer-automation contracts exist; no canvas editor, durable timer or public webhook ingress |
| Data mapping, arrays, batching, integrations, custom/API calls | V111 has safe declarative data node types and named connector-operation references; no broad connector catalog or sandboxed custom-code runtime |
| Credentials, external secrets and least-privilege sharing | Node configs accept opaque connection refs and reject secret fields; there is no credential vault, OAuth flow, encrypted secret manager or connection-sharing UI |
| Draft/publish/version/revert and environment promotion | Checksummed immutable releases exist in workflow/agent packages; no Git-backed workspace/environment promotion UI or graph diff/revert browser |
| Execution history, step inputs/outputs, debugging, retry and replay | Retry budget, stable idempotency, trusted exact-scope approvals and redacted summary contracts exist; no persisted execution timeline, full execution inspector or user replay UI |
| AI Agent model, tools, skills, knowledge, session/episodic memory, sub-agents, web search, channels and schedules | Atlas has bounded agent turns, skills, controlled tools, consent-gated memory, knowledge contracts and human approval; streaming, interactive session history, recursive delegation, connected channels and scheduled agent service are missing |
| Streaming replies and JSON-schema outputs | A bounded structured-output validator exists; no streaming transport or live workflow output mapping surface |
| Error handling, observability, evaluation and guardrails | Queue/retry/trace/SLO/evaluation contracts exist; no production queue consumer, worker fleet, live OTel export, batch evaluation UI or alerting integration |
| Queue mode, webhook processors, horizontal workers and object storage | V87/V90/V104/V110 define jobs, leases, webhooks, sync, storage and recovery targets; Redis/Postgres/object storage/ingress/workers are not connected or load-tested |
| n8n's integrations and community nodes | Not parity-covered by 86 Atlas workflow node types. The connector universe is dynamic and must be tracked provider-by-provider; generic HTTP does not count as integration parity. |

Current n8n agent documentation describes draft/published versions, tools, MCP, web search, skills, knowledge, memory, sub-agents, channels, schedules, sessions, approvals, streaming and JSON-schema replies. It also currently says Agents are Preview and queue mode is not supported for agents. Atlas uses the useful patterns with tenant/release/approval boundaries, but does not claim runtime parity.

## Priority gaps required for a real US launch

1. Implement the missing authenticated tenant API and browser signup/login/session flows. Only the configured verified Khan account can reach platform-global routes; customer admins stay tenant-scoped.
2. Connect managed Postgres transaction/repository adapters and execute all migrations with forced RLS tests against the supported database version.
3. Build the laptop-first workflow and agent studio with reviewable draft edits, sample-event simulation, templates, node schemas, approval UX, version diff and safe publish/revert.
4. Ship durable workflow/agent execution workers, schedule timers, execution timeline, retry/replay with pinned definitions, cancellation, per-tenant fairness, Redis queue, object storage and OTel/alerting.
5. Implement provider integrations in release slices: start with email/SMS, calendar/CRM import, payment checkout and customer chat; add social/reputation, affiliate/education and ads only after OAuth, tenant grants, signed callbacks, rate limits and reconciliation tests exist.
6. Connect billing/subscription entitlement and self-service plans; complete domain verification, TLS/CDN/WAF, backups/restore, disaster-recovery, accessibility, security review and measured load/failover tests.

Until those work is implemented and verified, Atlas is a tested source foundation and preview—not a live GHL/n8n replacement or a launch-ready SaaS.

## Sources

- [HighLevel complete workflow triggers](https://help.gohighlevel.com/support/solutions/articles/155000002292), modified 19 June 2026.
- [HighLevel complete workflow actions](https://help.gohighlevel.com/support/solutions/articles/155000002294-what-are-workflow-actions-complete-list-), modified 3 June 2026.
- [HighLevel AI Agent workflow action](https://help.gohighlevel.com/support/solutions/articles/155000007600-workflow-action-ai-agent), modified 1 October 2026.
- [HighLevel AI Workflow Builder](https://help.gohighlevel.com/support/solutions/articles/155000006100-workflow-ai-builder), modified 28 August 2026.
- [HighLevel Agent Studio overview](https://help.gohighlevel.com/support/solutions/articles/155000007393), modified 8 July 2026.
- [n8n agent lifecycle and capabilities](https://docs.n8n.io/build/build-and-manage-agents/).
- [n8n all-execution inspection and retry/replay](https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions/).
- [n8n queue mode](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode), [external binary storage](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/use-external-storage), and [OpenTelemetry traces](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/trace-executions-with-opentelemetry).
- [n8n security audits](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/run-security-audits), [workflow source control](https://docs.n8n.io/source-control-environments/create-environments/), and [official documentation index](https://docs.n8n.io/sitemap.md).

Vendor sources were checked 3 October 2026. Product availability and documentation change; the repository must periodically refresh this inventory. No vendor UI, brand assets or proprietary implementation is copied.
