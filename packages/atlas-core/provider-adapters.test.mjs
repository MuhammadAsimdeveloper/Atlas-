import test from 'node:test';import assert from 'node:assert/strict';
import {assertSafeProviderUrl,buildIdempotencyKey,executeProviderAction,verifyWebhookSignature,redactProviderError} from './provider-adapters.mjs';import {createHmac} from 'node:crypto';
test('blocks private provider destinations',()=>{assert.throws(()=>assertSafeProviderUrl('https://127.0.0.1/hook'),/Private provider/);assert.throws(()=>assertSafeProviderUrl('http://example.com'),/not allowed/);});
test('creates stable tenant/action idempotency keys',()=>assert.equal(buildIdempotencyKey({tenantId:'t',action:'send',resourceId:'r'}),buildIdempotencyKey({tenantId:'t',action:'send',resourceId:'r'})));
test('executes only validated adapter results',async()=>{const r=await executeProviderAction({adapter:{key:'test',send:async()=>({status:'sent',providerRef:'p'})},request:{}});assert.equal(r.status,'sent');});
test('verifies timestamped webhook signatures',()=>{const secret='vault/ref/provider';const body='{"event":"x"}';const ts=Date.now();const d=createHmac('sha256',secret).update(ts+'.'+body).digest('hex');assert.equal(verifyWebhookSignature({body,secret,signature:'v1.'+ts+'.'+d}),true);assert.equal(verifyWebhookSignature({body,secret,signature:'v1.'+(ts-400000)+'.'+d}),false);});
test('redacts provider secrets from errors',()=>assert.match(redactProviderError(new Error('Bearer abc secret=xyz')),/redacted/));
