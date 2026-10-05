# V117 — Workflow Preview and Activation Foundation

## Status

V117 is the first post-MiroFish implementation slice.

Implemented in this branch:

- safe, authenticated workflow preview execution
- tenant-bound preview API
- graph validation reuse
- approval-aware preview
- deterministic branch simulation for supported condition/switch operators
- honest connector/model dependency reporting
- zero external side effects in preview mode
- trigger mismatch protection
- bounded preview context and execution steps

## Endpoint

`POST /api/v1/growth/workflows/:workflowId/simulate`

Authentication uses the same active-session and workspace scope as the Growth Center. Mutating requests require the existing Atlas origin and CSRF checks.

### Request

Only the following fields are accepted:

- `event`: bounded JSON event payload; its `type` must match the workflow's configured trigger
- `executionId`: optional bounded execution identity
- `approvedNodeIds`: optional list of node IDs to mark approved for the preview
- `now`: optional timestamp used for deterministic timing
- `maxSteps`: optional safety bound

### Response

The response contains:

- `preview: true`
- execution identity and tenant
- overall status
- step-by-step status
- node risk/dependency metadata
- simulated dependency list
- zero external side effects
- bounded summary counts

## Preview Safety Model

Preview mode is intentionally not production execution.

It:

- never calls provider APIs
- never sends an email/SMS/WhatsApp/social message
- never charges a payment
- never creates an external calendar booking
- never invokes an external AI/model provider
- never sleeps for a real `delay` or `wait_until`
- never persists provider side effects
- always resolves tenant scope from the authenticated session at the API boundary

Connector, AI, financial, network and other adapter-dependent nodes appear as `simulated` steps with their dependency recorded.

Approval-gated nodes pause with `needs_approval` unless their node ID is explicitly included in the preview-only approval list.

## Flagship Workflow

V117 supports the first safe rehearsal of the Atlas customer journey:

**Lead → CRM → qualification → follow-up → booking → pipeline outcome**

The current preview runtime provides the execution rehearsal layer. Production delivery still requires the V118/V119 provider and durable execution work.

## Current Limitations

V117 does not provide:

- durable production workflow runs
- live trigger ingestion
- external provider side effects
- durable wait/resume
- persistent execution history
- production retry/replay controls
- real model execution
- a full visual run inspector

These remain later milestones.

## Verification

Automated tests cover:

- native preview execution
- connector simulation
- approval pauses
- preview approval continuation
- conditional routing
- trigger mismatch
- cross-tenant rejection
- authenticated API access
- CSRF enforcement

## Product Principle

The preview must help a customer answer:

> "Will this workflow do what I expect?"

before Atlas is allowed to perform a real external action.
