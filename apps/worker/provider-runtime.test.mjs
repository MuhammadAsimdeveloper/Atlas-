import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderRuntime} from './provider-runtime.mjs';

const tenantId='11111111-1111-4111-8111-111111111111';
const connectionId='22222222-2222-4222-8222-222222222222';
const job={tenant_id:tenantId,job_id:'33333333-3333-4333-8333-333333333333'};
const context={workerId:'worker-1',idempotencyKey:'a'.repeat(64),signal:undefined};

function store(connection){return {getProviderConnectionForWorker:async()=>connection};}
const fetchImpl=async(url,opts)=>({ok:true,status:200,text:async()=>JSON.stringify({MessageID:'m1',sid:'s1',messages:[{id:'w1'}]}),json:async()=>({sid:'s1',messages:[{id:'w1'}]}),headers:new Headers()});

test('dispatches only verified tenant-owned Postmark connection',async()=>{
 const runtime=createProviderRuntime({connectionStore:store({tenant_id:tenantId,connection_id:connectionId,provider_key:'postmark.email',channel:'email',status:'verified',credential_ref:'kms/postmark',metadata:{from:'a@example.com'}}),secretResolver:async()=> 'secret-ref',fetchImpl});
 const r=await runtime.execute({job,context,node:{config:{capabilityId:'communication.email',connectionRef:connectionId,to:'b@example.com',subject:'x',textBody:'hello'}}});
 assert.equal(r.providerRef,'m1');
});
test('fails closed on unverified connection',async()=>{
 const runtime=createProviderRuntime({connectionStore:store({tenant_id:tenantId,connection_id:connectionId,provider_key:'postmark.email',channel:'email',status:'draft',credential_ref:'kms/postmark',metadata:{from:'a@example.com'}}),secretResolver:async()=> 'secret-ref',fetchImpl});
 await assert.rejects(()=>runtime.execute({job,context,node:{config:{capabilityId:'communication.email',connectionRef:connectionId,to:'b@example.com',subject:'x',textBody:'hello'}}}),/not verified/);
});
test('fails closed on cross-tenant connection',async()=>{
 const runtime=createProviderRuntime({connectionStore:store({tenant_id:'44444444-4444-4444-8444-444444444444',connection_id:connectionId,provider_key:'postmark.email',channel:'email',status:'verified',credential_ref:'kms/postmark',metadata:{from:'a@example.com'}}),secretResolver:async()=> 'secret-ref',fetchImpl});
 await assert.rejects(()=>runtime.execute({job,context,node:{config:{capabilityId:'communication.email',connectionRef:connectionId,to:'b@example.com',subject:'x',textBody:'hello'}}}),/tenant mismatch/);
});
test('dispatches bounded Jobber GraphQL without persisting provider data',async()=>{
 let calls=0;
 const runtime=createProviderRuntime({connectionStore:store({tenant_id:tenantId,connection_id:connectionId,provider_key:'jobber.graphql',channel:null,status:'verified',credential_ref:'kms/jobber',metadata:{apiVersion:'2025-04-16'}}),secretResolver:async()=> 'access-token-value',fetchImpl:async()=>{calls++;return {ok:true,status:200,text:async()=>JSON.stringify({data:{account:{id:'jobber-account'}}}),headers:new Headers()};}});
 const r=await runtime.execute({job,context,node:{config:{capabilityId:'service.jobber',connectionRef:connectionId,query:'query Account { account { id } }',variables:{}}}});
 assert.equal(calls,1);
 assert.equal(r.providerRef,context.idempotencyKey);
});
