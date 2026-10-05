# Atlas V145 — Lead-to-Booking Integration

## What changed

V145 adds a cross-product orchestration contract that connects the existing hardened domain primitives into one deterministic business journey:

**Funnel/website lead form → Contact → Lead → Qualification → Follow-up plan → Calendar availability/hold/booking → Pipeline update → Redacted reporting**

The new service lives in `packages/atlas-journey/index.mjs`.

## Security boundary

V145 does not perform external side effects.

Message delivery, provider calls and voice execution remain behind their existing provider and policy gates. The journey emits stable idempotency references and a provider-required voice intent instead of fabricating successful delivery.

The service verifies:

- tenant identity and bounded references;
- source asset integrity and the presence of an Atlas lead-form block;
- pipeline integrity and valid stage membership;
- qualification profile integrity;
- follow-up integrity and provider/template references;
- booking-calendar integrity and availability;
- replay-stable contact, lead and action identifiers.

## Cross-module outcome

On a sales-ready qualification with an available slot:

1. the form creates a contact;
2. the contact receives a lead in the configured pipeline;
3. qualification is evaluated against explicit operator evidence;
4. follow-up steps are planned with stable idempotency keys;
5. calendar availability is checked;
6. a short booking hold is created;
7. the appointment is booked;
8. the lead advances to the booked stage with optimistic concurrency;
9. redacted journey events and a conversion report are produced;
10. a voice follow-up intent is emitted for the future provider runtime.

When qualification is incomplete, or the calendar has no slot, the journey stops without external side effects and records a redacted outcome.

## Testing

`packages/atlas-journey/index.test.mjs` covers:

- the full happy path;
- deterministic replay identities;
- cross-tenant source rejection;
- qualification evidence failure/human review;
- missing lead-form rejection;
- calendar conflict handling.

`npm run mirofish:check` now also exercises ten deterministic stakeholder scenarios:

- healthy lead-to-booking;
- duplicate form replay;
- qualification evidence failure;
- provider degradation;
- calendar conflict;
- voice consent/provider boundary;
- cross-tenant injection;
- replay identity;
- insecure public SEO attempt;
- destructive agent action without approval.

The MiroFish check is a deterministic engineering simulation/regression suite. It is not a substitute for an external hosted MiroFish forecast or real user research.

## Not yet claimed Live

V145 does not make real external providers live. Production activation still requires the deployment evidence gates already encoded in Atlas:

- real model/provider credentials and inference;
- telephony, email, SMS, WhatsApp and calendar connections;
- verified webhook callbacks and delivery receipts;
- KMS/external secret store;
- managed PostgreSQL/Redis/object storage/WAF/CDN;
- public HTTPS/domain verification;
- real backup/restore/failover measurements;
- OTLP collector and alerting evidence.

## Next

V146 should build the persistent Agent Studio/session runtime on top of this journey and make `invoke_agent`, knowledge retrieval, approvals and model execution observable. V147 then connects the voice lifecycle into the same journey and calendar/inbox graph.
