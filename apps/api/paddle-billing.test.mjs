import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyPaddleSignature, paddlePlanCatalog, verifyPaddleFreeTrialPrice, createPaddleCheckout, createPaddlePortalSession, normalizePaddleBillingEvent, paddleBodySha256 } from './paddle-billing.mjs';

const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secret='destination-secret-contains-more-than-24-bytes';
const env={ATLAS_PADDLE_ENVIRONMENT:'sandbox',ATLAS_PADDLE_API_ORIGIN:'https://sandbox-api.paddle.com',ATLAS_PADDLE_API_KEY:'sandbox-api-key-contains-more-than-20-characters',ATLAS_PADDLE_PRICE_STARTER:'pri_1234567890'};
const freeTrialPrice={id:'pri_1234567890',status:'active',billing_cycle:{interval:'month',frequency:1},unit_price:{amount:'2900',currency_code:'USD'},trial_period:{interval:'day',frequency:14,requires_payment_method:true,unit_price:null,unit_price_overrides:[]}};
const jsonResponse=data=>({ok:true,async json(){return {data};}});

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
  let calledUrl; let calledInit; const urls=[];
  const checkout=await createPaddleCheckout({tenantId,email:'Khan@example.net',planKey:'starter',env,fetchImpl:async(url,init)=>{
    urls.push(url);
    if (url.endsWith('/prices/pri_1234567890')) return jsonResponse(freeTrialPrice);
    calledUrl=url; calledInit=init; return jsonResponse({id:'txn_1234567890',checkout:{url:'https://sandbox-checkout.paddle.com/checkout/txn_1234567890'}});
  }});
  assert.deepEqual(urls,['https://sandbox-api.paddle.com/prices/pri_1234567890','https://sandbox-api.paddle.com/transactions']);
  assert.equal(calledUrl,'https://sandbox-api.paddle.com/transactions');
  assert.equal(calledInit.headers.authorization,`Bearer ${env.ATLAS_PADDLE_API_KEY}`);
  assert.equal(JSON.parse(calledInit.body).customer.email,'khan@example.net');
  assert.equal(JSON.parse(calledInit.body).custom_data.tenant_id,tenantId);
  assert.equal(checkout.checkoutUrl,'https://sandbox-checkout.paddle.com/checkout/txn_1234567890');
  assert.equal(checkout.trialDays,14); assert.deepEqual(checkout.renewal,{amount:'2900',currencyCode:'USD'});
  let missingModeCalled = false;
  const missingMode = { ...env }; delete missingMode.ATLAS_PADDLE_ENVIRONMENT;
  await assert.rejects(createPaddleCheckout({tenantId,email:'khan@example.net',planKey:'starter',env:missingMode,fetchImpl:async()=>{missingModeCalled=true;}}),{code:'billing_environment_required'});
  assert.equal(missingModeCalled,false,'missing environment must fail before making a provider request');
  await assert.rejects(createPaddleCheckout({tenantId,email:'khan@example.net',planKey:'starter',env,fetchImpl:async(url)=>url.endsWith('/prices/pri_1234567890')?jsonResponse(freeTrialPrice):jsonResponse({id:'txn_1234567890',checkout:{url:'https://evil.example/collect'}})}),{code:'paddle_checkout_unavailable'});
  await assert.rejects(createPaddleCheckout({tenantId:'foreign',email:'khan@example.net',planKey:'starter',env}),/verified workspace/);
  await assert.rejects(createPaddleCheckout({tenantId,email:'khan@example.net',planKey:'scale',env}),{code:'billing_not_configured'});
  let attemptedTransaction=false;
  await assert.rejects(createPaddleCheckout({tenantId,email:'khan@example.net',planKey:'starter',env,fetchImpl:async(url)=>{if(url.endsWith('/transactions'))attemptedTransaction=true;return jsonResponse({...freeTrialPrice,trial_period:null});}}),{code:'billing_trial_not_configured'});
  assert.equal(attemptedTransaction,false,'a normal paid price cannot bypass the free-trial price gate');
});

test('Paddle plan prices must be recurring, active, free for exactly 14 days and card-required', async () => {
  const verified=await verifyPaddleFreeTrialPrice({priceId:'pri_1234567890',env,fetchImpl:async(url,init)=>{
    assert.equal(url,'https://sandbox-api.paddle.com/prices/pri_1234567890');
    assert.equal(init.method,'GET'); assert.equal(init.headers.authorization,`Bearer ${env.ATLAS_PADDLE_API_KEY}`);
    return jsonResponse(freeTrialPrice);
  }});
  assert.equal(verified.trialDays,14); assert.deepEqual(verified.billingCycle,{interval:'month',frequency:1});
  for (const invalid of [
    {...freeTrialPrice,trial_period:{...freeTrialPrice.trial_period,frequency:7}},
    {...freeTrialPrice,trial_period:{...freeTrialPrice.trial_period,unit_price:{amount:'1',currency_code:'USD'}}},
    {...freeTrialPrice,trial_period:{...freeTrialPrice.trial_period,requires_payment_method:false}},
    {...freeTrialPrice,trial_period:{...freeTrialPrice.trial_period,unit_price_overrides:[{country_codes:['US'],unit_price:{amount:'1',currency_code:'USD'}}]}},
    {...freeTrialPrice,billing_cycle:null},
    {...freeTrialPrice,status:'archived'}
  ]) await assert.rejects(verifyPaddleFreeTrialPrice({priceId:'pri_1234567890',env,fetchImpl:async()=>jsonResponse(invalid)}),{code:'billing_trial_not_configured'});
});

test('Paddle customer portal returns only temporary HTTPS manage and cancel links for the stored subscription', async () => {
  let calledUrl; let calledInit;
  const portal=await createPaddlePortalSession({customerId:'ctm_1234567890',subscriptionId:'sub_1234567890',env,fetchImpl:async(url,init)=>{
    calledUrl=url; calledInit=init;
    return jsonResponse({customer_id:'ctm_1234567890',urls:{subscriptions:[{id:'sub_1234567890',view_subscription:'https://customer-portal.paddle.com/session?action=view&token=temporary',cancel_subscription:'https://customer-portal.paddle.com/session?action=cancel&token=temporary'}]}});
  }});
  assert.equal(calledUrl,'https://sandbox-api.paddle.com/customers/ctm_1234567890/portal-sessions');
  assert.deepEqual(JSON.parse(calledInit.body),{subscription_ids:['sub_1234567890']});
  assert.equal(portal.manageUrl,'https://customer-portal.paddle.com/session?action=view&token=temporary');
  assert.equal(portal.cancelUrl,'https://customer-portal.paddle.com/session?action=cancel&token=temporary');
  await assert.rejects(createPaddlePortalSession({customerId:'ctm_1234567890',subscriptionId:'sub_1234567890',env,fetchImpl:async()=>jsonResponse({customer_id:'ctm_foreign',urls:{subscriptions:[]}})}),{code:'paddle_portal_unavailable'});
  await assert.rejects(createPaddlePortalSession({customerId:'https://evil.example',subscriptionId:'sub_1234567890',env}),{code:'billing_subscription_required'});
});

test('subscription webhooks validate configured prices, tenant references and supported lifecycle events', () => {
  const event={event_id:'evt_1234567890',event_type:'subscription.trialing',occurred_at:new Date().toISOString(),data:{id:'sub_1234567890',customer_id:'ctm_1234567890',status:'trialing',items:[{price:freeTrialPrice}],custom_data:{tenant_id:tenantId,plan_key:'starter'},current_billing_period:{ends_at:new Date(Date.now()+14*86400_000).toISOString()}}};
  const normalized=normalizePaddleBillingEvent(event,{env});
  assert.equal(normalized.disposition,'apply'); assert.equal(normalized.status,'trialing'); assert.equal(normalized.tenantId,tenantId);
  assert.equal(normalized.trialStartedAt,normalized.occurredAt);
  assert.equal(normalizePaddleBillingEvent({...event,event_type:'customer.updated'},{env}).disposition,'ignored');
  assert.throws(()=>normalizePaddleBillingEvent({...event,data:{...event.data,items:[{price:{id:'pri_foreign_price'}}]}},{env}),/14-day free trial/);
  assert.throws(()=>normalizePaddleBillingEvent({...event,data:{...event.data,items:[{price:{...freeTrialPrice,trial_period:null}}]}},{env}),/14-day free trial/);
  assert.equal(paddleBodySha256(Buffer.from('raw')).length,64);
});
