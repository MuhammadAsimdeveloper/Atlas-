import crypto from 'node:crypto';
import { normalizeActionSchemas, isGenericJsonSchema } from '../atlas-action-fabric/schema.mjs';

const FREEZE = value => Object.freeze(value);
const SHA256 = /^[a-f0-9]{64}$/i;
const ID = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_AUTH = new Set(['oauth2', 'api_key', 'basic', 'bearer', 'hmac', 'none']);
const METHODS = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
const FORBIDDEN_HEADERS = new Set(['authorization','cookie','set-cookie','proxy-authorization','host','content-length','connection','transfer-encoding','upgrade']);
const PRIVATE_HOSTS = new Set(['localhost','localhost.localdomain','ip6-localhost','ip6-loopback']);
const PRIVATE_IPV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|0\.)/;
const PRIVATE_IPV6 = /^(::1|fc|fd|fe80:)/i;

export const AUTH_MODES = FREEZE({
  OAUTH2: 'oauth2',
  API_KEY: 'api_key',
  BASIC: 'basic',
  BEARER: 'bearer',
  HMAC: 'hmac',
  NONE: 'none'
});

const connector = (id, name, auth, protocol='rest', notes='') => FREEZE({
  id, name, auth, protocol, status: 'contracted',
  notes,
  operations: FREEZE(['health'])
});

const CONNECTOR_ROWS = [
  ['google','Google','oauth2','rest'],['microsoft','Microsoft','oauth2','rest'],
  ['slack','Slack','oauth2','rest'],['discord','Discord','oauth2','rest'],
  ['telegram','Telegram','api_key','rest'],['stripe','Stripe','bearer','rest'],
  ['paypal','PayPal','oauth2','rest'],['shopify','Shopify','bearer','rest'],
  ['woocommerce','WooCommerce','basic','rest'],['salesforce','Salesforce','oauth2','rest'],
  ['hubspot','HubSpot','bearer','rest'],['pipedrive','Pipedrive','api_key','rest'],
  ['mailchimp','Mailchimp','api_key','rest'],['sendgrid','SendGrid','api_key','rest'],
  ['twilio','Twilio','basic','rest'],['whatsapp','WhatsApp','bearer','rest'],
  ['openai','OpenAI','bearer','rest'],['anthropic','Anthropic','api_key','rest'],
  ['gemini','Gemini','api_key','rest'],['aws','AWS','hmac','rest'],
  ['azure','Azure','bearer','rest'],['github','GitHub','bearer','rest'],
  ['gitlab','GitLab','bearer','rest'],['notion','Notion','bearer','rest'],
  ['airtable','Airtable','bearer','rest'],['supabase','Supabase','bearer','rest'],
  ['postgresql','PostgreSQL','basic','database'],['mysql','MySQL','basic','database'],
  ['mongodb','MongoDB','basic','database'],['redis','Redis','basic','database'],
  ['s3','Amazon S3','hmac','rest'],['dropbox','Dropbox','oauth2','rest'],
  ['google-drive','Google Drive','oauth2','rest'],['google-calendar','Google Calendar','oauth2','rest'],
  ['microsoft-calendar','Microsoft Calendar','oauth2','rest'],
  ['facebook','Facebook','oauth2','rest'],['instagram','Instagram','oauth2','rest'],
  ['linkedin','LinkedIn','oauth2','rest'],['tiktok','TikTok','oauth2','rest']
];

export const ATLAS_CONNECTORS = FREEZE(CONNECTOR_ROWS.map(row => connector(...row)));

function assertPlain(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(name + ' must be a plain object');
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(name + ' prototype is not allowed');
  }
  return value;
}

function boundedText(value, name, max=500) {
  if (typeof value !== 'string') throw new TypeError(name + ' must be text');
  const text = value.trim();
  if (!text || text.length > max) throw new TypeError(name + ' is invalid');
  return text;
}

function assertRef(value, name) {
  boundedText(value, name, 160);
  if (!ID.test(value)) throw new TypeError(name + ' format is invalid');
  return value;
}

function assertTenantRef(value, name) {
  boundedText(value, name, 160);
  if (!ID.test(value) && !UUID.test(value)) throw new TypeError(name + ' format is invalid');
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function normalizeRequestHeaders(input) {
  if (input == null) return {};
  assertPlain(input,'operation requestHeaders');
  const entries=Object.entries(input);
  if(entries.length>30) throw new TypeError('operation requestHeaders exceed 30 entries');
  const output={};
  for(const [rawName,rawValue] of entries){
    const name=boundedText(rawName,'request header name',80);
    const lower=name.toLowerCase();
    if(!/^[a-z0-9-]+$/i.test(name)||FORBIDDEN_HEADERS.has(lower)||lower==='idempotency-key'||lower.startsWith('x-atlas-')||/authorization|cookie|token|secret|password|signature/i.test(lower)){
      throw Object.assign(new Error('request header is forbidden'),{code:'request_header_forbidden'});
    }
    const value=boundedText(String(rawValue),'request header value',1000);
    if(/[\\r\\n]/.test(value)) throw Object.assign(new Error('request header contains unsafe line breaks'),{code:'request_header_invalid'});
    output[name]=value;
  }
  return output;
}

function normalizeOAuthConfig(input){
  if(input==null) return null;
  assertPlain(input,'connector oauth');
  const tokenUrl=boundedText(input.tokenUrl,'OAuth token URL',2048);
  assertSafeConnectorUrl(tokenUrl);
  const clientId=boundedText(input.clientId,'OAuth client ID',300);
  if(/[\r\n\u0000]/.test(clientId)||/secret|token|password/i.test(clientId)) throw Object.assign(new Error('OAuth client ID is unsafe'),{code:'oauth_client_id_invalid'});
  const scope=input.scope==null?null:boundedText(input.scope,'OAuth scope',2000);
  for(const key of ['clientSecret','accessToken','refreshToken','token','secret']){
    if(Object.hasOwn(input,key)) throw Object.assign(new Error('OAuth connector definition cannot contain secret material'),{code:'oauth_secret_in_definition'});
  }
  return {tokenUrl,clientId,...(scope?{scope}:{})};
}

function normalizeHmacConfig(input){
  if(input==null) return null;
  assertPlain(input,'operation hmac');
  const timestampHeader=boundedText(input.timestampHeader||'x-atlas-timestamp','HMAC timestamp header',80);
  const signatureHeader=boundedText(input.signatureHeader||'x-atlas-signature','HMAC signature header',80);
  for(const name of [timestampHeader,signatureHeader]){
    const lower=name.toLowerCase();
    if(!/^[a-z0-9-]+$/i.test(name)||FORBIDDEN_HEADERS.has(lower)||/authorization|cookie|token|secret|password/i.test(lower)) throw Object.assign(new Error('HMAC header is forbidden'),{code:'hmac_header_forbidden'});
  }
  const algorithm=String(input.algorithm||'sha256').toLowerCase();
  if(algorithm!=='sha256') throw Object.assign(new Error('HMAC algorithm is unsupported'),{code:'hmac_algorithm_unsupported'});
  return {algorithm,timestampHeader,signatureHeader};
}


export function assertSafeConnectorUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) throw new TypeError('connector URL is invalid');
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new TypeError('connector URL is invalid'); }
  if (parsed.protocol !== 'https:') throw Object.assign(new Error('connector URLs must use HTTPS'), { code:'https_required' });
  if (parsed.username || parsed.password) throw Object.assign(new Error('connector URL credentials are forbidden'), { code:'url_credentials_forbidden' });
  const hostname = parsed.hostname.replace(/[.]+$/, '').toLowerCase();
  if (PRIVATE_HOSTS.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw Object.assign(new Error('private connector hostname is forbidden'), { code:'private_network_target' });
  }
  if (PRIVATE_IPV4.test(hostname) || PRIVATE_IPV6.test(hostname) || hostname.startsWith('[')) {
    throw Object.assign(new Error('private connector address is forbidden'), { code:'private_network_target' });
  }
  return true;
}

export function createConnectorDefinition({
  tenantId, id, name, auth='none', baseUrl, operations=[], version=1, scopes=[], rateLimit=null,
  pagination=null, oauth=null, metadata={}
} = {}) {
  assertTenantRef(tenantId, 'tenantId');
  assertRef(id, 'connectorId');
  boundedText(name, 'connector name', 160);
  if (!ALLOWED_AUTH.has(auth)) throw new TypeError('connector auth mode is invalid');
  assertSafeConnectorUrl(baseUrl);
  if (!Number.isSafeInteger(version) || version < 1 || version > 1000000) throw new TypeError('connector version is invalid');
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 500) throw new TypeError('connector operations must contain 1-500 entries');

  const seen = new Set();
  const normalized = operations.map(operation => {
    assertPlain(operation, 'connector operation');
    const opId = assertRef(operation.id, 'operation id');
    if (seen.has(opId)) throw new TypeError('connector operation ids must be unique');
    seen.add(opId);
    const method = String(operation.method || 'GET').toUpperCase();
    if (!METHODS.has(method)) throw new TypeError('connector operation method is invalid');
    const path = boundedText(operation.path || '/', 'operation path', 500);
    if (!path.startsWith('/') || path.includes('://') || path.includes('\\\\')) {
      throw Object.assign(new Error('connector operation path must be relative'), { code:'operation_path_invalid' });
    }
    const schemas=normalizeActionSchemas({inputSchema:operation.inputSchema || {}, outputSchema:operation.outputSchema || {}});
    const requestHeaders=normalizeRequestHeaders(operation.requestHeaders);
    const hmac=normalizeHmacConfig(operation.hmac);
    if(hmac){
      const declared=new Set(Object.keys(requestHeaders).map(key=>key.toLowerCase()));
      if(declared.has(hmac.timestampHeader.toLowerCase())||declared.has(hmac.signatureHeader.toLowerCase())) throw Object.assign(new Error('HMAC headers cannot be overridden by custom headers'),{code:'hmac_header_collision'});
    }
    return FREEZE({
      id: opId,
      method,
      path,
      inputSchema: schemas.inputSchema,
      outputSchema: schemas.outputSchema,
      requestHeaders,
      hmac,
      requiredScopes: [...new Set((Array.isArray(operation.requiredScopes) ? operation.requiredScopes : []).map(value => boundedText(value,'operation scope',240)))].sort(),
      idempotent: operation.idempotent !== false,
      requiresApproval: operation.requiresApproval === true
    });
  });

  const body = {
    tenantId, id, name: boundedText(name, 'connector name', 160), auth, baseUrl: new URL(baseUrl).origin,
    version, scopes: [...new Set((Array.isArray(scopes) ? scopes : []).map(value => boundedText(value,'scope',240)))].sort(),
    rateLimit: rateLimit ? clone(rateLimit) : null,
    pagination: pagination ? clone(pagination) : null,
    oauth: normalizeOAuthConfig(oauth),
    metadata: clone(metadata || {}),
    operations: normalized
  };
  return FREEZE({
    ...body,
    checksum: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')
  });
}

export function verifyConnectorDefinition(connectorDefinition) {
  if (!connectorDefinition || !SHA256.test(String(connectorDefinition.checksum || ''))) return false;
  const { checksum, ...body } = connectorDefinition;
  try {
    return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') === checksum;
  } catch {
    return false;
  }
}

export function validateConnectorOperation(connectorDefinition, operationId) {
  if (!verifyConnectorDefinition(connectorDefinition)) throw new Error('connector definition is invalid');
  const operation = connectorDefinition.operations?.find(item => item.id === operationId);
  if (!operation) throw Object.assign(new Error('connector operation is not granted'), { code:'operation_not_granted' });
  return FREEZE(clone(operation));
}

export function createConnectorSchemaRegistry({ connectors = [], tenantId = null } = {}) {
  if (!Array.isArray(connectors) || connectors.length > 500) throw new TypeError('connectors must contain <= 500 definitions');
  const rows = connectors.map(connectorDefinition => {
    if (!verifyConnectorDefinition(connectorDefinition)) throw new TypeError('connector definition is invalid');
    return FREEZE(clone(connectorDefinition));
  });
  const tenantBound = tenantId == null ? null : boundedText(tenantId, 'registry tenant id', 160);
  const lookup = (safeTenantId, connectorRef) => {
    const expectedTenant = tenantBound || boundedText(safeTenantId, 'tenantId', 160);
    if (tenantBound && safeTenantId !== tenantBound) throw Object.assign(new Error('connector registry tenant scope mismatch'), { code:'tenant_scope_mismatch' });
    const connector = rows.find(item => item.tenantId === expectedTenant && item.id === connectorRef);
    if (!connector) throw Object.assign(new Error('connector is not registered for this tenant'), { code:'connector_not_registered' });
    return connector;
  };
  return FREEZE({
    getOperationSchema({ tenantId: safeTenantId, connectorRef, operationRef } = {}) {
      const connector = lookup(safeTenantId, assertRef(connectorRef, 'connectorRef'));
      const operation = validateConnectorOperation(connector, assertRef(operationRef, 'operationRef'));
      const schemas = normalizeActionSchemas({ inputSchema:operation.inputSchema || {}, outputSchema:operation.outputSchema || {} });
      return FREEZE({
        tenantId: connector.tenantId,
        connectorRef: connector.id,
        operationRef: operation.id,
        protocol: connector.protocol,
        auth: connector.auth,
        baseUrl: connector.baseUrl,
        oauth: connector.oauth ? clone(connector.oauth) : null,
        method: operation.method,
        path: operation.path,
        schemaVersion: 1,
        schemaStatus: isGenericJsonSchema(schemas.inputSchema) && isGenericJsonSchema(schemas.outputSchema) ? 'generic' : 'typed',
        inputSchema: schemas.inputSchema,
        outputSchema: schemas.outputSchema,
        requestHeaders: clone(operation.requestHeaders || {}),
        hmac: operation.hmac ? clone(operation.hmac) : null,
        requiredScopes: Object.freeze([...(operation.requiredScopes || [])].map(String)),
        idempotent: operation.idempotent === true,
        requiresApproval: operation.requiresApproval === true
      });
    },
    has({ tenantId:safeTenantId, connectorRef } = {}) {
      try { lookup(safeTenantId, assertRef(connectorRef, 'connectorRef')); return true; } catch { return false; }
    },
    list({ tenantId:safeTenantId = tenantBound, schemaStatus = null } = {}) {
      const expectedTenant = tenantBound || boundedText(safeTenantId, 'tenantId', 160);
      if (tenantBound && safeTenantId !== tenantBound) throw Object.assign(new Error('connector registry tenant scope mismatch'), { code:'tenant_scope_mismatch' });
      return rows
        .filter(item => item.tenantId === expectedTenant)
        .flatMap(item => item.operations || [])
        .map(operation => {
          const schemas = normalizeActionSchemas({ inputSchema:operation.inputSchema || {}, outputSchema:operation.outputSchema || {} });
          return {
            connectorRef: rows.find(item => item.operations?.some(op => op.id === operation.id && item.tenantId === expectedTenant))?.id,
            operationRef: operation.id,
            schemaVersion:1,
            schemaStatus:isGenericJsonSchema(schemas.inputSchema) && isGenericJsonSchema(schemas.outputSchema) ? 'generic' : 'typed',
            inputSchema:schemas.inputSchema,
            outputSchema:schemas.outputSchema
          };
        })
        .filter(item => schemaStatus === null || item.schemaStatus === schemaStatus)
        .map(clone);
    }
  });
}


function keyBytes(masterKey) {
  const key = Buffer.isBuffer(masterKey) ? Buffer.from(masterKey) : Buffer.from(String(masterKey || ''), 'base64');
  if (key.length !== 32) throw new TypeError('masterKey must be exactly 32 bytes');
  return key;
}

export function encryptCredential({ secret, masterKey } = {}) {
  const key = keyBytes(masterKey);
  const plaintext = Buffer.from(boundedText(secret, 'credential secret', 20000), 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return FREEZE({
    algorithm: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  });
}

export function decryptCredential(envelope, masterKey) {
  assertPlain(envelope, 'credential envelope');
  if (envelope.algorithm !== 'AES-256-GCM') throw new Error('unsupported credential envelope');
  const key = keyBytes(masterKey);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function createCredentialEnvelope({
  tenantId, credentialId, kind='api_key', version=1, secret, masterKey, metadata={}
} = {}) {
  assertRef(tenantId, 'tenantId');
  assertRef(credentialId, 'credentialId');
  boundedText(kind, 'credential kind', 80);
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('credential version is invalid');
  const encrypted = encryptCredential({secret, masterKey});
  const safeMetadata = clone(metadata || {});
  delete safeMetadata.secret;
  delete safeMetadata.token;
  delete safeMetadata.password;
  return FREEZE({
    tenantId, credentialId, kind, version,
    ...encrypted,
    metadata: safeMetadata,
    createdAt: new Date().toISOString()
  });
}

export function rotateCredential({ envelope, newSecret, masterKey, metadata={} } = {}) {
  assertPlain(envelope, 'credential envelope');
  const current = decryptCredential(envelope, masterKey);
  if (!current) throw new Error('credential cannot be rotated from empty state');
  return createCredentialEnvelope({
    tenantId: envelope.tenantId,
    credentialId: envelope.credentialId,
    kind: envelope.kind,
    version: Number(envelope.version) + 1,
    secret: newSecret,
    masterKey,
    metadata
  });
}

export function buildAuthHeaders({ mode='none', accessToken, apiKey, headerName='X-API-Key', username, password } = {}) {
  if (!ALLOWED_AUTH.has(mode)) throw new TypeError('auth mode is invalid');
  if (mode === 'none') return {};
  if (mode === 'bearer' || mode === 'oauth2') {
    const token = boundedText(accessToken, 'accessToken', 20000);
    if (/[,\\s]/.test(token)) throw new TypeError('accessToken contains unsafe whitespace');
    return { authorization: 'Bearer ' + token };
  }
  if (mode === 'api_key') {
    const key = boundedText(apiKey, 'apiKey', 20000);
    const header = boundedText(headerName, 'headerName', 120).toLowerCase();
    if (['authorization','cookie','set-cookie','proxy-authorization'].includes(header)) throw new Error('credential header is not allowed');
    return { [headerName]: key };
  }
  if (mode === 'basic') {
    const user = typeof username === 'string' ? username : '';
    const pass = typeof password === 'string' ? password : '';
    if (!user || user.includes('\\n') || pass.includes('\\n')) throw new TypeError('basic auth credentials are invalid');
    return { authorization: 'Basic ' + Buffer.from(user + ':' + pass, 'utf8').toString('base64') };
  }
  throw new TypeError('HMAC auth requires signing through createHmacSignature');
}

export function createHmacSignature({ secret, timestamp=Math.floor(Date.now()/1000), body='' } = {}) {
  const key = Buffer.from(boundedText(secret, 'HMAC secret', 20000), 'utf8');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError('HMAC timestamp is invalid');
  const payload = String(timestamp) + '.' + String(body);
  const digest = crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex');
  return 't=' + timestamp + ',v1=' + digest;
}

export function verifyWebhookSignature({ secret, timestamp, body='', signature, maxAgeSeconds=300, now=Math.floor(Date.now()/1000) } = {}) {
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(now)) return false;
  if (Math.abs(now - timestamp) > maxAgeSeconds) return false;
  const expected = createHmacSignature({secret, timestamp, body});
  const a = Buffer.from(String(signature || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const header = (headers, name) => {
  const wanted = name.toLowerCase();
  for (const [key,value] of Object.entries(headers || {})) if (String(key).toLowerCase() === wanted) return value;
  return null;
};

export function parseRateLimit({ status, headers={} } = {}) {
  const remainingRaw = header(headers, 'x-ratelimit-remaining');
  const remaining = remainingRaw == null || remainingRaw === '' ? null : Number(remainingRaw);
  const retryAfter = header(headers, 'retry-after');
  let retryAfterMs = 0;
  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) retryAfterMs = Math.max(0, Math.round(seconds * 1000));
    else {
      const dateMs = Date.parse(String(retryAfter));
      if (Number.isFinite(dateMs)) retryAfterMs = Math.max(0, dateMs - Date.now());
    }
  }
  return FREEZE({
    limited: Number(status) === 429 || (remaining !== null && remaining <= 0),
    retryAfterMs,
    remaining: Number.isFinite(remaining) ? Math.max(0, remaining) : null
  });
}

export function computeBackoffMs({ attempt=1, baseMs=500, maxMs=30000, jitterRatio=0 } = {}) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 20) throw new TypeError('attempt is invalid');
  const base = Math.max(1, Number(baseMs) || 500);
  const max = Math.max(base, Number(maxMs) || 30000);
  const raw = Math.min(max, base * (2 ** (attempt - 1)));
  const jitter = Math.max(0, Math.min(1, Number(jitterRatio) || 0));
  return Math.min(max, Math.round(raw + raw * jitter));
}

export function nextPageRequest({ strategy='cursor', request, response={}, cursorParam='cursor', pageParam='page', linkHeader=null } = {}) {
  assertPlain(request, 'request');
  assertSafeConnectorUrl(request.url);
  const url = new URL(request.url);
  const body = response && typeof response.body === 'object' ? response.body : response;
  if (strategy === 'cursor') {
    const cursor = body?.nextCursor ?? body?.next_cursor ?? null;
    if (cursor == null || cursor === '') return null;
    url.searchParams.set(cursorParam, boundedText(String(cursor), 'cursor', 1000));
  } else if (strategy === 'page') {
    const hasMore = body?.hasMore ?? body?.has_more;
    if (!hasMore) return null;
    const current = Number(url.searchParams.get(pageParam) || '1');
    if (!Number.isSafeInteger(current) || current < 1) throw new TypeError('page parameter is invalid');
    url.searchParams.set(pageParam, String(current + 1));
  } else if (strategy === 'link') {
    if (!linkHeader) return null;
    const match = String(linkHeader).match(/<([^>]+)>\\s*;\\s*rel="?next"?/i);
    if (!match) return null;
    assertSafeConnectorUrl(match[1]);
    return FREEZE({ ...clone(request), url: match[1] });
  } else {
    throw new TypeError('pagination strategy is invalid');
  }
  return FREEZE({ ...clone(request), url: url.toString() });
}

export function buildGraphQLRequest({ url, query, variables={} } = {}) {
  assertSafeConnectorUrl(url);
  const q = boundedText(query, 'GraphQL query', 20000);
  assertPlain(variables, 'GraphQL variables');
  return FREEZE({
    url,
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query:q,variables:clone(variables)})
  });
}

export function buildSoapRequest({ url, action, envelope, contentType='text/xml; charset=utf-8' } = {}) {
  assertSafeConnectorUrl(url);
  const soapAction = boundedText(action, 'SOAP action', 500);
  const body = boundedText(envelope, 'SOAP envelope', 50000);
  if (!/^<[^>]+[\s\S]*>\s*$/.test(body)) throw new TypeError('SOAP envelope is invalid');
  return FREEZE({
    url,
    method:'POST',
    headers:{'content-type':contentType,soapaction:soapAction},
    body
  });
}

export function createOAuthRefreshPlan({ tokenUrl, refreshToken, clientId, scope=null } = {}) {
  assertSafeConnectorUrl(tokenUrl);
  const token = boundedText(refreshToken, 'refreshToken', 20000);
  const id = boundedText(clientId, 'clientId', 300);
  return FREEZE({
    url:tokenUrl,
    method:'POST',
    headers:{'accept':'application/json','content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      grant_type:'refresh_token',
      refresh_token:token,
      client_id:id,
      ...(scope ? {scope:boundedText(scope,'scope',2000)} : {})
    }).toString()
  });
}

export function shouldRefreshOAuth({ expiresAt, skewSeconds=60, now=Date.now() } = {}) {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) throw new TypeError('expiresAt is invalid');
  return expiry <= Number(now) + Math.max(0, Number(skewSeconds) * 1000);
}

export function redactHeaders(headers={}) {
  const output = {};
  for (const [key,value] of Object.entries(headers || {})) {
    const normalized = String(key).toLowerCase();
    output[key] = /authorization|cookie|set-cookie|api[-_]?key|token|secret|password|signature/i.test(normalized)
      ? '[REDACTED]' : String(value).slice(0,1000);
  }
  return FREEZE(output);
}

export function validateMarketplacePackage(input={}) {
  assertPlain(input,'marketplace package');
  const id=assertRef(input.id,'package id');
  const version=boundedText(input.version,'package version',80);
  const kind=boundedText(input.kind,'package kind',40);
  const atlasApi=boundedText(input.atlasApi,'atlasApi',80);
  const entrypoint=boundedText(input.entrypoint,'entrypoint',240);
  if (!/^[a-zA-Z0-9_./-]+$/.test(entrypoint) || entrypoint.startsWith('/') || entrypoint.includes('..')) {
    throw new Error('marketplace entrypoint is unsafe');
  }
  const permissions=Array.isArray(input.permissions) ? [...new Set(input.permissions.map(value=>boundedText(value,'permission',160)))] : [];
  if (permissions.length > 100) throw new TypeError('marketplace permissions exceed limit');
  if (permissions.some(item=>/^secrets?[.]/i.test(item) || /credential|private[_-]?key/i.test(item))) {
    throw new Error('marketplace package requests forbidden secret capabilities');
  }
  if (!SHA256.test(String(input.checksum || ''))) throw new Error('marketplace checksum is required');
  return FREEZE({
    status:'verified_metadata', id, version, kind, atlasApi, permissions:permissions.sort(),
    entrypoint, checksum:String(input.checksum).toLowerCase()
  });
}

export function verifyMarketplaceSignature({ manifest, signature, publicKey } = {}) {
  assertPlain(manifest,'manifest');
  if (!SHA256.test(String(manifest.checksum || ''))) return false;
  if (typeof signature !== 'string' || !publicKey) return false;
  try {
    return crypto.verify(null, Buffer.from(manifest.checksum,'hex'), publicKey, Buffer.from(signature,'base64url'));
  } catch { return false; }
}
