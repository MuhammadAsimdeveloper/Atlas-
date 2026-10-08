# V157 P0 — Typed Outputs and Deterministic Workflow Errors

Date: 2026-10-07
Status: IMPLEMENTED — foundation slice

## Typed output contract

The workflow node schema registry now validates node outputs before they are treated as contractually valid.

For action nodes, output validation resolves the bound action from the same action registry used at graph construction and validates the returned value against that action's output schema.

The registry also exposes reference-safe output metadata:

- schema version
- validity
- SHA-256 output hash

Raw output is not included in the summary, keeping the execution contract compatible with Atlas redaction and reference-only persistence rules.

## Downstream schema propagation

Typed outputs now flow through the same graph contract used by downstream validation. When a node has a strict runtime input schema, graph construction verifies that each upstream output can satisfy its required fields and compatible types. Generic downstream inputs inherit the upstream output shape. Multiple upstream branches are merged conservatively: only common required fields and non-conflicting property schemas are retained.

Connector operations contribute their normalized input/output schemas through the tenant-scoped connector schema registry, so connector-backed output can participate in the same propagation checks without placing credentials in workflow definitions.

## Error taxonomy

packages/atlas-target/workflow-runtime-contracts.mjs adds deterministic error classification for:

- policy/approval/permission errors
- validation/schema errors
- timeout
- provider failures
- network failures
- rate limits
- quota failures
- credential failures
- cancellation

Each normalized error exposes only bounded contract metadata: code, category, retryable and externalOutcome.

Provider/network failures may be retryable in principle, but an unknown external outcome is not blindly retried by the durable workflow execution engine. failWorkflowStep() now records error category, external outcome and retryability and moves unknown outcomes into a durable reconciliation_required state.

resolveWorkflowReconciliation() provides an explicit, replay-safe operator resolution: confirmed_success returns the exact node to queued execution; confirmed_failure dead-letters the execution. This follows the parity-plan rule that unknown external outcomes must enter reconciliation rather than be hidden behind a green result or blindly replayed.

## TDD coverage

Tests cover:

- successful typed action output validation
- schema-invalid output rejection
- reference-safe output summary without raw output
- deterministic error classification
- provider errors marked retryable but unknown-outcome
- policy errors marked non-retryable
- provider_retry_unsafe marked non-retryable
- durable execution dead-lettering an unknown provider outcome instead of automatically retrying

## Explicit non-goals

P0 remains partial.

Still unfinished:

- strict schemas for every legacy workflow node
- strict schemas for every remaining legacy node
- execution-time worker validation of actual provider result payloads against persisted node schemas
- complete connector_action/provider-operation authorization and credential resolution
- reconciliation worker/queue integration for unknown external outcomes
- remaining credential, execution inspector and test/preview parity work
