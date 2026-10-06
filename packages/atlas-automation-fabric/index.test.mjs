import test from 'node:test';
import assert from 'node:assert/strict';
import {
  N8N_PARITY_FEATURES,
  HARDENED_NODE_ADDONS,
  createAutomationPolicy,
  validateAutomationNode,
  createApprovalRequest,
  decideApproval,
  filterExecutions,
  planExecutionRetry,
  createWorkflowEnvironment,
  planEnvironmentPromotion,
  createWorkflowTemplate,
  instantiateWorkflowTemplate,
  createMcpServerManifest,
  authorizeMcpToolCall,
  createAiWorkflowProposal,
  auditWorkflowSecurity
} from './index.mjs';
import { WORKFLOW_NODE_CATALOG } from '../atlas-target/workflow-catalog.mjs';
import { createWorkflowGraph } from '../atlas-target/index.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const OTHER = '22222222-2222-4222-8222-222222222222';
const WORKFLOW = '44444444-4444-4444-8444-444444444444';
const EXECUTION = '55555555-5555-4555-8555-555555555555';
const NODE = '66666666-6666-4666-8666-666666666666';

test('V146 n8n parity catalog covers hardened core workflow concepts without enabling unsafe shell execution', () => {
  assert.ok(N8N_PARITY_FEATURES.includes('sub_workflow'));
  assert.ok(N8N_PARITY_FEATURES.includes('loop_over_items'));
  assert.ok(N8N_PARITY_FEATURES.includes('wait'));
  assert.ok(N8N_PARITY_FEATURES.includes('error_trigger'));
  assert.ok(N8N_PARITY_FEATURES.includes('execution_filters'));
  assert.ok(N8N_PARITY_FEATURES.includes('ai_workflow_builder'));
  assert.ok(N8N_PARITY_FEATURES.includes('mcp'));
  assert.equal(HARDENED_NODE_ADDONS.some(node => node.type === 'execute_command'), false);
  for (const type of ['loop_over_items','aggregate','remove_duplicates','sort','split_out','respond_to_webhook','error_trigger','stop_and_error','no_op','data_table','execution_data','mcp_client','mcp_server_trigger']) assert.ok(WORKFLOW_NODE_CATALOG[type], 'missing hardened workflow node: ' + type);
});

test('V146 policy bounds concurrency, retries, loops, timeout and execution data retention', () => {
  const policy = createAutomationPolicy({
    tenantId: TENANT,
    environmentId: '77777777-7777-4777-8777-777777777777',
    maxSteps: 500,
    maxConcurrency: 8,
    maxLoopItems: 1000,
    maxRetries: 4,
    timeoutMs: 120000,
    executionRetentionDays: 30,
    saveExecutionData: 'redacted'
  });
  assert.equal(policy.maxConcurrency, 8);
  assert.equal(policy.saveExecutionData, 'redacted');
  assert.throws(() => createAutomationPolicy({ tenantId: TENANT, environmentId: policy.environmentId, maxSteps: 501 }), /maxSteps/i);
  assert.throws(() => createAutomationPolicy({ tenantId: TENANT, environmentId: policy.environmentId, maxConcurrency: 0 }), /maxConcurrency/i);
});

test('V146 rejects direct network targets, secrets, shell execution and unbounded code', () => {
  assert.throws(() => validateAutomationNode({
    tenantId: TENANT,
    node: { id: NODE, type: 'http_request', config: { url: 'https://example.com/internal' } }
  }), /direct|network|url/i);

  assert.throws(() => validateAutomationNode({
    tenantId: TENANT,
    node: { id: NODE, type: 'http_request', config: { connectionRef: '99999999-9999-4999-8999-999999999999', headers: { authorization: 'secret_token' } } }
  }), /secret|authorization/i);

  assert.throws(() => validateAutomationNode({
    tenantId: TENANT,
    node: { id: NODE, type: 'code_transform', config: { code: 'require("child_process").exec("id")' } }
  }), /code|execution|unsupported/i);
});

test('V146 approval requests are exact, expiring and requester/approver separated', () => {
  const request = createApprovalRequest({
    tenantId: TENANT,
    workflowId: WORKFLOW,
    executionId: EXECUTION,
    nodeId: NODE,
    requestedByActorId: ACTOR,
    actionKey: 'publish_social_post',
    argumentsHash: 'a'.repeat(64),
    expiresAt: '2026-10-06T08:00:00.000Z'
  });
  assert.equal(decideApproval({ request, tenantId: OTHER, approvedByActorId: '77777777-7777-4777-8777-777777777777', decision: 'approved', now: Date.parse('2026-10-06T07:00:00.000Z') }).status, 'denied');
  assert.equal(decideApproval({ request, tenantId: TENANT, approvedByActorId: ACTOR, decision: 'approved', now: Date.parse('2026-10-06T07:00:00.000Z') }).status, 'denied');
  const approved = decideApproval({
    request,
    tenantId: TENANT,
    approvedByActorId: '77777777-7777-4777-8777-777777777777',
    decision: 'approved',
    now: Date.parse('2026-10-06T07:00:00.000Z')
  });
  assert.equal(approved.status, 'approved');
});

test('V146 execution filtering supports n8n-style operational triage without exposing payload bodies', () => {
  const items = [
    { id: '1', workflowId: WORKFLOW, tenantId: TENANT, status: 'failed', startedAt: '2026-10-06T06:00:00.000Z', customData: { source: 'crm' }, payload: { body: 'secret' } },
    { id: '2', workflowId: WORKFLOW, tenantId: TENANT, status: 'waiting', startedAt: '2026-10-06T06:10:00.000Z', customData: { source: 'crm' }, payload: { body: 'secret' } },
    { id: '3', workflowId: OTHER, tenantId: OTHER, status: 'success', startedAt: '2026-10-06T06:20:00.000Z', customData: { source: 'other' } }
  ];
  const result = filterExecutions({ tenantId: TENANT, executions: items, workflowId: WORKFLOW, statuses: ['failed','waiting'], customData: { source: 'crm' } });
  assert.deepEqual(result.map(item => item.id), ['1','2']);
  assert.equal('payload' in result[0], false);
});

test('V146 retry planner reuses one side-effect key and blocks unsafe retries', () => {
  const plan = planExecutionRetry({
    tenantId: TENANT,
    workflowId: WORKFLOW,
    workflowVersion: 3,
    executionId: EXECUTION,
    nodeId: NODE,
    attempt: 2,
    maxAttempts: 4,
    retrySafe: true,
    backoffMs: 500
  });
  assert.equal(plan.status, 'retryable');
  assert.equal(plan.idempotencyKey.length, 64);
  assert.throws(() => planExecutionRetry({
    tenantId: TENANT, workflowId: WORKFLOW, workflowVersion: 3, executionId: EXECUTION, nodeId: NODE,
    attempt: 2, maxAttempts: 4, retrySafe: false
  }), /unsafe|retry/i);
});

test('V146 source-control environments use protected production and manifest-bound promotion', () => {
  const dev = createWorkflowEnvironment({ tenantId: TENANT, id: '88888888-8888-4888-8888-888888888888', name: 'Development', stage: 'development', protected: false, branchRef: 'development' });
  const prod = createWorkflowEnvironment({ tenantId: TENANT, id: '99999999-9999-4999-8999-999999999999', name: 'Production', stage: 'production', protected: true, branchRef: 'production' });
  assert.equal(prod.protected, true);
  const promotion = planEnvironmentPromotion({ tenantId: TENANT, source: dev, target: prod, workflowId: WORKFLOW, workflowVersion: 3, manifestSha256: 'a'.repeat(64), approvedByActorId: ACTOR, sourceChangedAfterApproval: false });
  assert.equal(promotion.status, 'blocked');
  const approved = planEnvironmentPromotion({ tenantId: TENANT, source: dev, target: prod, workflowId: WORKFLOW, workflowVersion: 3, manifestSha256: 'a'.repeat(64), approvedByActorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sourceChangedAfterApproval: false });
  assert.equal(approved.status, 'ready');
});

test('V146 workflow templates are tenant-scoped, versioned and scrub customer refs before instantiation', () => {
  const template = createWorkflowTemplate({
    tenantId: TENANT,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Lead nurture',
    version: 2,
    graph: { nodes: [{ id: 't1', type: 'trigger', config: { eventType: 'form.submitted' } }, { id: 't2', type: 'create_contact', config: { contactRef: 'CUSTOMER_REF_PLACEHOLDER' } }], edges: [{ id: 'e1', from: 't1', to: 't2', port: 'next' }] }
  });
  const instance = instantiateWorkflowTemplate({ template, tenantId: TENANT, workflowId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', substitutions: { CUSTOMER_REF_PLACEHOLDER: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } });
  assert.equal(instance.templateVersion, 2);
  assert.equal(instance.tenantId, TENANT);
  assert.equal(instance.substitutionCount, 1);
  assert.notEqual(instance.manifestSha256, 'CUSTOMER_REF_PLACEHOLDER');
  assert.throws(() => instantiateWorkflowTemplate({ template, tenantId: OTHER, workflowId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', substitutions: {} }), /tenant/i);
});

test('V146 MCP tools are capability-scoped and never expose secrets or raw payloads', () => {
  const manifest = createMcpServerManifest({
    tenantId: TENANT,
    serverId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    tools: [
      { name: 'search_contacts', risk: 'read', capability: 'crm.read' },
      { name: 'send_message', risk: 'network', capability: 'communications.send' }
    ]
  });
  const allowed = authorizeMcpToolCall({ manifest, tenantId: TENANT, toolName: 'search_contacts', actorCapabilities: ['crm.read'], argumentsValue: { query: 'lead' } });
  assert.equal(allowed.allowed, true);
  const denied = authorizeMcpToolCall({ manifest, tenantId: TENANT, toolName: 'send_message', actorCapabilities: ['crm.read'], argumentsValue: { body: 'secret' } });
  assert.equal(denied.allowed, false);
  assert.throws(() => createMcpServerManifest({ tenantId: TENANT, serverId: manifest.serverId, tools: [{ name: 'dump_secret', risk: 'read', capability: 'secrets.read' }] }), /secret|forbidden/i);
});

test('V146 AI workflow builder emits a safe proposal, never directly mutates a production graph', () => {
  const proposal = createAiWorkflowProposal({
    tenantId: TENANT,
    requestedByActorId: ACTOR,
    prompt: 'When a lead form submits, qualify the lead, wait for approval, then send a follow-up.',
    candidateNodes: ['trigger', 'invoke_agent', 'approval', 'send_message']
  });
  assert.equal(proposal.status, 'proposal_only');
  assert.equal(proposal.requiresHumanReview, true);
  assert.equal(proposal.writeMode, 'draft_only');
  assert.equal(proposal.selectedNodes.length, 4);
  assert.equal(proposal.promptHash.length, 64);
});

test('V146 workflow security audit catches risky nodes and unprotected inbound triggers', () => {
  const report = auditWorkflowSecurity({
    tenantId: TENANT,
    workflow: {
      id: WORKFLOW,
      version: 1,
      nodes: [
        { id: 't', type: 'trigger', config: { eventType: 'webhook.received' }, category: 'orchestration', risk: 'read', guard: 'verified-adapter-required' },
        { id: 'h', type: 'http_request', config: { url: 'https://example.com' }, category: 'integrations', risk: 'network', guard: 'none' },
        { id: 'd', type: 'charge_payment', config: {}, category: 'finance', risk: 'financial', requiresApproval: true }
      ]
    }
  });
  assert.equal(report.status, 'blocked');
  assert.ok(report.findings.some(finding => /url|network/i.test(finding.code)));
  assert.ok(report.findings.some(finding => /approval|financial/i.test(finding.code)));
});
