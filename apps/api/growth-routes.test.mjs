import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createGrowthApi } from './growth-routes.mjs';
import { hashOpaqueToken, sessionCookieName } from './auth-contracts.mjs';

const tenantA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor='11111111-1111-4111-8111-111111111111', ownerEmail='khan@example.net';

async function createTestApi({ tenantId = tenantA, email = ownerEmail, memberships = [{tenant_id:tenantA,role_key:'owner',status:'active'}], envExtra = {}, subscriptionState = null, paddleFetch = fetch } = {}) {
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
  const api=createGrowthApi({store,authStore,env,fetchImpl:paddleFetch});
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
