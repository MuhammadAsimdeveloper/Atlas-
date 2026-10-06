# Atlas V146–V160 Hardened Automation Roadmap — 6 October 2026

## V146 — n8n-inspired hardened automation fabric (current build)

Atlas will adopt the useful workflow features visible in current n8n while keeping Atlas's stronger fail-closed tenant, approval, idempotency and provider-boundary model.

Implemented in V146:
- loop-over-items and bounded iteration
- aggregate, split-out, sort and remove-duplicates data operations
- edit-fields/declarative data mapping
- webhook response and explicit error/stop nodes
- execution custom data kept redacted/reference-only
- workflow execution filtering and retry planning
- protected development/staging/production environments
- reusable versioned workflow templates
- tenant/capability-scoped MCP tool manifests
- AI workflow-builder proposal mode (draft-only, no autonomous production mutation)
- workflow security audit
- human approval request/decision contract
- explicit rejection of unsafe shell/host execution in automation

Hardened rules:
- no arbitrary shell/host command execution;
- no direct arbitrary network URL in workflow action configuration;
- no secrets, tokens, cookies or authorization material in workflow configs;
- no automatic retry of non-idempotent side effects;
- no self-approval;
- no cross-tenant template/manifest execution;
- production environment must be protected;
- MCP write/financial/destructive tools require human approval;
- AI workflow authoring remains proposal-only until a separately verified release process approves the graph.

## V147 — Agent Workforce + Session Runtime
- Agent Studio
- persistent agent sessions and redacted tool history
- bounded model calls and cancellation
- structured output validation
- capability intersection across tenant, actor, agent, deployment
- approval inbox and resume
- workflow-to-agent and agent-to-workflow calls
- batch evaluation and regression evidence

## V148 — AI Voice + Unified Inbox Loop
- voice session correlation with contacts/conversations
- consent/suppression/call-window/provider gates at attempt time
- provider-neutral telephony adapter
- replay-safe callback reconciliation
- transfer/handoff queues
- post-call appointment/CRM/workflow outcomes
- private coaching/evaluation evidence

## V149 — Funnel + Website Conversion Fabric
- reusable page/form components
- public form ingress with abuse protection
- contact/lead dedupe
- UTM/affiliate attribution
- form/step/view/booking events
- calendar CTA wiring
- domain verification and HTTPS-only publication
- public release/rollback/diff
- SEO conversion analytics

## V150 — Calendar + Service Operations
- live availability provider adapters
- booking/reschedule/cancel reconciliation
- capacity, buffers and host routing
- reminder/no-show automation
- service request/job/visit/quote/invoice continuity
- SLA calendars and escalation
- human booking fallback

## V151 — CRM Intelligence + Portability
- unified customer timeline
- deterministic dedupe candidates + human-approved merge
- import/export with dry run and audit
- custom objects/associations
- saved views/bulk operations
- lifecycle automation
- privacy-safe attribution/reporting aggregates
- retention/deletion controls

## V152 — Security/Trust Enterprise Layer
- external KMS/secrets integration
- credential-scoping and rotation
- webhook verification coverage matrix
- tenant-isolation adversarial suite
- SSRF-safe connector boundaries
- security audit scanner
- break-glass/dual control
- dependency/container vulnerability gates
- recovery/deletion evidence

## V153 — SEO/Growth Intelligence
- canonical/robots/sitemap
- Open Graph/Twitter/JSON-LD
- page quality and internal-link checks
- Search Console integration
- landing-page conversion attribution
- performance/crawlability evidence
- rollback-safe publishing

## V154 — Distributed Production Execution
- real Redis client and worker wakeup
- priority/fairness/backpressure
- autoscaler actuators
- OTLP collector and alert destination
- production infrastructure/IaC evidence
- load/failover/restore drills

## V155 — Template + Marketplace + Community Extension Fabric
- signed workflow templates
- tenant-safe import/export
- verified community integrations
- extension risk scanning
- version compatibility and rollback

## V156 — Data + Integration Fabric
- richer connector pagination
- sync checkpoints
- conflict resolution
- A-to-B mapping
- dead-letter repair
- reconciliation dashboards

## V157 — Agentic Knowledge + RAG
- tenant knowledge stores
- retrieval/reranker policies
- memory lifecycle
- citation/evidence requirements
- prompt-injection and exfiltration defenses
- evaluation suites

## V158 — Business/Revenue Command Center
- funnel-to-revenue attribution
- cohort views
- workflow value scoring
- unit economics
- agency/client reporting
- budget/approval guardrails

## V159 — Multi-region Reliability
- regional routing
- failover policy
- replay-safe regional recovery
- data residency controls
- disaster recovery drills

## V160 — Launch Proof
- full external provider certification matrix
- real production credentials
- real domain/HTTPS
- managed data/queue/object/edge services
- backup/PITR restore evidence
- SLO burn-rate alerts
- security/compliance review
- measured load at target scale

## n8n-inspired capability mapping

Current n8n documentation exposes:
- visual workflow flow logic: conditionals, merging, looping, waiting, sub-workflows and error handling;
- data handling: expressions, linked items, filtering and data tables;
- core nodes including Code, HTTP Request, Error Trigger, Execute Sub-workflow, Loop Over Items, Merge, Remove Duplicates, Respond to Webhook, Sort, Split Out, Stop and Error, Switch, Wait, Webhook;
- Advanced AI surfaces including AI Workflow Builder, Chat Hub, instance-level MCP, RAG, human fallback and human-in-the-loop;
- execution filtering/retry;
- workflow sharing/RBAC and credential-aware editing;
- source-controlled development/production environments;
- security audits, credential/node/file-system checks and instance hardening.

Atlas adopts the useful concepts but intentionally hardens them:
- declarative expressions instead of arbitrary host execution;
- connector references instead of arbitrary URLs;
- strict tenant RLS and release pinning;
- exact, fresh, non-self approval;
- stable idempotency across retries;
- redacted execution data;
- protected production promotion;
- capability-scoped MCP;
- proposal-only AI workflow authoring.

## Verification policy

A feature is Connected only when:
- it integrates with the existing Atlas domain model;
- it has a tenant-scoped persistence path or explicit side-effect-free planning contract;
- downstream event/action linkage exists;
- retry/dedup semantics are defined;
- security failure behavior is explicit;
- tests prove the contract;
- CI runs Node 20 and 22;
- SEO/build/smoke/launch/production gates stay green;
- external providers are marked live only after external activation evidence.

