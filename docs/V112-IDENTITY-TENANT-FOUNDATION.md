# V112 — Identity and Tenant Foundation

V112 turns the former production-contract API into a database-backed Phase 1 service. The public application has a sign-in and account-creation surface; account data and tenant membership live in PostgreSQL. The local JSON preview and the illustrative `/app/` surface are not used as identity or tenant storage.

## Included behavior

- Account creation normalizes email, requires a 12–128 character password and creates one private company workspace. The onboarding record includes a service-business category and an IANA business time zone.
- Email verification, resend, password reset and logout tokens are random, one-use values. Only SHA-256 token digests are persisted; passwords use Node's parameter-pinned scrypt implementation.
- Sign-in creates a seven-day server-side session. The opaque session cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` in production. Mutating session requests require a matching CSRF cookie/header and same-origin request.
- IP and account-based auth attempts are rate-limited with shared PostgreSQL counters so limits do not reset on API replica changes. Stored rate-limit and IP identifiers use HMAC-SHA-256 with the server secret. Production requires `ATLAS_TRUST_PROXY=true` behind an HTTPS edge configured to overwrite `X-Real-IP`; a missing or invalid edge IP fails closed, preventing a shared proxy address from becoming a global throttle bucket.
- Organization selection is rechecked against a server-loaded active membership. Team invitations are single-use, expire in seven days, require a verified account with the invited address, permit only tenant roles or an existing same-tenant custom role, and allow one pending invitation per tenant/email at a time.
- Custom roles accept a fixed list of tenant capabilities. Platform-owner permissions are not part of that catalog. Owners and administrators can manage tenant invites and role definitions; viewer/member capabilities remain scoped to their workspace.
- `/api/v1/dashboard/summary` returns live account metrics only: active members, pending invitations and recorded audit events in the last seven days. CRM, messaging, appointment, automation and revenue metrics are labeled unavailable until their services are connected.
- Authentication audit rows are append-only. Production readiness checks both database connectivity and the V112 identity schema before returning ready.

## Authority boundary

There is no `platform_owner` field, role, invite type, or request option in the customer identity schema. The only global Atlas authority continues to come from the server's configured `ATLAS_PLATFORM_OWNER_EMAIL` matching a verified email in the trusted session. A company `owner`, `admin`, custom role, email payload, or `platformOwner` flag cannot create that authority. The service uses the existing trusted-object authority resolver in `packages/atlas-core/authority.mjs`.

Set the owner mailbox to Khan's actual verified address in deployment secrets. The sample file intentionally leaves it empty. Do not use a customer tenant address for this setting.

## Database and migration setup

Use two PostgreSQL identities: a migration owner with schema-change permission, and a runtime `atlas_app` role with no superuser, `BYPASSRLS`, database/role creation, role memberships or table ownership. The runtime grants script checks these restrictions before granting table access. Apply the versioned SQL with the separate migration connection, then apply the restricted runtime grants:

```text
ATLAS_MIGRATION_DATABASE_URL=<schema owner connection>
npm run db:migrate
```

Create `atlas_app` through the managed PostgreSQL provider's secret/user interface, or as a database owner with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`. Apply [`API-ROLE-GRANTS-V112.sql`](../infra/postgres/API-ROLE-GRANTS-V112.sql) as the database owner. Configure `ATLAS_DATABASE_URL` with the `atlas_app` connection. Do not run the API with the migration owner. The migration runner refuses this shared connection in production unless an explicit migration override is set for a controlled maintenance window.

The migration runner serializes schema changes with a PostgreSQL advisory lock and records SHA-256 checksums. It refuses to silently reapply a changed migration; changes to applied schema must use a forward migration. V112's schema and RLS behavior run in the test suite against ephemeral PostgreSQL-compatible PGlite. This is not a substitute for testing against the selected managed PostgreSQL service, its TLS settings, role privileges and backup/restore process.

Production API and migration connections enforce TLS certificate validation even if a connection URL contains weaker `sslmode` parameters. If a database provider uses a private CA, set `ATLAS_DATABASE_SSL_CA_FILE` to the PEM root certificate path mounted from deployment configuration. Pool size is bounded to 2–30 connections per process; size the managed database limit across all replicas, API instances, migration jobs and administrative connections.

## Email setup

In development, `ATLAS_EMAIL_PROVIDER=console` writes preview links to the local API log and is not available in production. For production configure `ATLAS_EMAIL_PROVIDER=postmark`, a Postmark server token, a verified sender in `ATLAS_EMAIL_FROM`, and a real public application origin. Provider credentials stay in the deployment secret store. Delivery failures are logged without logging links or bearer tokens.

Atlas has no public domain yet. Keep `ATLAS_PUBLIC_ORIGIN` blank in the preview. Production startup intentionally refuses to invent a domain or run with the sample `example.com` origin. Purchase and configure the real domain, DNS, TLS and verified sender before production email and SEO launch.

## API surface

All request bodies are bounded JSON; tenant IDs, roles and platform flags in body content are never trusted for authority.

| Endpoint | Operation |
| --- | --- |
| `POST /api/v1/auth/signup` | Create pending user and private tenant; send verification email |
| `POST /api/v1/auth/verify-email` | Verify one-use email token |
| `POST /api/v1/auth/verification/resend` | Resend without account enumeration |
| `POST /api/v1/auth/login` | Verify password and create secure session |
| `POST /api/v1/auth/password/forgot` | Request a reset email without account enumeration |
| `POST /api/v1/auth/password/reset` | Consume reset token, rotate password and revoke existing sessions |
| `POST /api/v1/auth/logout` | Revoke current session after CSRF validation |
| `GET/PATCH /api/v1/me` | Read current profile or change display name |
| `GET/POST /api/v1/organizations` | List memberships or create a new private workspace |
| `POST /api/v1/organizations/:id/select` | Select a workspace only after membership check |
| `GET /api/v1/dashboard/summary` | Read live core metrics for current selected workspace |
| `GET /api/v1/organizations/:id/members` | List same-tenant members for an owner/admin |
| `GET/POST /api/v1/organizations/:id/invitations` | List or create tenant-scoped invitations |
| `GET/POST /api/v1/organizations/:id/roles` | List or create allowlisted custom tenant roles |
| `POST /api/v1/invitations/accept` | Accept an invitation for the current verified email |

## Competitor research applied to Atlas

The latest official HighLevel docs reviewed on 3 October 2026 describe event-triggered agents, reusable agent actions against CRM records, workflow-to-agent invocation with structured output, and an AI workflow builder that streams progress and asks clarifying questions. Atlas already has corresponding trigger/action/agent contracts from V93–V111; V112 closes the missing tenant identity and authenticated API boundary needed to execute those operations safely. See [HighLevel Agent Studio triggers](https://help.gohighlevel.com/support/solutions/articles/155000007310-how-to-set-up-agent-studio-triggers-for-real-time-starts), [Agent Studio Actions Platform](https://help.gohighlevel.com/support/solutions/articles/155000008521-how-to-use-the-actions-platform-in-highlevel-agent-studio), [invoke-agent workflow action](https://help.gohighlevel.com/support/solutions/articles/155000007402-workflow-action-invoke-agent-studio-agent), and [AI Workflow Builder v3](https://help.gohighlevel.com/support/solutions/articles/155000006100).

HighLevel's September 2026 Conversation AI workflow action adds an in-workflow multi-turn exchange with configurable reply delay and message cap, separate timeout / booked / not-booked outcomes, and channel selection. Its booking bot can check a configured calendar and continue different workflow branches after a successful booking, timeout or exhausted attempt limit. Atlas already has tenant-bound agent invocation, customer reply waits, booking lifecycle and explicit workflow branches, but these remain contracts rather than a connected chatbot/calendar provider in this release. Useful next user-facing work is a guided service-business intake that captures only missing contact fields, offers live calendar slots through a provider adapter, supports cancel/reschedule only with an authenticated booking reference, and opens a human case on timeout or low evidence. Sources: [HighLevel Conversation AI workflow action](https://help.gohighlevel.com/support/solutions/articles/155000001358-workfl), [AI appointment booking guide](https://help.gohighlevel.com/support/solutions/articles/155000000210-appointment-booking-in-conversation-ai), [appointment booking action branches](https://help.gohighlevel.com/support/solutions/articles/155000003467).

n8n's current docs emphasize execution filtering and retrying against original versus currently saved versions, project-scoped execution visibility, Git-backed environment promotion, and tool-specific human review before sensitive AI actions. Atlas has version-pinned workflow releases, scoped sub-workflow references, stable retry idempotency, tenant roles, and bounded approval evidence in V102/V111. This release adds the authenticated organization/member boundary those execution and sharing capabilities need; execution workers, agent provider connections, credential vault and Git promotion UI remain future work. See [n8n execution inspection/retry](https://docs.n8n.io/workflows/executions/all-executions/), [project workflow sharing](https://docs.n8n.io/workflows/sharing/), [source-control environments](https://docs.n8n.io/source-control-environments/create-environments/), [Gmail human-in-the-loop tool approval](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations/), and [security audit](https://docs.n8n.io/hosting/securing/security-audit/).

## Limits not represented as finished

V112 is the Phase 1 identity foundation, not a complete production launch. TOTP/2FA, enterprise SSO/OAuth, user deactivation/removal, invite resend/cancel, API tokens, a rich dashboard layout editor, current user session management, password-hash migration policy, scheduled retention cleanup for expired auth sessions/tokens/rate rows, provider delivery receipts/outbox retries, distributed Redis coordination, and multi-region load/failover tests are not included. CRM/workflow/AI/chat/email/SMS/telephony/billing providers are not connected by this release. The legacy command-center preview still labels its data illustrative.
