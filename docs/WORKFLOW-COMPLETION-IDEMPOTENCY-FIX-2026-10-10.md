# Durable workflow completion idempotency fix

Date: 2026-10-10

## Finding

`completeWorkflowStep()` checked whether an execution was terminal before checking whether the requested node/attempt had already completed. A duplicated completion callback arriving after the final step had successfully completed therefore threw a terminal-state error rather than returning the existing immutable execution.

## Change

The engine now verifies the execution checksum and validates the attempt, then recognizes an already-completed node/attempt before enforcing the mutable-state guard. New transitions remain forbidden after terminal state; only a verifiable duplicate completion returns the unchanged execution.

## Regression coverage

`packages/atlas-target/workflow-execution-engine.test.mjs` covers duplicate completion after terminal success and asserts object identity is unchanged. Existing non-terminal duplicate-completion coverage remains in place.

## Verification and limits

The regression test is committed to `fix/redis-worker-wakeup` and included in the standard Node test suite. GitHub Actions was observed running at the time of this update; no passing result is claimed until the workflow completes. This fix addresses control-plane idempotency and does not imply that every workflow node has a live provider handler.
