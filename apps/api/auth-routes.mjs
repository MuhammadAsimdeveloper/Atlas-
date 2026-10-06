import { randomUUID } from 'node:crypto';
import {
  AUTH_ROLE_KEYS, csrfCookieName, sessionCookieName, createAuthError, generateOpaqueToken,
  hashIp, hashOpaqueToken, hashPassword, hashRateKey, isAllowedOrigin, normalizeDisplayName,
  normalizeEmail, normalizeIndustryKey, normalizeOrganizationName, normalizePassword, normalizeTimeZone, parseCookies, serializeAuthCookies,
  serializeClearedAuthCookies, validateCustomRole, verifyCsrf, verifyPassword
} from './auth-contracts.mjs';
import { resolveAtlasAuthority } from '../../packages/atlas-core/authority.mjs';
import { clientIdentity, securityHeaders } from './security.mjs';

const SESSION_SECONDS = 60 * 60 * 24 * 7;
const TOKEN_MILLIS = 30 * 60 * 1000;
const INVITE_MILLIS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(res, status, body, headers = {}, env = process.env) {
  res.writeHead(status, { ...securityHeaders(env), ...headers, 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
  return true;
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.split(';', 1)[0].trim() !== 'application/json') throw createAuthError(415, 'json_required');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw createAuthError(413, 'request_too_large');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('invalid object');
    return value;
  } catch {
    throw createAuthError(400, 'invalid_json');
  }
}

function requireToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw createAuthError(400, 'invalid_token');
  return value;
}

export function createAuthApi({ store, runtimeStore = null, mailer, env = process.env, clock = () => new Date(), logger = console, secret = env.ATLAS_SESSION_SECRET || 'atlas-development-only-secret-not-for-production' }) {
  if (!store) throw new TypeError('An authentication store is required.');
  const rate = async (req, route, email, limit, seconds = 900, emailOnly = false) => {
    const key = hashRateKey(secret, route, emailOnly ? 'account' : clientIdentity(req, env), email || '');
    const allowed = await store.consumeRateLimit({ key, now: clock(), windowSeconds: seconds, limit });
    if (!allowed) throw Object.assign(createAuthError(429, 'rate_limited', 'Try again later.'), { retryAfter: seconds });
  };
  const identity = async req => {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies.get(sessionCookieName(env));
    if (!raw) throw createAuthError(401, 'authentication_required');
    const session = await store.getSession({ sessionHash: hashOpaqueToken(raw) });
    if (!session) throw createAuthError(401, 'authentication_required');
    return { session, raw, cookies };
  };
  const requireMutation = async (req, session = null) => {
    if (!isAllowedOrigin(req, env)) throw createAuthError(403, 'origin_not_allowed');
    if (session && !(await verifyCsrf(req, session, env))) throw createAuthError(403, 'csrf_check_failed');
  };
  const withSessionCookies = (sessionToken, csrfToken) => ({ 'set-cookie': serializeAuthCookies(sessionToken, csrfToken, SESSION_SECONDS, env) });
  const routeHandler = async (req, res) => {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/v1/auth/') && !['/api/v1/me','/api/v1/organizations','/api/v1/dashboard/summary','/api/v1/operations/runtime'].includes(pathname) && !pathname.startsWith('/api/v1/organizations/') && pathname !== '/api/v1/invitations/accept') return false;
    try {
      if (req.method === 'POST' && !isAllowedOrigin(req, env)) throw createAuthError(403, 'origin_not_allowed');

      if (pathname === '/api/v1/auth/signup' && req.method === 'POST') {
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const displayName = normalizeDisplayName(body.displayName);
        const organizationName = normalizeOrganizationName(body.organizationName);
        const industryKey = normalizeIndustryKey(body.industry);
        const timeZone = normalizeTimeZone(body.timeZone);
        const password = normalizePassword(body.password);
        await rate(req, 'signup-ip', '', 12, 900);
        if (email) await rate(req, 'signup-account', email, 3, 86_400, true);
        if (!email || !displayName || !organizationName || !password || !industryKey || !timeZone) throw createAuthError(400, 'invalid_signup', 'Provide a valid name, email, workspace, industry, time zone, and password of at least 12 characters.');
        const verificationToken = generateOpaqueToken();
        const passwordHash = await hashPassword(password);
        const result = await store.createAccount({ email, displayName, organizationName, industryKey, timeZone, passwordHash, verificationTokenHash: hashOpaqueToken(verificationToken), expiresAt: new Date(clock().getTime() + TOKEN_MILLIS) });
        if (result.created) {
          try { await mailer.sendVerification({ email, token: verificationToken }); }
          catch (error) { logger.error?.(`Atlas verification delivery is unavailable: ${error.message}`); }
        }
        return sendJson(res, 202, { status: 'verification_pending', message: 'If the account can be created, a verification email will be sent.' });
      }

      if (pathname === '/api/v1/auth/verify-email' && req.method === 'POST') {
        await rate(req, 'verify-email-ip', '', 60, 900);
        const body = await readJson(req);
        const token = requireToken(body.token);
        const user = await store.verifyEmail({ tokenHash: hashOpaqueToken(token) });
        if (!user) throw createAuthError(400, 'invalid_or_expired_verification_token');
        return sendJson(res, 200, { status: 'verified', user: { id: user.id, email: user.email, displayName: user.displayName } });
      }

      if (pathname === '/api/v1/auth/verification/resend' && req.method === 'POST') {
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        await rate(req, 'verification-resend-ip', '', 10, 900);
        if (email) await rate(req, 'verification-resend-account', email, 4, 3600, true);
        if (email) {
          const token = generateOpaqueToken();
          const issued = await store.issueEmailVerification({ email, tokenHash: hashOpaqueToken(token), expiresAt: new Date(clock().getTime() + TOKEN_MILLIS) });
          if (issued) {
            try { await mailer.sendVerification({ email, token }); }
            catch (error) { logger.error?.(`Atlas verification delivery is unavailable: ${error.message}`); }
          }
        }
        return sendJson(res, 202, { status: 'verification_pending', message: 'If the account needs verification, a message will be sent.' });
      }

      if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        await rate(req, 'login-ip', '', 60, 300);
        if (email) await rate(req, 'login-account', email, 12, 900, true);
        const candidate = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
        const user = email ? await store.findUserForLogin(email) : null;
        let validPassword = false;
        if (user) validPassword = await verifyPassword(candidate, user.passwordHash);
        else await hashPassword('Atlas timing equalizer phrase 2026');
        if (!user || !validPassword || user.status !== 'active') throw createAuthError(401, 'invalid_credentials', 'Email or password is incorrect.');
        if (!user.emailVerified) throw createAuthError(401, 'invalid_credentials', 'Email or password is incorrect.');
        const sessionToken = generateOpaqueToken();
        const csrfToken = generateOpaqueToken();
        const session = await store.createSession({ userId: user.id, sessionHash: hashOpaqueToken(sessionToken), csrfHash: hashOpaqueToken(csrfToken), expiresAt: new Date(clock().getTime() + SESSION_SECONDS * 1000), userAgent: req.headers['user-agent'], ipHash: hashIp(secret, clientIdentity(req, env)) });
        const organizations = await store.listOrganizations({ userId: user.id });
        return sendJson(res, 200, { status: 'authenticated', csrfToken, user: { id: user.id, email: user.email, displayName: user.displayName }, activeOrganizationId: session.tenantId, organizations }, withSessionCookies(sessionToken, csrfToken));
      }

      if (pathname === '/api/v1/auth/password/forgot' && req.method === 'POST') {
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        await rate(req, 'password-forgot-ip', '', 12, 900);
        if (email) await rate(req, 'password-forgot-account', email, 4, 3600, true);
        if (email) {
          const token = generateOpaqueToken();
          const issued = await store.issuePasswordReset({ email, tokenHash: hashOpaqueToken(token), expiresAt: new Date(clock().getTime() + TOKEN_MILLIS) });
          if (issued) {
            try { await mailer.sendPasswordReset({ email, token }); }
            catch (error) { logger.error?.(`Atlas password-reset delivery is unavailable: ${error.message}`); }
          }
        }
        return sendJson(res, 202, { status: 'reset_requested', message: 'If the account exists, a password reset email will be sent.' });
      }

      if (pathname === '/api/v1/auth/password/reset' && req.method === 'POST') {
        const body = await readJson(req);
        const token = requireToken(body.token);
        const password = normalizePassword(body.password);
        await rate(req, 'password-reset-ip', '', 20, 900);
        await rate(req, 'password-reset-token', hashOpaqueToken(token), 5, 900, true);
        if (!password) throw createAuthError(400, 'invalid_password', 'Password must be 12 to 128 characters.');
        await store.resetPassword({ tokenHash: hashOpaqueToken(token), passwordHash: await hashPassword(password) });
        return sendJson(res, 200, { status: 'password_updated', message: 'Password updated. Sign in again on your devices.' }, { 'set-cookie': serializeClearedAuthCookies(env) });
      }

      if (pathname === '/api/v1/auth/logout' && req.method === 'POST') {
        const { session } = await identity(req);
        await requireMutation(req, session);
        await store.revokeSession({ sessionHash: session.tokenHash });
        return sendJson(res, 200, { status: 'signed_out' }, { 'set-cookie': serializeClearedAuthCookies(env) });
      }

      if (pathname === '/api/v1/me' && req.method === 'GET') {
        const { session, cookies } = await identity(req);
        const csrfToken = cookies.get(csrfCookieName(env)) || '';
        const validCsrf = csrfToken && hashOpaqueToken(csrfToken) === session.csrfHash ? csrfToken : null;
        const authority = resolveAtlasAuthority({ actor: { id: session.user.id, email: session.user.email, emailVerified: session.user.emailVerified, authenticated: true, status: session.user.status }, tenantId: session.tenantId, memberships: session.memberships.map(item => ({ id: `${item.tenant_id}:${session.user.id}`, actorId: session.user.id, tenantId: item.tenant_id, role: item.role_key, status: item.status })), ownerEmail: env.ATLAS_PLATFORM_OWNER_EMAIL });
        return sendJson(res, 200, { user: { id: session.user.id, email: session.user.email, displayName: session.user.displayName, emailVerified: session.user.emailVerified }, activeOrganization: session.tenantId ? { id: session.tenantId, name: session.organizationName, role: session.tenantRole } : null, platformOwner: authority.globalRole === 'platform_owner', csrfToken: validCsrf, organizations: session.memberships.map(item => ({ id: item.tenant_id, name: item.organization_name, role: item.role_key })) });
      }

      if (pathname === '/api/v1/me' && req.method === 'PATCH') {
        const { session } = await identity(req);
        await requireMutation(req, session);
        const body = await readJson(req);
        const displayName = normalizeDisplayName(body.displayName);
        if (!displayName) throw createAuthError(400, 'invalid_display_name');
        const user = await store.updateProfile({ userId: session.user.id, displayName });
        return sendJson(res, 200, { user: { id: user.id, email: user.email, displayName: user.displayName, emailVerified: user.emailVerified } });
      }

      if (pathname === '/api/v1/organizations' && req.method === 'GET') {
        const { session } = await identity(req);
        return sendJson(res, 200, { organizations: await store.listOrganizations({ userId: session.user.id }) });
      }

      if (pathname === '/api/v1/organizations' && req.method === 'POST') {
        const { session } = await identity(req);
        await requireMutation(req, session);
        await rate(req, 'create-organization-ip', '', 10, 3600);
        const body = await readJson(req);
        const name = normalizeOrganizationName(body.name);
        if (!name) throw createAuthError(400, 'invalid_organization_name');
        const organization = await store.createOrganization({ userId: session.user.id, sessionHash: session.tokenHash, name });
        return sendJson(res, 201, { organization });
      }

      const selectMatch = pathname.match(/^\/api\/v1\/organizations\/([0-9a-f-]{36})\/select$/i);
      if (selectMatch && req.method === 'POST') {
        const { session } = await identity(req);
        await requireMutation(req, session);
        const organization = await store.selectOrganization({ userId: session.user.id, sessionHash: session.tokenHash, tenantId: selectMatch[1] });
        return sendJson(res, 200, { activeOrganization: organization });
      }

      const dashboardMatch = pathname === '/api/v1/dashboard/summary';
      if (dashboardMatch && req.method === 'GET') {
        const { session } = await identity(req);
        if (!session.tenantId) throw createAuthError(409, 'organization_required');
        return sendJson(res, 200, await store.getDashboard({ userId: session.user.id, tenantId: session.tenantId }));
      }

      if (pathname === '/api/v1/operations/runtime' && req.method === 'GET') {
        const { session } = await identity(req);
        if (!session.tenantId) throw createAuthError(409, 'organization_required');
        if (!runtimeStore) throw createAuthError(503, 'runtime_unavailable');
        const counts = await runtimeStore.counts();
        return sendJson(res, 200, {
          release: env.ATLAS_RELEASE || null,
          distributedWakeup: Boolean(env.ATLAS_REDIS_URL),
          durableQueue: 'postgresql',
          counts: Object.fromEntries(Object.entries(counts || {}).map(([k,v]) => [k, Number.isFinite(Number(v)) ? Number(v) : v]))
        });
      }

      const memberMatch = pathname.match(/^\/api\/v1\/organizations\/([0-9a-f-]{36})\/(members|invitations|roles)$/i);
      if (memberMatch && req.method === 'GET') {
        const { session } = await identity(req);
        const tenantId = memberMatch[1];
        if (memberMatch[2] === 'members') return sendJson(res, 200, { members: await store.listMembers({ userId: session.user.id, tenantId }) });
        if (memberMatch[2] === 'invitations') return sendJson(res, 200, { invitations: await store.listInvitations({ userId: session.user.id, tenantId }) });
        return sendJson(res, 200, { roles: await store.listCustomRoles({ userId: session.user.id, tenantId }) });
      }

      if (memberMatch && req.method === 'POST' && memberMatch[2] === 'invitations') {
        const { session } = await identity(req);
        await requireMutation(req, session);
        await rate(req, `invite-ip:${memberMatch[1]}`, '', 40, 3600);
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        if (email) await rate(req, `invite-email:${memberMatch[1]}`, email, 5, 86_400, true);
        let roleKey = body.roleKey || 'member';
        let customRoleId = null;
        if (typeof roleKey !== 'string') throw createAuthError(400, 'invalid_invitation_role');
        if (AUTH_ROLE_KEYS.has(roleKey)) {
          // Built-in tenant roles are scoped to the invited workspace.
        } else if (/^custom:[a-z0-9][a-z0-9-]{0,48}$/.test(roleKey) && typeof body.customRoleId === 'string' && /^[0-9a-f-]{36}$/i.test(body.customRoleId)) customRoleId = body.customRoleId;
        else throw createAuthError(400, 'invalid_invitation_role');
        if (!email || email === session.user.email) throw createAuthError(400, 'invalid_invitation_email');
        const token = generateOpaqueToken();
        const invitation = await store.createInvitation({ userId: session.user.id, tenantId: memberMatch[1], email, roleKey, customRoleId, tokenHash: hashOpaqueToken(token), expiresAt: new Date(clock().getTime() + INVITE_MILLIS) });
        let delivered = false;
        try { await mailer.sendInvitation({ email, token, organizationName: invitation.organizationName, role: roleKey }); delivered = true; }
        catch (error) { logger.error?.(`Atlas invitation delivery is unavailable: ${error.message}`); }
        return sendJson(res, 202, { status: 'invitation_pending', email, role: roleKey, delivery: delivered ? 'sent' : 'unavailable', expiresInSeconds: INVITE_MILLIS / 1000 });
      }

      if (memberMatch && req.method === 'POST' && memberMatch[2] === 'roles') {
        const { session } = await identity(req);
        await requireMutation(req, session);
        await rate(req, `custom-role-ip:${memberMatch[1]}`, '', 30, 3600);
        const role = validateCustomRole(await readJson(req));
        const created = await store.createCustomRole({ userId: session.user.id, tenantId: memberMatch[1], roleId: randomUUID(), role });
        return sendJson(res, 201, { role: created });
      }

      if (pathname === '/api/v1/invitations/accept' && req.method === 'POST') {
        const { session } = await identity(req);
        await requireMutation(req, session);
        await rate(req, 'invitation-accept-ip', '', 20, 900);
        const body = await readJson(req);
        const token = requireToken(body.token);
        const organization = await store.acceptInvitation({ userId: session.user.id, email: session.user.email, tokenHash: hashOpaqueToken(token) });
        return sendJson(res, 200, { status: 'invitation_accepted', organization });
      }

      return sendJson(res, 405, { error: 'method_not_allowed' }, { allow: 'GET, POST, PATCH' });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) logger.error?.(`Atlas auth request failed: ${error.message}`);
      const edgeIdentityUnavailable = status === 503 && error.code === 'trusted_client_ip_unavailable';
      const body = status >= 500
        ? { error: edgeIdentityUnavailable ? error.code : 'internal_error', message: edgeIdentityUnavailable ? 'Atlas could not identify your connection. Try again shortly.' : 'The request could not be completed.' }
        : { error: error.code || 'request_failed', message: error.message };
      return sendJson(res, status, body, status === 429 ? { 'retry-after': String(error.retryAfter || 900) } : {});
    }
  };

  return Object.freeze({ handle: routeHandler, store });
}
