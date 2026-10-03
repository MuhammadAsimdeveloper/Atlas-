# Atlas V100 Launch Readiness

## What is launchable now

Atlas V100 has a reproducible static marketing/preview build with automated syntax, SEO, HTTP smoke, documentation, security-invariant and unit-test checks. The latest main commit has passed the repository CI matrix on Node 20 and Node 22.

The launch artifact is deliberately preview-safe by default: the marketing page is noindex, robots denies crawling, and the command-center remains a sample-data preview. Public indexing requires a real HTTPS origin supplied at build time.

## Verified in CI

- Node 20 and 22 test matrix.
- Unit tests and JavaScript syntax checks.
- Security/tenant-boundary doctor checks.
- Markdown documentation checks.
- Static preview HTTP smoke tests.
- Public/preview SEO generation and sitemap assertions.
- Static marketing-site build.
- Launch artifact is uploaded from CI for release packaging.

## Required before a real SaaS launch

These are product/infrastructure dependencies, not bugs hidden by the source build:

1. Deploy an authenticated API and tenant/session middleware.
2. Apply and validate PostgreSQL migrations with forced RLS in a managed environment.
3. Deploy durable Redis/queue workers and a scheduler.
4. Connect and verify real email/SMS/WhatsApp/social/voice/calendar/payment providers as needed.
5. Configure secret management/KMS, object storage, WAF/CDN and OpenTelemetry export.
6. Add signup/login, tenant administration, live inbox and production operator surfaces.
7. Configure a real HTTPS domain, then build with ATLAS_PUBLIC_ORIGIN=https://... and run npm run seo:check.
8. Execute backup/restore, load, failover, retention/deletion and provider-replay drills.
9. Perform an external mobile/laptop accessibility and security review.
10. Publish only after the deployment environment, domain and provider tests pass.

## Release rule

Do not describe the sample command center, deterministic contracts, or static preview as a connected SaaS product. A channel is connected only after credentials, callback verification, delivery tests and production observability have passed.
