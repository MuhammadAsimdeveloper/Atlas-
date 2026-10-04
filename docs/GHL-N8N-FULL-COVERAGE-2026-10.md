# GHL + n8n Full Feature Coverage — Atlas V111

## Status legend
CONTRACT = a tested Atlas contract exists.
BUILD = explicitly assigned to V111–V120 engineering.
DEPLOYMENT = live provider/infrastructure/external verification remains.

The machine-readable inventory is in 'packages/atlas-feature-catalog/index.mjs'.

## GHL coverage domains

### CRM
Contacts, businesses, companies, custom objects, associations, tags, custom fields/values, Smart Lists, filtering, bulk operations, notes, followers, tasks/recurring tasks, opportunities, pipelines, stages, lead scoring, attribution, timelines, dashboards, API and webhooks.

### Conversations & phone
Unified inbox; email; SMS/MMS; WhatsApp; Facebook Messenger; Instagram DM; Live Chat; website chat widget; custom providers; assignment/tags/internal notes; templates/snippets; scheduling/bulk messaging; inbound/outbound calls; recordings/reporting/forwarding/tracking; numbers/caller ID; spam/validation; missed-call/voicemail/call connect; IVR; Voice AI; Conversation AI; qualification; booking; routing; human handoff.

### Marketing
Email campaigns/broadcasts/templates/editor; SMS/WhatsApp/Messenger campaigns; segmentation; trigger links/URL shorteners; forms/surveys/quizzes; lead forms; funnel/site pages; blogs; authors/categories; scheduling; Social Planner; approval/drafts/recurring posts; platform publishing; social analytics; Ad Manager; Google/Meta/LinkedIn ads; prospecting; marketing audits; content/image/email/funnel/website AI; SEO assistance; A/B testing.

### Websites, funnels & SEO
Funnel/site builder, drag/drop elements, responsive editing, templates, sections/rows/columns, CSS/JS/HTML, embedded forms/surveys/calendars/checkout, thank-you pages, domains/SSL/redirects/publish, analytics, title/meta/canonical/robots/sitemap/schema/Open Graph/Twitter cards, SEO AI and split testing.

### Calendars
Calendars/groups, appointment types, availability/working hours, assignments, round robin, team/resource booking, services/add-ons/categories, paid calendars, booking pages, reminders/confirmations/reschedule/cancel/no-show, recurring events, Google sync, blocking and booking automation.

### Payments & commerce
Products/prices/variations; order forms/checkout/payment links; one-time/recurring payments; subscriptions; invoices/recurring invoices; estimates/proposals; discounts/coupons/taxes/fees/tips/payment schedules; dunning; recovery; refunds/receipts/transactions/orders; Stripe/PayPal/Square/NMI/Authorize.Net/Razorpay/ACH/SEPA/Apple Pay/Google Pay/BNPL; POS/readers/tap-to-pay/text-to-pay; gift cards/loyalty/ecommerce/upsells/downsells; routing; ledger/reconciliation.

### Reputation
Review requests/automation/channels, links, balancing, Google/Facebook, monitoring/trends/sentiment, AI replies/summaries, widgets/filtering/thresholds/layouts, video testimonials, collectors and listing management/Yext.

### Learning/community
Courses/lessons; membership products/offers/access levels/student management/certificates/webinars; communities/groups/posts/members/moderation/paid monetization.

### Affiliate
Affiliate manager/tracking/referral links/attribution/postbacks/commission/loyalty.

### Agency/SaaS/white-label
Agency/subaccount hierarchy, dashboards, user/permission models, snapshots, snapshot deployment/sharing/templates, SaaS plans/subscriptions/provisioning/billing, phone/email/AI rebilling, usage/markup billing, white-label branding/domains/apps, marketplace/install/reselling, agency templates/transfers/billing/audit.

### AI
Ask AI, CRM AI, content/image/email/website/funnel AI, Conversation AI, Voice AI, autonomous/managed agents, Agent Studio, Workflow AI, prompt optimization/testing, voice testing, Knowledge Base, review AI, qualification/booking/routing, CRM and connector actions.

### Workflow automation
Event/contact/appointment/opportunity/payment/ecommerce/affiliate/course/community/communication/ads/social/IVR triggers; email/SMS/WhatsApp/assignment/tasks/CRM/opportunity/calendar/webhook/notifications/goals; if/else/switch/waits; workflow chaining; sub-workflows; AI workflow builder.

## n8n coverage domains

### Core workflow runtime
Visual canvas, manual/schedule/webhook/app/chat/SSE/polling triggers, branching, if/switch/merge/loops/split/aggregate/filter/sort/dedupe/limit, waits, sub-workflows, data mapping, expressions, previous-node data, item linking, binary/files, HTTP/GraphQL/webhooks, JWT, FTP/SFTP, SSH, LDAP, IMAP, RSS, HTML/Markdown/XML, compression, crypto, Git, code, JavaScript/Python, custom helpers, JMESPath, data tables, mock/pinned data, pagination and workflow versioning.

### Integration fabric
REST/GraphQL; OAuth2/API key/service account; HMAC/signed webhooks; polling/delta/event streams; connector SDK; private/community nodes; provider/version/capability discovery; health/rate limits/circuit breakers; replay protection; idempotency; deduplication; conflict resolution.

### AI and agents
Agents and agent variants; chains; extraction/classification/sentiment/summarization; structured output/parsers/autofix; memory backends; vector stores; embeddings; document loaders/splitters/retrievers/rerankers; search/calculator/code tools; MCP client/server; workflow-as-tool; human fallback/HITL; model selection; evaluations; guardrails; observability/cost/permission controls.

### Execution & queues
Execution history/detail; retry/replay/resume; idempotent and at-least-once semantics; dedupe; DLQ; queues/workers; concurrency/backpressure/priority; schedules/cron; long-running/durable workflows; cancellation/pause; timeouts/rate limiting; provider buckets; circuit breakers/bulkheads; DLQ replay; lineage/audit/redaction.

### Security & enterprise
Credential storage/encryption/sharing; least privilege; workflow permissions/RBAC/custom roles/projects/user roles; 2FA; SAML/OIDC/LDAP; external secrets; audit/log streaming/security audit; SSRF/risky/community-node controls; key rotation; execution redaction; registration restrictions; isolation; tenant/platform-owner boundaries; secret rotation; key versioning; tamper-evident audit; policy engine.

### DevOps & lifecycle
API/auth; CLI; Git source control; dev/staging/prod; branching/protected production; push/pull; PR deployment; diffs/version/rollback; node SDK/testing/versioning; environment promotion/drift; config/release artifacts; OEM deployment.

### Observability & governance
OpenTelemetry traces/metrics/logs; SLO/error budget/burn rate; workflow/connector/queue/agent/cost metrics; security/compliance evidence; disaster-recovery evidence/restore drills; capacity profiles.

## Atlas superiority requirements
For every parity feature, Atlas adds or preserves at least one of:
- tenant-first authorization and forced database RLS;
- immutable version/checksum or release binding;
- deterministic idempotency and replay safety;
- provider-aware rate limits/circuit breakers;
- approval/step-up/dual-control for risky actions;
- explicit consent/suppression for communications;
- durable execution and audit lineage;
- AI tool/secret boundaries;
- observable SLO/DR evidence;
- business-graph/customer-intelligence integration.

## What remains intentionally external
Actual provider credentials, phone/carrier registration, DNS/CDN/WAF, hosted PostgreSQL/Redis, object storage/KMS, live model providers, payment processing, production SSO, compliance certification, capacity/load evidence and operational support processes are deployment work and cannot be honestly declared done from source code alone.
