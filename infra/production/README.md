# Production deployment gate

The compose file is a deployment reference, not a security approval.

Before production:
1. Replace the sample Postgres password with a secret-manager value.
2. Use managed PostgreSQL with TLS, backups, PITR and forced RLS.
3. Apply V80, V85, V90, V91, V92, V93, V94, V95, V96, V99 and V100 migrations in order.
4. Create separate API and worker database roles without BYPASSRLS.
5. Verify every tenant transaction sets app.tenant_id from authenticated membership.
6. Connect Redis through a private network and configure durable queue consumers.
7. Configure WAF/rate limiting, TLS, secret rotation, object storage and OpenTelemetry.
8. Run backup/restore, migration rollback, load, failover and tenant-isolation tests against the actual deployment.
9. Configure real provider adapters only after credentials, webhook signatures, consent, idempotency and replay tests pass.
10. Only then switch ATLAS_PUBLIC_ORIGIN to the production HTTPS origin and enable indexing.

Do not use local JSON state, the sample Postgres password, or the static command-center preview as production persistence.