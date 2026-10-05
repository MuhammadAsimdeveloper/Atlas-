# Webhook secret resolver

This module boundary is intentionally deployment-provided. Production deployments must supply `ATLAS_WEBHOOK_SECRET_RESOLVER_MODULE` with a reviewed implementation that resolves webhook verification secrets without exposing raw credentials to the API or worker logs.

The resolver should fail closed on missing, malformed, cross-tenant, or stale secret references.
