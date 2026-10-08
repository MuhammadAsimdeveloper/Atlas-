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
 const r=await runtime.execute({job,context,node:{config:{capabilityId:'communication.email',connectionRef:connectionId,consent:true,approved:true,to:'b@example.com',subject:'x',textBody:'hello'}}});
 assert.equal(r.providerRef,'m1');
});
test('fails closed on unverified connection',async()=>{
 const runtime=createProviderRuntime({connectionStore:store({tenant_id:tenantId,connection_id:connectionId,provider_key:'postmark.email',channel:'email',status:'draft',credential_ref:'kms/postmark',metadata:{from:'a@example.com'}}),secretResolver:async()=> 'secret-ref',fetchImpl});
 await assert.rejects(()=>runtime.execute({job,context,node:{config:{capabilityId:'communication.email',connectionRef:connectionId,consent:true,approved:true,to:'b@example.com',subject:'x',textBody:'hello'}}}),/not verified/);
});
test('fails closed on cross-tenant connection',async()=>{
 const runtime=createProviderRuntime({connectionStore:store({tenant_id:'44444444-4444-4444-8444-444444444444',connection_id:connectionId,provider_key:'postmark.email',channel:'email',status:'verified',credential_ref:'kms/postmark',metadata:{from:'a@example.com'}}),secretResolver:async()=> 'secret-ref',fetchImpl});
 await assert.rejects(()=>runtime.execute({job,context,node:{config:{capabilityId:'communication.email',connectionRef:connectionId,consent:true,approved:true,to:'b@example.com',subject:'x',textBody:'hello'}}}),/tenant mismatch/);
});
test('dispatches bounded Jobber GraphQL without persisting provider data',async()=>{
 let calls=0;
 const runtime=createProviderRuntime({connectionStore:store({tenant_id:tenantId,connection_id:connectionId,provider_key:'jobber.graphql',channel:null,status:'verified',credential_ref:'kms/jobber',metadata:{apiVersion:'2025-04-16'}}),secretResolver:async()=> 'access-token-value-123456',fetchImpl:async()=>{calls++;return {ok:true,status:200,text:async()=>JSON.stringify({data:{account:{id:'jobber-account'}}}),headers:new Headers()};}});
 const r=await runtime.execute({job,context,node:{config:{capabilityId:'service.jobber',connectionRef:connectionId,consent:true,approved:true,query:'query Account { account { id } }',variables:{}}}});
 assert.equal(calls,1);
 assert.equal(r.providerRef,context.idempotencyKey);
});


test('V157 P0 connector_action resolves a tenant-scoped operation, verified connection and external secret, then returns typed output',async()=>{
 const {createConnectorDefinition,createConnectorSchemaRegistry}=await import('../../packages/atlas-integration-fabric/index.mjs');
 const connector=createConnectorDefinition({
  tenantId,
  id:'crm',
  name:'Custom CRM',
  auth:'bearer',
  baseUrl:'https://api.example.com',
  operations:[{
   id:'contacts.lookup',
   method:'POST',
   path:'/v1/contacts/lookup',
   inputSchema:{type:'object',required:['contactRef'],additionalProperties:false,properties:{contactRef:{type:'string'}}},
   outputSchema:{type:'object',required:['contact'],additionalProperties:false,properties:{contact:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string'}}}}},
   idempotent:true
  }]
 });
 const connectorRegistry=createConnectorSchemaRegistry({connectors:[connector]});
 let seen=null;
 const runtime=createProviderRuntime({
  connectionStore:store({tenant_id:tenantId,connection_id:connectionId,provider_key:'crm',channel:null,status:'verified',credential_ref:'kms/crm',metadata:{}}),
  connectorRegistry,
  secretResolver:async()=>{seen='resolved-secret';return seen;},
  fetchImpl:async(url,opts)=>{
   assert.equal(url,'https://api.example.com/v1/contacts/lookup');
   assert.equal(opts.method,'POST');
   assert.equal(opts.headers.authorization,'Bearer resolved-secret');
   assert.deepEqual(JSON.parse(opts.body),{contactRef:'c1'});
   return {ok:true,status:200,text:async()=>JSON.stringify({contact:{id:'c1'}}),headers:new Headers({'content-type':'application/json'})};
  }
 });
 const r=await runtime.execute({job,context,node:{type:'connector_action',config:{connectorRef:'crm',connectionRef:connectionId,operationRef:'contacts.lookup',input:{contactRef:'c1'}}}});
 assert.equal(seen,'resolved-secret');
 assert.deepEqual(r.output,{contact:{id:'c1'}});
 assert.equal(r.resultRef.kind,'connector_operation');
 assert.equal(r.resultRef.id,context.idempotencyKey);
});

test('V157 P0 connector_action fails closed when connection provider does not match connector identity',async()=>{
 const {createConnectorDefinition,createConnectorSchemaRegistry}=await import('../../packages/atlas-integration-fabric/index.mjs');
 const connector=createConnectorDefinition({tenantId,id:'crm',name:'Custom CRM',auth:'bearer',baseUrl:'https://api.example.com',operations:[{id:'contacts.lookup',method:'POST',path:'/contacts',inputSchema:{type:'object'},outputSchema:{type:'object'}}]});
 const connectorRegistry=createConnectorSchemaRegistry({connectors:[connector]});
 const runtime=createProviderRuntime({
  connectionStore:store({tenant_id:tenantId,connection_id:connectionId,provider_key:'other-crm',channel:null,status:'verified',credential_ref:'kms/crm',metadata:{}}),
  connectorRegistry,secretResolver:async()=> 'resolved-secret',
  fetchImpl:async()=>{throw new Error('must not call provider')}
 });
 await assert.rejects(()=>runtime.execute({job,context,node:{type:'connector_action',config:{connectorRef:'crm',connectionRef:connectionId,operationRef:'contacts.lookup',input:{}}}}),/connector.*match|provider.*match|operation.*binding/i);
});


test('V157 P0 HMAC connector operations sign the exact outbound body and allow only declared non-secret headers',async()=>{
 const {createConnectorDefinition,createConnectorSchemaRegistry}=await import('../../packages/atlas-integration-fabric/index.mjs');
 const connector=createConnectorDefinition({
  tenantId,id:'aws',name:'HMAC API',auth:'hmac',baseUrl:'https://api.example.com',
  operations:[{
   id:'items.create',method:'POST',path:'/v1/items',
   inputSchema:{type:'object',required:['name'],additionalProperties:false,properties:{name:{type:'string'}}},
   outputSchema:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string'}}},
   requestHeaders:{'x-atlas-client':'atlas-test'},
   hmac:{timestampHeader:'x-atlas-timestamp',signatureHeader:'x-atlas-signature'}
  }]
 });
 const registry=createConnectorSchemaRegistry({connectors:[connector]});
 const runtime=createProviderRuntime({
  connectionStore:store({tenant_id:tenantId,connection_id:connectionId,provider_key:'aws',channel:null,status:'verified',credential_ref:'kms/hmac',metadata:{}}),
  connectorRegistry:registry,
  secretResolver:async()=> 'hmac-secret-123456',
  fetchImpl:async(url,opts)=>{
   assert.equal(opts.headers['x-atlas-client'],'atlas-test');
   assert.match(opts.headers['x-atlas-timestamp'],/^\\d+$/);
   assert.match(opts.headers['x-atlas-signature'],/^t=\\d+,v1=[a-f0-9]{64}$/);
   assert.equal(opts.headers.authorization,undefined);
   return {ok:true,status:200,text:async()=>JSON.stringify({id:'i1'}),headers:new Headers({'content-type':'application/json'})};
  }
 });
 const r=await runtime.execute({job,context,node:{type:'connector_action',config:{connectorRef:'aws',connectionRef:connectionId,operationRef:'items.create',input:{name:'x'}}}});
 assert.deepEqual(r.output,{id:'i1'});
});

test('V157 P0 connector operation headers reject secret-bearing and hop-by-hop names at definition time',async()=>{
 const {createConnectorDefinition}=await import('../../packages/atlas-integration-fabric/index.mjs');
 assert.throws(()=>createConnectorDefinition({tenantId,id:'headers',name:'Headers',auth:'bearer',baseUrl:'https://api.example.com',operations:[{id:'items.get',method:'GET',path:'/items',requestHeaders:{authorization:'nope'},inputSchema:{type:'object'},outputSchema:{type:'object'}}]}),/header|forbidden|secret/i);
 assert.throws(()=>createConnectorDefinition({tenantId,id:'headers2',name:'Headers2',auth:'bearer',baseUrl:'https://api.example.com',operations:[{id:'items.get',method:'GET',path:'/items',requestHeaders:{connection:'close'},inputSchema:{type:'object'},outputSchema:{type:'object'}}]}),/header|forbidden/i);
});
