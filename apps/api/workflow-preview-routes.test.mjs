import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createGrowthApi } from './growth-routes.mjs';
import { createWorkflowGraph } from '../../packages/atlas-target/index.mjs';
import { hashOpaqueToken, sessionCookieName } from './auth-contracts.mjs';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = '11111111-1111-4111-8111-111111111111';
const workflowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function fixture() {
  const sessionToken = 'workflow-preview-session-token';
  const csrf = 'workflow-preview-csrf-token';
  const session = {
    tokenHash: hashOpaqueToken(sessionToken),
    csrfHash: hashOpaqueToken(csrf),
    expiresAt: new Date(Date.now() + 60_000),
    tenantId,
    user: { id: actorId, email: 'khan@example.net', displayName: 'Khan', emailVerified: true, status: 'active' },
    memberships: [{ tenant_id: tenantId, role_key: 'owner', status: 'active' }]
  };
  const graph = createWorkflowGraph({
    tenantId,
    id: workflowId,
    name: 'Preview API',
    nodes: [
      { id: 'start', type: 'trigger', config: { eventType: 'contact.created' } },
      { id: 'stop', type: 'stop' }
    ],
    edges: [{ from: 'start', to: 'stop' }]
  });
  const seen = [];
  const authStore = { async getSession({ sessionHash }) { return sessionHash === session.tokenHash ? session : null; } };
  const store = {
    async get(data) { seen.push(data); return { id: workflowId, tenantId, module: 'workflows', payload: { graph } }; }
  };
  const env = { NODE_ENV: 'development', ATLAS_PLATFORM_OWNER_EMAIL: 'khan@example.net' };
  const api = createGrowthApi({ store, authStore, env });
  const server = createServer(async (req, res) => { if (!(await api.handle(req, res))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = {
    origin: base,
    cookie: sessionCookieName(env) + '=' + encodeURIComponent(sessionToken) + '; atlas_csrf=' + encodeURIComponent(csrf),
    'x-atlas-csrf': csrf,
    'content-type': 'application/json'
  };
  return { base, headers, seen, async close() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

test('workflow preview endpoint executes only in safe preview mode', async () => {
  const api = await fixture();
  try {
    const response = await fetch(api.base + '/api/v1/growth/workflows/' + workflowId + '/simulate', {
      method: 'POST',
      headers: api.headers,
      body: JSON.stringify({ event: { type: 'contact.created', firstName: 'Asim' }, executionId: 'api-preview-1' })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.preview, true);
    assert.equal(body.status, 'completed');
    assert.equal(body.externalSideEffects, 0);
    assert.equal(body.steps.length, 2);
    assert.equal(api.seen[0].tenantId, tenantId);
    assert.equal(api.seen[0].actorId, actorId);
  } finally {
    await api.close();
  }
});

test('workflow preview requires the existing workflow record and active tenant', async () => {
  const api = await fixture();
  try {
    const response = await fetch(api.base + '/api/v1/growth/workflows/' + workflowId + '/simulate', {
      method: 'POST',
      headers: { ...api.headers, 'x-atlas-csrf': '' },
      body: JSON.stringify({ event: { type: 'contact.created' } })
    });
    assert.equal(response.status, 403);
  } finally {
    await api.close();
  }
});
