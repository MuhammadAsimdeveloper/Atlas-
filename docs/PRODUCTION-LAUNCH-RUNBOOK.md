# Atlas Production Launch Runbook

## Rule

Repository readiness, infrastructure readiness and customer/provider readiness are separate gates.

## Sequence

1. Verify the exact release commit and run the complete CI suite.
2. Apply forward PostgreSQL migrations with the migration identity.
3. Provision restricted `atlas_app` and `atlas_worker` identities.
4. Configure managed PostgreSQL TLS, backups and PITR.
5. Configure Redis TLS/authentication and HA.
6. Configure KMS/secret resolution and rotate test credentials.
7. Configure WAF/CDN, HTTPS and trusted proxy headers.
8. Configure provider credentials, webhook signatures, consent and reconciliation.
9. Run V149 recovery drills in staging.
10. Run representative load and measure queue latency, execution latency, error rate and recovery time.
11. Produce V150 evidence records for the exact deployed release.
12. Run `npm run production:evidence` and require a ready report.
13. Execute the flagship workflow end-to-end:
    Lead -> CRM -> qualification -> follow-up -> appointment -> pipeline update -> reporting.
14. Enable production traffic only after the measured evidence report is ready.

## Rollback

Disable traffic, stop new schedule claims, preserve the durable database, roll back the application release, and reconcile any provider actions marked `reconciliation_required` before replaying work.

## External evidence

The repository cannot create live provider accounts, DNS records, managed database backups or real failover measurements. Those must be produced by deployment operators and recorded as hashed, time-bounded evidence.
