# MiroFish Atlas Decision Record — 5 October 2026

## Purpose

This document records the MiroFish simulation used to challenge the current Atlas product direction and converts the result into engineering/product constraints.

This is a decision-support artifact, not evidence that Atlas will succeed or fail. Synthetic agent reactions are scenario analysis and must be validated with real users.

## Scenario Tested

Atlas launches as a low-cost freemium all-in-one SaaS combining:

- CRM and customer operations
- visual workflow automation
- AI agents and an operator AI Copilot
- calendars and service operations
- funnels and website tools
- integrations
- business operations

The intended competitive set included GoHighLevel, n8n, HubSpot, monday.com and Salesforce.

## Simulated Stakeholders

1. Agency owner
2. Small-business owner
3. Freelancer
4. Startup founder
5. Developer / automation expert
6. GoHighLevel user
7. n8n user
8. HubSpot user
9. Price-sensitive Pakistani user
10. International SaaS buyer
11. Competitor / product manager
12. Skeptical technical buyer

## Simulation Process

The MiroFish run completed the six-stage decision process:

1. Seed analysis
2. Graph building
3. Decision specification
4. Multi-agent orchestration
5. Independent judgment + debate + devil's advocate
6. Final merge / adjudication

The final report extraction timed out, so no numerical risk score or confidence score is recorded here.

## Strong Signals

### 1. Differentiation is the central product risk

The most important strategic question is:

> Why should a customer switch to Atlas instead of staying with the tools they already use?

Atlas must answer this through product experience, not only marketing copy.

### 2. A broad feature surface is not the same as product value

Atlas already contains a large set of contracts, modules and feature plans. That is useful infrastructure, but users will judge Atlas on whether a complete business outcome can be achieved reliably.

The next development cycle therefore prioritizes end-to-end workflows over further catalog expansion.

### 3. Trust is a first-class feature

A new SaaS handling customer and business data needs visible trust signals:

- clear data handling and security boundaries
- honest provider connection status
- auditability
- safe failure behavior
- reliable onboarding
- status/health visibility
- understandable support and recovery expectations

Atlas must never imply that an integration, AI provider, workflow or external action is live when it is only a contract or draft.

### 4. Freemium must demonstrate value without becoming an infrastructure trap

The free tier should allow a real first success while bounding expensive resources such as execution volume, model usage, message delivery and support.

Free limits are product hypotheses until real usage data validates them.

### 5. Switching value must be immediate

The best initial Atlas experience is not "configure an enterprise operating system."

It is:

> Connect data → capture a lead → run an automation → take an approved action → see the result.

## Negative Signals / Risks

- Feature parity pressure from established products
- Complex onboarding
- Weak differentiation
- User distrust of a new platform
- Free-tier support and infrastructure costs
- Payment and billing readiness
- External-provider dependency
- Building too many incomplete feature families
- Lack of end-to-end workflow execution despite a sophisticated definition layer

## Strategic Decisions

### Decision A — Stop treating feature count as the primary roadmap metric

New features must justify themselves through a customer outcome, activation path, competitive advantage, trust requirement, or platform dependency.

### Decision B — Build one killer workflow first

The first flagship journey is:

**Lead → CRM → qualification → automated follow-up → appointment → pipeline update → reporting**

The exact channels/providers are deployment-dependent, but the user-facing outcome is fixed.

### Decision C — Execution becomes the next major platform milestone

V116 has visual workflow authoring and a validated graph contract. The repository roadmap must now prioritize:

- event ingress
- graph interpretation
- durable execution
- waits/resume
- approvals
- retries/replay
- execution inspection
- provider actions
- outcome telemetry

### Decision D — Do not chase complete GHL/n8n parity before retention evidence

Feature parity remains a long-term benchmark. It is not the gate for the next public beta.

## Product Validation Questions

Before expanding the product surface, collect evidence for:

1. Can a new user complete the flagship workflow without assistance?
2. What causes users to abandon setup?
3. Which existing tool would they replace, if any?
4. Which Atlas capability creates the clearest switching reason?
5. Which free-tier limits feel fair?
6. Which trust questions block use of real customer data?
7. Which workflow outcomes justify payment?

## Evidence Policy

MiroFish findings are hypotheses.

The following are **not** established by the simulation:

- market size
- conversion rate
- retention rate
- willingness to pay
- probability of Atlas success
- superiority over any competitor

Those require product analytics, user interviews, usability tests, beta behavior and production evidence.


## V148 deterministic simulation update — 6 October 2026

The V148 simulation set was expanded for the AI execution frontier. New regression scenarios cover invalid structured model output, duplicate-safe approval replay, agent turn/tool budget exhaustion, cross-tenant workflow invocation blocking, and construction-time redaction of raw prompts/transcripts.

The simulations are deliberately deterministic repository checks, not a claim that live external provider behavior has been certified. Live model providers, telephony, Redis workers, external secret/KMS, object storage and production observability remain deployment evidence gates.

