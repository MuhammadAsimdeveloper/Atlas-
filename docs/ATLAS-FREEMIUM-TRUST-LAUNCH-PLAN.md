# Atlas Freemium and Trust Launch Plan

## Objective

Use freemium to create a low-friction first experience while protecting Atlas from uncontrolled infrastructure, AI and support costs.

## Launch Principle

The free tier should prove the product's value.

It should not attempt to provide unlimited business infrastructure.

## Free Tier Design

The initial free tier should be based on bounded resource units rather than arbitrary feature walls.

Candidate controls:

- workspaces
- team members
- active workflows
- workflow executions
- automation frequency
- connected providers
- AI runs/tokens
- message sends
- retained execution history
- storage

The exact numerical limits are hypotheses and must be validated with real usage.

## Free User Experience

A free user should be able to:

1. create a workspace
2. import or create sample data
3. use the Lead to Booking template
4. run safe test executions
5. connect a limited number of supported integrations
6. see meaningful analytics
7. understand exactly what is included
8. reach a clear upgrade point when the product is already useful

Do not force payment before the user has experienced the product's core outcome.

## Upgrade Moments

Upgrade prompts should appear when Atlas can explain:

- which limit was reached
- why the limit exists
- what the next plan unlocks
- whether data remains safe
- whether workflows continue running
- what happens after cancellation

Avoid generic "upgrade now" messaging without a concrete product reason.

## Trust Center

Atlas should ship a visible trust surface covering:

### Data

- tenant isolation
- RLS boundaries
- data retention
- deletion expectations
- export behavior
- backups/recovery posture

### Integrations

For every provider show:

- connected
- needs reauthentication
- error
- disconnected
- last health check
- capabilities enabled

Never display a provider as connected because a configuration field merely exists.

### AI

For AI features show:

- model/provider state
- data source scope
- tool permissions
- whether the action is draft/proposal or execution
- human approval requirement
- evaluation status for published customer-facing agents

### Automation

Show:

- workflow status
- active version
- recent runs
- failed runs
- approval waits
- provider dependency
- retry state

## Public-Beta Trust Gates

Before using real customer data:

- HTTPS production origin
- verified authentication/session behavior
- RLS/tenant isolation tests
- restricted worker identity
- encrypted provider credentials
- webhook signature verification
- safe retry/idempotency
- backup strategy
- monitoring
- incident contact
- honest provider capability labels
- tested data export/deletion path

## Payment Readiness

Before charging customers:

- legitimate business/payment provider setup
- verified production pricing IDs
- webhook verification
- subscription state reconciliation
- entitlement enforcement
- cancellation
- failed payment handling
- customer billing portal
- refund/adjustment process
- audit trail

The product may run a non-paid beta before all commercial infrastructure is ready, provided the user-facing terms and access model are explicit.

## Operational Cost Protection

At minimum, enforce:

- per-tenant execution quotas
- per-tenant concurrency
- AI usage caps
- message caps
- provider rate-limit handling
- queue backpressure
- dead-letter behavior
- abusive automation protection
- admin-visible resource usage

## Launch Sequence

### Stage A — Internal

- sample data only
- test-mode workflows
- synthetic providers where needed
- no customer data

### Stage B — Private beta

- small number of invited workspaces
- supported provider set only
- manual onboarding
- active error monitoring
- weekly product review

### Stage C — Public free tier

- self-service signup
- bounded resources
- trust center
- diagnostics
- support workflow
- usage telemetry

### Stage D — Paid plans

Only after actual usage reveals:

- which features drive retention
- which limits protect the system
- which workflows create value
- which customers are willing to pay

## Trust Anti-Patterns

Do not:

- claim "AI powered" when no model provider is configured
- claim "automation running" when only graph persistence exists
- expose fake integration badges
- hide failed external deliveries
- store secrets in workflow definitions
- silently drop executions
- promise enterprise scale before load/failover evidence
- use the simulation as a substitute for customer research

## Launch Gate

Atlas can move from private beta to public free tier when the flagship workflow is reliable enough to demonstrate repeatedly, external dependencies are truthfully represented, and operators can diagnose failures without reading raw production state manually.
