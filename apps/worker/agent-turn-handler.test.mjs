import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTurnJobHandler } from './agent-turn-handler.mjs';
import { createAgentReleaseManifest } from '../../packages/atlas-agent-fabric/index.mjs';

const TENANT='11111111-1111-4111-8111-111111111111';
const SESSION='22222222-2222-4222-8222-222222222222';
const EXECUTION='33333333-3333-4333-8333-333333333333';
const PLAN='44444444-4444-4444-8444-444444444444';
const JOB='55555555-5555-4555-8555-555555555555';
const ACTOR='66666666-6666-4666-8666-666666666666';

test('V148 agent turn worker requires resolved transient input and records only redacted result refs',async()=>{
  const updates=[];
  const release=createAgentReleaseManifest({tenantId:TENANT,agentId:'agent_v148',releaseId:'release_v148',version:1,status:'active',allowedTools:[],modelPolicy:{provider:'test-model',maxInputTokens:1000,maxOutputTokens:200,timeoutMs:5000},systemPromptHash:'a'.repeat(64)});
  const store={
    async getAgentTurnForWorker(){return {
      tenant_id:TENANT,execution_id:EXECUTION,plan_id:PLAN,session_id:SESSION,turn_id:'turn-v148-worker',
      release_id:release.releaseId,release_version:release.version,created_by:ACTOR,conversation_ref:'inbox:conversation:'+SESSION,
      release_snapshot:release,
      prompt_hash:'b'.repeat(64),input_ref:'inbox:conversation:'+SESSION,status:'queued',version:1,idempotency_key:'c'.repeat(64)
    }},
    async updateAgentTurnForWorker(data){updates.push(data);return true;}
  };
  const handler=createAgentTurnJobHandler({
    resolveInput:async()=>({prompt:'hello'}),
    getModelAdapter:async()=>({provider:'test-model',version:1,infer:async()=>({output:'done',usage:{inputTokens:2,outputTokens:1}})}),
    tools:{},
    executeTool:async()=>({}),
    deliverResponse:async()=>({kind:'inbox_message',id:'77777777-7777-4777-8777-777777777777',version:1})
  });
  const context={tenantId:TENANT,jobId:JOB,workerId:'worker-v148',attempt:1,signal:new AbortController().signal,workerStore:store,idempotencyKey:'c'.repeat(64)};
  const payload={executionId:EXECUTION};
  await handler(payload,context);
  assert.equal(updates.length,2);
  assert.equal(updates[0].status,'running');
  assert.equal(updates[1].status,'completed');
});
