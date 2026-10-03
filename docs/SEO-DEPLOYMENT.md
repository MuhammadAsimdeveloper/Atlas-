# SEO and Search Indexing

## Current state

Atlas does not have a public domain yet. The default build is a preview and deliberately cannot be indexed: the landing page and command-center app use `noindex,nofollow`, and `robots.txt` denies crawling. There is no canonical host or sitemap in the preview output.

The marketing page is a static, laptop-first product preview. Its claims distinguish implemented contracts from unconnected production services; pricing is explicitly marked as a target and not a checkout offer. Structured data is generated only for text already visible on the page and does not publish plan offers, reviews, ratings, availability or customer counts.

## Build preview

From the project root, run:

```sh
node scripts/build-site.mjs
node scripts/seo-check.mjs
```

The generated files are in `dist/atlas-site/`; this folder is ignored by Git and should not be placed inside a source ZIP. Preview mode emits a deny-all `robots.txt`, does not create `sitemap.xml`, and adds no canonical URL.

## Enable indexing after launch

After purchasing a domain, configure DNS, provision HTTPS, and choose the one canonical hostname (for example, `https://www.your-real-domain.com`). Run the public build with that origin:

```sh
node scripts/build-site.mjs --mode public --origin https://www.your-real-domain.com
node scripts/seo-check.mjs
```

Or set `ATLAS_PUBLIC_ORIGIN` in the deployment environment and run `node scripts/build-site.mjs --mode public`. Public mode rejects missing origins, HTTP URLs, URL paths, credentials, query strings, fragments, local/reserved hostnames and IP addresses. It emits:

- one canonical URL for the marketing root;
- Open Graph and Twitter title/description/URL metadata;
- Organization, WebSite, SoftwareApplication and visible FAQ structured data;
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
