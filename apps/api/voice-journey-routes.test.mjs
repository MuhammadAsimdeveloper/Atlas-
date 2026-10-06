import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createGrowthApi } from './growth-routes.mjs';
import { hashOpaqueToken, sessionCookieName } from './auth-contracts.mjs';

const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor='11111111-1111-4111-8111-111111111111';
const contact='22222222-2222-4222-8222-222222222222';
const conversation='33333333-3333-4333-8333-333333333333';
const workflow='44444444-4444-4444-8444-444444444444';
const appointment='55555555-5555-4555-8555-555555555555';
const voice='voice_session_v148_001';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const sha=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const voiceSession=(()=>{const body={id:voice,tenantId:tenant,contactRef:contact,conversationRef:conversation,direction:'outbound',providerConnectionRef:'twilio-connection-1',providerCallRef:'CA12345678',status:'completed',currentAgentRelease:{agentId:'66666666-6666-4666-8666-666666666666',releaseId:'agent-release-148',version:1,checksum:'a'.repeat(64)},appointmentRef:appointment,callOutcome:'appointment_booked',idempotencyKey:'b'.repeat(64),eventRefs:['voice-event-1'],events:[],agentReleaseChain:[],agentTransferCount:0,version:2,createdAt:'2026-10-06T07:59:00.000Z',updatedAt:'2026-10-06T08:00:00.000Z'};return {...body,checksum:sha(body)};})();

async function apiFixture() {
  const sessionToken='voice-api-session'; const csrf='voice-api-csrf';
  const session={tokenHash:hashOpaqueToken(sessionToken),csrfHash:hashOpaqueToken(csrf),expiresAt:new Date(Date.now()+600000),tenantId:tenant,user:{id:actor,email:'owner@example.test',displayName:'Owner',emailVerified:true,status:'active'},memberships:[{tenant_id:tenant,role_key:'owner',status:'active'}]};
  const authStore={async getSession({sessionHash}){return sessionHash===session.tokenHash?session:null;}};
  const stored=[];
  const store={async overview(){return{};}};
  const runtimeStore={async recordVoiceJourneyOutcome({tenantId,outcome}){stored.push({tenantId,outcome});return outcome.outcomeId;}};
  const env={NODE_ENV:'development',ATLAS_PLATFORM_OWNER_EMAIL:'owner@example.test',ATLAS_VOICE_JOURNEY_RECONCILIATION_ENABLED:'true'};
  const api=createGrowthApi({store,authStore,runtimeStore,env});
  const server=createServer(async(req,res)=>{if(!(await api.handle(req,res))){res.writeHead(404);res.end();}});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const headers={origin:base,cookie:`${sessionCookieName(env)}=${encodeURIComponent(sessionToken)}; atlas_csrf=${encodeURIComponent(csrf)}`,'x-atlas-csrf':csrf,'content-type':'application/json'};
  return {base,headers,stored,async close(){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}

test('V148 authenticated voice reconciliation persists a redacted workflow outcome', async()=>{
  const api=await apiFixture();
  try{
    const response=await fetch(api.base+'/api/v1/growth/voice/journey-outcomes/reconcile',{method:'POST',headers:api.headers,body:JSON.stringify({
      journeyId:'journey_v148_api_001',voiceSession,contactRef:contact,conversationRef:conversation,leadRef:null,appointmentRef:appointment,
      workflowId:workflow,workflowVersion:3,outcome:'appointment_booked',eventRef:'voice-outcome-api-001',handoffQueueRef:null,now:Date.parse('2026-10-06T08:00:00.000Z')
    })});
    assert.equal(response.status,201);
    const body=await response.json();
    assert.equal(body.outcome.status,'reconciled');
    assert.equal(body.outcome.workflowId,workflow);
    assert.equal(api.stored.length,1);
    assert.equal(api.stored[0].outcome.redacted,true);
    assert.equal('transcript' in api.stored[0].outcome,false);
  }finally{await api.close();}
});

test('V148 voice reconciliation is activation-gated', async()=>{
  const api=await apiFixture();
  try{
    api.headers.origin=api.base;
    const response=await fetch(api.base+'/api/v1/growth/voice/journey-outcomes/reconcile',{method:'POST',headers:api.headers,body:JSON.stringify({
      journeyId:'journey_v148_api_002',voiceSession,contactRef:contact,conversationRef:conversation,leadRef:null,appointmentRef:appointment,
      workflowId:workflow,workflowVersion:3,outcome:'appointment_booked',eventRef:'voice-outcome-api-002',handoffQueueRef:null,now:Date.parse('2026-10-06T08:00:00.000Z')
    })});
    assert.equal(response.status,201);
  }finally{await api.close();}
});
