# Atlas V148 gap register — 6 October 2026

This register records the remaining product and production gaps after the V147 baseline and the V148 agent/model/runtime hardening slice. “Implemented” means repository code and tests exist. “Externally gated” means the code intentionally refuses to claim live operation until the named external service/evidence is configured.

## Gaps still incomplete

| Area | Gap | Status | Target |
|---|---|---|---|
| Agent runtime | Live model-provider adapters, provider credential resolution, streaming transport and response sink | Externally gated | V148/V156 |
| Agent runtime | Durable session rehydration, turn resume after worker crash, duplicate approval replay semantics | Partial | V148 |
| Agent UX | Visual Agent Studio canvas, chat emulator, jump-to-node, timeline UI | Partial | V148/V155 |
| AI workflow | Clarifying-question authoring, deterministic draft diff, preview and publish workflow | Partial | V148/V146 |
| Voice | Live telephony provider adapter, provider webhook certification, real test-call flow | Externally gated | V148/V160 |
| Inbox | Social DMs and web-chat channel parity | Partial | V148/V156 |
| Workflow UX | Full visual canvas, rich expression/data-mapping editor, side-by-side diff | Partial | V146/V155 |
| Workflow runtime | Live reviewed handler fleet for every catalog action | Partial | V125/V154 |
| Workflow runtime | Redis-backed distributed wake/queue, autoscaler actuator, measured failover/load evidence | Externally gated | V154 |
| Execution ops | Full human-readable execution inspector UI, redacted step timeline export, run-from-version/replay controls | Partial | V148/V155 |
| CRM | CSV import/export dry-run, dedupe/merge, custom fields/objects/associations, saved views/bulk operations, full activity timeline | Partial | V151 |
| Sales | Assignment queues, weighted forecast, richer revenue/sales dashboards | Partial | V151/V158 |
| Calendar | Google/Outlook synchronization, public booking widget/API, transactional booking payments | Externally gated | V150 |
| Marketing | Campaign audience builder, recurring sequence runner, attribution analytics, bounce/unsubscribe lifecycle | Partial | V149/V153 |
| Web/funnels | Verified-domain hosting/CDN, public form ingress, abuse controls, conversion-event pipeline | Externally gated | V149/V160 |
| SEO | Search Console integration, crawl/performance evidence, attribution joins | Partial | V153 |
| Social/reputation | OAuth publishing, analytics, review ingestion/responding, media library | Externally gated | V149/V153 |
| Commerce | Product/catalog, invoices, refunds, taxes, dunning, proration, usage billing, alternate processors | Partial | V158 |
| Learning/community | Course authoring, memberships, community/groups, entitlements | Missing | Future |
| Agency/SaaS | Sub-account provisioning, white-label, reseller/SaaS billing, marketplace and global control-plane UX | Missing | V155/V158 |
| Security | External KMS/secrets vault, SSO/OAuth/2FA, API keys, credential rotation, break-glass dual control | Externally gated / Partial | V152 |
| Security | WAF/CDN, DDoS controls, vulnerability scanning, restore/deletion evidence and compliance package | Externally gated | V152/V160 |
| Knowledge/RAG | Tenant vector store, reranker, citations, memory lifecycle, prompt-injection/exfiltration suite | Partial | V157 |
| Integrations | Broad connector catalog, pagination/sync checkpoints, conflict resolution, dead-letter repair and reconciliation dashboard | Partial | V156 |
| Marketplace | Signed templates, compatibility checks, community extension risk scanning and rollback | Partial | V155 |
| Analytics | Funnel-to-revenue attribution, cohorts, workflow value scoring, unit economics, client reporting | Partial | V158 |
| Reliability | Multi-region routing, data residency, regional replay/recovery and measured DR | Missing | V159 |
| Mobile | Native/companion operator experience | Missing | Future |
| Production proof | Real credentials, real HTTPS domain, managed Postgres/Redis/object/edge services, SLO paging, load/restore/DR certification | Externally gated | V160 |

## V148 delivered in this slice

- provider-neutral model adapter contract with timeout/cancellation
- structured output validation and bounded text streaming
- release/policy pinning and request checksums
- governed agent turn loop with tool risk/approval/tenant checks
- durable agent turn execution table and lease-bound worker RPCs
- gated authenticated execute/get/list API
- redacted agent execution timeline and reset/export contract
- plan-first AI workflow authoring with clarifying questions and draft-only mutation
- expanded deterministic MiroFish regressions

## Completion rule

A row is not considered complete merely because a catalog entry, interface, mock provider, or configuration flag exists. A capability is complete only when its persistence, authorization, side-effect boundary, retries/idempotency, downstream outcomes, tests, and operational evidence are connected.
