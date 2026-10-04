# Atlas API

V116 runs the authenticated same-origin workspace and account API plus the PostgreSQL execution foundation and tenant-authorized workflow capability catalog. Set `ATLAS_DATABASE_URL` to restricted `atlas_app`, not the migration owner. If the database/schema are unavailable, readiness and authenticated routes fail closed.

## First database setup

1. Create a migration role that may apply schema and separate `atlas_app` and `atlas_worker` roles with no `BYPASSRLS`, elevated privileges, role memberships or Atlas relation ownership.
2. Set `ATLAS_MIGRATION_DATABASE_URL` and run `npm run db:migrate`.
3. Create the restricted `atlas_app` role and apply `infra/postgres/API-ROLE-GRANTS-V112.sql`, `API-ROLE-GRANTS-V114.sql` and `API-ROLE-GRANTS-V115.sql` as the database owner. V115 grants create a restricted `atlas_worker` login role if needed.
4. Set `ATLAS_DATABASE_URL` to the `atlas_app` connection. Keep passwords/certificates in the deployment secret manager.
5. Configure Khan's verified owner email, a 32-byte session secret, the 32-byte action approval key, a real HTTPS public origin, and Postmark sender credentials before production startup. Production Postgres connections always verify TLS certificates; set `ATLAS_DATABASE_SSL_CA_FILE` to the provider's PEM root certificate path mounted from deployment configuration. URL `sslmode` options cannot disable verification. Set `ATLAS_TRUST_PROXY=true` only behind an HTTPS edge configured to overwrite `X-Real-IP`; production requests without one valid IP fail closed so all visitors do not share a single throttling bucket.

The migration runner applies the versioned SQL files in numeric order, serializes migration operations with a PostgreSQL advisory lock and stores each file's SHA-256. It refuses to modify a migration already recorded as applied. API deployment does not run migrations automatically.

Production startup verifies that `ATLAS_DATABASE_URL` is connected as `atlas_app`, with no superuser, `BYPASSRLS`, database/role creation privileges, role memberships or ownership of Atlas relations. An unsafe database identity stops API startup.

The production Compose template requires `ATLAS_POSTGRES_SUPERUSER_PASSWORD` from the deployment environment and binds port 8080 to loopback for a local HTTPS proxy. Do not put the bootstrap database password or worker credentials in the API container. The optional `workers` profile requires a distinct `ATLAS_WORKER_DATABASE_URL` and a reviewed handler file mounted from `ATLAS_WORKER_HANDLERS_PATH`; it receives an explicit minimal environment and does not inherit the API `.env` file. Atlas ships no business handler by default. Example: `docker compose --env-file .env -f infra/docker-compose.production.yml up -d` after completing the migration/runtime-role setup above.

## Request authority

The API derives identity from the server-side opaque session cookie, then loads active organization memberships from PostgreSQL. Tenant routes re-check the actor's active membership and role before using a tenant transaction. Tenant selection is changed only after the session actor is confirmed as a member. Request-body tenant IDs, roles, owner flags and provider secrets are never used as authority.

Only a verified session whose normalized email matches `ATLAS_PLATFORM_OWNER_EMAIL` receives platform-owner authority through the trusted resolver. The database has tenant roles only; company owner/admin roles can never promote themselves to global access.

Every tenant query uses server-controlled transaction-local `app.actor_id` and `app.tenant_id` contexts. Runtime privileges must not include `BYPASSRLS`, superuser or table ownership. See [`API-ROLE-GRANTS-V112.sql`](../../infra/postgres/API-ROLE-GRANTS-V112.sql) and the [V112 setup/security guide](../../docs/V112-IDENTITY-TENANT-FOUNDATION.md).

## Session and email controls

- Seven-day random opaque session cookies; only a SHA-256 digest is persisted.
- `HttpOnly`, `SameSite=Strict`; `Secure` and `__Host-` cookie names in production.
- Same-origin request check plus double-submit CSRF cookie/header bound to a session digest.
- Passwords use scrypt with fixed reviewed parameters; email verification/reset/invitation values are random, one-time, expiring tokens stored by digest.
- PostgreSQL-backed IP and account rate-limit keys are hashed and shared across API replicas.
- Postmark handles production transactional email. Console links are development-only and are not used in production.

## Operational checks

`GET /health/live` checks process health. `GET /health/ready` checks PostgreSQL connectivity and the V115 schema (identity, Growth Center/billing and queue/outbox/schedule tables) and can require `X-Atlas-Health-Token`. Readiness does not prove managed database failover, handler health, mail delivery, worker capacity or user-scale performance. Configure API pool bounds to match managed database connection limits and route clients through a trusted HTTPS edge.
