import { sessionCookieName, hashOpaqueToken, parseCookies, isAllowedOrigin, verifyCsrf, createAuthError } from './auth-contracts.mjs';
import { resolveAtlasAuthority, requireAtlasPlatformOwner } from '../../packages/atlas-core/authority.mjs';
import { securityHeaders, enforceRateLimit } from './security.mjs';

const LIMIT = 100;
function send(res, status, body, env) {
  res.writeHead(status, { ...securityHeaders(env), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
}
function boundedLimit(value) { const n = Number(value); return Number.isInteger(n) ? Math.max(1, Math.min(LIMIT, n)) : 25; }

export function createPlatformAdminApi({ pool, authStore, env = process.env } = {}) {
  if (!pool || !authStore) throw new TypeError('Platform admin requires database and auth stores.');
  async function identity(req) {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies.get(sessionCookieName(env));
    if (!raw) throw createAuthError(401, 'authentication_required');
    const session = await authStore.getSession({ sessionHash: hashOpaqueToken(raw) });
    if (!session) throw createAuthError(401, 'authentication_required');
    const authority = resolveAtlasAuthority({
      actor: { ...session.user, authenticated: true, emailVerified: session.user.emailVerified, status: session.user.status },
      tenantId: session.tenantId || null,
      memberships: (session.memberships || []).map(row => ({ actorId: session.user.id, tenantId: row.tenant_id, role: row.role_key, status: row.status })),
      ownerEmail: env.ATLAS_PLATFORM_OWNER_EMAIL
    });
    requireAtlasPlatformOwner(authority);
    return { session, authority };
  }
  async function route(req, res) {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    if (!url.pathname.startsWith('/api/v1/platform-admin/')) return false;
    try {
      if (!['GET','HEAD'].includes(req.method)) {
        if (!isAllowedOrigin(req, env)) throw createAuthError(403, 'origin_not_allowed');
        const { session } = await identity(req);
        if (!(await verifyCsrf(req, session, env))) throw createAuthError(403, 'csrf_check_failed');
        return send(res, 405, { error: 'admin_mutations_not_enabled' }, env);
      }
      await enforceRateLimit({ req, store: authStore, secret: env.ATLAS_SESSION_SECRET, env, route: 'platform-admin.read', limit: 90, windowSeconds: 60 });
      await identity(req);
      const path = url.pathname.slice('/api/v1/platform-admin/'.length);
      if (path === 'overview') {
        const [users, workspaces, audit, payments] = await Promise.all([
          pool.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified, count(*) FILTER (WHERE disabled_at IS NOT NULL)::int AS disabled FROM atlas_auth_users'),
          pool.query('SELECT count(*)::int AS total FROM atlas_organizations'),
          pool.query('SELECT count(*)::int AS total FROM atlas_auth_audit_events WHERE created_at >= now() - interval \'24 hours\''),
          pool.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status='failed')::int AS failed, count(*) FILTER (WHERE status='captured')::int AS captured, coalesce(sum(amount_minor) FILTER (WHERE status='captured'),0)::text AS captured_minor FROM atlas_v156_payment_events")
        ]);
        return send(res, 200, { data: { users: users.rows[0], workspaces: workspaces.rows[0], audit24h: audit.rows[0].total, payments: payments.rows[0], sections: { content: 'not_configured', notifications: 'not_configured' } } }, env);
      }
      if (path === 'users') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
        const limit = boundedLimit(url.searchParams.get('limit'));
        const { rows } = await pool.query(`SELECT user_id AS id, email, display_name AS "displayName", (email_verified_at IS NOT NULL) AS "emailVerified", (disabled_at IS NOT NULL) AS disabled, created_at AS "createdAt" FROM atlas_auth_users WHERE ($1 = '' OR email ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%') ORDER BY created_at DESC LIMIT $2`, [q, limit]);
        return send(res, 200, { data: rows, limit }, env);
      }
      if (path === 'payments') {
        const limit = boundedLimit(url.searchParams.get('limit'));
        const { rows } = await pool.query(`SELECT tenant_id AS "workspaceId", provider, provider_event_id AS "providerEventId", payment_id AS "paymentId", order_id AS "orderId", status, amount_minor::text AS "amountMinor", currency, occurred_at AS "occurredAt", received_at AS "receivedAt" FROM atlas_v156_payment_events ORDER BY occurred_at DESC LIMIT $1`, [limit]);
        return send(res, 200, { data: rows, limit }, env);
      }
      if (path === 'audit') {
        const limit = boundedLimit(url.searchParams.get('limit'));
        const { rows } = await pool.query(`SELECT event_id AS id, tenant_id AS "workspaceId", actor_id AS "actorId", action, subject_ref AS "subjectRef", metadata, created_at AS "createdAt" FROM atlas_auth_audit_events ORDER BY created_at DESC LIMIT $1`, [limit]);
        return send(res, 200, { data: rows, limit }, env);
      }
      if (path === 'reports') {
        const { rows } = await pool.query(`SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS events FROM atlas_auth_audit_events WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1`);
        return send(res, 200, { data: rows }, env);
      }
      if (path === 'content' || path === 'notifications') return send(res, 200, { data: [], status: 'not_configured', message: 'This module requires its versioned persistence schema and audited mutation workflow before it can be enabled.' }, env);
      return send(res, 404, { error: 'not_found' }, env);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const code = status === 500 ? 'platform_admin_unavailable' : (error.code || 'request_rejected');
      if (status >= 500) process.stderr.write(`Atlas platform admin read failed: ${error.message}\n`);
      return send(res, status, { error: code }, env);
    }
  }
  return { handle: route };
}
