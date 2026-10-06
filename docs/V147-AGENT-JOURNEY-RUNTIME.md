# Atlas V147 — Agent Journey Runtime

## Outcome

V147 makes the AI-agent layer a connected part of Atlas rather than a standalone agent catalog.

**Agent release → authenticated session → reference-only journey context → bounded turn plan → approved workflow invocation → human handoff → redacted outcome evidence**

## Connected domains

A journey context may carry only opaque references to CRM contact/lead/opportunity, appointment, conversation/inbox thread, voice session and workflow execution.

Raw prompts, customer messages, transcripts, recordings, credentials and secret material are rejected from the planning contract.

## Agent release controls

Agent releases are tenant-bound, versioned and checksum protected. The control-plane stores a prompt hash rather than prompt text and bounds model-provider timeout/input/output budgets.

## Turn controls

Every turn is pinned to a specific release, bounded to the session, identified by deterministic turn/idempotency keys, limited to a finite tool plan, restricted to hashed tool arguments, and connected to approval references and optional workflow invocation references.

## Workflow controls

Read-only workflow invocation can be authorized directly. Network/write/financial/destructive invocations require an explicit approval reference.

## Human handoff

Handoffs use stable reference-only identifiers with bounded reason codes and queue references. Appointment references can be carried forward without copying customer content.

## Durable persistence

V147 adds `atlas_agent_turn_plans` and `atlas_agent_handoffs`. Both use forced tenant RLS and the `atlas_app` grant path.

## API

Authenticated Growth API endpoints:

- `POST /api/v1/growth/agents/turns/plan`
- `POST /api/v1/growth/agents/workflow-invocations/authorize`
- `POST /api/v1/growth/agents/handoffs`

Existing agent session creation remains at `POST /api/v1/growth/agents/sessions`.

The turn and handoff endpoints validate authenticated tenant and persistent session ownership before writing evidence.

## External activation boundary

V147 does not claim live model inference. Real model providers, telephony, messaging and calendar services remain explicit external deployment gates.

## Next

V148 connects the existing voice lifecycle and unified inbox to this agent journey, including appointment outcomes, post-call CRM updates, workflow events and human handoff reconciliation.
