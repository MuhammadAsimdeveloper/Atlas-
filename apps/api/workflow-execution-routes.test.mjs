import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createGrowthApi } from './growth-routes.mjs';
import { createWorkflowGraph } from '../../packages/atlas-target/index.mjs';
import { hashOpaqueToken, sessionCookieName } from './auth-contracts.mjs';

const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId='11111111-1111-4111-8111-111111111111';
const workflowId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const executionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function workflowRecord(state='published') {
  const graph=createWorkflowGraph({
    tenantId,id:workflowId,version:3,name:'Lead journey',
    nodes:[
      {id:'start',type:'trigger',config:{eventType:'contact.created'}},
      {id:'stop',type:'stop'}
    ],
    edges:[{id:'e1',from:'start',to:'stop',port:'next'}]
  });
  return { id:workflowId,tenantId,module:'workflows',state,payload:{name:'Lead journey',graph} };
}

async function fixture({workflowState='published'}={}) {
  const sessionToken='workflow-execution-session-token';
  const csrf='workflow-execution-csrf-token';
  const session={tokenHash:hashOpaqueToken(sessionToken),csrfHash:hashOpaqueToken(csrf),expiresAt:new Date(Date.now()+60_000),tenantId,user:{id:actorId,email:'khan@example.net',displayName:'Khan',emailVerified:true,status:'active'},memberships:[{tenant_id:tenantId,role_key:'owner',status:'active'}]};
  const calls=[];
  const authStore={async getSession({sessionHash}){return sessionHash===session.tokenHash?session:null;}};
  const executions=new Map();
  const executionStore={
    async create(data){calls.push(['create',data]);executions.set(executionId,{executionId,tenantId,status:'queued',version:1,currentNodeId:'start',workflowVersion:3});return executions.get(executionId);},
    async list(data){calls.push(['list',data]);return {items:[...executions.values()]};},
    async get(data){calls.push(['get',data]);return executions.get(data.executionId)||null;},
    async getActivationChecklist(data){calls.push(['activation',data]);return {workspace:{tenantId},steps:[{id:'capture_lead',status:'complete'},{id:'publish_workflow',status:'ready'},{id:'connect_provider',status:'blocked'}],nextAction:'publish_workflow'};},
    async cancel(data){calls.push(['cancel',data]);return {...executions.get(data.executionId),status:'canceled',version:2};},
    async approve(data){calls.push(['approve',data]);return {...executions.get(data.executionId),status:'queued',version:2};},
    async replay(data){calls.push(['replay',data]);return {executionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',status:'queued',workflowVersion:3};},
    async reconcile(data){calls.push(['reconcile',data]);return {executionId:data.executionId,tenantId:data.tenantId,status:data.resolution==='confirmed_success'?'queued':'dead_letter',version:3};}
  };
  const growthStore={async get(data){calls.push(['workflowGet',data]);return workflowRecord(workflowState);},async getActivationChecklist(data){calls.push(['activation',data]);return {workspace:{tenantId},steps:[{id:'capture_lead',status:'complete'},{id:'publish_workflow',status:'ready'},{id:'connect_provider',status:'blocked'}],nextAction:'publish_workflow'};}};
  const env={NODE_ENV:'development',ATLAS_PLATFORM_OWNER_EMAIL:'khan@example.net',ATLAS_WORKFLOW_EXECUTION_ENABLED:'true',ATLAS_WORKFLOW_EXECUTION_HANDLER_READY:'true'};
  const api=createGrowthApi({store:growthStore,executionStore,authStore,env});
  const server=createServer(async(req,res)=>{if(!(await api.handle(req,res))){res.writeHead(404);res.end();}});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const headers={origin:base,cookie:sessionCookieName(env)+'='+encodeURIComponent(sessionToken)+'; atlas_csrf='+encodeURIComponent(csrf),'x-atlas-csrf':csrf,'content-type':'application/json'};
  return {base,headers,calls,async close(){await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}

test('starting a published workflow creates a durable queued execution',async()=>{
  const api=await fixture();
  try{
    const response=await fetch(api.base+'/api/v1/growth/workflows/'+workflowId+'/executions',{method:'POST',headers:api.headers,body:JSON.stringify({triggerEventType:'contact.created',triggerEventRef:'evt_001',executionId})});
    const body=await response.json();
    assert.equal(response.status,202);
    assert.equal(body.execution.status,'queued');
    assert.equal(api.calls.find(([kind])=>kind==='create')[1].tenantId,tenantId);
    assert.equal(api.calls.find(([kind])=>kind==='create')[1].workflow.payload.graph.version,3);
  }finally{await api.close();}
});

test('execution route refuses drafts and validates trigger identity before creating work',async()=>{
  const draftApi=await fixture({workflowState:'draft'});
  try{
    const response=await fetch(draftApi.base+'/api/v1/growth/workflows/'+workflowId+'/executions',{method:'POST',headers:draftApi.headers,body:JSON.stringify({triggerEventType:'contact.created',triggerEventRef:'evt_002',executionId})});
    assert.equal(response.status,409);
    assert.equal(draftApi.calls.some(([kind])=>kind==='create'),false);
  } finally { await draftApi.close(); }
  const api=await fixture();
  try{
    api.calls.length=0;
    const response=await fetch(api.base+'/api/v1/growth/workflows/'+workflowId+'/executions',{method:'POST',headers:api.headers,body:JSON.stringify({triggerEventType:'payment.failed',triggerEventRef:'evt_002',executionId})});
    assert.equal(response.status,400);
    assert.equal(api.calls.some(([kind])=>kind==='create'),false);
    const response2=await fetch(api.base+'/api/v1/growth/workflows/'+workflowId+'/executions',{method:'POST',headers:api.headers,body:JSON.stringify({triggerEventType:'contact.created',triggerEventRef:'evt_003',executionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'})});
    assert.equal(response2.status,202);
  }finally{await api.close();}
});

test('execution cancellation, approval and replay stay tenant-scoped and require mutation protection',async()=>{
  const api=await fixture();
  try{
    let response=await fetch(api.base+'/api/v1/growth/workflows/'+workflowId+'/executions/'+executionId+'/cancel',{method:'POST',headers:{...api.headers,'x-atlas-csrf':''},body:JSON.stringify({})});
    assert.equal(response.status,403);
    response=await fetch(api.base+'/api/v1/growth/workflows/'+workflowId+'/executions/'+executionId+'/cancel',{method:'POST',headers:api.headers,body:JSON.stringify({expectedVersion:1})});
    assert.equal(response.status,200);
    assert.equal(api.calls.at(-1)[1].tenantId,tenantId);
    response=await fetch(api.base+'/api/v1/growth/workflows/'+workflowId+'/executions/'+executionId+'/approve',{method:'POST',headers:api.headers,body:JSON.stringify({expectedVersion:2,approvalId:'approval_1',evidenceRef:{kind:'approval',id:'evidence-1'}})});
    assert.equal(response.status,200);
    assert.equal(api.calls.at(-1)[1].actorId,actorId);
    response=await fetch(api.base+'/api/v1/growth/workflows/'+workflowId+'/executions/'+executionId+'/replay',{method:'POST',headers:api.headers,body:JSON.stringify({expectedVersion:2,executionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'})});
    assert.equal(response.status,202);
    assert.equal(api.calls.at(-1)[1].tenantId,tenantId);
  }finally{await api.close();}
});


test('execution history accepts bounded filters for operator triage', async () => {
  const api = await fixture();
  try {
    const response = await fetch(api.base + '/api/v1/growth/workflows/' + workflowId + '/executions?limit=25&status=retryable&triggerEventType=contact.created&errorCode=provider_timeout', { headers: { cookie: api.headers.cookie } });
    assert.equal(response.status, 200);
    const call = api.calls.find(([kind]) => kind === 'list');
    assert.equal(call[1].limit, 25);
    assert.equal(call[1].status, 'retryable');
    assert.equal(call[1].triggerEventType, 'contact.created');
    assert.equal(call[1].errorCode, 'provider_timeout');
  } finally { await api.close(); }
});


test('activation checklist exposes the first customer outcome without claiming provider connectivity', async () => {
  const api = await fixture();
  try {
    const response = await fetch(api.base + '/api/v1/growth/activation', { headers: { cookie: api.headers.cookie } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.steps.find(step => step.id === 'connect_provider').status, 'blocked');
    assert.equal(body.nextAction, 'publish_workflow');
    assert.equal(api.calls.at(-1)[0], 'activation');
    assert.equal(api.calls.at(-1)[1].tenantId, tenantId);
  } finally { await api.close(); }
});


test('reconciliation route requires CSRF and delegates only authenticated tenant authority',async()=>{
 const api=await fixture();
 try{
  let response=await fetch(api.base+'/api/v1/growth/executions/reconcile',{method:'POST',headers:{...api.headers,'x-atlas-csrf':''},body:JSON.stringify({executionId,reconciliationId:'reconcile_12345678',resolution:'confirmed_success',expectedVersion:2})});
  assert.equal(response.status,403);
  response=await fetch(api.base+'/api/v1/growth/executions/reconcile',{method:'POST',headers:api.headers,body:JSON.stringify({executionId,reconciliationId:'reconcile_12345678',resolution:'confirmed_success',expectedVersion:2,tenantId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})});
  assert.equal(response.status,400);
  response=await fetch(api.base+'/api/v1/growth/executions/reconcile',{method:'POST',headers:api.headers,body:JSON.stringify({executionId,reconciliationId:'reconcile_12345678',resolution:'confirmed_success',expectedVersion:2})});
  assert.equal(response.status,200);
  const call=api.calls.find(([kind])=>kind==='reconcile');
  assert.equal(call[1].tenantId,tenantId);
  assert.equal(call[1].actorId,actorId);
  assert.equal(call[1].resolution,'confirmed_success');
 }finally{await api.close();}
});
