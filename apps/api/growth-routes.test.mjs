import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createGrowthApi } from './growth-routes.mjs';
import { hashOpaqueToken, sessionCookieName } from './auth-contracts.mjs';
import { createAgentReleaseManifest, buildAgentJourneyContext } from '../../packages/atlas-agent-fabric/index.mjs';

const tenantA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor='11111111-1111-4111-8111-111111111111', ownerEmail='khan@example.net';

async function createTestApi({ tenantId = tenantA, email = ownerEmail, memberships = [{tenant_id:tenantA,role_key:'owner',status:'active'}], envExtra = {}, subscriptionState = null, paddleFetch = fetch, runtimeStoreExtra = {} } = {}) {
  const sessionToken='session-token-for-growth-api-test'; const csrf='csrf-token-for-growth-api-test'; const seen=[];
  const session={tokenHash:hashOpaqueToken(sessionToken),csrfHash:hashOpaqueToken(csrf),expiresAt:new Date(Date.now()+60_000),tenantId,user:{id:actor,email,displayName:'Khan',emailVerified:true,status:'active'},memberships};
  const authStore={async getSession({sessionHash}) { return sessionHash===session.tokenHash ? session : null; }};
  const store={
    async overview(data) { seen.push(['overview',data]); return {status:'tenant_database_backed'}; },
    async list(data) { seen.push(['list',data]); return {items:[],canWrite:true}; },
    async getWorkflowCatalog(data) { seen.push(['workflow_catalog',data]); return { executionAvailable:false, previewAvailable:true, triggers:[{type:'contact.created'}], nodes:[{type:'trigger'},{type:'stop'}] }; },
    async listPublishedQualificationProfiles(data) { seen.push(['qualification_profiles',data]); return {items:[{id:'44444444-4444-4444-8444-444444444444',state:'published'}],canWrite:false}; },
    async get(data) { seen.push(['get',data]); return {id:data.id,tenantId:data.tenantId,module:data.module}; },
    async create(data) { seen.push(['create',data]); return {id:'22222222-2222-4222-8222-222222222222',tenantId:data.tenantId,module:data.module,payload:data.payload}; },
    async update(data) { seen.push(['update',data]); return {id:data.id,tenantId:data.tenantId,version:2,payload:data.payload}; },
    async transition(data) { seen.push(['transition',data]); return {id:data.id,tenantId:data.tenantId,state:'published'}; },
    async moveLeadStage(data) { seen.push(['move_stage',data]); return {item:{id:data.leadId,tenantId:data.tenantId,payload:{stageId:data.stageId}},move:{stageId:data.stageId,stageName:'Qualified',direction:'forward'}}; },
    async evaluateLead(data) { seen.push(['evaluate_lead',data]); return {item:{id:data.leadId,tenantId:data.tenantId},evaluation:{score:82,status:'needs_review'}}; },
    async getSubscription(data) { seen.push(['subscription',data]); return subscriptionState; },
    async applyPaddleEvent(event, hash) { seen.push(['webhook',event,hash]); return {status:'applied'}; },
    async requireBillingManager(data) { seen.push(['billing_manager',data]); }
  };
  const env={NODE_ENV:'development',ATLAS_PLATFORM_OWNER_EMAIL:ownerEmail,ATLAS_PADDLE_WEBHOOK_SECRET:'webhook-secret-for-test-long-enough',ATLAS_PADDLE_PRICE_STARTER:'pri_1234567890',...envExtra};
  const runtimeStore={...runtimeStoreExtra};
  const api=createGrowthApi({store,authStore,runtimeStore,env,fetchImpl:paddleFetch});
  const server=createServer(async(req,res)=>{if(!(await api.handle(req,res))){res.writeHead(404);res.end();}});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={origin:base,cookie:`${sessionCookieName(env)}=${encodeURIComponent(sessionToken)}; atlas_csrf=${encodeURIComponent(csrf)}`,'x-atlas-csrf':csrf,'content-type':'application/json'};
  return {store,seen,env,base,headers,csrf,sessionToken,async close(){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}

test('Growth routes use the authenticated active tenant and reject request-supplied authority', async () => {
  const api=await createTestApi();
  try {
    let response=await fetch(`${api.base}/api/v1/growth/contacts?tenantId=${tenantB}`,{headers:api.headers});
    assert.equal(response.status,200);
    assert.equal(api.seen.at(-1)[1].tenantId,tenantA);
    response=await fetch(`${api.base}/api/v1/growth/contacts`,{method:'POST',headers:api.headers,body:JSON.stringify({payload:{firstName:'Ari',email:'ari@example.net'},tenantId:tenantB,platformOwner:true})});
    assert.equal(response.status,400);
    assert.equal(api.seen.some(([kind])=>kind==='create'),false);
    response=await fetch(`${api.base}/api/v1/growth/contacts`,{method:'POST',headers:{...api.headers,'x-atlas-csrf':''},body:JSON.stringify({payload:{firstName:'Ari',email:'ari@example.net'}})});
    assert.equal(response.status,403);
    response=await fetch(`${api.base}/api/v1/growth/contacts`,{method:'POST',headers:api.headers,body:JSON.stringify({payload:{firstName:'Ari',email:'ari@example.net'}})});
    assert.equal(response.status,201);
    const creation=api.seen.find(([kind])=>kind==='create')[1];
    assert.equal(creation.tenantId,tenantA);
    assert.equal(creation.actorId,actor);
    assert.equal(creation.publisherAuthority.globalRole,'platform_owner');
  } finally {await api.close();}
});

test('workflow capability catalog is available only through the authenticated active tenant scope', async () => {
  const api=await createTestApi();
  try {
    let response=await fetch(`${api.base}/api/v1/growth/workflows/catalog?tenantId=${tenantB}`,{headers:api.headers});
    const catalog=await response.json();
    assert.equal(response.status,200);
    assert.equal(catalog.executionAvailable,false);
    assert.equal(catalog.previewAvailable,true);
    assert.deepEqual(catalog.nodes.map(node=>node.type),['trigger','stop']);
    const scope=api.seen.find(([kind])=>kind==='workflow_catalog')[1];
    assert.equal(scope.actorId,actor); assert.equal(scope.tenantId,tenantA);

    const unauthenticated=await fetch(`${api.base}/api/v1/growth/workflows/catalog`);
    assert.equal(unauthenticated.status,401);
    const wrongMethod=await fetch(`${api.base}/api/v1/growth/workflows/catalog`,{method:'POST',headers:api.headers,body:JSON.stringify({})});
    assert.equal(wrongMethod.status,405,'catalog is a read-only endpoint and is not a write command');
    assert.equal(wrongMethod.headers.get('allow'),'GET');
  } finally {await api.close();}
});

test('an authenticated user without an active company tenant cannot reach Growth Center data', async () => {
  const api=await createTestApi({tenantId:null,memberships:[]});
  try {
    const response=await fetch(`${api.base}/api/v1/growth/contacts`,{headers:api.headers});
    assert.equal(response.status,409);
    assert.equal((await response.json()).error,'workspace_required');
    assert.equal(api.seen.length,0);
  } finally {await api.close();}
});

test('CRM stage moves and qualification evaluations use session scope and exact versioned request contracts', async () => {
  const api=await createTestApi();
  try {
    const leadId='33333333-3333-4333-8333-333333333333';
    const profileId='44444444-4444-4444-8444-444444444444';
    let response=await fetch(`${api.base}/api/v1/growth/ai-qualification?publishedOnly=true`,{headers:api.headers});
    assert.equal(response.status,200);
    assert.equal((await response.json()).items[0].state,'published');
    assert.equal(api.seen.find(([kind])=>kind==='qualification_profiles')[1].tenantId,tenantA);
    response=await fetch(`${api.base}/api/v1/growth/leads/${leadId}/move-stage`,{method:'POST',headers:api.headers,body:JSON.stringify({expectedVersion:3,stageId:'qualified'})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).move.stageName,'Qualified');
    const moved=api.seen.find(([kind])=>kind==='move_stage')[1];
    assert.equal(moved.tenantId,tenantA); assert.equal(moved.actorId,actor); assert.equal(moved.expectedVersion,3);
    response=await fetch(`${api.base}/api/v1/growth/ai-qualification/${profileId}/evaluate`,{method:'POST',headers:api.headers,body:JSON.stringify({expectedVersion:4,leadId,ratings:{fit:82},evidenceRefs:{fit:'call:42'}})});
    assert.equal(response.status,200);
    const evaluated=api.seen.find(([kind])=>kind==='evaluate_lead')[1];
    assert.equal(evaluated.profileId,profileId); assert.equal(evaluated.leadId,leadId); assert.equal(evaluated.tenantId,tenantA);
    response=await fetch(`${api.base}/api/v1/growth/leads/${leadId}/move-stage`,{method:'POST',headers:api.headers,body:JSON.stringify({expectedVersion:3,stageId:'qualified',platformOwner:true})});
    assert.equal(response.status,400);
  } finally {await api.close();}
});

test('Paddle webhook verification covers exact raw bytes, event normalization and duplicate-safe store handoff', async () => {
  const api=await createTestApi();
  try {
    const event={event_id:'evt_1234567890',event_type:'subscription.created',occurred_at:new Date().toISOString(),data:{id:'sub_1234567890',customer_id:'ctm_1234567890',status:'active',items:[{price:{id:'pri_1234567890'}}],custom_data:{tenant_id:tenantA,plan_key:'starter'}}};
    const rawBody=Buffer.from(JSON.stringify(event));
    const timestamp=String(Math.floor(Date.now()/1000));
    const signature=createHmac('sha256',api.env.ATLAS_PADDLE_WEBHOOK_SECRET).update(`${timestamp}:`).update(rawBody).digest('hex');
    let response=await fetch(`${api.base}/api/v1/webhooks/paddle`,{method:'POST',headers:{'content-type':'application/json','paddle-signature':`ts=${timestamp};h1=${signature}`},body:rawBody});
    assert.equal(response.status,200);
    const forwarded=api.seen.find(([kind])=>kind==='webhook');
    assert.equal(forwarded[1].tenantId,tenantA);
    assert.equal(forwarded[1].planKey,'starter');
    assert.equal(forwarded[2].length,64);
    response=await fetch(`${api.base}/api/v1/webhooks/paddle`,{method:'POST',headers:{'content-type':'application/json','paddle-signature':`ts=${timestamp};h1=${'0'.repeat(64)}`},body:rawBody});
    assert.equal(response.status,401);
  } finally {await api.close();}
});

test('billing offers only Paddle-verified 14-day trials, blocks repeat trials, and creates an authenticated cancel/manage portal', async () => {
  const price={id:'pri_1234567890',status:'active',billing_cycle:{interval:'month',frequency:1},unit_price:{amount:'2900',currency_code:'USD'},trial_period:{interval:'day',frequency:14,requires_payment_method:true,unit_price:null,unit_price_overrides:[]}};
  const envExtra={ATLAS_PADDLE_ENVIRONMENT:'sandbox',ATLAS_PADDLE_API_ORIGIN:'https://sandbox-api.paddle.com',ATLAS_PADDLE_API_KEY:'sandbox-api-key-contains-more-than-20-characters'};
  let transactions=0;
  const paddleFetch=async(url,init)=>{
    if(url.endsWith('/prices/pri_1234567890')) return {ok:true,async json(){return {data:price};}};
    if(url.endsWith('/transactions')) { transactions++; return {ok:true,async json(){return {data:{id:'txn_1234567890',checkout:{url:'https://sandbox-checkout.paddle.com/checkout/txn_1234567890'}}};}}; }
    if(url.endsWith('/portal-sessions')) return {ok:true,async json(){return {data:{customer_id:'ctm_1234567890',urls:{subscriptions:[{id:'sub_1234567890',view_subscription:'https://customer-portal.paddle.com/session?action=view&token=temporary',cancel_subscription:'https://customer-portal.paddle.com/session?action=cancel&token=temporary'}]}}};}};
    throw new Error(`Unexpected Paddle request: ${url}`);
  };
  const api=await createTestApi({envExtra,paddleFetch});
  try {
    let response=await fetch(`${api.base}/api/v1/billing/plans`,{headers:api.headers});
    const plans=await response.json();
    assert.equal(response.status,200); assert.equal(plans.plans.find(plan=>plan.key==='starter').trialDays,14);
    assert.equal(plans.plans.find(plan=>plan.key==='starter').checkoutAvailable,true);
    response=await fetch(`${api.base}/api/v1/billing/checkout`,{method:'POST',headers:api.headers,body:JSON.stringify({planKey:'starter'})});
    const checkout=await response.json();
    assert.equal(response.status,201); assert.equal(checkout.checkout.trialDays,14); assert.equal(transactions,1);
    assert.equal(api.seen.find(([kind])=>kind==='billing_manager')[1].tenantId,tenantA);
  } finally { await api.close(); }

  const priorTrial=await createTestApi({envExtra,subscriptionState:{subscriptionId:'sub_1234567890',customerId:'ctm_1234567890',status:'canceled',trialStartedAt:new Date().toISOString()},paddleFetch});
  try {
    const response=await fetch(`${priorTrial.base}/api/v1/billing/checkout`,{method:'POST',headers:priorTrial.headers,body:JSON.stringify({planKey:'starter'})});
    assert.equal(response.status,409); assert.equal((await response.json()).error,'billing_trial_already_used');
    assert.equal(transactions,1,'the route enforces trial eligibility before calling Paddle');
  } finally { await priorTrial.close(); }

  const active=await createTestApi({envExtra,subscriptionState:{subscriptionId:'sub_1234567890',customerId:'ctm_1234567890',status:'trialing',trialStartedAt:new Date().toISOString()},paddleFetch});
  try {
    const response=await fetch(`${active.base}/api/v1/billing/portal`,{method:'POST',headers:active.headers});
    const result=await response.json();
    assert.equal(response.status,201); assert.equal(result.portal.manageUrl,'https://customer-portal.paddle.com/session?action=view&token=temporary');
    assert.equal(result.portal.cancelUrl,'https://customer-portal.paddle.com/session?action=cancel&token=temporary');
  } finally { await active.close(); }
});

test('V146 AI workflow proposal endpoint is authenticated, tenant-bound and draft-only', async () => {
  const api=await createTestApi();
  try {
    let response=await fetch(`${api.base}/api/v1/growth/automation/ai-proposal`,{method:'POST',headers:api.headers,body:JSON.stringify({
      prompt:'When a lead arrives, qualify it, request approval, then follow up.',
      candidateNodes:['trigger','invoke_agent','approval','send_message']
    })});
    assert.equal(response.status,201);
    const body=await response.json();
    assert.equal(body.proposal.tenantId,tenantA);
    assert.equal(body.proposal.status,'proposal_only');
    assert.equal(body.proposal.writeMode,'draft_only');
    assert.equal(body.proposal.requiresHumanReview,true);
    response=await fetch(`${api.base}/api/v1/growth/automation/ai-proposal`,{method:'POST',headers:api.headers,body:JSON.stringify({
      prompt:'Run a shell command on the server.',
      candidateNodes:['trigger','execute_command']
    })});
    assert.equal(response.status,400);
  } finally {await api.close();}
});

test('V146 workflow security audit endpoint is authenticated and returns fail-closed findings', async () => {
  const api=await createTestApi();
  try {
    const response=await fetch(`${api.base}/api/v1/growth/automation/security-audit`,{method:'POST',headers:api.headers,body:JSON.stringify({
      workflow:{
        tenantId:tenantA,
        id:'33333333-3333-4333-8333-333333333333',
        version:1,
        nodes:[
          {id:'44444444-4444-4444-8444-444444444444',type:'trigger',config:{eventType:'webhook.received'}},
          {id:'55555555-5555-4555-8555-555555555555',type:'http_request',config:{url:'https://example.com'}}
        ]
      }
    })});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.report.status,'blocked');
    assert.ok(body.report.findings.some(finding=>finding.code==='DIRECT_NETWORK_URL'));
    assert.ok(body.report.findings.some(finding=>finding.code==='UNPROTECTED_WEBHOOK'));
  } finally {await api.close();}
});

test('V147 authenticated agent turn planning binds the persistent session to the exact release', async () => {
  const sessionId='99999999-9999-4999-8999-999999999999';
  const release=createAgentReleaseManifest({tenantId:tenantA,agentId:'77777777-7777-4777-8777-777777777777',releaseId:'88888888-8888-4888-8888-888888888888',version:1,status:'active',allowedTools:['crm.search'],modelPolicy:{provider:'model_adapter'},systemPromptHash:'a'.repeat(64)});
  const stored=[];
  const api=await createTestApi({runtimeStoreExtra:{
    async getAgentSession({tenantId,sessionId:requested}) { assert.equal(tenantId,tenantA); assert.equal(requested,sessionId); return {session_id:sessionId,agent_release_ref:release.releaseId,status:'active'}; },
    async recordAgentTurnPlan({tenantId,plan}) { assert.equal(tenantId,tenantA); stored.push(plan); return plan.planId; }
  }});
  try {
    const response=await fetch(api.base+'/api/v1/growth/agents/turns/plan',{method:'POST',headers:api.headers,body:JSON.stringify({
      sessionId,agentRelease:release,turnId:'turn_v147_001',promptHash:'b'.repeat(64),
      toolCalls:[{toolName:'crm.search',risk:'read',argumentsHash:'c'.repeat(64)}],
      approvalRefs:[],workflowInvocationRef:null,
      journeyContext:buildAgentJourneyContext({tenantId:tenantA,journeyId:'journey_v147_api_001',contactRef:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),
      now:Date.parse('2026-10-06T08:00:00.000Z')
    })});
    assert.equal(response.status,201);
    const body=await response.json();
    assert.equal(body.plan.releaseId,release.releaseId);
    assert.equal(body.plan.rawPromptStored,false);
    assert.equal(stored.length,1);
    assert.equal(stored[0].tenantId,tenantA);
  } finally { await api.close(); }
});

test('V147 workflow invocation and handoff APIs are tenant-bound and approval-aware', async () => {
  const release=createAgentReleaseManifest({tenantId:tenantA,agentId:'77777777-7777-4777-8777-777777777777',releaseId:'88888888-8888-4888-8888-888888888888',version:1,status:'active',allowedTools:['crm.search'],modelPolicy:{provider:'model_adapter'},systemPromptHash:'a'.repeat(64)});
  const api=await createTestApi({runtimeStoreExtra:{
    async getAgentSession({tenantId,sessionId}) { assert.equal(tenantId,tenantA); return {session_id:sessionId,agent_release_ref:release.releaseId,status:'active'}; },
    async recordAgentHandoff({tenantId,handoff}) { assert.equal(tenantId,tenantA); return handoff.handoffId; }
  }});
  try {
    let response=await fetch(api.base+'/api/v1/growth/agents/workflow-invocations/authorize',{method:'POST',headers:api.headers,body:JSON.stringify({agentRelease:release,workflowId:'66666666-6666-4666-8666-666666666666',workflowVersion:2,risk:'write',approvalRef:null})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).authorization.allowed,false);
    response=await fetch(api.base+'/api/v1/growth/agents/handoffs',{method:'POST',headers:api.headers,body:JSON.stringify({sessionId:'99999999-9999-4999-8999-999999999999',reason:'low_confidence',queueRef:'queue_sales_001',appointmentRef:null,now:Date.parse('2026-10-06T08:00:00.000Z')})});
    assert.equal(response.status,201);
    const handoff=(await response.json()).handoff;
    assert.equal(handoff.tenantId,tenantA);
    assert.equal(handoff.redacted,true);
  } finally { await api.close(); }
});

test('V148 agent turn execution is feature-gated, tenant-scoped and queued from a stored plan', async () => {
  const queued=[];
  const runtimeStoreExtra={
    async queueAgentTurnExecution(data){ queued.push(data); return {executionId:'99999999-9999-4999-8999-999999999999',jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}; },
    async getAgentTurnExecution(data){ return {executionId:data.executionId,status:'queued',tenantId:data.tenantId,rawPromptStored:false}; },
    async listAgentTurnExecutions(data){ return {items:[{executionId:'99999999-9999-4999-8999-999999999999',status:data.status||'queued',tenantId:data.tenantId,rawPromptStored:false}]}; }
  };
  const api=await createTestApi({runtimeStoreExtra});
  try {
    let response=await fetch(api.base + '/api/v1/growth/agents/turns/execute',{method:'POST',headers:api.headers,body:JSON.stringify({executionId:'99999999-9999-4999-8999-999999999999',planId:'88888888-8888-4888-8888-888888888888'})});
    assert.equal(response.status,503);
    const enabled=await createTestApi({runtimeStoreExtra,envExtra:{ATLAS_AGENT_TURN_EXECUTION_ENABLED:'true',ATLAS_AGENT_TURN_EXECUTION_HANDLER_READY:'true'}});
    try {
      response=await fetch(enabled.base + '/api/v1/growth/agents/turns/execute',{method:'POST',headers:enabled.headers,body:JSON.stringify({executionId:'99999999-9999-4999-8999-999999999999',planId:'88888888-8888-4888-8888-888888888888'})});
      const body=await response.json();
      assert.equal(response.status,202);
      assert.equal(body.execution.executionId,'99999999-9999-4999-8999-999999999999');
      assert.equal(queued.at(-1).tenantId,tenantA);
      assert.equal(queued.at(-1).actorId,actor);
      response=await fetch(enabled.base + '/api/v1/growth/agents/turns/99999999-9999-4999-8999-999999999999',{headers:enabled.headers});
      assert.equal(response.status,200);
      assert.equal((await response.json()).execution.status,'queued');
      response=await fetch(enabled.base + '/api/v1/growth/agents/turns?status=queued',{headers:enabled.headers});
      assert.equal(response.status,200);
      assert.equal((await response.json()).items.length,1);
    } finally { await enabled.close(); }
  } finally { await api.close(); }
});


test('credential lifecycle routes are authenticated, CSRF-protected and never return secret material',async()=>{
 const api=await createTestApi({runtimeStoreExtra:{
   async listCredentials(data){assert.equal(data.tenantId,tenantA);return {items:[{credential_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',provider_key:'oauthcrm',label:'CRM',status:'active',secret_ref_present:true}]};},
   async createCredential(data){assert.equal(data.tenantId,tenantA);return data.credentialId;},
   async rotateCredential(data){assert.equal(data.tenantId,tenantA);return {credentialId:data.credentialId,status:'active'};},
   async revokeCredential(data){assert.equal(data.tenantId,tenantA);return {credentialId:data.credentialId,status:'revoked'};}
 }});
 try{
  let response=await fetch(api.base+'/api/v1/growth/credentials',{headers:api.headers});
  const listed=await response.json();
  assert.equal(response.status,200);
  assert.equal('secret_ref' in listed.items[0],false);
  response=await fetch(api.base+'/api/v1/growth/credentials',{method:'POST',headers:{...api.headers,'x-atlas-csrf':''},body:JSON.stringify({credentialId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',providerKey:'oauthcrm',label:'CRM',secretRef:'vault/crm-v1'})});
  assert.equal(response.status,403);
  response=await fetch(api.base+'/api/v1/growth/credentials',{method:'POST',headers:api.headers,body:JSON.stringify({credentialId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',providerKey:'oauthcrm',label:'CRM',secretRef:'vault/crm-v1'})});
  assert.equal(response.status,201);
  response=await fetch(api.base+'/api/v1/growth/credentials/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/rotate',{method:'POST',headers:api.headers,body:JSON.stringify({secretRef:'vault/crm-v2'})});
  assert.equal(response.status,200);
  response=await fetch(api.base+'/api/v1/growth/credentials/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/revoke',{method:'POST',headers:api.headers,body:JSON.stringify({})});
  assert.equal(response.status,200);
 }finally{await api.close();}
});
