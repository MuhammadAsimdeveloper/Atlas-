import test from 'node:test';
import assert from 'node:assert/strict';
import {defineAction,getAction,listActions,compileActionSurfaces,createInvocation,createActionRegistry,syntheticTestPlan,buildBusinessCapability,ACTION_CATALOG_COUNT} from './index.mjs';

test('business actions are reusable across API/workflow/MCP/agent/UI/portal surfaces',()=>{
 const a=defineAction({id:'crm.contact.upsert',name:'Upsert Contact',domain:'crm',risk:'write',surfaces:['api','workflow','mcp','agent','ui','portal']});
 const s=compileActionSurfaces(a);
 assert.equal(s.api.operationId,a.id);assert.equal(s.workflow.actionId,a.id);assert.equal(s.mcp.toolName,a.id);assert.equal(s.agent.skillAction,a.id);assert.equal(s.portal.actionId,a.id);
 assert.match(a.definitionHash,/^[a-f0-9]{64}$/);
});

test('side effects fail closed until provider and approval gates pass',()=>{
 assert.throws(()=>createInvocation({tenantId:'tenant_1',actionId:'commerce.payment.refund',requestId:'req_1',actorRef:'user_1',idempotencyKey:'idem_1',mode:'live',providerState:'configured',approved:true}),/verified/);
 assert.throws(()=>createInvocation({tenantId:'tenant_1',actionId:'commerce.payment.refund',requestId:'req_1',actorRef:'user_1',idempotencyKey:'idem_1',mode:'live',providerState:'verified',approved:false}),/approval/);
 const ok=createInvocation({tenantId:'tenant_1',actionId:'commerce.payment.refund',requestId:'req_1',actorRef:'user_1',idempotencyKey:'idem_1',mode:'live',providerState:'verified',approved:true});
 assert.equal(ok.tenantId,'tenant_1');
});

test('action inputs reject credentials and excessive recursion',()=>{assert.throws(()=>createInvocation({tenantId:'tenant_1',actionId:'crm.contact.upsert',requestId:'req_1',actorRef:'user_1',idempotencyKey:'idem-12345678',input:{password:'secret'}}),/credential/);assert.throws(()=>createInvocation({tenantId:'tenant_1',actionId:'crm.contact.upsert',requestId:'req_1',actorRef:'user_1',idempotencyKey:'idem-12345678',input:{nested:{token:'x'}}}),/credential/);});

test('synthetic connector/action tests cannot enable real side effects',()=>{
 const p=syntheticTestPlan({tenantId:'tenant_1',actionId:'workflow.execute',fixtures:[{input:{ok:true}}]});
 assert.equal(p.mode,'synthetic');assert.equal(p.sideEffects,'disabled');
});

test('catalog remains bounded and queryable',()=>{
 assert.ok(ACTION_CATALOG_COUNT>=6);assert.ok(getAction('workflow.execute'));assert.equal(listActions({risk:'financial'})[0].id,'commerce.payment.refund');
});

test('capability compiler creates one canonical surface map',()=>{
 const a=getAction('crm.contact.upsert');const b=buildBusinessCapability({action:a});
 assert.equal(b.actionId,a.id);assert.deepEqual(Object.keys(b.surfaces).sort(),['agent','api','mcp','portal','ui','webhook','workflow']);
});

test('typed action schemas reject invalid payloads and enforce required fields',()=>{
 const action=defineAction({
  id:'crm.contact.typed-test',
  name:'Typed Contact Test',
  domain:'crm',
  risk:'write',
  inputSchema:{
   type:'object',
   required:['contactRef','score'],
   additionalProperties:false,
   properties:{
    contactRef:{type:'string',minLength:3,maxLength:180},
    score:{type:'number',minimum:0,maximum:100}
   }
  },
  surfaces:['api','workflow']
 });
 const registry=createActionRegistry({actions:[action]});
 assert.equal(registry.get(action.id).definitionHash,action.definitionHash);
 assert.throws(()=>createInvocation({
  registry,
  tenantId:'tenant_1',
  actionId:action.id,
  requestId:'req_1',
  actorRef:'user_1',
  idempotencyKey:'idem-typed-123',
  input:{contactRef:'contact_1',score:'high'}
 }),error=>error?.code==='schema_validation_failed');
 assert.throws(()=>createInvocation({
  registry,
  tenantId:'tenant_1',
  actionId:action.id,
  requestId:'req_1',
  actorRef:'user_1',
  idempotencyKey:'idem-typed-124',
  input:{contactRef:'contact_1'}
 }),error=>error?.code==='schema_validation_failed');
 const valid=createInvocation({
  registry,
  tenantId:'tenant_1',
  actionId:action.id,
  requestId:'req_1',
  actorRef:'user_1',
  idempotencyKey:'idem-typed-125',
  input:{contactRef:'contact_1',score:90}
 });
 assert.equal(valid.actionId,action.id);
});

test('typed action inputs can resolve allowlisted expressions before schema validation',()=>{
 const action=defineAction({
  id:'crm.contact.expression-test',
  name:'Expression Contact Test',
  domain:'crm',
  risk:'write',
  inputSchema:{type:'object',required:['score'],additionalProperties:false,properties:{score:{type:'number',minimum:0,maximum:100}}},
  surfaces:['api','workflow']
 });
 const registry=createActionRegistry({actions:[action]});
 const invocation=createInvocation({
  registry,
  tenantId:'tenant_1',
  actionId:action.id,
  requestId:'req_expr_1',
  actorRef:'user_1',
  idempotencyKey:'idem-expr-125',
  input:{score:{$expression:'input.customer.score'}},
  expressionContext:{input:{customer:{score:88}}}
 });
 assert.equal(invocation.input.score,88);
 assert.throws(()=>createInvocation({
  registry,
  tenantId:'tenant_1',
  actionId:action.id,
  requestId:'req_expr_2',
  actorRef:'user_1',
  idempotencyKey:'idem-expr-126',
  input:{score:{$expression:'process.env.SECRET'}},
  expressionContext:{input:{}}
 }),/allowlisted|invalid|expression/i);
});
