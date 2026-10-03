# V98 Deep Audit — Outbound Message Rendering

## Finding addressed

The workflow system could publish a message intent pinned to an immutable tenant template, but it had no renderer. A worker would otherwise need to implement variable parsing and HTML escaping independently, creating a likely injection bug across email/SMS/WhatsApp paths.

V98 adds a pure tenant-bound renderer and documents that it prepares content only. It will not send or schedule a message. The trusted worker remains responsible for loading template and merge values from the correct tenant, enforcing consent/suppression/frequency/quiet-hour rules at send time, using provider idempotency, and recording verified delivery receipts.

## Security checks

- Verifies the pinned published template checksum, channel/purpose shape and exact trusted tenant ID.
- Restricts placeholders to bounded business-data namespaces; denies prototype paths and credential/payment-related properties.
- Reads own data properties without invoking getters and accepts only primitive string/number/boolean values.
- Missing data returns a review outcome with field names and does not return partial message content.
- Escapes interpolated email HTML text. HTML supports only basic formatting and fixed HTTPS anchors; interpolations in tags/attributes and unsupported markup are rejected.
- Rejects email subject control characters that could forge additional headers.
- Does not accept tenant IDs from the rendered variables and has no provider/delivery side effects.

## Residual risks and limits

- There is no authenticated API or persistent worker in this source. The renderer is safe only when callers obtain template/data and tenant scope from trusted storage/session logic.
- Consent, suppression, opt-out processing, quiet hours, provider throttling, idempotency persistence, retries and delivery receipts are contracts elsewhere; live delivery is not connected.
- Static template copy remains tenant-authored. The HTML allowlist blocks active elements and arbitrary attributes, but brands must still review links and content for trust, policy and deliverability.
- Database migrations and live providers were not available. No end-to-end email/SMS sandbox delivery was performed.
- `npm audit` cannot run in this desktop runtime because npm is not installed; the source declares zero runtime dependencies. CI remains configured to run npm audit on Node 20 and 22.

## Authority

The single verified Khan account retains platform-wide Atlas authority. Template creation/publishing requires tenant owner/admin authority unless the caller is already a legitimate platform owner. Rendering does not grant roles or cross-tenant access; exact tenant matching is mandatory for all callers.
