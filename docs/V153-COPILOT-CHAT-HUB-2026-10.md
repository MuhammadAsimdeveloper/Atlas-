# V153 — Authenticated Copilot Chat Hub + Public Webchat

V153 closes the customer-facing Copilot activation gap.

## Delivered

- Authenticated tenant-scoped Copilot Chat Hub at `/copilot.html`.
- Public widget embed at `/copilot-widget.mjs`.
- Signed customer support sessions using the existing V152 HMAC gateway.
- Exact origin allowlisting; no wildcard public origin.
- Durable public session ledger with expiry/revocation fields.
- Public turns enqueue the existing `agent.turn.execute` production worker path.
- Customer messages remain in the existing reviewed inbox content-store boundary.
- Conversation history is served through the signed session.
- Real model delta streaming is persisted as tenant/session-bound stream events and delivered over authenticated fetch/SSE.
- Human handoff endpoint and authenticated operator queue.
- Existing agent tool approval records are surfaced in the Copilot approval inbox.
- Optimistic/idempotent public turn preparation prevents duplicate execution for the same customer turn.
- Staging E2E script covers health, public session, turn enqueue, authenticated stream, history and handoff; optional operator checks run when a staging cookie is supplied.

## Required production configuration

`ATLAS_SUPPORT_SESSION_SECRET` may use the existing `ATLAS_SESSION_SECRET` fallback, but a dedicated 32+ byte secret is recommended. A live agent release manifest must contain:

- tenant-bound `tenantId`
- UUID `agentId`
- immutable `releaseId` and positive `version`
- `active` or `canary` status
- signed `checksum`
- `systemPromptHash`
- model provider/model/credential reference in `modelPolicy`

The model credential itself is never stored in the Copilot config; only its reviewed reference is stored.

## Staging E2E

Set:

```bash
ATLAS_STAGING_ORIGIN=https://staging.example.test \
ATLAS_STAGING_WIDGET_ORIGIN=https://staging.example.test \
ATLAS_STAGING_WIDGET_KEY=<public-widget-key> \
node scripts/copilot-staging-test.mjs
```

For authenticated operator queue checks also set `ATLAS_STAGING_COOKIE` (and configure the tenant/operator session normally).

The test is intentionally real: it does not stub the model provider, worker, Redis wakeup, content store, or PostgreSQL queue.

## Security boundary

The public widget key is an identifier, not a credential. The customer session is the credential. The server validates its HMAC signature, expiry, channel, tenant/release scope and database session ledger before accepting turns. Public SQL access is exposed only through security-definer functions with explicit role grants.

Raw customer/model content is not written into execution evidence. Customer-visible message and stream content goes through the existing inbox content-store contract.


## Final hardening verification

- Public session, turn, history, stream and handoff requests are origin-bound and rate-limited.
- Published agent release manifests are checksum-verified and tenant-bound before widget activation.
- Public origin resolution uses a forced-RLS-safe `SECURITY DEFINER` function.
- Staging E2E also verifies the served Hub/widget assets and, when staging auth material is supplied, authenticated handoff resolution with CSRF.
