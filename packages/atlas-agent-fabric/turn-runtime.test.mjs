import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createModelAdapter,
  createModelRequest,
  invokeModelTurn
} from './model-runtime.mjs';
import {
  runAgentTurn
} from './turn-runtime.mjs';
import {
  createAgentRuntimePolicy,
  defineAgentTool,
  createAgentSession
} from '../atlas-target/index.mjs';
import { createAgentReleaseManifest } from './index.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const AGENT = '44444444-4444-4444-8444-444444444444';
const RELEASE = '55555555-5555-4555-8555-555555555555';
const SESSION_CONVERSATION = '88888888-8888-4888-8888-888888888888';
const NOW = Date.parse('2026-10-06T08:00:00.000Z');

function release() {
  return createAgentReleaseManifest({
    tenantId: TENANT,
    agentId: AGENT,
    releaseId: RELEASE,
    version: 7,
    status: 'active',
    allowedTools: ['crm.search'],
    modelPolicy: { provider: 'test-model', maxInputTokens: 2000, maxOutputTokens: 500, timeoutMs: 5000 },
    systemPromptHash: 'd'.repeat(64)
  });
}

function session() {
  const runtime = createAgentRuntimePolicy({
    tenantId: TENANT,
    agentId: AGENT,
    releaseId: RELEASE,
    allowedTools: ['crm.search'],
    maxTurns: 3,
    maxToolCalls: 2,
    maxExecutionMs: 30_000
  });
  return createAgentSession({
    runtime,
    tenantId: TENANT,
    conversationId: SESSION_CONVERSATION,
    actorId: ACTOR,
    now: NOW,
    leaseMs: 30_000
  });
}

test('V148 request is reference/hash based and never accepts durable raw prompt state', () => {
  const req = createModelRequest({
    tenantId: TENANT,
    agentRelease: release(),
    sessionId: session().id,
    turnId: 'turn_v148_001',
    promptHash: 'e'.repeat(64),
    inputRef: 'inbox:conversation:88888888-8888-4888-8888-888888888888',
    responseMode: 'text',
    now: NOW
  });
  assert.equal(req.rawPromptStored, false);
  assert.equal(req.promptHash, 'e'.repeat(64));
  assert.equal(req.releaseId, RELEASE);
  assert.throws(() => createModelRequest({
    tenantId: TENANT,
    agentRelease: release(),
    sessionId: session().id,
    turnId: 'turn_v148_002',
    promptHash: 'e'.repeat(64),
    inputRef: 'inbox:conversation:88888888-8888-4888-8888-888888888888',
    prompt: 'secret customer text',
    now: NOW
  }), /prompt|customer/i);
});

test('V148 model adapter enforces provider contract, timeout and redacted result metadata', async () => {
  const adapter = createModelAdapter({
    provider: 'test-model',
    infer: async ({ input }) => ({ output: { answer: String(input.prompt).toUpperCase() }, finishReason: 'stop', usage: { inputTokens: 4, outputTokens: 2 } })
  });
  const req = createModelRequest({
    tenantId: TENANT,
    agentRelease: release(),
    sessionId: session().id,
    turnId: 'turn_v148_003',
    promptHash: 'e'.repeat(64),
    inputRef: 'inbox:conversation:88888888-8888-4888-8888-888888888888',
    responseMode: 'structured',
    outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
    now: NOW
  });
  const result = await invokeModelTurn({
    request: req,
    adapter,
    input: { prompt: 'hello' },
    now: NOW
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.output, { answer: 'HELLO' });
  assert.equal(result.redacted.rawOutputStored, false);
  assert.equal(result.redacted.provider, 'test-model');
  assert.equal(result.redacted.inputHash.length, 64);
});

test('V148 agent loop executes allowed read tools, pauses on writes, and never stores content', async () => {
  let calls = 0;
  const adapter = createModelAdapter({
    provider: 'test-model',
    infer: async ({ input }) => {
      calls += 1;
      if (calls === 1) return { toolCalls: [{ name: 'crm.search', arguments: { query: input.prompt } }] };
      return { output: { status: 'done' }, finishReason: 'stop' };
    }
  });
  const crmTool = defineAgentTool({
    name: 'crm.search',
    risk: 'read',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  });
  const result = await runAgentTurn({
    tenantId: TENANT,
    actorId: ACTOR,
    release: release(),
    session: session(),
    turnId: 'turn_v148_004',
    promptHash: 'e'.repeat(64),
    runtimeInput: { prompt: 'find the contact' },
    outputSchema: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] },
    adapter,
    tools: { 'crm.search': crmTool },
    executeTool: async (_tool, args) => ({ matched: args.query.length }),
    now: NOW
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.output, { status: 'done' });
  assert.equal(result.redacted.rawPromptStored, false);
  assert.equal(result.redacted.transcriptStored, false);
  assert.equal(calls, 2);
});

test('V148 agent loop fails closed on cross-tenant release/session and approval-required tool calls', async () => {
  const writeTool = defineAgentTool({ name: 'crm.search', risk: 'write' });
  const adapter = createModelAdapter({
    provider: 'test-model',
    infer: async () => ({ toolCalls: [{ name: 'crm.search', arguments: { query: 'x' } }] })
  });
  const base = {
    tenantId: TENANT,
    actorId: ACTOR,
    release: release(),
    session: session(),
    turnId: 'turn_v148_005',
    promptHash: 'e'.repeat(64),
    runtimeInput: { prompt: 'do it' },
    adapter,
    tools: { 'crm.search': writeTool },
    executeTool: async () => ({ ok: true }),
    now: NOW
  };
  const blocked = await runAgentTurn(base);
  assert.equal(blocked.status, 'needs_approval');
  assert.equal(blocked.redacted.reason, 'TOOL_APPROVAL_REQUIRED');
  assert.equal(blocked.redacted.rawPromptStored, false);

  const foreignRelease = createAgentReleaseManifest({
    ...release(),
    tenantId: '22222222-2222-4222-8222-222222222222'
  });
  await assert.rejects(runAgentTurn({ ...base, turnId: 'turn_v148_006', release: foreignRelease }), /tenant|release/i);
});

test('V148 streaming adapter exposes transient deltas but redacts them from durable result', async () => {
  const deltas = [];
  const adapter = createModelAdapter({
    provider: 'test-model',
    stream: async function* () {
      yield { delta: 'Hel' };
      yield { delta: 'lo' };
      yield { done: true, finishReason: 'stop' };
    }
  });
  const req = createModelRequest({
    tenantId: TENANT,
    agentRelease: release(),
    sessionId: session().id,
    turnId: 'turn_v148_007',
    promptHash: 'e'.repeat(64),
    inputRef: 'inbox:conversation:88888888-8888-4888-8888-888888888888',
    responseMode: 'text',
    now: NOW
  });
  const result = await invokeModelTurn({
    request: req,
    adapter,
    input: { prompt: 'hello' },
    onDelta: delta => deltas.push(delta),
    now: NOW
  });
  assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Hello');
  assert.equal(result.redacted.transcriptStored, false);
});
