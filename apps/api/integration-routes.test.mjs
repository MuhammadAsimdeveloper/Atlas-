import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { createIntegrationApi } from './integration-routes.mjs';

function responseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(value = '') { this.body += String(value); }
  };
}

function request(raw, headers = {}, method = 'POST', url = '/') {
  const req = Readable.from([Buffer.from(raw)]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'atlas.test', ...headers };
  return req;
}

test('Jobber webhook accepts an authentic raw-body HMAC and delegates to the ingress store', async () => {
  const calls = [];
  const store = {
    async ingestJobberWebhook(input) { calls.push(input); return { duplicate:false, queued:true, disconnected:false }; }
  };
  const env = { NODE_ENV:'test', ATLAS_JOBBER_CLIENT_SECRET:'secret' };
  const api = createIntegrationApi({ authStore:{}, integrationStore:store, env });
  const raw = JSON.stringify({ data:{ webHookEvent:{ topic:'CLIENT_UPDATE', accountId:'account-1', itemId:'item-1', occurredAt:'2026-10-04T00:00:00Z' } } });
  const signature = createHmac('sha256','secret').update(Buffer.from(raw)).digest('base64');
  const res = responseRecorder();
  await api.handle(request(raw, { 'x-jobber-hmac-sha256':signature }, 'POST', '/api/v1/integrations/webhooks/jobber'), res);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(JSON.parse(res.body), { accepted:true, duplicate:false, queued:true, disconnected:false });
  assert.equal(calls[0].accountId,'account-1');
  assert.equal(calls[0].topic,'CLIENT_UPDATE');
});

test('Jobber webhook rejects an invalid signature before touching the store', async () => {
  let called = false;
  const api = createIntegrationApi({
    authStore:{},
    integrationStore:{ async ingestJobberWebhook(){ called = true; } },
    env:{ NODE_ENV:'test', ATLAS_JOBBER_CLIENT_SECRET:'secret' }
  });
  const res = responseRecorder();
  await api.handle(request('{"data":{"webHookEvent":{"topic":"CLIENT_UPDATE","accountId":"a","itemId":"i"}}}', { 'x-jobber-hmac-sha256':'invalid' }, 'POST', '/api/v1/integrations/webhooks/jobber'), res);
  assert.equal(res.statusCode,401);
  assert.equal(called,false);
});

test('Zapier inbound webhook is deduplicated through the integration store and returns 202', async () => {
  const calls = [];
  const api = createIntegrationApi({
    authStore:{},
    integrationStore:{ async ingestZapierWebhook(input){ calls.push(input); return { duplicate:false, queued:true }; } },
    env:{ NODE_ENV:'test' }
  });
  const res = responseRecorder();
  await api.handle(request('{"event":"lead.created","id":"lead-1"}', {}, 'POST', '/api/v1/integrations/webhooks/zapier/test-key-12345678901234567890123456789012'), res);
  assert.equal(res.statusCode,202);
  assert.equal(calls.length,1);
  assert.equal(calls[0].webhookKeyHash.length,64);
});
