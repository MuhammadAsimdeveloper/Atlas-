# Atlas V124 — Production Activation & Trust Gate

V124 adds the repository-side production activation gate after the V123 provider/service-operations integration fabric.

## Hardened guarantees

- Release metadata is synchronized to 124.0.0 / V124.
- Production activation checks critical configuration, API security wiring, worker isolation, provider fail-closed boundaries, non-root deployment and CI least privilege.
- Provider calls retain safe destination validation, bounded retries, idempotency and redacted provider errors.
- Provider configuration is never treated as connectivity.

## Live-status rule

Atlas may display an integration as **Live** only after deployment proves credentials, OAuth/token exchange, provider health, supported test transaction, inbound webhook verification, idempotency/reconciliation and tenant-bound health persistence. An adapter existing in source is not proof of live connectivity.

## Required production infrastructure

HTTPS edge/WAF, managed PostgreSQL with TLS/RLS/PITR, independently scaled workers, secret manager/KMS, object storage/CDN, OpenTelemetry export and alerting, backup/restore evidence, retention/deletion controls, and tested incident procedures.

## Current provider surface

The repository contains concrete adapters for Postmark email, Twilio messaging/voice, WhatsApp Cloud, Zapier webhooks and Jobber GraphQL, plus the provider-neutral adapter boundary. External accounts, credentials and end-to-end verification remain deployment-specific.

## Activation sequence

1. `npm ci`
2. `npm test`
3. `npm run check`
4. `npm run doctor`
5. `npm run production:check`
6. `npm run production:activation-check`
7. `npm run db:migrate` against managed PostgreSQL
8. Run provider sandbox/live capability and webhook checks
9. Run backup/restore, load and failure-injection drills
10. Promote only after edge health and observability gates pass

Never bypass a failed gate with an environment flag. Never accept tenant IDs, roles, credentials or arbitrary provider destinations from untrusted workflow/model input.
