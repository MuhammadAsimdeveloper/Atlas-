# Atlas P126 webhook secret boundary

A reviewed deployment module must export resolveSecret({tenantId,endpointId,providerKey,secretRef}).

Twilio: return the account auth token or configured webhook shared key.
Postmark: return the HTTP Basic credential in username:password form; Postmark does not sign webhooks with HMAC.
WhatsApp Cloud: return the Meta app secret for X-Hub-Signature-256 verification.

Never store these secrets in PostgreSQL, webhook payloads or logs.