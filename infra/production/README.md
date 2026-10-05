# Production deployment gate

The compose file is a deployment reference, not a security approval.

Before production:
1. Replace the sample Postgres password with a secret-manager value.
2. Use managed PostgreSQL with TLS, backups, PITR and forced RLS.
3. Apply V80–V115 forward migrations in version order, then apply V112, V114 and V115 grants as a migration owner.
4. Provision separate `atlas_app` and `atlas_worker` identities with no BYPASSRLS, role memberships, or Atlas table ownership. Keep migration credentials separate.
5. Verify every API tenant transaction sets app.tenant_id from authenticated membership and the worker credential is not present in the API container.
6. V139–V145 use PostgreSQL as durable execution authority and Redis as an optional acceleration/wakeup layer. Configure TLS/authenticated Redis and verify its failure fallback before enabling it.
7. Mount a reviewed `.mjs` handler module under `apps/worker/handlers/` and configure `ATLAS_WORKER_DATABASE_URL` before enabling the optional `workers` Compose profile. The worker receives only its database and runtime settings; it does not inherit API/provider secrets from `.env`. No business handlers ship by default.
8. Configure WAF/rate limiting, TLS, secret rotation, object storage and OpenTelemetry.
9. Run backup/restore, migration rollback, load, failover and tenant-isolation tests against the actual deployment.
10. Configure real provider adapters only after credentials, webhook signatures, consent, idempotency and replay tests pass.
11. Only then switch ATLAS_PUBLIC_ORIGIN to the production HTTPS origin and enable indexing.

Do not use local JSON state, the sample Postgres password, or the static command-center preview as production persistence.


## V146–V150 operators

Run `node apps/worker/control-plane.mjs` as a separately deployed worker-role process to execute the autoscaling/alert control loop. Run `npm run recovery:drill -- --scenario redis_failure --pool <pool>` in staging before launch. Run `npm run production:evidence` with time-bounded evidence JSON files for the exact release before production traffic.
