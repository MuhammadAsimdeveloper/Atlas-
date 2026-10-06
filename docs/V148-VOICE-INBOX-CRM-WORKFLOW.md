# Atlas V148 — AI Voice + Unified Inbox Journey Bridge

## Outcome

V148 connects the existing governed voice lifecycle to the same business graph used by CRM, calendar, unified inbox and workflow automation.

**Voice session → conversation/inbox → contact/lead → appointment → workflow event → reporting**

## Reconciliation contract

`planVoiceAgentJourney` accepts an already-verified voice session and produces only reference-level reconciliation evidence.

It verifies:
- tenant and checksum integrity;
- contact and conversation references match the voice session;
- the session is completed and its outcome matches the reconciliation request;
- `appointment_booked` carries the exact appointment reference recorded by the voice session;
- transferred outcomes carry a human handoff queue reference;
- workflow identifiers and versions are explicit;
- the outcome carries a deterministic idempotency key.

Raw transcripts, recordings, phone numbers, message bodies and other customer content are not copied into the reconciliation object.

## Unified inbox connection

`buildVoiceInboxOutcome` produces a redacted conversation event for the existing inbox graph. Handoff outcomes become `conversation.voice_handoff`; other terminal outcomes become `conversation.voice_outcome`.

## Calendar connection

An `appointment_booked` voice outcome is accepted only when the exact appointment reference matches the completed voice session. V148 does not bypass the existing booking/calendar layer.

## CRM connection

The bridge carries the CRM contact and optional lead references. It does not mutate CRM rows directly; the downstream workflow/runtime can consume the redacted event and perform the already-governed versioned CRM mutation.

## Workflow connection

Each reconciliation event carries `workflowId`, `workflowVersion`, `journeyId` and `eventRef`. This makes the post-call workflow trigger explicit and replay-safe without executing a provider action inside the pure bridge.

## Durable persistence

V148 adds `atlas_voice_journey_outcomes` with forced tenant RLS, unique idempotency and indexes for conversation/contact timelines.

## API

Authenticated Growth API endpoint:

- `POST /api/v1/growth/voice/journey-outcomes/reconcile`

The endpoint is disabled unless `ATLAS_VOICE_JOURNEY_RECONCILIATION_ENABLED=true`. This is intentional: real production reconciliation should be activated only after provider/runtime evidence exists.

## External activation boundary

V148 does not claim a live telephony provider. Real call execution, provider callbacks, recordings, calendar sync, WhatsApp/SMS/email delivery and model inference remain deployment gates.

## Next

V149 should finish the website/funnel conversion fabric and feed attribution, form submission and booking outcomes into the same CRM/workflow graph.