import test from 'node:test';import assert from 'node:assert/strict';import {executeWithRetry,createZapierWebhookAdapter,createJobberAdapter} from './integration-runtime.mjs';
test('retries transient integration responses and succeeds',async()=>{let n=0;const r=await executeWithRetry(async()=>{n++;return n<3?{ok:false,status:503,headers:new Headers()}:{ok:true,status:200,data:{ok:true}}},{baseDelayMs:0});assert.equal(n,3);assert.equal(r.data.ok,true)});
test('rejects non-HTTPS Zapier hooks',()=>assert.throws(()=>createZapierWebhookAdapter({hookUrl:'http://example.com/hook'}),/zapier_hook_url_required/));
test('requires a real Jobber access token',()=>assert.throws(()=>createJobberAdapter({accessToken:'short'}),/jobber_access_token_required/));
test('pins Jobber API to the documented host',()=>assert.throws(()=>createJobberAdapter({accessToken:'x'.repeat(30),apiUrl:'https://evil.example/graphql'}),/private|unsafe|not allowed|host/i));
