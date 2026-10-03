# V99 — Voice Operations and Call Lifecycle

V99 adds a governed call-session domain around Atlas's existing tenant-scoped agent releases. It models helpline calls, outbound voice tasks, disclosure, specialist-agent transfer, human handoff, consent-gated recording, appointment evidence and terminal outcomes. It is a domain contract and preview: no phone number, speech model, calendar, recording store or telephony provider is connected.

## Call path

```text
verified provider or workflow event
  -> resolve tenant and opaque phone-connection reference
  -> pin an evaluated, published voice-agent release
  -> recheck outbound consent, DNC, frequency, provider terms, capacity and local call window
  -> queue or schedule the call with an idempotency key
  -> play the tenant's versioned AI disclosure
  -> connect the agent
  -> book, route to a bounded specialist, or hand off to a human queue
  -> stop any consented recording
  -> record a minimal outcome event and trigger existing post-call workflows
```

The order is deliberate. `agent_connected` is rejected until the disclosure event is recorded. A release transfer must be published, checksummed, tenant-matched and voice-enabled; a call can transfer to at most three distinct releases, and it cannot return to a release already in the call chain. Human queues and provider connections use opaque references instead of phone numbers.

## Outbound call authorization

`authorizeOutboundVoiceCall()` requires separately scoped evidence for:

- an eligible voice policy decision and a current, unexpired decision version;
- explicit per-contact voice consent, including its purpose, revision and expiry;
- a fresh do-not-call/suppression check;
- a current per-contact frequency window;
- accepted provider outbound terms for the exact tenant connection; and
- a short-lived capacity reservation issued by trusted storage.

Provider terms do not count as a contact's consent. The contact timezone and tenant-configured `callWindow` are resolved server-side. The planner understands overnight schedules and DST using actual instants; it can return a future permitted time. At dispatch, the worker must reload all evidence and authorize again. Capacity reservations must be atomic in shared storage to avoid concurrent workers exceeding provider limits.

The tenant call window is a configuration input, not a statement that one schedule satisfies every jurisdiction. Deployments must apply their local consent, quiet-hour, AI disclosure and calling rules. HighLevel's published example uses 8:00 AM–8:00 PM in a contact timezone and also warns that accepting platform terms does not establish individual consent; Atlas therefore keeps those checks separate and does not hard-code that vendor window. See [HighLevel outbound Voice AI guidance](https://help.gohighlevel.com/support/solutions/articles/155000006598-voice-ai-outbound-calling).

## Transfers, actions and agent safety

- Specialist transfers are modeled separately from human handoff. The destination must use a published same-tenant release and the bounded transfer chain rejects loops.
- Human handoff requires a fixed reason code and an opaque tenant queue reference. The human join event must come through an authenticated server adapter.
- Appointment booking stores a provider-generated booking reference. Existing workflow contracts handle post-call tasks and messages; this module does not send a follow-up itself.
- Prompt output is not authority. Any in-call action must go through the existing tenant tool allowlist, approval service and idempotent workflow action APIs.
- Call events accept only known fields and safe references. Transcript text, audio, credentials, phone numbers and arbitrary provider payloads are not included in session or event rows.

## Webhooks, recording and event history

The adapter must validate the provider's exact signed request before it creates `provider_webhook` evidence. Twilio requires signature checking against the exact request URL and parameters; forwarded or re-encoded request data can invalidate verification. Atlas's `verified` attestation is an internal adapter contract, not a signature verifier. Use HTTPS, verify signatures before parsing event effects, pin the tenant by the trusted connection record and deduplicate callbacks with the provider event ID. See [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

Recording starts disabled or consent-required. When consent is required, the call cannot begin recording without provider-attested, session-bound caller consent. Normal completion is blocked until recording has stopped. If recording is enabled in production, use encrypted object storage, a tenant retention policy, access audit and deletion workflow; keep audio and transcripts out of execution events and telemetry.

The V99 SQL migration adds tenant-composite call sessions, provider callback idempotency, optimistic session versions, an append-only event table, forced tenant RLS and minimal reference/checksum columns. Run `SET LOCAL app.tenant_id` only after server-side authentication and membership resolution. The domain functions don't replace webhook cryptography, authentication, transaction boundaries or database concurrency control.

## Desktop preview and external work

The laptop-first command center provides sample booking, after-hours and billing call journeys. The preview explicitly says that no call is placed. Production still needs an authenticated API, signed webhook adapters, tenant/provider credential resolution, a voice provider, speech/model runtime, calendars, human routing, a quota reservation store, encrypted recording storage (if enabled), live evaluation and migration validation against the supported PostgreSQL version.

HighLevel's current docs describe inbound/outbound voice agents, appointment actions, post-call workflows, phone routing, call transfer and agent transfer. Atlas adopts those operational concepts with tenant-pinned releases, explicit evidence, consent checks and loop caps; the Atlas UI and implementation are independent. Sources: [Voice AI setup and actions](https://help.gohighlevel.com/support/solutions/articles/155000004107), [specialist-agent transfer](https://help.gohighlevel.com/support/solutions/articles/155000007796-voice-ai-agent-transfer), and [appointment booking](https://help.gohighlevel.com/support/solutions/articles/155000005293-appointment-booking-for-voice-ai-agents-in-highlevel).
