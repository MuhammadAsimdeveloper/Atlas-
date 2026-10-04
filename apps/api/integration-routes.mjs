import { createAuthError, sessionCookieName, hashOpaqueToken, isAllowedOrigin, parseCookies, verifyCsrf } from './auth-contracts.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { resolveAtlasAuthority } from '../../packages/atlas-core/authority.mjs';
import { listProviders, getProvider, buildProviderConnectionPlan, listIntegrationRecipes } from '../../packages/atlas-integrations/index.mjs';
import { exchangeJobberCode, getJobberAccount, verifyJobberWebhook, webhookEventKey } from '../../packages/atlas-integrations/jobber.mjs';
import { hashSecret } from '../../packages/atlas-integrations/secrets.mjs';

function send(res, status, body, env, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...(env.NODE_ENV === 'production' ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
  return true;
}

function sendHtml(res, status, title, message, env) {
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#172033}main{border:1px solid #dfe3eb;border-radius:16px;padding:28px}a{display:inline-block;padding:10px 14px;border-radius:9px;background:#172033;color:#fff;text-decoration:none}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(message)}</p><a href="/">Return to Atlas</a></main></body></html>`;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...(env.NODE_ENV === 'production' ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {})
  });
  res.end(html);
  return true;
}

async function readRawBody(req, maxBytes = 256_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw createAuthError(413, 'request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJsonBuffer(raw) {
  const contentType = String(raw.contentType || '').toLowerCase();
  void contentType;
}

function readJsonBytes(raw) {
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('object required');
    return value;
  } catch {
    throw createAuthError(400, 'invalid_json');
  }
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw createAuthError(415, 'json_required');
  return readJsonBytes(await readRawBody(req, 30_000));
}

function exact(body, fields) {
  if (Object.keys(body).some(key => !fields.includes(key))) throw createAuthError(400, 'unsupported_request_fields');
}

function idempotencyFor(request) {
  return createHash('sha256').update(JSON.stringify({ nonce: randomUUID(), request })).digest('hex');
}

export function createIntegrationApi({ authStore, integrationStore = null, env = process.env } = {}) {
  if (!authStore) throw new TypeError('Integration API requires the authentication store.');

  async function identity(req) {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies.get(sessionCookieName(env));
    if (!raw) throw createAuthError(401, 'authentication_required');
    const session = await authStore.getSession({ sessionHash: hashOpaqueToken(raw) });
    if (!session?.tenantId) throw createAuthError(401, 'authentication_required');
    const memberships = (session.memberships || []).map(row => ({
      actorId: session.user.id, tenantId: row.tenant_id, role: row.role_key, status: row.status
    }));
    const publisherAuthority = resolveAtlasAuthority({
      actor: { ...session.user, authenticated: true, emailVerified: session.user.emailVerified, status: session.user.status },
      tenantId: session.tenantId,
      memberships,
      ownerEmail: env.ATLAS_PLATFORM_OWNER_EMAIL
    });
    return { session, actorId: session.user.id, tenantId: session.tenantId, publisherAuthority };
  }

  function canRead(who) {
    const membership = (who.session.memberships || []).find(row => row.tenant_id === who.tenantId && row.status === 'active');
    return Boolean(membership);
  }

  async function requireMutation(req, who) {
    if (!isAllowedOrigin(req, env)) throw createAuthError(403, 'origin_not_allowed');
    if (!(await verifyCsrf(req, who.session, env))) throw createAuthError(403, 'csrf_check_failed');
  }

  function requireStore() {
    if (!integrationStore) throw createAuthError(503, 'integration_storage_not_configured', 'Provider connections require ATLAS_INTEGRATION_ENCRYPTION_KEY and V118 database migration.');
    return integrationStore;
  }

  async function publicJobberWebhook(req, res) {
    const raw = await readRawBody(req, 256_000);
    const signature = req.headers['x-jobber-hmac-sha256'];
    const secret = env.ATLAS_JOBBER_CLIENT_SECRET;
    if (!secret || !verifyJobberWebhook(raw, signature, secret)) return send(res, 401, { error: 'webhook_signature_invalid' }, env);
    const payload = readJsonBytes(raw);
    const event = payload?.data?.webHookEvent;
    if (!event || typeof event.accountId !== 'string' || typeof event.topic !== 'string') {
      return send(res, 400, { error: 'jobber_webhook_invalid' }, env);
    }
    const store = requireStore();
    const result = await store.ingestJobberWebhook({
      accountId: event.accountId,
      externalEventKey: webhookEventKey(raw),
      topic: event.topic,
      externalObjectId: typeof event.itemId === 'string' ? event.itemId : null,
      payload
    });
    return send(res, 202, {
      accepted: true,
      duplicate: Boolean(result?.duplicate),
      queued: Boolean(result?.queued),
      disconnected: Boolean(result?.disconnected)
    }, env);
  }

  async function publicZapierWebhook(req, res, key) {
    const raw = await readRawBody(req, 256_000);
    const payload = readJsonBytes(raw);
    const store = requireStore();
    try {
      const result = await store.ingestZapierWebhook({
        webhookKeyHash: hashSecret(key),
        externalEventKey: webhookEventKey(raw),
        payload
      });
      return send(res, 202, { accepted: true, duplicate: Boolean(result?.duplicate), queued: Boolean(result?.queued) }, env);
    } catch (error) {
      if (error?.code === 'integration_connection_not_found') return send(res, 404, { error: 'not_found' }, env);
      throw error;
    }
  }

  async function oauthCallback(req, res, providerId, url) {
    const store = requireStore();
    const state = url.searchParams.get('state');
    if (!state) return sendHtml(res, 400, 'Connection could not be completed', 'The OAuth state was missing. Start the connection from Atlas again.', env);
    const stateRow = await store.consumeOAuthState(state);
    if (stateRow.provider_id !== providerId || providerId !== 'jobber') throw createAuthError(400, 'oauth_provider_mismatch');
    if (url.searchParams.get('error')) return sendHtml(res, 200, 'Jobber connection cancelled', 'No Atlas credentials were stored. You can start the connection again from Integrations.', env);
    const expectedRedirect = new URL('/api/v1/integrations/oauth/jobber/callback', new URL(env.ATLAS_PUBLIC_ORIGIN)).toString();
    if (stateRow.redirect_uri !== expectedRedirect) throw createAuthError(400, 'oauth_redirect_mismatch');
    const code = url.searchParams.get('code');
    if (!code) throw createAuthError(400, 'oauth_code_missing');
    const verifier = store.decryptOAuthVerifier(stateRow);
    const tokens = await exchangeJobberCode({
      clientId: env.ATLAS_JOBBER_CLIENT_ID,
      clientSecret: env.ATLAS_JOBBER_CLIENT_SECRET,
      redirectUri: stateRow.redirect_uri,
      code,
      codeVerifier: verifier
    });
    const account = await getJobberAccount({
      accessToken: tokens.accessToken,
      graphqlVersion: env.ATLAS_JOBBER_GRAPHQL_VERSION
    });
    await store.saveJobberConnection({
      actorId: stateRow.actor_id,
      tenantId: stateRow.tenant_id,
      account,
      tokens,
      graphqlVersion: env.ATLAS_JOBBER_GRAPHQL_VERSION
    });
    return sendHtml(res, 200, 'Jobber connected', `${account.name} is now connected to Atlas. You can return to Integrations and run the first synchronization.`, env);
  }

  async function route(req, res) {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    const path = url.pathname;

    if (req.method === 'POST' && path === '/api/v1/integrations/webhooks/jobber') {
      try { return await publicJobberWebhook(req, res); } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        return send(res, status, { error: error?.code || 'webhook_unavailable' }, env);
      }
    }
    const zapierInbound = path.match(/^\/api\/v1\/integrations\/webhooks\/zapier\/([A-Za-z0-9_-]{32,512})$/);
    if (req.method === 'POST' && zapierInbound) {
      try { return await publicZapierWebhook(req, res, zapierInbound[1]); } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        return send(res, status, { error: error?.code || 'webhook_unavailable' }, env);
      }
    }
    const oauthMatch = path.match(/^\/api\/v1\/integrations\/oauth\/([a-z0-9-]+)\/callback$/);
    if (req.method === 'GET' && oauthMatch) {
      try { return await oauthCallback(req, res, oauthMatch[1], url); } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        return sendHtml(res, status, 'Connection could not be completed', error?.message || 'The provider connection failed. Start again from Atlas.', env);
      }
    }

    if (!path.startsWith('/api/v1/integrations')) return false;
    try {
      const who = await identity(req);
      if (!canRead(who)) throw createAuthError(403, 'integrations_read_forbidden');

      if (path === '/api/v1/integrations/providers' && req.method === 'GET') {
        const providers = listProviders({
          category: url.searchParams.get('category') || null,
          query: url.searchParams.get('q') || '',
          status: url.searchParams.get('status') || null
        });
        return send(res, 200, { providers, count: providers.length }, env);
      }

      if (path === '/api/v1/integrations/recipes' && req.method === 'GET') {
        return send(res, 200, { recipes: listIntegrationRecipes({ providerId: url.searchParams.get('provider') || null }) }, env);
      }

      const providerMatch = path.match(/^\/api\/v1\/integrations\/providers\/([a-z0-9-]+)$/);
      if (providerMatch && req.method === 'GET') {
        return send(res, 200, { provider: getProvider(providerMatch[1]) }, env);
      }

      const store = requireStore();
      if (path === '/api/v1/integrations/connections' && req.method === 'GET') {
        return send(res, 200, { connections: await store.listConnections({ actorId: who.actorId, tenantId: who.tenantId }) }, env);
      }

      if (path === '/api/v1/integrations/oauth/jobber/start' && req.method === 'POST') {
        await requireMutation(req, who);
        return send(res, 201, await store.createJobberOAuthStart({ actorId: who.actorId, tenantId: who.tenantId }), env);
      }

      if (path === '/api/v1/integrations/zapier/connections' && req.method === 'POST') {
        await requireMutation(req, who);
        const body = await readJson(req);
        exact(body, ['displayName','targetUrl','signingSecret']);
        return send(res, 201, await store.createZapierConnection({
          actorId: who.actorId, tenantId: who.tenantId, displayName: body.displayName, targetUrl: body.targetUrl, signingSecret: body.signingSecret || null
        }), env);
      }

      const connectionMatch = path.match(/^\/api\/v1\/integrations\/connections\/([0-9a-f-]{36})\/(health|sync|test|disconnect)$/);
      if (connectionMatch) {
        await requireMutation(req, who);
        const connectionId = connectionMatch[1];
        const connection = await store.getConnection({ actorId: who.actorId, tenantId: who.tenantId, connectionId });
        const action = connectionMatch[2];
        if (action === 'disconnect') {
          return send(res, 200, { connection: await store.disconnect({ actorId: who.actorId, tenantId: who.tenantId, connectionId }) }, env);
        }
        if (connection.provider_id === 'jobber') {
          const operation = action === 'sync' ? 'jobber.sync_clients' : 'jobber.health';
          const task = await store.createTask({ actorId: who.actorId, tenantId: who.tenantId, connectionId, operation, request: { requestedAt: new Date().toISOString(), nonce: randomUUID() }, idempotencyKey: idempotencyFor({ connectionId, operation }) });
          return send(res, 202, { task }, env);
        }
        if (connection.provider_id === 'zapier' && action === 'test') {
          const task = await store.createTask({ actorId: who.actorId, tenantId: who.tenantId, connectionId, operation: 'zapier.send_test', request: { requestedAt: new Date().toISOString(), nonce: randomUUID() }, idempotencyKey: idempotencyFor({ connectionId, operation: 'zapier.send_test' }) });
          return send(res, 202, { task }, env);
        }
        throw createAuthError(400, 'integration_action_unsupported');
      }

      if (path === '/api/v1/integrations/connection-plan' && req.method === 'POST') {
        await requireMutation(req, who);
        const body = await readJson(req);
        exact(body, ['providerId','requestedCapabilities','syncMode']);
        if (!Array.isArray(body.requestedCapabilities)) throw createAuthError(400, 'requested_capabilities_invalid');
        return send(res, 201, {
          plan: buildProviderConnectionPlan({
            providerId: body.providerId,
            tenantId: who.tenantId,
            requestedCapabilities: body.requestedCapabilities,
            syncMode: body.syncMode || 'bidirectional'
          })
        }, env);
      }

      return send(res, 405, { error: 'method_not_allowed' }, env, { allow: 'GET, POST' });
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      const body = { error: typeof error?.code === 'string' ? error.code : 'integration_service_unavailable' };
      if (status !== 500) body.message = error?.message;
      return send(res, status, body, env);
    }
  }

  return { handle: route };
}
