import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityApi } from './capability-routes.mjs';

function response() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.statusCode=status; this.headers=headers; },
    end(value='') { this.body=String(value); }
  };
}

function request(url, cookie='atlas_session=test-session') {
  return {
    method:'GET',
    url,
    headers:{ cookie },
    async *[Symbol.asyncIterator]() {}
  };
}

const env={NODE_ENV:'development',ATLAS_PUBLIC_ORIGIN:'http://localhost:4000',ATLAS_SESSION_SECRET:'test-secret'};

test('platform exposes the hardened connector catalog and five-phase feature registry', async () => {
  const authStore={getSession: async () => ({tenantId:'tenant_123',user:{id:'actor_123'},csrfToken:'csrf'})};
  const api=createCapabilityApi({store:{},authStore,env});
  const connectorsRes=response();
  const connectorsHandled=await api.handle(request('/api/v1/platform/connectors/catalog'),connectorsRes);
  assert.equal(connectorsHandled,true);
  assert.equal(connectorsRes.statusCode,200);
  const connectors=JSON.parse(connectorsRes.body);
  assert.ok(connectors.items.some(item=>item.id==='google'));
  assert.ok(connectors.items.some(item=>item.id==='stripe'));
  assert.ok(connectors.items.some(item=>item.id==='google-calendar'));

  const featuresRes=response();
  const featuresHandled=await api.handle(request('/api/v1/platform/features'),featuresRes);
  assert.equal(featuresHandled,true);
  assert.equal(featuresRes.statusCode,200);
  const features=JSON.parse(featuresRes.body);
  assert.equal(features.phases.length,5);
  assert.ok(features.items.some(item=>item.id==='security.passkeys'));
});

test('new platform registries still require an authenticated tenant session', async () => {
  const authStore={getSession: async () => null};
  const api=createCapabilityApi({store:{},authStore,env});
  const res=response();
  await api.handle(request('/api/v1/platform/connectors/catalog',''),res);
  assert.equal(res.statusCode,401);
  assert.equal(JSON.parse(res.body).error,'authentication_required');
});
