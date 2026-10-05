# Atlas Post-MiroFish Development Roadmap — October 2026

## Mission

Turn Atlas from a large collection of bounded SaaS contracts into a trustworthy end-to-end business automation product.

The roadmap deliberately favors **depth of one complete customer outcome** over superficial parity across every GoHighLevel/n8n feature.

## Baseline

The repository README and master roadmap identify V119 as the current documented release baseline.

Important repository truth:

- V119: durable workflow execution state/control plane, version pinning, replay/cancel/approval and atomic queue handoff
- V117: authenticated visual Workflow Studio and safe workflow preview
- V115: durable queue/outbox/scheduler primitives
- V114: tenant-scoped Growth Center modules
- V113: agent evaluation gates
- V118 documentation exists for live provider connections, but that document is an implementation specification and is not by itself proof of a production-live deployment

Do not mark a capability "live" solely because a contract, catalog entry, migration, UI or documentation exists.

## North-Star Product Outcome

### Flagship Atlas journey

**Lead → CRM → qualify → follow up → book → update pipeline → measure outcome**

A first-time customer should be able to understand, configure, test and observe this journey without learning Atlas internals.

## Phase 1 — V117 Product Focus + Activation Foundation

### Goal

Make the first successful workflow obvious.

### Deliverables

- New-user onboarding with workspace context and sample-data option
- Guided flagship workflow template
- Clear "what is connected" status
- Test/sandbox mode that cannot send real customer messages
- Workflow validation UX with actionable errors
- Empty states tied to the flagship journey
- Dashboard centered on outcomes, not feature counts
- Template gallery with a small curated initial set
- Help/trust links in sensitive connection and AI surfaces

### Exit gate

A new user can create a workspace, add sample data, activate a template in test mode and inspect the expected result without administrator assistance.

## Phase 2 — V118 Provider Execution Hardening

### Goal

Turn the provider catalog into verified connections.

### Priority providers

1. Jobber
2. Zapier
3. Webhooks / generic event ingress

Then expand based on observed customer demand.

### Deliverables

- OAuth/connect/disconnect lifecycle
- encrypted credential storage
- token rotation
- provider health
- inbound webhook verification
- durable sync tasks
- idempotent outbound delivery
- external-ID mapping
- provider-specific error classification
- end-to-end sandbox tests

### Exit gate

At least one provider path can be connected, tested, disconnected and safely replayed in a tenant-isolated environment with observable delivery state.

## Phase 3 — V119 Workflow Execution Engine

### Goal

Make published workflows actually execute.

### Deliverables

- canonical graph interpreter
- trigger/event ingress
- node dispatch
- context/data mapping
- deterministic run identity
- durable step state ✅
- delayed waits
- approval pauses and resume ✅ (control-plane state)
- bounded retries ✅ (state-machine policy)
- dead-letter handling ✅ (state-machine policy)
- cancellation ✅
- replay with version pinning ✅
- execution timeline ✅
- per-node status and failure reason ✅ (durable state)
- tenant-safe execution isolation ✅
- concurrency controls
- worker health and queue metrics

### Hard rule

Publishing a graph must never imply execution until the execution path and handlers have been verified.

### Exit gate

The flagship lead-to-booking workflow can complete from trigger to observable outcome using a real or approved sandbox provider path.

## Phase 4 — V120 Communications + Customer Inbox

### Goal

Close the communication gap required for follow-up workflows.

### Priority

Start with a small set of channels and prove reliability before adding every channel in the catalog.

### Deliverables

- unified conversation model
- email delivery adapter
- inbound email event adapter
- consent/suppression enforcement
- delivery receipts
- bounce/unsubscribe processing
- human handoff
- assignment
- case/ticket relationship
- message history
- send/deliver/fail state
- operator inbox

SMS, WhatsApp, social DMs and telephony follow after the first reliable communication loop.

### Exit gate

A lead can receive an approved follow-up, an operator can see the communication state, and a failed delivery is safely visible and recoverable.

## Phase 5 — V121 AI Agent Studio + Copilot Workflow Authoring

### Goal

Make AI a force multiplier on the workflow engine rather than a disconnected chat feature.

### Deliverables

- natural-language workflow draft generation
- clarification questions for ambiguous requests
- proposed graph diff before save
- agent configuration UI
- tool permission preview
- knowledge-source management
- durable agent sessions
- structured outputs
- human approval for high-risk actions
- V113 evaluation integration in the publish path
- prompt-injection and sensitive-data test suites
- explicit model/provider status

### Exit gate

A user can describe a simple business process in natural language, inspect the generated workflow, run evaluation cases, and publish only after passing policy gates.

## Phase 6 — V122 Onboarding, Migration and Growth Loops

### Goal

Make Atlas easier to adopt from an existing tool.

### Deliverables

- CSV import/export
- dedupe suggestions and safe merge flow
- basic migration assistants
- workflow templates by business outcome
- first-run checklist
- in-product diagnostics
- product analytics events
- activation funnel instrumentation
- churn/abandonment reasons
- support diagnostics
- customer feedback capture

### Exit gate

Atlas can measure where a new user succeeds or fails without exposing sensitive customer content.

## Phase 7 — V123 Freemium + Billing + Entitlements

### Goal

Create a sustainable free-to-paid boundary.

### Deliverables

- explicit Free / Pro / Agency candidate plan model
- server-side entitlement enforcement
- usage counters
- execution limits
- AI usage limits
- connection limits
- team/seat limits
- audit-friendly plan changes
- trial state
- billing portal
- failed-payment handling
- invoice/subscription state
- upgrade prompts attached to meaningful limits

### Pricing policy

Do not choose final prices from simulation output alone.

Treat limits and prices as hypotheses to test after measuring:

- activation
- workflow completion
- weekly use
- retained workspaces
- resource consumption
- support cost
- willingness to pay

## Phase 8 — V124 Agency / Multi-Account Growth

Only start this phase after the core single-business product demonstrates repeatable value.

### Deliverables

- sub-account provisioning
- workspace templates/snapshots
- agency roles
- delegated administration
- usage/seat metering
- agency-level billing
- white-label options
- marketplace/integration distribution

## Phase 9 — V125 Production Reliability + Scale

### Goal

Earn operational trust.

### Deliverables

- managed PostgreSQL
- backup/PITR
- restore drills
- Redis/queue infrastructure where required
- object storage
- WAF/CDN
- observability
- alerts
- distributed tracing
- rate limiting
- capacity tests
- load tests
- failover tests
- incident runbooks
- data retention controls
- security review
- SLOs and error budgets

## Deferred Until Core Validation

The following stay behind the flagship workflow unless a real customer pull makes them urgent:

- full course/community product
- advanced ecommerce/POS
- ad management
- broad social publishing matrix
- large-scale affiliate payout systems
- mobile companion
- exhaustive connector catalog
- complete GHL permission-by-permission parity
- complete n8n node-by-node parity

## Roadmap Gate

Every new feature must satisfy at least one:

1. Enables the flagship workflow
2. Removes a measured activation blocker
3. Creates meaningful competitive differentiation
4. Improves trust/safety/reliability
5. Enables validated revenue
6. Removes a critical platform dependency

Otherwise it enters the deferred backlog.
