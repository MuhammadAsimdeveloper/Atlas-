# Atlas — Zee-Inspired Utility Integration Plan

Atlas is a consumer of the shared utility layer; Build Vibe/CodingVibes is the canonical owner.

## Integrate first
- SEO metadata generation
- sitemap and robots generation
- Open Graph/social previews
- website SEO auditing
- performance auditing
- accessibility auditing
- image optimization
- QR generation
- API testing for integration diagnostics

Embed these into Websites, Funnels, Marketing, customer workspaces and deployment checks where they directly improve business workflows.

Do not duplicate the shared implementation. Use stable adapters/contracts and preserve tenant isolation, audit logs, quotas and provider gates.

JSON, JSON→TypeScript, Regex, JWT and Base64 may be exposed to technical/admin users later if there is a demonstrated workflow need.