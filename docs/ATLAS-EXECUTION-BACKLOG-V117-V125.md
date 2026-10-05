# Atlas Execution Backlog — V117 to V125

## How to use this backlog

Implement in order unless a measured production issue changes the priority.

Each item should produce code, tests, observability and documentation where applicable.

## V117 — Activation

### P0

- [ ] Build guided onboarding
- [ ] Add sample-data/test workspace path
- [ ] Ship Lead to Booking workflow template
- [ ] Add workflow validation error UX
- [ ] Add provider connection truth/status UI
- [ ] Make the dashboard outcome-focused
- [ ] Add test-mode execution preview
- [ ] Add activation telemetry without storing sensitive message content

### P1

- [ ] Curate initial workflow template gallery
- [ ] Add contextual help
- [ ] Add trust/security explainer surface
- [ ] Add workspace setup checklist

## V118 — Provider Runtime

### P0

- [ ] Verify Jobber connector end-to-end
- [ ] Verify Zapier connector end-to-end
- [ ] Add webhook ingress health
- [ ] Add provider connection diagnostics
- [ ] Add connection test action
- [ ] Add external-ID mapping audit
- [ ] Add connector replay/idempotency tests

### P1

- [ ] Add provider rate-limit classification
- [ ] Add reauthentication UX
- [ ] Add connector capability matrix in UI

## V119 — Workflow Execution

### P0

- [ ] Implement graph interpreter
- [ ] Implement trigger ingress
- [ ] Implement node dispatch
- [ ] Persist execution/step state
- [ ] Implement deterministic idempotency
- [ ] Implement retries/backoff
- [ ] Implement dead-letter state
- [ ] Implement delayed wait/resume
- [ ] Implement approval pause/resume
- [ ] Implement cancellation
- [ ] Implement safe replay/version pinning
- [ ] Build execution inspector
- [ ] Add worker concurrency controls

### P1

- [ ] Add execution filters
- [ ] Add per-node duration/error metrics
- [ ] Add operator retry controls
- [ ] Add redacted execution diagnostics

## V120 — Security hardening

### P0

- [x] Remove direct worker workflow-execution table privileges
- [x] Add lease-bound execution RPCs
- [x] Centralize browser/API security headers
- [x] Fail closed on missing trusted proxy client IP
- [x] Rate-limit Growth/Billing mutations and Paddle webhook ingress
- [x] Require a production health token
- [x] Add CI least-privilege permissions and bounded job runtime
- [x] Add automated dependency-update policy

### P1

- [ ] External penetration test
- [ ] WAF-managed rate-limit policy
- [ ] MFA/2FA and SSO
- [ ] Managed KMS/secret rotation
- [ ] Container/runtime hardening review

## V120 — Communications

### P0

- [ ] Unified conversation model
- [ ] Email provider adapter
- [ ] Inbound email event path
- [ ] Consent/suppression checks
- [ ] Delivery receipt handling
- [ ] Bounce/unsubscribe handling
- [ ] Operator inbox
- [ ] Human handoff
- [ ] Communication state in workflow inspector

### P1

- [ ] SMS adapter
- [ ] WhatsApp adapter
- [ ] Social messaging adapters
- [ ] Telephony/voice integration

## V121 — AI Workflow + Agents

### Delivered first activation slice

- [x] MiroFish-driven tenant activation checklist for the flagship Lead → follow-up → appointment outcome
- [x] Durable delay/wait-until state with bounded 30-day resume window
- [x] Due-only resume transition with checksum/version integrity
- [x] Operator execution-history filters for status, trigger and error code

### Remaining P0



### P0

- [ ] Natural-language workflow draft generator
- [ ] Clarification flow
- [ ] Graph diff review before save
- [ ] Agent Studio
- [ ] Tool permission preview
- [ ] Persistent agent session model
- [ ] Knowledge-source administration
- [ ] Structured AI output handling
- [ ] V113 evaluation gate integration
- [ ] Prompt-injection scenario suite
- [ ] Sensitive-data scenario suite
- [ ] Human-handoff scenario suite

### P1

- [ ] Agent templates
- [ ] Reusable skills
- [ ] MCP management surface
- [ ] Streamed responses where provider supports them

## V122 — Adoption and Migration

### P0

- [ ] CSV import
- [ ] CSV export
- [ ] Safe dedupe/merge flow
- [ ] Migration diagnostics
- [ ] Activation funnel dashboard
- [ ] Abandonment reason capture
- [ ] In-product feedback
- [ ] Curated business-outcome templates

### P1

- [ ] GHL migration assistant
- [ ] n8n workflow migration research
- [ ] HubSpot import helpers
- [ ] Additional CRM importers

## V123 — Freemium and Billing

### P0

- [ ] Entitlement service
- [ ] Usage counters
- [ ] Execution quotas
- [ ] AI usage limits
- [ ] Connection limits
- [ ] Seat limits
- [ ] Trial state
- [ ] Subscription reconciliation
- [ ] Customer billing portal
- [ ] Upgrade/downgrade behavior
- [ ] Failed-payment handling

### P1

- [ ] Usage analytics
- [ ] Plan recommendation hints
- [ ] Invoice/reporting improvements
- [ ] Agency plan metering

## V124 — Agency Platform

### P0

- [ ] Sub-account provisioning
- [ ] Agency membership/roles
- [ ] Workspace snapshots
- [ ] Delegated administration
- [ ] Seat/usage metering

### P1

- [ ] White-label controls
- [ ] Agency billing
- [ ] Marketplace foundations

## V125 — Production Scale

### P0

- [ ] Managed PostgreSQL
- [ ] Backup/PITR
- [ ] Restore drill
- [ ] Queue/worker production topology
- [ ] WAF/CDN
- [ ] OTel/tracing
- [ ] Alerting
- [ ] Rate limiting
- [ ] Load tests
- [ ] Failure-injection tests
- [ ] Capacity baseline
- [ ] Incident runbook
- [ ] Retention/deletion controls

### P1

- [ ] Multi-region strategy
- [ ] Disaster recovery rehearsal
- [ ] Cost dashboards
- [ ] SLO/error budget dashboards

## Cross-Cutting Engineering Rules

### Tenant safety

Every new read/write path must preserve tenant scope from trusted server context.

### Provider truth

Configuration is not connectivity. Mark integrations live only after successful capability checks and end-to-end tests.

### Execution truth

Published workflow definitions are not running workflows.

### AI truth

AI features must declare provider availability, tool permissions and approval requirements.

### Data minimization

Queue payloads and agent state should use resource references and bounded metadata instead of unnecessary customer content or secrets.

### Version integrity

Executions and replays must pin the exact workflow/agent release they execute.

## Release Discipline

For every version:

1. update implementation
2. add/adjust automated tests
3. run security and tenant-boundary tests
4. run focused end-to-end tests
5. verify UI claims against actual provider state
6. document what is live vs contract vs preview vs missing
7. update the roadmap
8. publish a release note

## Definition of Strategic Success

Atlas is strategically on track when a new customer can:

**understand Atlas → connect safely → run one valuable automation → observe the outcome → trust the system → return → eventually pay**

Feature breadth is downstream of that loop.
