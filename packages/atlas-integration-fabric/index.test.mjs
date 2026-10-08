import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATLAS_CONNECTORS,
  AUTH_MODES,
  createConnectorDefinition,
  createCredentialEnvelope,
  decryptCredential,
  encryptCredential,
  rotateCredential,
  buildAuthHeaders,
  createHmacSignature,
  verifyWebhookSignature,
  parseRateLimit,
  computeBackoffMs,
  nextPageRequest,
  buildGraphQLRequest,
  buildSoapRequest,
  validateMarketplacePackage,
  validateConnectorOperation,
  assertSafeConnectorUrl
} from './index.mjs';

test('connector catalog contains the requested provider families', () => {
  const names = new Set(ATLAS_CONNECTORS.map(item => item.id));
  for (const id of [
    'google','microsoft','slack','discord','telegram','stripe','paypal','shopify',
    'woocommerce','salesforce','hubspot','pipedrive','mailchimp','sendgrid','twilio',
    'whatsapp','openai','anthropic','gemini','aws','azure','github','gitlab','notion',
    'airtable','supabase','postgresql','mysql','mongodb','redis','s3','dropbox',
    'google-drive','google-calendar','microsoft-calendar','facebook','instagram',
    'linkedin','tiktok'
  ]) assert.equal(names.has(id), true, id);
});

test('connector definitions are tenant-safe, versioned and operation-scoped', () => {
  const connector = createConnectorDefinition({
    tenantId: 'tenant_123',
    id: 'custom_crm',
    name: 'Custom CRM',
    auth: 'bearer',
    baseUrl: 'https://api.example.com',
    operations: [{ id: 'contacts.list', method: 'GET', path: '/v1/contacts' }]
  });
  assert.equal(connector.tenantId, 'tenant_123');
  assert.equal(connector.version, 1);
  assert.equal(connector.operations[0].id, 'contacts.list');
  assert.throws(() => validateConnectorOperation(connector, 'contacts.delete'));
});

test('credential envelope encrypts without exposing plaintext and rotates versions', () => {
  const key = Buffer.alloc(32, 7);
  const envelope = createCredentialEnvelope({
    tenantId: 'tenant_123',
    credentialId: 'cred_1',
    kind: 'api_key',
    version: 1,
    secret: 'super-secret-value',
    masterKey: key
  });
  assert.equal('secret' in envelope, false);
  const plain = decryptCredential(envelope, key);
  assert.equal(plain, 'super-secret-value');

  const rotated = rotateCredential({
    envelope,
    newSecret: 'new-secret-value',
    masterKey: key
  });
  assert.equal(rotated.version, 2);
  assert.equal(decryptCredential(rotated, key), 'new-secret-value');
});

test('auth helpers support bearer, basic and API key modes', () => {
  assert.deepEqual(
    buildAuthHeaders({ mode: AUTH_MODES.BEARER, accessToken: 'token-123' }),
    { authorization: 'Bearer token-123' }
  );
  assert.match(
    buildAuthHeaders({ mode: AUTH_MODES.BASIC, username: 'u', password: 'p' }).authorization,
    /^Basic /
  );
  assert.deepEqual(
    buildAuthHeaders({ mode: AUTH_MODES.API_KEY, apiKey: 'key-123', headerName: 'X-API-Key' }),
    { 'X-API-Key': 'key-123' }
  );
});

test('HMAC signing uses a timestamped canonical payload', () => {
  const signature = createHmacSignature({
    secret: 'shared',
    timestamp: 1700000000,
    body: '{"ok":true}'
  });
  assert.equal(
    verifyWebhookSignature({
      secret: 'shared',
      timestamp: 1700000000,
      body: '{"ok":true}',
      signature,
      now: 1700000000
    }),
    true
  );
  assert.equal(
    verifyWebhookSignature({
      secret: 'shared',
      timestamp: 1700000000,
      body: '{"ok":false}',
      signature,
      now: 1700000000
    }),
    false
  );
});

test('rate limit parsing and exponential backoff are bounded and deterministic', () => {
  assert.deepEqual(
    parseRateLimit({
      status: 429,
      headers: { 'retry-after': '3', 'x-ratelimit-remaining': '0' }
    }),
    { limited: true, retryAfterMs: 3000, remaining: 0 }
  );
  assert.equal(computeBackoffMs({ attempt: 1, baseMs: 500, maxMs: 5000 }), 500);
  assert.equal(computeBackoffMs({ attempt: 5, baseMs: 500, maxMs: 5000 }), 5000);
});

test('pagination produces bounded next-page requests', () => {
  const page = nextPageRequest({
    strategy: 'cursor',
    request: { url: 'https://api.example.com/items?limit=50', method: 'GET' },
    response: { nextCursor: 'abc123' },
    cursorParam: 'cursor'
  });
  assert.equal(page.url, 'https://api.example.com/items?limit=50&cursor=abc123');
  assert.equal(
    nextPageRequest({
      strategy: 'page',
      request: { url: 'https://api.example.com/items?page=2', method: 'GET' },
      response: { hasMore: false }
    }),
    null
  );
});

test('GraphQL and SOAP requests are generated without hidden network side effects', () => {
  assert.deepEqual(
    buildGraphQLRequest({
      url: 'https://api.example.com/graphql',
      query: 'query GetUser($id: ID!) { user(id: $id) { id } }',
      variables: { id: 'u1' }
    }),
    {
      url: 'https://api.example.com/graphql',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'query GetUser($id: ID!) { user(id: $id) { id } }',
        variables: { id: 'u1' }
      })
    }
  );
  const soap = buildSoapRequest({
    url: 'https://api.example.com/soap',
    action: 'GetUser',
    envelope: '<GetUser><id>u1</id></GetUser>'
  });
  assert.equal(soap.method, 'POST');
  assert.equal(soap.headers.soapaction, 'GetUser');
  assert.match(soap.body, /<GetUser>/);
});

test('connector URLs reject non-HTTPS and obvious private-network destinations', () => {
  assert.equal(assertSafeConnectorUrl('https://api.example.com/v1'), true);
  assert.throws(() => assertSafeConnectorUrl('http://api.example.com/v1'));
  assert.throws(() => assertSafeConnectorUrl('https://127.0.0.1/v1'));
  assert.throws(() => assertSafeConnectorUrl('https://localhost/v1'));
});

test('marketplace packages require signed metadata, compatibility and declared permissions', () => {
  const pkg = validateMarketplacePackage({
    id: 'community.example.crm',
    version: '1.0.0',
    kind: 'connector',
    atlasApi: '>=153',
    permissions: ['contacts.read'],
    entrypoint: 'index.mjs',
    checksum: 'a'.repeat(64)
  });
  assert.equal(pkg.status, 'verified_metadata');
  assert.throws(() => validateMarketplacePackage({
    ...pkg,
    permissions: ['secrets.read']
  }));
});


test('connector operation schemas are normalized and exposed through a tenant-scoped registry', async () => {
  const { createConnectorSchemaRegistry } = await import('./index.mjs');
  const connector=createConnectorDefinition({
    tenantId:'tenant_123',
    id:'custom.crm',
    name:'Custom CRM',
    auth:'bearer',
    baseUrl:'https://api.example.com',
    operations:[{
      id:'contacts.list',
      method:'GET',
      path:'/contacts',
      inputSchema:{type:'object',required:['page'],additionalProperties:false,properties:{page:{type:'integer',minimum:1}}},
      outputSchema:{type:'object',required:['items'],additionalProperties:false,properties:{items:{type:'array',items:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string'}}}}}}
    }]
  });
  const registry=createConnectorSchemaRegistry({connectors:[connector]});
  const schema=registry.getOperationSchema({tenantId:'tenant_123',connectorRef:'custom.crm',operationRef:'contacts.list'});
  assert.equal(schema.connectorRef,'custom.crm');
  assert.equal(schema.operationRef,'contacts.list');
  assert.equal(schema.schemaStatus,'typed');
  assert.equal(schema.inputSchema.properties.page.type,'integer');
  assert.equal(schema.outputSchema.properties.items.items.properties.id.type,'string');
});
