# V97 Deep Audit — SEO Build and No-Domain Preview

## Changes

- Preview mode fails safe: `noindex,nofollow`, deny-all `robots.txt`, no canonical and no sitemap.
- Public mode requires one explicit HTTPS origin with no path, credentials, query or fragment; reserved/local names and IP origins are rejected.
- Canonical, Open Graph/Twitter metadata and JSON-LD are emitted only in public mode. The generator checks that the FAQ structured data still matches visible FAQ text.
- The app is noindex in both modes and is never included in the sitemap. Public `robots.txt` permits crawling so crawlers can read the app's noindex directive.
- Build output is restricted to a subdirectory of `dist/`; `dist/` symlinks are rejected to avoid deleting through a redirected output path.
- Removed the Google Fonts import to eliminate an unnecessary third-party font request and keep the first render independent of the font provider.

## Findings addressed

| Finding | Resolution |
|---|---|
| No real Atlas origin existed, so canonical URLs would be fabricated | Default build has no canonical; public mode requires an explicit valid origin |
| A deployable preview could be crawled by search engines | Preview meta robots and deny-all robots file |
| Sample-data command center could be indexed | App-level `noindex,nofollow` and sitemap exclusion |
| Structured data can drift from visible product or FAQ claims | Generated from constrained page constants and checked against visible FAQ source |
| Search metadata could overstate commerce readiness | No Offer/pricing schema; page states that plan prices are targets, not active checkout |
| Marketing page depended on an external font provider | System-font stack with no remote font fetch |

## Still not verified

- No public domain has been purchased; DNS, TLS, canonical redirects, CDN headers, Google/Bing property verification and live crawling cannot be checked yet.
- Browser-based visual review, accessibility auditing across assistive technologies, Core Web Vitals and mobile device QA remain outstanding.
- Signup, login, checkout, delivery providers, authenticated APIs and the sample command center's data connections remain unimplemented/external per V96 production boundary.
- No npm CLI was found in the prior local runtime inspection; `npm audit` availability must be checked at release time. The package declares no third-party runtime dependencies.
- PostgreSQL migrations, managed Redis/workers, KMS, object storage, CDN/WAF, OTel export, production load and failover remain deployment tasks.

## Verification for release

Run `node scripts/seo-check.mjs`, `node scripts/check.mjs`, `node scripts/doctor.mjs`, `node scripts/docs-check.mjs`, `node --test` and `node scripts/smoke-http.mjs`. Record exact results in `RELEASE-MANIFEST.txt`; do not convert unverified external conditions into launch claims.
