# Atlas V150 — Deployment Build and Operational Proof

## What changed

V150 moves the release from a contract-only distributed fabric toward a real deployable execution path.

### Distributed execution

- PostgreSQL remains the durable queue, lease, retry and recovery source of truth.
- Added a native Redis RESP client with redis:// and rediss:// support, AUTH, database selection, bounded frames and blocking BRPOP.
- API enqueue publishes a Redis wakeup only after the PostgreSQL transaction commits.
- Workers block on Redis wakeups and immediately trigger a normal durable PostgreSQL claim cycle.
- Redis failure degrades to PostgreSQL polling; queued work is not considered lost.
- Production Compose now provisions Redis with AOF persistence and health checks.
- Worker/API configuration exposes ATLAS_REDIS_URL and ATLAS_REDIS_NAMESPACE.

### Operational product surface

The authenticated command center now includes Operations:

- queued jobs
- running jobs
- dead-letter jobs
- Redis wakeup status
- current Atlas release
- operator-facing queue interpretation

This is tenant-authenticated and does not expose secrets or cross-tenant queue data.

### SEO and discovery

The public publishing pipeline includes canonical URL, robots directives, sitemap, Open Graph/Twitter metadata, Schema.org Organization/WebSite/WebPage/SoftwareApplication/FAQ graph, machine-readable llms.txt, web manifest metadata and an explicit public security contact requirement.

Preview mode remains fail-safe with noindex,nofollow and deny-all robots.

### Deployment preflight

npm run deploy:preflight executes unit tests, repository checks, security doctor, MiroFish, docs, SEO, launch readiness, production readiness and production activation in order.

Strict external mode additionally requires ATLAS_PUBLIC_ORIGIN, ATLAS_SECURITY_CONTACT, ATLAS_PROVIDER_ACTIVATION_EVIDENCE_REF and ATLAS_REDIS_URL.

## External providers

Atlas contains bounded adapters for Postmark email, Twilio SMS, Twilio Voice, Meta WhatsApp Cloud, Zapier webhooks and Jobber GraphQL.

Production activation remains credential/evidence dependent. A provider adapter in source is not treated as an active provider account.

The final deployment must perform controlled sandbox/live probes, verify webhook signatures, record provider receipts, exercise duplicate callbacks and reconcile provider identity against the tenant ledger.

## Required final production evidence

Before public launch, attach evidence for managed PostgreSQL/PITR restore, Redis/TLS worker wakeup, object storage/backup, WAF/CDN/HTTPS, KMS secret resolution, a real model request, selected real communication/calendar/payment paths, provider callback reconciliation, worker failover, representative load, SLO alert delivery, domain/Search Console verification, public SEO crawl and deployed tenant-isolation tests.

No source-level contract substitutes for these external operational proofs.
