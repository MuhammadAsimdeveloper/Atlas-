import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
export const JOBBER_AUTHORIZE_URL = 'https://api.getjobber.com/api/oauth/authorize';
export const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';

function fail(message, code = 'jobber_request_failed', status = 502, meta = {}) {
  throw Object.assign(new Error(message), { code, status, ...meta });
}

function requiredText(value, field, max = 2048) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`${field} is invalid.`);
  return value.trim();
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function parseResponse(response) {
  const contentType = String(response.headers.get('content-type') || '');
  let body;
  try {
    body = contentType.includes('application/json') ? await response.json() : await response.text();
  } catch {
    body = null;
  }
  return body;
}

function tokenPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Jobber token response was malformed.', 'jobber_token_malformed', 502);
  if (typeof body.access_token !== 'string' || !body.access_token || typeof body.refresh_token !== 'string' || !body.refresh_token) {
    fail('Jobber token response is missing required tokens.', 'jobber_token_malformed', 502);
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    tokenType: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 86_400) : 3600,
    warning: typeof body.warning === 'string' ? body.warning.slice(0, 500) : null,
    scope: typeof body.scope === 'string' ? body.scope.split(/\\s+/).filter(Boolean).slice(0, 100) : []
  };
}

export function buildJobberAuthorizeUrl({ clientId, redirectUri, state, codeChallenge, scope = [] } = {}) {
  requiredText(clientId, 'clientId', 256);
  requiredText(redirectUri, 'redirectUri', 2048);
  requiredText(state, 'state', 512);
  requiredText(codeChallenge, 'codeChallenge', 512);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  if (Array.isArray(scope) && scope.length) params.set('scope', scope.join(' '));
  return `${JOBBER_AUTHORIZE_URL}?${params}`;
}

export async function exchangeJobberCode({ clientId, clientSecret, redirectUri, code, codeVerifier, fetchImpl = globalThis.fetch } = {}) {
  requiredText(clientId, 'clientId', 256);
  requiredText(clientSecret, 'clientSecret', 512);
  requiredText(redirectUri, 'redirectUri', 2048);
  requiredText(code, 'code', 4096);
  requiredText(codeVerifier, 'codeVerifier', 512);
  const response = await fetchImpl(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });
  const body = await parseResponse(response);
  if (!response.ok) {
    const codeValue = typeof body?.error === 'string' ? body.error : 'jobber_token_exchange_failed';
    fail('Jobber authorization could not be completed.', codeValue === 'invalid_grant' ? 'jobber_oauth_invalid_grant' : 'jobber_token_exchange_failed', response.status === 400 ? 400 : 502);
  }
  return tokenPayload(body);
}

export async function refreshJobberToken({ clientId, clientSecret, refreshToken, fetchImpl = globalThis.fetch } = {}) {
  requiredText(clientId, 'clientId', 256);
  requiredText(clientSecret, 'clientSecret', 512);
  requiredText(refreshToken, 'refreshToken', 4096);
  const response = await fetchImpl(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  const body = await parseResponse(response);
  if (!response.ok) {
    const codeValue = typeof body?.error === 'string' ? body.error : 'jobber_refresh_failed';
    fail('Jobber access token refresh failed.', codeValue === 'invalid_grant' ? 'jobber_reauth_required' : 'jobber_refresh_failed', response.status === 400 ? 401 : 502);
  }
  return tokenPayload(body);
}

export async function jobberGraphql({ accessToken, graphqlVersion, query, variables = {}, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  requiredText(accessToken, 'accessToken', 4096);
  requiredText(graphqlVersion, 'graphqlVersion', 32);
  requiredText(query, 'query', 50_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Math.min(30_000, Number(timeoutMs) || 10_000)));
  timer.unref?.();
  try {
    const response = await fetchImpl(JOBBER_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-jobber-graphql-version': graphqlVersion,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });
    const body = await parseResponse(response);
    if (response.status === 401) fail('Jobber access token is invalid or expired.', 'jobber_token_expired', 401);
    if (response.status === 429) fail('Jobber rate limit reached; retry the operation.', 'jobber_rate_limited', 429, { retryAfter: response.headers.get('retry-after') || null });
    if (!response.ok) fail('Jobber API returned an unexpected HTTP status.', 'jobber_http_error', 502);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Jobber API returned malformed JSON.', 'jobber_invalid_response', 502);
    if (Array.isArray(body.errors) && body.errors.length) {
      const message = String(body.errors[0]?.message || 'Jobber GraphQL request failed').slice(0, 500);
      fail(message, 'jobber_graphql_error', 502, { graphqlErrors: body.errors.slice(0, 5) });
    }
    return body;
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') fail('Jobber API request timed out.', 'jobber_timeout', 504);
    fail('Jobber API request failed.', 'jobber_network_error', 502);
  } finally {
    clearTimeout(timer);
  }
}

const ACCOUNT_QUERY = `query AtlasAccount { account { id name countryCode } }`;
const CLIENTS_QUERY = `query AtlasClients($first: Int!, $after: String) {
  clients(first: $first, after: $after) {
    nodes {
      id firstName lastName companyName email phone updatedAt jobberWebUri isArchived isLead
    }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}`;
const CREATE_CLIENT = `mutation AtlasClientCreate($input: ClientCreateAttributes!) {
  clientCreate(input: $input) {
    client { id firstName lastName companyName email phone updatedAt jobberWebUri }
    userErrors { message path }
  }
}`;
const EDIT_CLIENT = `mutation AtlasClientEdit($clientId: EncodedId!, $input: ClientEditAttributes!) {
  clientEdit(clientId: $clientId, input: $input) {
    client { id firstName lastName companyName email phone updatedAt jobberWebUri }
    userErrors { message path }
  }
}`;

export async function getJobberAccount({ accessToken, graphqlVersion, fetchImpl, timeoutMs } = {}) {
  const response = await jobberGraphql({ accessToken, graphqlVersion, query: ACCOUNT_QUERY, fetchImpl, timeoutMs });
  if (!response.data?.account?.id) fail('Jobber account response is missing account identity.', 'jobber_account_missing', 502);
  return response.data.account;
}

export async function listJobberClientsPage({ accessToken, graphqlVersion, after = null, first = 100, fetchImpl, timeoutMs } = {}) {
  const size = Number.isInteger(first) ? Math.max(1, Math.min(100, first)) : 100;
  const response = await jobberGraphql({
    accessToken, graphqlVersion, query: CLIENTS_QUERY, variables: { first: size, after }, fetchImpl, timeoutMs
  });
  const page = response.data?.clients;
  if (!page || !Array.isArray(page.nodes) || !page.pageInfo) fail('Jobber clients response is malformed.', 'jobber_clients_malformed', 502);
  return {
    clients: page.nodes,
    hasNextPage: Boolean(page.pageInfo.hasNextPage),
    endCursor: page.pageInfo.endCursor || null,
    totalCount: Number.isFinite(Number(page.totalCount)) ? Number(page.totalCount) : null
  };
}

function userErrors(result, operation) {
  const errors = Array.isArray(result?.userErrors) ? result.userErrors : [];
  if (errors.length) {
    const detail = errors.map(error => ({
      message: String(error?.message || 'Jobber rejected the request').slice(0, 300),
      path: Array.isArray(error?.path) ? error.path.slice(0, 10) : []
    }));
    fail(`Jobber rejected the ${operation} operation.`, 'jobber_user_error', 400, { userErrors: detail });
  }
  if (!result?.client?.id) fail(`Jobber ${operation} response did not return a client.`, 'jobber_mutation_malformed', 502);
  return result.client;
}

export async function createJobberClient({ accessToken, graphqlVersion, firstName, lastName = '', companyName = null, email, fetchImpl, timeoutMs } = {}) {
  requiredText(firstName, 'firstName', 80);
  if (lastName !== '') requiredText(lastName, 'lastName', 80);
  requiredText(email, 'email', 254);
  const input = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    emails: [{ description: 'MAIN', primary: true, address: email.trim().toLowerCase() }]
  };
  if (companyName) input.companyName = requiredText(companyName, 'companyName', 160);
  const response = await jobberGraphql({ accessToken, graphqlVersion, query: CREATE_CLIENT, variables: { input }, fetchImpl, timeoutMs });
  return userErrors(response.data?.clientCreate, 'clientCreate');
}

export async function editJobberClient({ accessToken, graphqlVersion, clientId, firstName, lastName = '', companyName = null, email = null, fetchImpl, timeoutMs } = {}) {
  requiredText(clientId, 'clientId', 512);
  const input = {};
  if (firstName !== undefined) input.firstName = requiredText(firstName, 'firstName', 80);
  if (lastName !== undefined) input.lastName = requiredText(lastName, 'lastName', 80);
  if (companyName !== null && companyName !== undefined) input.companyName = requiredText(companyName, 'companyName', 160);
  if (email !== null && email !== undefined) {
    requiredText(email, 'email', 254);
    input.emails = [{ description: 'MAIN', primary: true, address: email.trim().toLowerCase() }];
  }
  if (!Object.keys(input).length) throw new TypeError('At least one client field is required.');
  const response = await jobberGraphql({ accessToken, graphqlVersion, query: EDIT_CLIENT, variables: { clientId, input }, fetchImpl, timeoutMs });
  return userErrors(response.data?.clientEdit, 'clientEdit');
}

export function verifyJobberWebhook(rawBody, signature, clientSecret) {
  if (!Buffer.isBuffer(rawBody)) rawBody = Buffer.from(String(rawBody ?? ''), 'utf8');
  if (rawBody.length > 256_000 || typeof signature !== 'string' || typeof clientSecret !== 'string' || !clientSecret) return false;
  const normalized = signature.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return false;
  const expected = createHmac('sha256', clientSecret).update(rawBody).digest();
  let provided;
  try { provided = Buffer.from(normalized, 'base64'); } catch { return false; }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function webhookEventKey(rawBody) {
  if (!Buffer.isBuffer(rawBody)) rawBody = Buffer.from(String(rawBody ?? ''), 'utf8');
  return createHash('sha256').update(rawBody).digest('hex');
}
