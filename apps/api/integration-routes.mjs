import { sessionCookieName, createAuthError, hashOpaqueToken, isAllowedOrigin, parseCookies, verifyCsrf } from './auth-contracts.mjs';
import { resolveAtlasAuthority } from '../../packages/atlas-core/authority.mjs';
import { listProviders, getProvider, buildProviderConnectionPlan, listIntegrationRecipes } from '../../packages/atlas-integrations/index.mjs';

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

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw createAuthError(415, 'json_required');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 30_000) throw createAuthError(413, 'request_too_large');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('object required');
    return value;
  } catch { throw createAuthError(400, 'invalid_json'); }
}

function exact(body, fields) {
  if (Object.keys(body).some(key => !fields.includes(key))) throw createAuthError(400, 'unsupported_request_fields');
}

export function createIntegrationApi({ authStore, env = process.env } = {}) {
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
    return Boolean(membership && ['owner','admin','member','viewer'].includes(membership.role_key));
  }

  function canManage(who) {
    const membership = (who.session.memberships || []).find(row => row.tenant_id === who.tenantId && row.status === 'active');
    if (!membership) return false;
    if (['owner','admin'].includes(membership.role_key)) return true;
    const permissions = Array.isArray(membership.permissions) ? membership.permissions : [];
    return permissions.includes('integrations.manage');
  }

  async function requireMutation(req, who) {
    if (!isAllowedOrigin(req, env)) throw createAuthError(403, 'origin_not_allowed');
    if (!(await verifyCsrf(req, who.session, env))) throw createAuthError(403, 'csrf_check_failed');
    if (!canManage(who)) throw createAuthError(403, 'integrations_manage_forbidden');
  }

  async function route(req, res) {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    const path = url.pathname;
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
      const body = { error: typeof error.code === 'string' ? error.code : 'integration_service_unavailable' };
      if (error?.unsupported) body.unsupported = error.unsupported;
      if (status !== 500) body.message = error.message;
      return send(res, status, body, env);
    }
  }

  return { handle: route };
}
