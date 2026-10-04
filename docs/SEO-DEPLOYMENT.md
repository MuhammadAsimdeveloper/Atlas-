# SEO, Search Visibility and Publishing

## Current state

Atlas treats SEO as a publishing contract, not a collection of isolated head tags. The default build remains preview-safe: the landing page and command-center app use `noindex,nofollow`, `robots.txt` denies crawling, and there is no public canonical origin or sitemap in preview mode.

The marketing page is a static, laptop-first product preview. Its claims distinguish implemented contracts from unconnected production services; pricing is explicitly marked as a target and not a checkout offer. Structured data is generated only for text already visible on the page and does not publish plan offers, reviews, ratings, availability or customer counts.

## Search-quality system

The reusable `packages/atlas-seo/` package provides an SEO-readiness assessment for each page and for the site as a whole. It evaluates metadata quality, search-intent alignment, content depth and uniqueness, internal-link discovery, sitemap inclusion, structured data/entity clarity, image alternative-text coverage, HTTPS/mobile readiness, Core Web Vitals inputs, freshness and claim transparency.

The score is an internal readiness and prioritization score, **not a prediction of a Google or Bing ranking position**. Search engines use many signals and rankings depend on query intent, relevance, content quality, competition, links, context and systems outside Atlas.

`packages/atlas-next/` now accepts optional per-page SEO context and reports site SEO readiness in public publish plans. A future AI/page generator can therefore propose content while the publishing layer still surfaces technical and content gaps before publication.

Atlas deliberately does not emit a `meta name="keywords"` tag. Use useful visible content, headings, descriptive links, metadata and accurate structured data instead.

## Content and ranking strategy

The core topic cluster is **AI customer operations for service businesses**, supported by **AI customer service**, **service-desk automation**, **lead follow-up automation**, **appointment follow-up**, **governed AI agents** and **customer operations analytics**.

Each indexable URL should serve one dominant search intent. Give every page a unique title and description, one clear H1, descriptive H2/H3 headings, useful visible content, relevant internal links and only the schema types that accurately describe visible page content.

Grow topical authority with genuinely useful use-case pages, guides, implementation explanations and comparisons rather than multiple near-duplicate pages with keyword substitutions.

Do not manufacture reviews, ratings, customer counts, availability, prices, certifications or case studies in structured data. Claims should be supportable from the page and real product evidence.

## Technical indexing rules

Only include canonical, indexable URLs in the sitemap. Use crawlable HTML links for discovery. Keep private/authenticated pages out of the sitemap and use `noindex` where appropriate.

Do not use `robots.txt` as a substitute for `noindex`: a crawler has to access the page to see the `noindex` directive.

After launch, verify the real domain externally in Google Search Console and Bing Webmaster Tools, check canonical redirects, sitemap processing, structured data, mobile rendering, Core Web Vitals and indexing status.

## Build preview

From the project root, run:

```sh
node scripts/build-site.mjs
node scripts/seo-check.mjs
```

The generated files are in `dist/atlas-site/`; this folder is ignored by Git and should not be placed inside a source ZIP. Preview mode emits a deny-all `robots.txt`, does not create `sitemap.xml`, and adds no canonical URL.

## Domain-independent preview and SEO deployment

If Atlas does not have a public domain yet, keep preview builds on `noindex,nofollow`, keep the preview robots policy closed to crawling, and do not create a sitemap or canonical public origin. The application can be tested locally or on a temporary preview host without claiming search visibility. When a real public domain is selected, configure `ATLAS_PUBLIC_ORIGIN`, provision HTTPS, verify the property in Google Search Console and Bing Webmaster Tools, and only then enable public indexing.

## Enable indexing after launch

After purchasing a domain, configure DNS, provision HTTPS, and choose the one canonical hostname (for example, `https://www.your-real-domain.com`). Run the public build with that origin:

```sh
node scripts/build-site.mjs --mode public --origin https://www.your-real-domain.com
node scripts/seo-check.mjs
```

Or set `ATLAS_PUBLIC_ORIGIN` in the deployment environment and run `node scripts/build-site.mjs --mode public`. Public mode rejects missing origins, HTTP URLs, URL paths, credentials, query strings, fragments, local/reserved hostnames and IP addresses.

Optional deployment variables are `ATLAS_SITE_LASTMOD`, `ATLAS_GOOGLE_SITE_VERIFICATION` and `ATLAS_BING_SITE_VERIFICATION`. Keep `ATLAS_SITE_LASTMOD` tied to the actual visible-content revision; do not bump it on every deployment. It emits:

- one canonical URL for the marketing root;
- Open Graph and Twitter title/description/URL metadata, including a 1200×630 social preview asset;
- `WebSite`, `Organization`, `WebPage`, `SoftwareApplication` and visible FAQ structured data;
- optional Google Search Console and Bing Webmaster verification tags;
- an explicit content freshness date in the sitemap;
- an allow-crawl `robots.txt` with the absolute sitemap location;
- a sitemap containing only the marketing root.

The sample `/app/` command center remains `noindex,nofollow` and is omitted from the sitemap. Robots allows crawlers to fetch that page so they can observe its noindex directive. Do not add authenticated app pages to the sitemap.

After deploying to the real host, verify canonical redirects, TLS, response status, robots, sitemap and rendered mobile/laptop layouts from outside the workspace. Then register the verified property in Google Search Console and Bing Webmaster Tools and submit the sitemap. Domain purchase, DNS/TLS, deployment, crawlability, search-console verification and actual indexing remain external and are not verified here.

## Guardrails

- Never build public mode against a placeholder hostname or a preview URL.
- Keep preview builds noindex until a stable public origin is selected.
- Keep page claims aligned with what is shipped and connected; update JSON-LD only from content visible to visitors.
- Do not mark the sample dashboard as a paid or live software service.
- Configure the production host to serve `dist/atlas-site/` and apply normal CDN/WAF/security headers separately.
