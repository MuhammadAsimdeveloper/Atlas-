import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtlasAuthority } from '../atlas-core/authority.mjs';
import { hashAction } from '../atlas-platform/index.mjs';
import { atlasCopilotToolManifest, runAtlasCopilotTurn } from './index.mjs';

const ownerEmail = 'khan@example.test';
const tenantId = 'tenant-a';
const tenantAdmin = resolveAtlasAuthority({
  actor: { id: 'admin-a', authenticated: true, email: 'admin@example.test', emailVerified: true },
  tenantId,
  memberships: [{ id: 'membership-a', actorId: 'admin-a', tenantId, role: 'admin', status: 'active' }],
  ownerEmail
});
const tenantViewer = resolveAtlasAuthority({
  actor: { id: 'viewer-a', authenticated: true }, tenantId,
  memberships: [{ id: 'membership-v', actorId: 'viewer-a', tenantId, role: 'viewer', status: 'active' }], ownerEmail
});
const otherTenantOwner = resolveAtlasAuthority({
  actor: { id: 'owner-b', authenticated: true }, tenantId: 'tenant-b',
  memberships: [{ id: 'membership-b', actorId: 'owner-b', tenantId: 'tenant-b', role: 'owner', status: 'active' }], ownerEmail
});
const platformOwner = resolveAtlasAuthority({
  actor: { id: 'khan', authenticated: true, email: ownerEmail, emailVerified: true }, ownerEmail
});

const model = (...responses) => {
  const queue = [...responses];
  return { async generate() { return queue.shift(); } };
};
const toolCall = (name, args) => ({ type: 'tool_call', name, arguments: args });
const readTool = async () => ({ tenantId, count: 3 });

test('tenant roles receive only their scoped Copilot tools; platform owner gets global read tools only', () => {
  const admin = atlasCopilotToolManifest({ authority: tenantAdmin });
  assert.equal(admin.scope, 'tenant');
  assert.equal(admin.tenantId, tenantId);
  assert.ok(admin.tools.some(tool => tool.name === 'crm.task.create'));
  assert.ok(!admin.tools.some(tool => tool.name.startsWith('platform.')));

  const viewer = atlasCopilotToolManifest({ authority: tenantViewer });
  assert.ok(!viewer.tools.some(tool => tool.risk !== 'read'));
  assert.throws(() => atlasCopilotToolManifest({ authority: tenantAdmin, scope: { type: 'platform' } }), /platform-owner/);
  assert.throws(() => atlasCopilotToolManifest({ authority: { authenticated: true, globalRole: 'platform_owner' }, scope: { type: 'platform' } }), /platform-owner/);

  const global = atlasCopilotToolManifest({ authority: platformOwner, scope: { type: 'platform' } });
  assert.ok(global.tools.some(tool => tool.name === 'platform.security.audit.read'));
  assert.ok(global.tools.every(tool => tool.risk === 'read'));
  assert.ok(!global.tools.some(tool => tool.name.includes('.write') || tool.name.includes('.create')));
});

test('requested tenant cannot override authenticated membership and untrusted authority is rejected', () => {
  assert.throws(() => atlasCopilotToolManifest({ authority: otherTenantOwner, scope: { type: 'tenant', tenantId } }), /Tenant membership/);
  assert.throws(() => atlasCopilotToolManifest({ authority: { actorId: 'admin-a', tenantId, tenantRole: 'admin', authenticated: true } }), /Tenant membership/);
});

test('read adapter receives server-derived tenant scope and cannot return cross-tenant data', async () => {
  let received;
  const result = await runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-1', userMessage: 'How many contacts?',
    modelAdapter: model(toolCall('tenant.overview.read', {}), { type: 'final', text: 'There are three contacts.' }),
    toolExecutor: { async read(request) { received = request; return { tenantId, count: 3 }; } }
  });
  assert.equal(result.status, 'answered');
  assert.equal(received.tenantId, tenantId);
  assert.equal(received.scope, 'tenant');

  const blocked = await runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-2', userMessage: 'Read a case',
    modelAdapter: model(toolCall('support.case.read', { caseRef: 'case-1' })),
    toolExecutor: { async read() { return { tenantId: 'tenant-b', summary: 'private' }; } }
  });
  assert.equal(blocked.status, 'handoff');
  assert.equal(blocked.reason, 'tool_result_scope_invalid');
});

test('writes create tenant-bound pending approval proposals and never execute via the read executor', async () => {
  let directReads = 0;
  const saved = [];
  const result = await runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-3', userMessage: 'Add a follow-up task',
    modelAdapter: model(toolCall('crm.task.create', { contactRef: 'contact-1', title: 'Call back tomorrow' })),
    toolExecutor: { async read() { directReads++; throw new Error('write path must not use read adapter'); } },
    actionStore: { async createPending(action) {
      saved.push(action);
      return { tenantId: action.tenantId, actionId: action.id, status: action.status, idempotencyKey: action.idempotencyKey, actionHash: hashAction(action) };
    } }
  });
  assert.equal(result.status, 'needs_approval');
  assert.equal(result.action.status, 'pending_approval');
  assert.equal(saved[0].tenantId, tenantId);
  assert.equal(saved[0].tool, 'crm.task.create');
  assert.equal(directReads, 0);
});

test('workflow proposals validate against the trusted tenant and reject unapproved steps', async () => {
  const valid = await runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-4', userMessage: 'Create a follow-up workflow',
    modelAdapter: model(toolCall('automation.workflow.draft.create', {
      name: 'New lead follow-up', triggerType: 'contact.created', steps: [{ id: 'wait', type: 'wait', delayMs: 1000 }]
    })),
    actionStore: { async createPending(action) { return { tenantId, actionId: action.id, status: action.status, idempotencyKey: action.idempotencyKey, actionHash: hashAction(action) }; } }
  });
  assert.equal(valid.status, 'needs_approval');

  const invalid = await runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-5', userMessage: 'Create a workflow',
    modelAdapter: model(toolCall('automation.workflow.draft.create', {
      name: 'Unsafe workflow', triggerType: 'contact.created', steps: [{ id: 'bad', type: 'http_request', url: 'https://example.test' }]
    })),
    actionStore: { async createPending() { throw new Error('must not persist invalid workflow'); } }
  });
  assert.equal(invalid.reason, 'tool_arguments_invalid');
});

test('write retries reuse the same action id and binding hash for approval-store idempotency', async () => {
  const stored = new Map();
  const actionStore = { async createPending(action) {
    const existing = stored.get(action.idempotencyKey);
    if (existing) return existing;
    const row = { tenantId, actionId: action.id, status: action.status, idempotencyKey: action.idempotencyKey, actionHash: hashAction(action) };
    stored.set(action.idempotencyKey, row);
    return row;
  } };
  const run = () => runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'same-conversation', userMessage: 'Create a callback task', actionStore,
    modelAdapter: model(toolCall('crm.task.create', { contactRef: 'contact-2', title: 'Call back' }))
  });
  const first = await run();
  const second = await run();
  assert.equal(first.status, 'needs_approval');
  assert.equal(second.status, 'needs_approval');
  assert.equal(second.action.id, first.action.id);
  assert.equal(second.action.idempotencyKey, first.action.idempotencyKey);
});

test('sensitive arguments, untrusted context fields, and forged platform tool calls fail closed', async () => {
  const sensitive = await runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-6', userMessage: 'Update the contact',
    modelAdapter: model(toolCall('crm.contact.field.update', { contactRef: 'contact-1', fieldRef: 'email', value: 'alex@example.test' })),
    actionStore: { async createPending() { throw new Error('sensitive write must not be persisted'); } }
  });
  assert.equal(sensitive.reason, 'tool_arguments_invalid');

  await assert.rejects(() => runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-7', userMessage: 'Help',
    serverContext: { tenantId: 'tenant-b' }, modelAdapter: model({ type: 'final', text: 'No' })
  }), /restricted field/);

  const globalTool = await runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-8', userMessage: 'Show global platform state',
    modelAdapter: model(toolCall('platform.overview.read', { periodDays: 7 })), toolExecutor: { read: readTool }
  });
  assert.equal(globalTool.reason, 'tool_unavailable_or_unauthorized');
});

test('model timeout and cancellation are bounded even when an adapter ignores AbortSignal', async () => {
  const stalledModel = { generate: () => new Promise(() => {}) };
  const timedOut = await runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-9', userMessage: 'Help', modelAdapter: stalledModel, timeoutMs: 100
  });
  assert.equal(timedOut.reason, 'model_timeout');

  const controller = new AbortController();
  const pending = runAtlasCopilotTurn({
    authority: tenantAdmin, conversationId: 'conversation-10', userMessage: 'Help', modelAdapter: stalledModel, timeoutMs: 5000, signal: controller.signal
  });
  setTimeout(() => controller.abort(), 10);
  const canceled = await pending;
  assert.equal(canceled.reason, 'request_canceled');
});
