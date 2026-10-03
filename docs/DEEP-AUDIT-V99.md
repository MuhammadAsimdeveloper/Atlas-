# V99 Deep Audit — Voice Agent and Helpline Lifecycle

## Finding addressed

The existing agent deployment router declared a `voice` channel, and workflow recipes included missed-call and post-call follow-up ideas, but there was no call-session lifecycle. Provider call handling, AI disclosure, specialist transfers, human queue join, outbound call policy and recording state were not represented as a coherent, auditable flow.

V99 adds an immutable, checksummed call-session contract, tenant-pinned agent-release references, explicit transitions, provider-evidence scope checks, outbound consent/terms/capacity/window gates, bounded AI transfers, human handoff, recording consent and append-only event schema. The command center includes a local flow preview for booking, after-hours and billing.

## Security and reliability decisions

- Inbound creation requires a fresh provider verification attestation scoped to tenant, connection, event and call reference. The attestation is only trustworthy when the external adapter performs actual provider signature validation.
- Outbound AI calls require explicit per-contact voice consent independently of provider account terms; they also require a fresh DNC check, frequency decision, provider-capacity reservation and tenant-configured contact-local call window.
- Provider capacity reservations, provider event IDs and session idempotency keys must be persisted atomically by the production worker/database. The pure library does not claim exactly-once provider calls.
- Calls pin a checksum-valid published agent release that has a voice route in the same tenant. Agent transfer validates the destination release and rejects repeat releases or chains beyond three transfers.
- Agents cannot start speaking before the disclosure event. Recording defaults to disabled; consent-required mode needs provider-attested caller evidence and a stop event before normal completion.
- Sessions and events retain only opaque references, status, safe reason codes, checksums and timestamps. They do not accept transcript/audio fields or arbitrary provider payloads.
- Tenant session/event tables force RLS; the event table revokes update/delete/truncate from PUBLIC and has an immutability trigger. No migration was applied in this environment.

## Residual risks and limits

- `verified: true` is not a signature check. The exact provider URL, query/form/body parameters, signature key rotation and tenant-to-connection binding must be validated by a dedicated API adapter before creating the attestation.
- Consent laws, recording rules, AI disclosure requirements, calling windows, rate quotas and provider terms differ by location and provider. This contract enforces a deliberately strict baseline but is not a legal-compliance determination.
- Capacity reservation must be distributed and transactional. If the reservation expires before the local call window, the call is rejected and requires a fresh reservation.
- Transfer requests and call actions still require the existing model/tool authorization, tenant capability check, approval policy, provider adapter and idempotent worker before execution.
- No phone number, speech/LLM runtime, provider, calendar booking, human queue, recording store or actual inbound/outbound call is connected or end-to-end tested. There is no load/failover result.
- Other voice quality gaps include durable transcripts/recordings governed by consent and retention, redacted transcript evaluation, coaching workflow, per-number routing UI and production call metrics. They are queued for V100 only where evidence can be safely minimized.

## Competitive review

Checked first-party HighLevel voice guides and Twilio webhook security on 3 October 2026. HighLevel documents inbound/outbound calling, appointment booking, workflow actions, handoff to a person or another agent, and provider-specific outbound scheduling guidance. Atlas implements the core lifecycle and policy contracts without claiming provider parity or copying product UI. References and design constraints are in [V99 Voice Operations](V99-VOICE-OPERATIONS.md).

## Verification

V99 tests cover tenant/release pinning, provider-attestation freshness, outbound consent and quota evidence, contact-local overnight/DST windows, policy recheck, disclosure-before-agent, transfer-loop caps, human handoff, recording consent and completion, event replay, tamper detection and no-content event fields. Run the exact results in the top-level `RELEASE-MANIFEST.txt` after the release gate.
