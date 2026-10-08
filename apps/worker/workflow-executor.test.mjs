import test from 'node:test';import assert from 'node:assert/strict';import {createWorkflowExecution} from '../../packages/atlas-target/workflow-execution-engine.mjs';import {createWorkflowGraph} from '../../packages/atlas-target/index.mjs';import {executeWorkflowJob} from './workflow-executor.mjs';
function graph(external=false){const tenantId='11111111-1111-4111-8111-111111111111';return createWorkflowGraph({tenantId,id:'22222222-2222-4222-8222-222222222222',version:1,name:'x',nodes:[{id:'33333333-3333-4333-8333-333333333333',type:'trigger',config:{eventType:'contact.created'}},{id:'44444444-4444-4444-8444-444444444444',type:external?'send_message':'stop',config:external?{channel:'email',templateRef:'template_1',connectionRef:'connection_1',capabilityId:'communication.email',providerStatus:'configured',consent:true,approved:true}:{}}],edges:[{from:'33333333-3333-4333-8333-333333333333',to:'44444444-4444-4444-8444-444444444444',port:'next'}]});}
test('runs a leased execution through a pure node and persists the transition',async()=>{const g=graph();const e=createWorkflowExecution({tenantId:g.tenantId,workflow:g,triggerEventRef:'evt_1',createdByActorId:g.tenantId});let saved=e;const store={getWorkflowExecutionForJob:async()=>saved,updateWorkflowExecutionForJob:async(_j,_w,u)=>{saved=u.state;return true}};const r=await executeWorkflowJob({store,job:{tenant_id:g.tenantId,job_id:'job-1'},workerId:'worker-1',resolveAction:async()=>({selectedPort:'next'}),now:Date.parse('2026-10-05T00:00:00Z')});assert.equal(r.status,'queued');assert.equal(saved.currentNodeId,'44444444-4444-4444-8444-444444444444');});
test('fails closed before external side effects',async()=>{const g=graph(true);const e=createWorkflowExecution({tenantId:g.tenantId,workflow:g,triggerEventRef:'evt_1',createdByActorId:g.tenantId});let saved=e;const store={getWorkflowExecutionForJob:async()=>saved,updateWorkflowExecutionForJob:async(_j,_w,u)=>{saved=u.state;return true}};await executeWorkflowJob({store,job:{tenant_id:g.tenantId,job_id:'job-1'},workerId:'worker-1',resolveAction:async()=>({selectedPort:'next'}),now:Date.parse('2026-10-05T00:00:00Z')});const r=await executeWorkflowJob({store,job:{tenant_id:g.tenantId,job_id:'job-2'},workerId:'worker-1',resolveAction:async()=>{throw new Error('must not run')},now:Date.parse('2026-10-05T00:00:00Z')});assert.equal(r.execution.lastErrorCode,'provider_not_verified');});


test('V157 P0 worker forwards resolved step output to the execution validator without persisting raw output',async()=>{
 const g=graph();
 const e=createWorkflowExecution({tenantId:g.tenantId,workflow:g,triggerEventRef:'evt_output',createdByActorId:g.tenantId});
 let saved=e;
 const store={
  getWorkflowExecutionForJob:async()=>saved,
  updateWorkflowExecutionForJob:async(_j,_w,u)=>{saved=u.state;return true}
 };
 await executeWorkflowJob({
  store,job:{tenant_id:g.tenantId,job_id:'job-output'},workerId:'worker-1',
  resolveAction:async()=>({selectedPort:'next',resultRef:{kind:'workflow_event',id:'evt_output',version:1},output:{hello:'world'}}),
  now:Date.parse('2026-10-05T00:00:00Z')
 });
 const step=saved.steps.at(-1);
 assert.equal(step.outputHash.length,64);
 assert.equal(step.outputSchemaVersion,1);
 assert.equal('output' in step,false);
});
