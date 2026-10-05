import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowGraph } from './index.mjs';
import {
  createWorkflowExecution,
  requestWorkflowApproval,
  approveWorkflowExecution,
  completeWorkflowStep,
  failWorkflowStep,
  cancelWorkflowExecution,
  replayWorkflowExecution
} from './workflow-execution-engine.mjs';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workflowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const executionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const stepRef = '11111111-1111-4111-8111-111111111111';

function graph() {
  return createWorkflowGraph({
    tenantId,
    id: workflowId,
    version: 7,
    name: 'Lead journey',
    nodes: [
      { id: 'start', type: 'trigger', config: { eventType: 'contact.created' } },
      { id: 'task', type: 'create_task', config: { taskTemplateRef: stepRef } },
      { id: 'stop', type: 'stop' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'task', port: 'next' },
      { id: 'e2', from: 'task', to: 'stop', port: 'next' }
    ]
  });
}

test('execution pins workflow version/checksum and starts at the trigger', () => {
  const state = createWorkflowExecution({
    tenantId,
    executionId,
    workflow: graph(),
    triggerEventRef: 'event_2026_0001',
    createdByActorId: '99999999-9999-4999-8999-999999999999'
  });

  assert.equal(state.status, 'queued');
  assert.equal(state.workflowVersion, 7);
  assert.equal(state.graphChecksum, graph().checksum);
  assert.equal(state.currentNodeId, 'start');
  assert.equal(state.steps.length, 0);
});

test('completed steps advance exactly once and preserve a reference-only result', () => {
  const first = createWorkflowExecution({
    tenantId,
    executionId,
    workflow: graph(),
    triggerEventRef: 'event_2026_0002',
    createdByActorId: '99999999-9999-4999-8999-999999999999'
  });

  const completed = completeWorkflowStep({
    execution: first,
    nodeId: 'start',
    attempt: 1,
    resultRef: { kind: 'workflow_event', id: 'event_2026_0002', version: 1 },
    now: '2026-10-05T10:00:00Z'
  });

  assert.equal(completed.status, 'queued');
  assert.equal(completed.currentNodeId, 'task');
  assert.equal(completed.steps.length, 1);
  assert.equal(completed.steps[0].status, 'completed');
  assert.deepEqual(completed.steps[0].resultRef, { kind: 'workflow_event', id: 'event_2026_0002', version: 1 });

  const duplicate = completeWorkflowStep({
    execution: completed,
    nodeId: 'start',
    attempt: 1,
    resultRef: { kind: 'workflow_event', id: 'event_2026_0002', version: 1 },
    now: '2026-10-05T10:00:01Z'
  });
  assert.strictEqual(duplicate, completed);
});

test('approval requests pause execution and approval resumes the exact node', () => {
  const first = createWorkflowExecution({
    tenantId,
    executionId,
    workflow: graph(),
    triggerEventRef: 'event_2026_0003',
    createdByActorId: '99999999-9999-4999-8999-999999999999'
  });
  const waiting = requestWorkflowApproval({
    execution: first,
    nodeId: 'task',
    requestedByActorId: '99999999-9999-4999-8999-999999999999',
    now: '2026-10-05T10:00:00Z',
    expiresAt: '2026-10-05T10:10:00Z'
  });

  assert.equal(waiting.status, 'waiting_approval');
  assert.equal(waiting.currentNodeId, 'task');
  assert.equal(waiting.approval.status, 'pending');

  const approved = approveWorkflowExecution({
    execution: waiting,
    approvalId: waiting.approval.approvalId,
    approvedByActorId: '88888888-8888-4888-8888-888888888888',
    now: '2026-10-05T10:05:00Z'
  });

  assert.equal(approved.status, 'queued');
  assert.equal(approved.currentNodeId, 'task');
  assert.equal(approved.approval.status, 'approved');
});

test('step failure retries within the pinned execution and dead-letters after the limit', () => {
  const first = createWorkflowExecution({
    tenantId,
    executionId,
    workflow: graph(),
    triggerEventRef: 'event_2026_0004',
    createdByActorId: '99999999-9999-4999-8999-999999999999'
  });
  const failed = failWorkflowStep({
    execution: first,
    nodeId: 'start',
    attempt: 1,
    errorCode: 'provider_timeout',
    now: '2026-10-05T10:00:00Z'
  });
  assert.equal(failed.status, 'retryable');
  assert.equal(failed.retryAt, '2026-10-05T10:00:00.500Z');

  const terminal = failWorkflowStep({
    execution: { ...failed, steps: failed.steps.map(step => ({ ...step, attempt: 3 })) },
    nodeId: 'start',
    attempt: 3,
    errorCode: 'provider_timeout',
    now: '2026-10-05T10:01:00Z'
  });
  assert.equal(terminal.status, 'dead_letter');
  assert.equal(terminal.lastErrorCode, 'provider_timeout');
});

test('cancellation is version-safe and terminal', () => {
  const first = createWorkflowExecution({
    tenantId,
    executionId,
    workflow: graph(),
    triggerEventRef: 'event_2026_0005',
    createdByActorId: '99999999-9999-4999-8999-999999999999'
  });
  const canceled = cancelWorkflowExecution({
    execution: first,
    requestedByActorId: '99999999-9999-4999-8999-999999999999',
    now: '2026-10-05T10:00:00Z'
  });
  assert.equal(canceled.status, 'canceled');
  assert.ok(canceled.endedAt);
  assert.throws(() => cancelWorkflowExecution({
    execution: canceled,
    requestedByActorId: '99999999-9999-4999-8999-999999999999'
  }), /terminal|canceled/i);
});

test('replay creates a new execution pinned to the original graph version', () => {
  const first = createWorkflowExecution({
    tenantId,
    executionId,
    workflow: graph(),
    triggerEventRef: 'event_2026_0006',
    createdByActorId: '99999999-9999-4999-8999-999999999999'
  });
  const failed = failWorkflowStep({
    execution: first,
    nodeId: 'start',
    attempt: 1,
    errorCode: 'provider_timeout',
    now: '2026-10-05T10:00:00Z'
  });
  const replay = replayWorkflowExecution({
    execution: failed,
    replayExecutionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    requestedByActorId: '99999999-9999-4999-8999-999999999999',
    now: '2026-10-05T10:05:00Z'
  });

  assert.equal(replay.executionId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal(replay.workflowVersion, first.workflowVersion);
  assert.equal(replay.graphChecksum, first.graphChecksum);
  assert.equal(replay.status, 'queued');
  assert.equal(replay.currentNodeId, 'start');
});
