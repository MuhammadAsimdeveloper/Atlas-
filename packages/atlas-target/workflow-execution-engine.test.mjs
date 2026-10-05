import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowGraph } from './index.mjs';
import {
  createWorkflowExecution,
  requestWorkflowApproval,
  approveWorkflowExecution,
  completeWorkflowStep,
  resumeWorkflowExecution,
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
    workflow: createWorkflowGraph({
      tenantId,
      id: workflowId,
      version: 7,
      name: 'Lead journey',
      nodes: [
        { id: 'start', type: 'trigger', config: { eventType: 'contact.created' } },
        { id: 'task', type: 'delete_contact', config: { contactRef: stepRef } },
        { id: 'stop', type: 'stop' }
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'task', port: 'next' },
        { id: 'e2', from: 'task', to: 'stop', port: 'next' }
      ]
    }),
    triggerEventRef: 'event_2026_0003',
    createdByActorId: '99999999-9999-4999-8999-999999999999'
  });
  const advanced = completeWorkflowStep({
    execution: first,
    nodeId: 'start',
    attempt: 1,
    now: '2026-10-05T10:00:00Z'
  });
  const waiting = requestWorkflowApproval({
    execution: advanced,
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

  const failedAgain = failWorkflowStep({
    execution: failed,
    nodeId: 'start',
    attempt: 2,
    errorCode: 'provider_timeout',
    now: '2026-10-05T10:00:01Z'
  });
  assert.equal(failedAgain.status, 'retryable');

  const terminal = failWorkflowStep({
    execution: failedAgain,
    nodeId: 'start',
    attempt: 3,
    errorCode: 'provider_timeout',
    now: '2026-10-05T10:00:02Z'
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


test('workflow result references reject direct email or URL destinations', () => {
  const workflow = graph();
  const execution = createWorkflowExecution({
    tenantId,
    executionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    workflow,
    triggerEventRef: 'event_2026_0007',
    createdByActorId: '99999999-9999-4999-8999-999999999999'
  });
  assert.throws(() => completeWorkflowStep({
    execution,
    nodeId: 'start',
    resultRef: { kind: 'provider', id: 'person@example.com' },
    now: '2026-10-05T10:00:00Z'
  }), /opaque reference/i);
  assert.throws(() => completeWorkflowStep({
    execution,
    nodeId: 'start',
    resultRef: { kind: 'provider', id: 'https://example.com' },
    now: '2026-10-05T10:00:00Z'
  }), /opaque reference/i);
});


test('delay and wait nodes pause execution with a bounded resume time', () => {
  const now = Date.parse('2026-10-05T10:00:00.000Z');
  const graph = workflow({
    nodes: [
      { id: 'trigger', type: 'trigger', name: 'Lead created', config: { eventType: 'lead.created' } },
      { id: 'wait', type: 'delay', name: 'Wait one minute', config: { delayMs: 60_000 } },
      { id: 'stop', type: 'stop', name: 'Done', config: {} }
    ],
    edges: [
      { id: 'e1', from: 'trigger', to: 'wait', port: 'next' },
      { id: 'e2', from: 'wait', to: 'stop', port: 'next' }
    ]
  });
  let execution = createWorkflowExecution({ tenantId, executionId, workflow: graph, triggerEventRef: 'event_1', createdByActorId: actorId, now });
  execution = completeWorkflowStep({ execution, nodeId: 'trigger', now });
  execution = startWorkflowStep(execution, { nodeId: 'wait', now });
  execution = completeWorkflowStep({ execution, nodeId: 'wait', now });
  assert.equal(execution.status, 'waiting');
  assert.equal(execution.currentNodeId, 'wait');
  assert.equal(execution.resumeAt, '2026-10-05T10:01:00.000Z');
  const before = resumeWorkflowExecution({ execution, now: now + 59_999 });
  assert.equal(before, execution);
  const resumed = resumeWorkflowExecution({ execution, now: now + 60_000 });
  assert.equal(resumed.status, 'queued');
  assert.equal(resumed.currentNodeId, 'stop');
  assert.equal(resumed.resumeAt, null);
});

test('wait-until nodes reject unbounded or past resume times', () => {
  const now = Date.parse('2026-10-05T10:00:00.000Z');
  const graph = workflow({
    nodes: [
      { id: 'trigger', type: 'trigger', name: 'Lead created', config: { eventType: 'lead.created' } },
      { id: 'wait', type: 'wait_until', name: 'Wait', config: { resumeAt: '2026-10-05T10:05:00.000Z' } },
      { id: 'stop', type: 'stop', name: 'Done', config: {} }
    ],
    edges: [{ id: 'e1', from: 'trigger', to: 'wait', port: 'next' }, { id: 'e2', from: 'wait', to: 'stop', port: 'next' }]
  });
  let execution = createWorkflowExecution({ tenantId, executionId: crypto.randomUUID(), workflow: graph, triggerEventRef: 'event_2', createdByActorId: actorId, now });
  execution = completeWorkflowStep({ execution, nodeId: 'trigger', now });
  execution = startWorkflowStep(execution, { nodeId: 'wait', now });
  execution = completeWorkflowStep({ execution, nodeId: 'wait', now });
  assert.equal(execution.resumeAt, '2026-10-05T10:05:00.000Z');
  assert.throws(() => resumeWorkflowExecution({ execution, now: now + 5 * 60_000 - 1 }), /not ready/);
});
