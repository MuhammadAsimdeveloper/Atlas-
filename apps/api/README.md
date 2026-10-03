# Atlas API boundary

This process owns HTTP hardening, health endpoints and the production configuration gate. Tenant endpoints must sit behind authenticated session resolution and a PostgreSQL transaction adapter.

Required production secrets:
- ATLAS_DATABASE_URL
- ATLAS_SESSION_SECRET
- ATLAS_ACTION_APPROVAL_KEY (32+ bytes)
- ATLAS_PLATFORM_OWNER_EMAIL
- ATLAS_PUBLIC_ORIGIN (HTTPS)

Never accept tenant IDs, memberships, roles, platform-owner flags or provider credentials from request bodies. Resolve them from the authenticated session and trusted database state, then set SET LOCAL app.tenant_id inside every tenant transaction.

The readiness endpoint reports configuration readiness only until the database adapter is connected.