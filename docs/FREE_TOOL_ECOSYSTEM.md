# Free Tool Ecosystem — Atlas

Date: 2026-10-07

The ecosystem research expands our capability strategy beyond Zee/Teamily into the large free/browser-tool market.

## Canonical principle

Do not clone hundreds of websites. Build and consume a shared Tool Fabric. Prefer local/client-side execution for files and sensitive data; use network providers only when necessary and explicit.

Research patterns include:
- free tool directories with hundreds of utilities;
- PDF/document suites;
- image/media conversion and optimization;
- text/encoding/data conversion;
- developer/security utilities;
- calculators/converters;
- SEO/web audits;
- QR/generator utilities;
- browser/computer-use agents.

Representative research: FreeTools.org reports 162+ tools across 12 categories; All Free Tools advertises hundreds across SEO, PDF, image, developer, business, text and calculators; Free.Tools organizes 65 tools across text/encoding, compression/hash, documents, images, networking, math, developer, time/date and security. citeturn0search5turn0search0turn0search2

Open-source/client-side ecosystems also demonstrate the value of local processing and transparent source/license/data-location metadata. citeturn1search4turn1search8

## Shared capability families

### Utility
PDF merge/split/compress/convert, image resize/compress/convert/crop, text counting/diff/case/sort, JSON/CSV/YAML/XML conversion, Base64/URL encoding, UUID/hash, QR, color/gradient, date/time and unit conversion.

### Web/SEO
Meta/OG/robots/sitemap, schema, canonical/redirect/link checks, headers, web manifest, Lighthouse-backed performance/accessibility/SEO auditing. Lighthouse is an important open-source reference for these audit surfaces. citeturn1search6turn1search3

### Security
Password generation, checksum/hash, JWT inspection, certificate inspection, secret/PII scanning and redaction. Decoding is never presented as signature verification.

### Browser agents
Provider-neutral contracts for isolated browser sessions, navigation, observation, clicks/types/select/scroll, extraction, screenshots, downloads/uploads, verification, authentication handoff, recording/replay and durable tasks.

Anchor's public architecture is a useful competitive reference for isolated sessions, authentication/MFA handoff, observability, deterministic workflows, concurrency and MCP/SDK integration. Its performance/security numbers are vendor claims and must not be treated as independently verified. citeturn1search0turn1search1

## Product boundary

This repository must use the canonical owner appropriate to its mission:
- Build Vibe: canonical tool implementation
- Aira: orchestration, permissions, memory, approvals and tool routing
- Atlas: business workflows and governed integrations
- Auto-Vid: media production
- Web Agency: delivery/QA
- Asim-OS: local/offline adapters
- Saudadesk-Ai: product-specific capabilities

## Build rule

A tool is not “done” because a UI exists. It requires a contract, implementation, tests, security/privacy mode, documentation and verification state.