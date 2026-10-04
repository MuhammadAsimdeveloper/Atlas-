import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from './provider-integrations.mjs';

const originalFetch = globalThis.fetch;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers:{ 'content-type':'application/json' } });
}

test('Jobber health handler calls account API and marks the connection healthy', async () => {
  const health = [];
  const taskStates = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.getjobber.com/api/graphql');
    assert.equal(options.headers.authorization, 'Bearer jobber-access');
    assert.equal(options.headers['x-jobber-graphql-version'], '2026-01-01');
    return jsonResponse({ data:{ account:{ id:'acct-1', name:'Test Business', countryCode:'US' } } });
  };
  try {
    const integrationStore = {
      async workerGetTask() { return { tenant_id:'00000000-0000-4000-8000-000000000002', task_id:'00000000-0000-4000-8000-000000000001', connection_id:'00000000-0000-4000-8000-000000000003', operation:'jobber.health', provider_id:'jobber', auth_mode:'oauth2', status:'connected', config:{ graphqlVersion:'2026-01-01' }, connection_status:'connected', connection_created_by:'00000000-0000-4000-8000-000000000004' }; },
      async workerMarkTask(task, status, result, error) {
        taskStates.push({ status, result, error });
      },
      async workerGetValidJobberSecret({ refresh }) {
        void refresh;
        return { secret:{ accessToken:'jobber-access' }, connection:{} };
      },
      async workerMarkHealth(input) { health.push(input); }
    };
    const { jobHandlers } = await createHandlers({ runtimeStore:{}, integrationStore, env:{ ATLAS_JOBBER_GRAPHQL_VERSION:'2026-01-01' } });
    const result = await jobHandlers['integration.execute'](
      { kind:'integration_task', id:'00000000-0000-4000-8000-000000000001', version:1 },
      { tenantId:'00000000-0000-4000-8000-000000000002', taskId:'00000000-0000-4000-8000-000000000001', attempt:0 }
    );
    assert.equal(result.status, 'healthy');
    assert.deepEqual(taskStates.map(item => item.status), ['processing', 'succeeded']);
    assert.equal(taskStates[1].result.status, 'healthy');
    assert.equal(taskStates[1].error, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Zapier send_test targets only the selected connection', async () => {
  const sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push({ url, body:JSON.parse(options.body) });
    return jsonResponse({}, 200);
  };
  try {
    const integrationStore = {
      async workerGetTask() {
        return {
          task_id:'00000000-0000-4000-8000-000000000010',
          tenant_id:'00000000-0000-4000-8000-000000000002',
          connection_id:'00000000-0000-4000-8000-000000000003',
          provider_id:'zapier',
          auth_mode:'webhook',
          status:'connected'
        };
      },
      async workerGetConnection() {
        return {
          connection_id:'00000000-0000-4000-8000-000000000003',
          provider_id:'zapier',
          auth_mode:'webhook',
          status:'connected',
          secret_ciphertext:'ignored',
          tenant_id:'00000000-0000-4000-8000-000000000002'
        };
      },
      decryptSecret() {
        return { targetUrl:'https://hooks.zapier.com/hooks/catch/test', signingSecret:null };
      },
      async workerMarkTask() {}
    };
    const { jobHandlers } = await createHandlers({ runtimeStore:{}, integrationStore, env:{} });
    // Execute only the live task path through the worker's task handler.
    const result = await jobHandlers['integration.execute'](
      { kind:'integration_task', id:'00000000-0000-4000-8000-000000000010', version:1 },
      { tenantId:'00000000-0000-4000-8000-000000000002', attempt:0 }
    );
    assert.equal(sent.length,1);
    assert.equal(sent[0].url,'https://hooks.zapier.com/hooks/catch/test');
    assert.equal(result.sent.length,1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
