# V98 — Safe Message Template Rendering

V98 adds the missing render step between an approved workflow intent and an external email/message provider. The renderer is a pure function: it verifies the immutable template checksum, requires the same trusted tenant scope, resolves only caller-supplied tenant data, and returns a deterministic draft. It does not send, schedule or persist a message.

## Example

```js
const draft = renderMessageTemplateVersion({
  template: pinnedTemplateRelease,
  tenantId: authenticatedWorkflowTenantId,
  variables: {
    contact: { first_name: 'Amina' },
    appointment: { start_time: 'Tuesday at 9:00 AM' }
  }
});

if (draft.status === 'needs_data') {
  // Route to needs_review; do not enqueue provider delivery.
}
```

The API/worker must load `pinnedTemplateRelease` and each variable from trusted tenant-scoped storage. Do not use inbound webhook, model, URL or request-body fields as trusted merge data without schema validation and provenance checks. Platform-owner authority does not bypass a tenant mismatch.

## Rendering rules

- Approved roots: `contact`, `appointment`, `company`, `agent`, `workflow`, `service`, `billing` and `links`; nested paths are bounded. Prototype paths and credential/sensitive-payment fields are rejected.
- The resolver reads own data properties only. It does not invoke getters or coerce objects. Values must resolve to bounded primitive strings, finite numbers or booleans.
- If a referenced value is missing or null, the result is `needs_data`; the output contains no partial subject/body.
- Email subject variables reject CR/LF and header control characters.
- Email bodies default to plain text. The optional `html` format allows only a small set of text-formatting tags plus fixed HTTPS anchors. Dynamic values can appear only in text nodes and are HTML-escaped.
- SMS, WhatsApp, social, webchat and voice templates remain plain text. Provider-specific length, consent, quiet-hour, suppression and rate rules must still be checked by the delivery worker.

## Worker flow

```text
tenant workflow step + pinned template release
  -> load variables from tenant-scoped records
  -> renderMessageTemplateVersion()
  -> needs_data => review queue; rendered => draft
  -> recheck consent / suppression / frequency / send window
  -> idempotent provider adapter
  -> trusted delivery receipt and audit event
```

The final three steps are not connected in this source release. Do not interpret a `rendered` result as consent, approval, provider acceptance or message delivery.

## Verification

`packages/customer-operations/template-renderer.test.mjs` covers normal personalization, HTML escaping/allowlisting, malicious tags and URLs, dynamic attributes, unbalanced markup, missing data, cross-tenant templates, checksum tampering, header injection, accessor-only values and plain text output.

`node scripts/smoke-http.mjs` also verifies that the laptop-first command center exposes the message-studio preview and explicitly labels it as a sample, not a connected sender.
