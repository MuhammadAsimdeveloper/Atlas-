import { sessionCookieName, hashOpaqueToken, parseCookies, isAllowedOrigin, verifyCsrf, createAuthError } from './auth-contracts.mjs';
import { resolveAtlasAuthority, requireAtlasPlatformOwner } from '../../packages/atlas-core/authority.mjs';
import { securityHeaders, enforceRateLimit } from './security.mjs';

const LIMIT = 100;
async function readJsonBody(req, maxBytes = 8192) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString('utf8');
    if (Buffer.byteLength(raw) > maxBytes) throw createAuthError(413, 'request_body_too_large');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw createAuthError(400, 'invalid_json'); }
}
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
        const transitionMatch = req.method === 'POST' && url.pathname.match(/^\/api\/v1\/platform-admin\/content\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/transition$/i);
        if (transitionMatch) {
          const body = await readJsonBody(req);
          const action = body.action;
          const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
          const assignedTo = typeof body.assignedTo === 'string' ? body.assignedTo.trim() : null;
          const expectedVersion = Number(body.expectedVersion);
          if (!['assigned','marked_in_review'].includes(action)) return send(res, 400, { error: 'unsupported_moderation_transition' }, env);
          if (reason.length < 8 || Buffer.byteLength(reason) > 2000) return send(res, 400, { error: 'invalid_moderation_reason' }, env);
          if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return send(res, 400, { error: 'expected_version_required' }, env);
          if (action === 'assigned' && (!assignedTo || assignedTo.length > 254)) return send(res, 400, { error: 'assignee_required' }, env);
          const requestId = typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].length <= 128 ? req.headers['x-request-id'] : null;
          try {
            const { rows } = await pool.query(
              'SELECT * FROM atlas_v158_admin_transition_content_report($1,$2,$3,$4,$5,$6,$7)',
              [transitionMatch[1], session.user.id, action, reason, assignedTo, expectedVersion, requestId]
            );
            return send(res, 200, { data: rows[0], status: 'updated', enforcement: 'disabled_until_content_adapter_exists' }, env);
          } catch (error) {
            if (error.code === 'P0002') return send(res, 404, { error: 'content_report_not_found' }, env);
            if (error.code === '40001') return send(res, 409, { error: 'content_report_version_conflict' }, env);
            if (error.code === '22023') return send(res, 400, { error: error.message }, env);
            throw error;
          }
        }
        return send(res, 405, { error: 'admin_mutations_not_enabled' }, env);
      }
      await enforceRateLimit({ req, store: authStore, secret: env.ATLAS_SESSION_SECRET, env, route: 'platform-admin.read', limit: 90, windowSeconds: 60 });
      await identity(req);
      const path = url.pathname.slice('/api/v1/platform-admin/'.length);
      if (path === 'overview') {
        const [users, workspaces, audit] = await Promise.all([
          pool.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified, count(*) FILTER (WHERE disabled_at IS NOT NULL)::int AS disabled FROM atlas_auth_users'),
          pool.query('SELECT count(*)::int AS total FROM atlas_organizations'),
          pool.query('SELECT count(*)::int AS total FROM atlas_auth_audit_events WHERE created_at >= now() - interval \'24 hours\'')
        ]);
        return send(res, 200, { data: { users: users.rows[0], workspaces: workspaces.rows[0], audit24h: audit.rows[0].total, payments: { status: 'unavailable', reason: 'tenant_rls_read_model_required' }, sections: { content: 'available_read_only', notifications: 'available_read_only' } } }, env);
      }
      if (path === 'users') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
        const limit = boundedLimit(url.searchParams.get('limit'));
        const { rows } = await pool.query(`SELECT user_id AS id, email, display_name AS "displayName", (email_verified_at IS NOT NULL) AS "emailVerified", (disabled_at IS NOT NULL) AS disabled, created_at AS "createdAt" FROM atlas_auth_users WHERE ($1 = '' OR email ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%') ORDER BY created_at DESC LIMIT $2`, [q, limit]);
        return send(res, 200, { data: rows, limit }, env);
      }
      if (path === 'payments') return send(res, 503, { error: 'platform_finance_read_model_required', message: 'Cross-tenant finance views are disabled until a tenant-isolated, audited platform reporting read model is installed.' }, env);
      if (path === 'audit') {
        const limit = boundedLimit(url.searchParams.get('limit'));
        const { rows } = await pool.query(`SELECT event_id AS id, tenant_id AS "workspaceId", actor_id AS "actorId", action, subject_ref AS "subjectRef", metadata, created_at AS "createdAt" FROM atlas_auth_audit_events ORDER BY created_at DESC LIMIT $1`, [limit]);
        return send(res, 200, { data: rows, limit }, env);
      }
      if (path === 'reports') {
        const { rows } = await pool.query(`SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS events FROM atlas_auth_audit_events WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1`);
        return send(res, 200, { data: rows }, env);
      }
      if (path === 'content') {
        const status = url.searchParams.get('status');
        if (status && !['open','in_review','actioned','dismissed','appealed'].includes(status)) return send(res, 400, { error: 'invalid_content_status' }, env);
        const limit = boundedLimit(url.searchParams.get('limit'));
        const { rows } = await pool.query('SELECT * FROM atlas_v157_admin_list_content_reports($1,$2)', [status || null, limit]);
        return send(res, 200, { data: rows, limit, status: 'available', mutations: 'disabled_pending_audited_workflow' }, env);
      }
      if (path.startsWith('notifications/') && path.endsWith('/attempts')) {
        const notificationId = path.slice('notifications/'.length, -'/attempts'.length);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) return send(res, 400, { error: 'invalid_notification_id' }, env);
        const { rows } = await pool.query('SELECT * FROM atlas_v157_admin_notification_attempts($1)', [notificationId]);
        return send(res, 200, { data: rows, notificationId, status: 'available' }, env);
      }
      if (path === 'notifications') {
        const status = url.searchParams.get('status');
        if (status && !['draft','queued','sending','sent','partial','failed','cancelled'].includes(status)) return send(res, 400, { error: 'invalid_notification_status' }, env);
        const limit = boundedLimit(url.searchParams.get('limit'));
        const { rows } = await pool.query('SELECT * FROM atlas_v157_admin_list_notifications($1,$2)', [status || null, limit]);
        return send(res, 200, { data: rows, limit, status: 'available', delivery: 'provider_worker_not_connected' }, env);
      }
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
