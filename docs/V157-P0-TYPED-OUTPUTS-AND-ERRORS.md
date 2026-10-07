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

Provider/network failures may be retryable in principle, but an unknown external outcome is not blindly retried by the durable workflow execution engine. failWorkflowStep() now records error category, external outcome and retryability and only schedules automatic retry when the outcome is known.

This follows the parity-plan rule that unknown external outcomes must enter reconciliation rather than be hidden behind a green result or blindly replayed.

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
- connector-derived input/output schemas
- automatic output-shape propagation from one node into the next node's input schema
- complete connector_action/provider operation binding
- durable reconciliation worker/state for unknown external outcomes
- remaining credential, execution inspector and test/preview parity work
