import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSseBuffer } from './openai-compatible.mjs';
import { createModelAdapter, createModelRequest, invokeModelTurn } from '../../../packages/atlas-agent-fabric/model-runtime.mjs';

const TENANT='11111111-1111-4111-8111-111111111111';
const RELEASE={tenantId:TENANT,releaseId:'release_v148',version:1,modelPolicy:{provider:'test-model',timeoutMs:1000,maxOutputTokens:100,maxOutputChars:1000}};

test('OpenAI-compatible SSE splitting retains only the unterminated final line',()=>{
  const first=splitSseBuffer('data: {"a":1}\ndata: {"b":');
  assert.deepEqual(first.lines,['data: {"a":1}']);
  assert.equal(first.remainder,'data: {"b":');
  const second=splitSseBuffer(first.remainder+'}\\n');
  assert.deepEqual(second.lines,['data: {"b":}']);
  assert.equal(second.remainder,'');
});

test('model latency is measured from actual invocation start rather than caller timestamp',async()=>{
  const request=createModelRequest({tenantId:TENANT,agentRelease:RELEASE,sessionId:'session_v148',turnId:'turn_v148',promptHash:'a'.repeat(64),inputRef:'conversation_v148',now:Date.now()-60000});
  const adapter=createModelAdapter({provider:'test-model',infer:async()=>{await new Promise(resolve=>setTimeout(resolve,5));return {output:'ok',usage:{inputTokens:1,outputTokens:1}};}});
  const result=await invokeModelTurn({request,adapter,input:{prompt:'hello'},now:Date.now()-60000});
  assert.equal(result.status,'completed');
  assert.ok(result.redacted.latencyMs>=5);
  assert.ok(result.redacted.latencyMs<1000);
});
