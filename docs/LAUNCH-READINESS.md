# Atlas V115 Launch Readiness

## V115 repository status

The current source release is V115. The authenticated tenant API, Growth Center records, Paddle subscription webhook path, PostgreSQL durable queue/outbox/scheduler mechanics, and generic worker loop are covered by local automated checks. No default workflow or provider handlers ship, and the worker refuses to start without an operator-reviewed module. Migrations have only been exercised against ephemeral PGlite in this workspace. See [the V115 master roadmap](ATLAS-MASTER-ROADMAP.md) for DONE/PARTIAL/BLOCKED status by phase.

## What is launchable now

Atlas V115 has a reproducible static marketing/demo preview and an authenticated workspace UI/API when PostgreSQL is configured. The static preview (`scripts/preview.mjs`) contains illustrative data; the API-served workspace (`apps/api/server.mjs`) uses authenticated tenant routes and does not fabricate CRM metrics. Local checks cover syntax, SEO, HTTP smoke, documentation, tenant boundaries, queue state transitions and the worker-loop contract. GitHub CI installs locked runtime/test dependencies and runs the Node 20/22 matrix; require a green Actions result for the current commit before deployment.

The marketing/demo preview is deliberately noindex by default and robots denies crawling. Public indexing requires a real HTTPS origin supplied at build time.

## CI verification gates

- Node 20 and 22 test matrix; `npm ci` installs the PGlite test dependency before migration integration tests.
- Unit tests and JavaScript syntax checks.
- Security/tenant-boundary doctor checks.
- Markdown documentation checks.
- Static preview HTTP smoke tests.
- Public/preview SEO generation and sitemap assertions.
- Static marketing-site build.
- Launch artifact is uploaded from CI for release packaging.

## Required before a real SaaS launch

These are product/infrastructure dependencies, not bugs hidden by the source build:

1. Configure a production HTTPS domain/edge, managed PostgreSQL, transactional email and Paddle settings, including active recurring plan prices with verified 14-day free trials and the required API permissions.
2. Apply V115 migrations and grants with separate migration, API and worker roles; validate forced RLS in the target environment.
3. Supply reviewed workflow/provider handler modules before enabling queue workers; Redis is not part of V115 queue runtime.
4. Connect and verify real email/SMS/WhatsApp/social/voice/calendar/payment providers as needed.
5. Configure secret management/KMS, object storage, WAF/CDN and OpenTelemetry export.
6. Add live inbox, graph execution, execution/replay UI, worker operations and complete tenant lifecycle controls.
7. Configure a real HTTPS domain, then build with ATLAS_PUBLIC_ORIGIN=https://... and run npm run seo:check.
8. Execute backup/restore, load, failover, retention/deletion and provider-replay drills.
9. Perform an external mobile/laptop accessibility and security review.
10. Publish only after the deployment environment, domain and provider tests pass.

## Release rule

Do not describe the sample command center, deterministic contracts, or static preview as a connected SaaS product. A channel is connected only after credentials, callback verification, delivery tests and production observability have passed.
