# Atlas Flagship Workflow Plan

## Product Thesis

Atlas should initially win by completing one business outcome better than a collection of disconnected tools.

### Flagship outcome

**Turn a new lead into a qualified, followed-up, booked opportunity with a visible audit trail.**

## Canonical Journey

1. Lead enters Atlas
2. Contact is created or matched
3. Lead is placed in a pipeline
4. Qualification rules or AI agent evaluate the lead
5. Atlas chooses the allowed follow-up path
6. Follow-up is sent through a configured provider
7. Lead books an appointment
8. Pipeline stage updates
9. Human approval is requested when policy requires it
10. Outcome is recorded
11. Owner sees what happened, why it happened and what needs attention

## Why This Journey

It joins the repository's strongest existing areas:

- Contacts
- Leads
- Pipelines
- Tasks
- Qualification
- Follow-up
- Workflow definitions
- Calendar contracts
- AI agent safety/evaluation
- Durable queue/outbox infrastructure
- Provider connections

It also creates a direct business outcome that can be demonstrated to prospective customers.

## Required User Experience

### Onboarding

The user should see:

- who Atlas is for
- the flagship workflow
- what Atlas can do in test mode
- which providers are connected
- what requires configuration
- what actions are currently simulated vs real

### Template

Ship a curated "Lead to Booking" template.

It must include:

- trigger
- dedupe/match
- qualification
- branch
- follow-up
- wait
- booking event
- pipeline update
- completion state

The template should be editable without breaking the underlying graph contracts.

### Test Mode

Test mode must:

- use sample contacts or clearly identified test records
- prevent real provider side effects
- show the step sequence
- show expected inputs/outputs
- expose validation problems
- allow a safe repeat

### Production Mode

Production mode must require:

- verified tenant membership
- verified connection
- provider health
- applicable consent
- action authorization
- exact workflow version
- idempotency identity
- retry policy
- observable execution state

## Core Runtime Contract

For every workflow execution, persist a minimal inspectable identity:

- tenant
- workflow
- published version
- execution
- trigger identity
- node identity
- attempt
- state
- timestamps
- redacted error/status metadata

Do not persist unnecessary secrets or full customer message bodies in queue payloads.

## Required Node Families

### Trigger

- lead created
- lead updated
- webhook received
- appointment booked

### CRM

- find contact
- create/update contact
- create/update lead
- move pipeline stage
- create task

### Qualification

- rule-based score
- evaluated AI agent
- human review

### Communication

- prepare message
- consent check
- send email
- wait for delivery state
- handoff to human

### Calendar

- booking request
- appointment event
- cancellation/reschedule event

### Control flow

- if
- switch
- wait
- retry
- stop
- child workflow

## Safety Rules

No workflow may:

- accept arbitrary credentials
- send to arbitrary recipients without policy checks
- escape tenant scope
- execute arbitrary SQL/code unless a separately isolated, reviewed runtime exists
- bypass consent
- use an unverified provider
- resume a high-risk action without valid approval
- silently change workflow version during replay

## Execution Inspector

The operator needs:

- timeline
- current state
- completed steps
- failed step
- retry count
- approval status
- provider status
- safe error explanation
- retry/replay action where permitted

## Success Criteria

These are internal product hypotheses, not market benchmarks.

Initial validation targets:

- a new user can understand the flagship workflow quickly
- a first test run can be completed without developer intervention
- failures are understandable and recoverable
- the same business outcome can be demonstrated repeatedly
- users can explain why they would use Atlas instead of stitching together existing tools

Measure before optimizing:

- onboarding completion
- time to first successful test run
- first production workflow completion
- weekly retained workspaces
- failed execution rate
- provider error rate
- manual support interventions
- template-to-custom-workflow conversion
- free-to-paid intent

## Definition of Done

The flagship workflow is not "done" until:

- graph authoring works
- graph validation works
- execution works
- provider connection works
- consent/policy checks work
- waits/resume work
- failures are visible
- replay is safe
- audit evidence exists
- analytics record the outcome
- the UI truthfully reflects every external dependency
