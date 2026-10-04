import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyPaddleSignature, paddlePlanCatalog, createPaddleCheckout, normalizePaddleBillingEvent, paddleBodySha256 } from './paddle-billing.mjs';

const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secret='destination-secret-contains-more-than-24-bytes';
const env={ATLAS_PADDLE_ENVIRONMENT:'sandbox',ATLAS_PADDLE_API_ORIGIN:'https://sandbox-api.paddle.com',ATLAS_PADDLE_API_KEY:'sandbox-api-key-contains-more-than-20-characters',ATLAS_PADDLE_PRICE_STARTER:'pri_1234567890'};

test('Paddle signatures authenticate exact raw bytes, enforce five-second freshness and allow key rotation', () => {
  const body=Buffer.from('{"event_id":"evt_1234567890"}'); const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256',secret).update(`${timestamp}:`).update(body).digest('hex');
  assert.equal(verifyPaddleSignature({rawBody:body,signatureHeader:`ts=${timestamp};h1=${signature}`,secret}),true);
  assert.equal(verifyPaddleSignature({rawBody:Buffer.from(body.toString()+' '),signatureHeader:`ts=${timestamp};h1=${signature}`,secret}),false);
  assert.equal(verifyPaddleSignature({rawBody:body,signatureHeader:`ts=${Number(timestamp)-6};h1=${signature}`,secret,now:Number(timestamp)*1000}),false);
  assert.equal(verifyPaddleSignature({rawBody:body,signatureHeader:`ts=${timestamp};h1=${signature};h1=${'a'.repeat(64)}`,secret}),true);
  assert.equal(verifyPaddleSignature({rawBody:body,signatureHeader:`ts=${timestamp};ts=${timestamp};h1=${signature}`,secret}),false);
});

test('Paddle checkout keeps the API key server-side and rejects untrusted checkout origins', async () => {
  assert.deepEqual(paddlePlanCatalog(env),[{key:'starter',priceId:'pri_1234567890'}]);
  let calledUrl; let calledInit;
  const checkout=await createPaddleCheckout({tenantId,email:'Khan@example.net',planKey:'starter',env,fetchImpl:async(url,init)=>{
    calledUrl=url; calledInit=init; return {ok:true,async json(){return {data:{id:'txn_1234567890',checkout:{url:'https://sandbox-checkout.paddle.com/checkout/txn_1234567890'}}};}};
  }});
  assert.equal(calledUrl,'https://sandbox-api.paddle.com/transactions');
  assert.equal(calledInit.headers.authorization,`Bearer ${env.ATLAS_PADDLE_API_KEY}`);
  assert.equal(JSON.parse(calledInit.body).customer.email,'khan@example.net');
  assert.equal(JSON.parse(calledInit.body).custom_data.tenant_id,tenantId);
  assert.equal(checkout.checkoutUrl,'https://sandbox-checkout.paddle.com/checkout/txn_1234567890');
  let missingModeCalled = false;
  const missingMode = { ...env }; delete missingMode.ATLAS_PADDLE_ENVIRONMENT;
  await assert.rejects(createPaddleCheckout({tenantId,email:'khan@example.net',planKey:'starter',env:missingMode,fetchImpl:async()=>{missingModeCalled=true;}}),{code:'billing_environment_required'});
  assert.equal(missingModeCalled,false,'missing environment must fail before making a provider request');
  await assert.rejects(createPaddleCheckout({tenantId,email:'khan@example.net',planKey:'starter',env,fetchImpl:async()=>({ok:true,async json(){return {data:{id:'txn_1234567890',checkout:{url:'https://evil.example/collect'}}};}})}),{code:'paddle_checkout_unavailable'});
  await assert.rejects(createPaddleCheckout({tenantId:'foreign',email:'khan@example.net',planKey:'starter',env}),/verified workspace/);
  await assert.rejects(createPaddleCheckout({tenantId,email:'khan@example.net',planKey:'scale',env}),{code:'billing_not_configured'});
});

test('subscription webhooks validate configured prices, tenant references and supported lifecycle events', () => {
  const event={event_id:'evt_1234567890',event_type:'subscription.trialing',occurred_at:new Date().toISOString(),data:{id:'sub_1234567890',customer_id:'ctm_1234567890',status:'trialing',items:[{price:{id:'pri_1234567890'}}],custom_data:{tenant_id:tenantId,plan_key:'starter'},current_billing_period:{ends_at:new Date(Date.now()+86400_000).toISOString()}}};
  const normalized=normalizePaddleBillingEvent(event,{env});
  assert.equal(normalized.disposition,'apply'); assert.equal(normalized.status,'trialing'); assert.equal(normalized.tenantId,tenantId);
  assert.equal(normalizePaddleBillingEvent({...event,event_type:'customer.updated'},{env}).disposition,'ignored');
  assert.throws(()=>normalizePaddleBillingEvent({...event,data:{...event.data,items:[{price:{id:'pri_foreign_price'}}]}},{env}),/configured Atlas plan/);
  assert.equal(paddleBodySha256(Buffer.from('raw')).length,64);
});
