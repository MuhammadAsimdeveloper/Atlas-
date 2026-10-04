# Atlas production architecture

## Source architecture

Atlas uses a stateless Node.js API with managed PostgreSQL as authoritative identity, tenant, CRM, billing and V115 execution storage. Database operations use restricted API/runtime roles and forced row-level security. Apply versioned SQL migrations with a separate migration identity. The V115 queue uses PostgreSQL row locking and remains durable without Redis.

At higher volume, run API, webhook ingress, workflow workers and schedulers as separate horizontally scaled services. Redis may be added for ephemeral caching, rate limits or wake-up hints; it must not replace PostgreSQL as the acknowledged source of durable job state. Use an object store for media, a CDN/WAF and TLS edge for public assets/API ingress, and an OpenTelemetry collector with redaction for traces/metrics.

Secrets should come from a managed secret store/KMS. Keep API and worker database URLs separate. The API role is `atlas_app`; the worker role is `atlas_worker`, has no `BYPASSRLS`, role memberships or Atlas table ownership, and is limited by RLS to queue metadata. The worker must not inherit the API or migration role.

## Deployment boundary

The Compose file is a local deployment reference, not a production-scale certification. Its PostgreSQL and Redis containers are not managed services. The `workers` profile requires a separately provisioned `atlas_worker` database credential and a reviewed handler module mounted read-only under `apps/worker/handlers/`. V115 intentionally includes no default business handler, so a worker refuses to start without one.

Before a public launch, configure managed database backups/PITR and verify restores; configure provider secrets and webhook origins; mount storage/CDN/WAF/HTTPS; run migration, tenant-isolation, provider-replay, load, failover and disaster-recovery tests against the target deployment; and publish measured SLO/RTO/RPO. This repository contains no millions-of-users proof, external audit, live provider verification or restore-drill evidence.

See [deployment notes](../infra/production/README.md), [execution engine](EXECUTION-ENGINE.md), and [master roadmap](ATLAS-MASTER-ROADMAP.md).
