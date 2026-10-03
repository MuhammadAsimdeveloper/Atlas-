# V102 — Hardened CRM, Workflow Nodes, Booking Calendars and AI Agents

V102 strengthens the four product surfaces the Atlas roadmap had identified as the next structural target: CRM, no-code workflow execution, customer-facing booking calendars, and AI-agent runtime controls.

## CRM target

Atlas now has a provider-neutral target model for contacts, companies, leads, deals, tickets, tasks, notes, appointments and custom records. Custom properties support bounded typed values and required-field rules. Record mutations are tenant-bound, checksum-protected and optimistic-versioned. Associations and pipeline transitions are explicit rather than hidden inside UI behavior.

Pipeline governance supports controlled backward movement and stage skipping, with an approval gate available for backward transitions. Search is deterministic and cursor-based so the target contract can sit behind a real indexed store later.

## Workflow-node target

The node catalog now covers the practical overlap between HighLevel-style customer automation and n8n-style execution:

trigger, condition, switch, delay, wait_until, transform, set_field, tag, associate, create_task, send_message, find_availability, book_appointment, reschedule_appointment, cancel_appointment, invoke_agent, sub_workflow, approval, webhook, and stop.

Each node carries an explicit risk class, execution guard, retry envelope and timeout. Graphs are bounded, single-trigger, reachable and cycle-free. Destructive nodes do not run without exact approval evidence. Execution inspection exposes statuses, durations, retries and approval stops without copying customer message bodies into the execution contract.

## Booking-calendar target

This is deliberately separate from V96 support SLA calendars.

Booking calendars support tenant time zones, weekly working windows, holidays, date overrides, minimum notice, booking horizon, slot duration/interval, buffers, capacity and host selection. The contract provides availability search, short holds, idempotent booking, optimistic rescheduling and cancellation.

A production adapter must protect concurrent booking with a transactional lock, serializable/exclusion-safe constraint or equivalent. The pure contract cannot by itself prevent two separate database workers from racing on the same slot.

## AI-agent runtime target

The existing V91+ customer-agent release/router safeguards remain the outer authority boundary. V102 adds a reusable execution envelope around an already-authorized release: tenant/agent/release pinning, turn/tool/execution budgets, lease-bound sessions, exact tool approvals bound to the argument hash, bounded JSON arguments and structured-output validation.

Read tools can run inside the declared allowlist. Write/financial/destructive tools default to approval. Approval expires quickly and is bound to the exact tenant, actor, agent, release, tool, arguments and idempotency key.

## Competitive positioning

HighLevel's current Workflow AI Builder generates end-to-end workflows from natural-language intent; its AI Agent workflow action executes multi-step tasks through configured tools; and its booking experience can check availability and branch on booked/not-booked/timeout outcomes. V102 maps those useful product primitives into deterministic Atlas contracts instead of making UI state the source of truth.

n8n's architecture emphasizes trigger/action nodes, branching, waits, sub-workflows and inspectable executions. Atlas V102 turns those execution primitives into a bounded, checksummed graph with explicit risk and approval metadata.

HubSpot's 2026 CRM platform surface emphasizes broad CRM objects, custom objects, associations, pipelines, custom events and API-side validation. V102 therefore treats typed CRM properties, association identity, pipeline governance and server-side validation as domain invariants rather than client-only behavior.

Reference sources:
- HighLevel Workflow AI Builder: https://help.gohighlevel.com/support/solutions/articles/155000006100
- HighLevel AI Agent workflow action: https://help.gohighlevel.com/support/solutions/articles/155000007600
- HighLevel booking conversation AI: https://help.gohighlevel.com/support/solutions/articles/155000003467
- HubSpot Fall 2026 Developer Spotlight: https://developers.hubspot.com/changelog/fall-2026-spotlight
- HubSpot CRM write validation: https://developers.hubspot.com/changelog/crm-api-write-validation-enforcement
- Atlas n8n architecture review: docs/N8N-ARCHITECTURE-REVIEW-2026-10.md

## Verification

Focused V102 target tests were executed in the build workspace on Node 22: 4/4 passed. The new JavaScript module also passes Node syntax checking.

The V102 SQL migration is a persistence target and was not executed against a live PostgreSQL environment. Provider adapters, authenticated tenant API routes, real Google/Outlook calendar sync, transactional booking locks, production queue workers, live messaging delivery and production agent model execution still require deployment work and verification.

V102 is intended to be composed with the existing V91–V100 tenant authority, automation, service desk, SLA, voice, memory, observability and durable-action foundations rather than replacing them.
