import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowGraph } from './index.mjs';
import { simulateWorkflow } from './workflow-simulator.mjs';

const tenantId = 'tenant-alpha';
const contactRef = '11111111-1111-4111-8111-111111111111';
const taskTemplateRef = '22222222-2222-4222-8222-222222222222';

function graphFor(...nodes) {
  const ids = nodes.map(node => node.id);
  const edges = [];
  for (let index = 0; index < ids.length - 1; index += 1) edges.push({ from: ids[index], to: ids[index + 1] });
  return createWorkflowGraph({
    tenantId,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Lead to Booking Preview',
    nodes,
    edges
  });
}

test('preview executes a native workflow without external side effects', () => {
  const graph = graphFor(
    { id: 'start', type: 'trigger', config: { eventType: 'contact.created' } },
    { id: 'format', type: 'transform', config: { mapping: { greeting: 'event.firstName' } } },
    { id: 'stop', type: 'stop' }
  );

  const result = simulateWorkflow({
    graph,
    tenantId,
    executionId: 'exec-preview-1',
    event: { type: 'contact.created', firstName: 'Asim' },
    now: Date.parse('2026-10-05T09:00:00Z')
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.steps.map(step => step.status).join(','), 'completed,completed,completed');
  assert.equal(result.steps[1].output.greeting, 'Asim');
  assert.equal(result.externalSideEffects, 0);
});

test('preview simulates connector work and records the dependency honestly', () => {
  const graph = graphFor(
    { id: 'start', type: 'trigger', config: { eventType: 'contact.created' } },
    { id: 'task', type: 'create_task', config: { taskTemplateRef } },
    { id: 'stop', type: 'stop' }
  );

  const result = simulateWorkflow({
    graph,
    tenantId,
    executionId: 'exec-preview-2',
    event: { type: 'contact.created', contactId: contactRef },
    now: Date.parse('2026-10-05T09:00:00Z')
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.externalSideEffects, 0);
  assert.equal(result.steps[1].status, 'simulated');
  assert.equal(result.steps[1].dependency, 'connector');
  assert.match(result.steps[1].reason, /preview mode/i);
});

test('approval nodes pause the preview and do not execute following nodes', () => {
  const graph = graphFor(
    { id: 'start', type: 'trigger', config: { eventType: 'contact.created' } },
    { id: 'approval', type: 'approval' },
    { id: 'after', type: 'create_task', config: { taskTemplateRef } },
    { id: 'stop', type: 'stop' }
  );

  const result = simulateWorkflow({
    graph,
    tenantId,
    executionId: 'exec-preview-3',
    event: { type: 'contact.created', contactId: contactRef },
    now: Date.parse('2026-10-05T09:00:00Z')
  });

  assert.equal(result.status, 'needs_approval');
  assert.equal(result.steps.at(-1).status, 'needs_approval');
  assert.deepEqual(result.steps.map(step => step.nodeId), ['start', 'approval']);
});

test('approval can be pre-authorized for a test run without enabling provider side effects', () => {
  const graph = graphFor(
    { id: 'start', type: 'trigger', config: { eventType: 'contact.created' } },
    { id: 'approval', type: 'approval' },
    { id: 'task', type: 'create_task', config: { taskTemplateRef } },
    { id: 'stop', type: 'stop' }
  );

  const result = simulateWorkflow({
    graph,
    tenantId,
    executionId: 'exec-preview-4',
    event: { type: 'contact.created', contactId: contactRef },
    approvedNodeIds: ['approval'],
    now: Date.parse('2026-10-05T09:00:00Z')
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.steps[1].status, 'completed');
  assert.equal(result.steps[2].status, 'simulated');
  assert.equal(result.externalSideEffects, 0);
});

test('preview rejects cross-tenant execution before traversing the graph', () => {
  const graph = graphFor(
    { id: 'start', type: 'trigger', config: { eventType: 'contact.created' } },
    { id: 'stop', type: 'stop' }
  );

  assert.throws(
    () => simulateWorkflow({
      graph,
      tenantId: 'tenant-beta',
      executionId: 'exec-preview-5',
      event: { type: 'contact.created' }
    }),
    /tenant|checksum/i
  );
});
