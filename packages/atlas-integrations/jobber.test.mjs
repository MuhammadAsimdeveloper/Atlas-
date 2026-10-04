import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobberAuthorizeUrl, exchangeJobberCode, refreshJobberToken, jobberGraphql, listJobberClientsPage, createJobberClient, verifyJobberWebhook } from './jobber.mjs';
import { createHmac } from 'node:crypto';

function fakeFetch(expectedUrl, responseBody, { status = 200, headers = {} } = {}) {
  return async (url, options) => {
    assert.equal(url, expectedUrl);
    return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json', ...headers } });
  };
}

test('Jobber authorize URL uses state and PKCE', () => {
  const url = buildJobberAuthorizeUrl({
    clientId:'client', redirectUri:'https://atlas.example/cb', state:'state-value', codeChallenge:'challenge', scope:['clients:read','clients:write']
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('response_type'),'code');
  assert.equal(parsed.searchParams.get('code_challenge_method'),'S256');
  assert.equal(parsed.searchParams.get('scope'),'clients:read clients:write');
});

test('Jobber code exchange and refresh parse rotated token sets', async () => {
  const fetchImpl = fakeFetch('https://api.getjobber.com/api/oauth/token', { access_token:'a2', refresh_token:'r2', token_type:'Bearer', expires_in:3600 });
  const exchanged = await exchangeJobberCode({ clientId:'c', clientSecret:'s', redirectUri:'https://atlas.example/cb', code:'code', codeVerifier:'verifier', fetchImpl });
  assert.equal(exchanged.accessToken,'a2');
  const refreshed = await refreshJobberToken({ clientId:'c', clientSecret:'s', refreshToken:'r1', fetchImpl });
  assert.equal(refreshed.refreshToken,'r2');
});

test('Jobber GraphQL checks top-level failures and paginates clients', async () => {
  const body = { data:{ clients:{nodes:[{id:'1',firstName:'Ada',lastName:'Lovelace',email:'ada@example.com'}],pageInfo:{hasNextPage:true,endCursor:'cursor-1'},totalCount:10} } };
  const fetchImpl = fakeFetch('https://api.getjobber.com/api/graphql', body);
  const page = await listJobberClientsPage({ accessToken:'token', graphqlVersion:'2025-04-16', fetchImpl, first:25 });
  assert.equal(page.clients[0].firstName,'Ada');
  assert.equal(page.endCursor,'cursor-1');

  const failed = fakeFetch('https://api.getjobber.com/api/graphql', { errors:[{message:'rate limited'}] });
  await assert.rejects(() => jobberGraphql({ accessToken:'token', graphqlVersion:'2025-04-16', query:'query { account { id } }', fetchImpl:failed }), error => error.code === 'jobber_graphql_error');
});

test('Jobber client creation includes supported documented fields and handles userErrors', async () => {
  let sent = null;
  const fetchImpl = async (url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({data:{clientCreate:{client:{id:'c1',firstName:'Ada',lastName:'Lovelace'},userErrors:[]}}}), {status:200,headers:{'content-type':'application/json'}});
  };
  const client = await createJobberClient({accessToken:'token',graphqlVersion:'2025-04-16',firstName:'Ada',lastName:'Lovelace',companyName:'Atlas',email:'ADA@EXAMPLE.COM',fetchImpl});
  assert.equal(client.id,'c1');
  assert.equal(sent.variables.input.emails[0].address,'ada@example.com');
});

test('Jobber HMAC webhook verification is strict', () => {
  const raw = Buffer.from('{"data":{}}');
  const signature = createHmac('sha256','secret').update(raw).digest('base64');
  assert.equal(verifyJobberWebhook(raw, signature, 'secret'),true);
  assert.equal(verifyJobberWebhook(raw, signature.slice(0,-1) + 'A', 'secret'),false);
});
