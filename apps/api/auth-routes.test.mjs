import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createAuthApi } from './auth-routes.mjs';
import { hashOpaqueToken, hashPassword } from './auth-contracts.mjs';

function createMemoryStore() {
  const users = new Map(); const verification = new Map(); const resets = new Map(); const sessions = new Map(); const rate = new Map();
  const orgs = new Map(); const memberships = new Map(); const invitations = new Map(); const customRoles = new Map();
  return {
    users, sessions, orgs, memberships, invitations, customRoles,
    async consumeRateLimit({ key, limit }) { const next = (rate.get(key) || 0) + 1; rate.set(key, next); return next <= limit; },
    async createAccount(account) {
      if (users.has(account.email)) return { created: false };
      const userId = `user-${users.size + 1}`; const tenantId = `tenant-${orgs.size + 1}`;
      const user = { id: userId, email: account.email, displayName: account.displayName, passwordHash: account.passwordHash, emailVerified: false, status: 'active', createdAt: new Date() };
      users.set(account.email, user); orgs.set(tenantId, { id: tenantId, name: account.organizationName, slug: `${tenantId}-slug`, status: 'active', createdAt: new Date() });
      memberships.set(`${tenantId}:${userId}`, { tenantId, userId, role: 'owner', status: 'active' });
      verification.set(account.verificationTokenHash, user.email);
      return { created: true, userId, tenantId };
    },
    async verifyEmail({ tokenHash }) {
      const email = verification.get(tokenHash); if (!email) return null;
      verification.delete(tokenHash); const user = users.get(email); user.emailVerified = true; return user;
    },
    async issueEmailVerification({ email, tokenHash }) { const user = users.get(email); if (!user || user.emailVerified) return false; verification.set(tokenHash, email); return true; },
    async findUserForLogin(email) { return users.get(email) || null; },
    async createSession(data) {
      const user = [...users.values()].find(item => item.id === data.userId);
      if (!user?.emailVerified || user.status !== 'active') throw Object.assign(new Error('Authentication required'), { status: 401, code: 'authentication_required' });
      const owned = [...memberships.values()].filter(row => row.userId === user.id && row.status === 'active');
      const tenantId = owned[0]?.tenantId || null; const session = { ...data, user, tenantId };
      sessions.set(data.sessionHash, session); return { tenantId };
    },
    async getSession({ sessionHash }) {
      const s = sessions.get(sessionHash); if (!s || new Date(s.expiresAt) <= new Date()) return null;
      const membershipsList = [...memberships.values()].filter(row => row.userId === s.user.id).map(row => ({ tenant_id: row.tenantId, role_key: row.role, status: row.status, organization_name: orgs.get(row.tenantId)?.name }));
      return { tokenHash: sessionHash, csrfHash: s.csrfHash, expiresAt: s.expiresAt, user: s.user, tenantId: s.tenantId, tenantRole: membershipsList.find(row => row.tenant_id === s.tenantId)?.role_key, organizationName: orgs.get(s.tenantId)?.name, memberships: membershipsList };
    },
    async revokeSession({ sessionHash }) { return sessions.delete(sessionHash); },
    async listOrganizations({ userId }) { return [...memberships.values()].filter(row => row.userId === userId && row.status === 'active').map(row => ({ ...orgs.get(row.tenantId), role: row.role })); },
    async createOrganization({ userId, sessionHash, name }) {
      const id = `tenant-${orgs.size + 1}`; orgs.set(id, { id, name, slug: `${id}-slug`, status: 'active', createdAt: new Date() });
      memberships.set(`${id}:${userId}`, { tenantId: id, userId, role: 'owner', status: 'active' });
      sessions.get(sessionHash).tenantId = id; return { id, name, role: 'owner' };
    },
    async selectOrganization({ userId, sessionHash, tenantId }) {
      if (!memberships.has(`${tenantId}:${userId}`)) throw Object.assign(new Error('Not found'), { status: 404, code: 'organization_not_found' });
      sessions.get(sessionHash).tenantId = tenantId; return { id: tenantId, name: orgs.get(tenantId).name, role: memberships.get(`${tenantId}:${userId}`).role };
    },
    async getDashboard({ userId, tenantId }) {
      if (!memberships.has(`${tenantId}:${userId}`)) throw Object.assign(new Error('Not found'), { status: 404, code: 'organization_not_found' });
      return { organization: orgs.get(tenantId), metrics: { activeMembers: 1, pendingInvitations: 0, auditEventsLast7Days: 2 }, dataStatus: 'live_core_metrics' };
    },
    async listMembers({ userId, tenantId }) {
      if (!['owner','admin'].includes(memberships.get(`${tenantId}:${userId}`)?.role)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'tenant_admin_required' });
      return [...memberships.values()].filter(row => row.tenantId === tenantId).map(row => ({ userId: row.userId, email: [...users.values()].find(user => user.id === row.userId).email, displayName: [...users.values()].find(user => user.id === row.userId).displayName, role: row.role, status: row.status }));
    },
    async createInvitation(data) {
      if (!['owner','admin'].includes(memberships.get(`${data.tenantId}:${data.userId}`)?.role)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'tenant_admin_required' });
      invitations.set(data.tokenHash, data); return { organizationName: orgs.get(data.tenantId).name, role: data.roleKey };
    },
    async listInvitations({ userId, tenantId }) {
      if (!['owner','admin'].includes(memberships.get(`${tenantId}:${userId}`)?.role)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'tenant_admin_required' });
      return [...invitations.values()].filter(row => row.tenantId === tenantId).map(row => ({ id: row.tokenHash.slice(0,16), email: row.email, role: row.roleKey, status: 'pending', expiresAt: row.expiresAt, createdAt: new Date() }));
    },
    async acceptInvitation({ userId, email, tokenHash }) {
      const invite = invitations.get(tokenHash);
      if (!invite || invite.email !== email) throw Object.assign(new Error('Invalid invitation'), { status: 400, code: 'invalid_or_expired_invitation' });
      memberships.set(`${invite.tenantId}:${userId}`, { tenantId: invite.tenantId, userId, role: invite.roleKey, status: 'active' }); invitations.delete(tokenHash);
      return { id: invite.tenantId, name: orgs.get(invite.tenantId).name, role: invite.roleKey };
    },
    async createCustomRole({ userId, tenantId, roleId, role }) {
      if (!['owner','admin'].includes(memberships.get(`${tenantId}:${userId}`)?.role)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'tenant_admin_required' });
      const stored = { id: roleId, key: role.key, name: role.name, permissions: role.permissions }; customRoles.set(`${tenantId}:${role.key}`, stored); return stored;
    },
    async listCustomRoles({ userId, tenantId }) {
      if (!memberships.has(`${tenantId}:${userId}`)) throw Object.assign(new Error('Not found'), { status: 404, code: 'organization_not_found' });
      return [...customRoles.entries()].filter(([key]) => key.startsWith(`${tenantId}:`)).map(([,value]) => value);
    },
    async issuePasswordReset({ email, tokenHash }) { if (!users.get(email)?.emailVerified) return false; resets.set(tokenHash, email); return true; },
    async resetPassword({ tokenHash, passwordHash }) { const email = resets.get(tokenHash); if (!email) throw Object.assign(new Error('Invalid token'), { status: 400, code: 'invalid_or_expired_reset_token' }); users.get(email).passwordHash = passwordHash; resets.delete(tokenHash); sessions.clear(); return true; },
    async updateProfile({ userId, displayName }) { const user = [...users.values()].find(row => row.id === userId); user.displayName = displayName; return user; }
  };
}

async function startApi({ ownerEmail = 'khan@example.net', envOverrides = {} } = {}) {
  const store = createMemoryStore(); const mail = { verification: [], reset: [], invitation: [] };
  const mailer = {
    async sendVerification(data) { mail.verification.push(data); },
    async sendPasswordReset(data) { mail.reset.push(data); },
    async sendInvitation(data) { mail.invitation.push(data); }
  };
  const env = { NODE_ENV: 'development', ATLAS_PLATFORM_OWNER_EMAIL: ownerEmail, ATLAS_SESSION_SECRET: 'dev-secret-for-auth-route-test-only', ATLAS_PUBLIC_ORIGIN: '', ...envOverrides };
  const api = createAuthApi({ store, mailer, env, secret: env.ATLAS_SESSION_SECRET, logger: { error() {} } });
  const server = createServer(async (req,res) => { if (!(await api.handle(req,res))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, { cookie, csrf, realIp, origin = base } = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-atlas-csrf': csrf } : {}), ...(realIp ? { 'x-real-ip': realIp } : {}) }, body: JSON.stringify(body) });
  const close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return { store, mail, base, post, close };
}

test('signup verifies email, creates a tenant owner, signs in, and exposes live workspace data', async () => {
  const api = await startApi();
  try {
    const signup = await api.post('/api/v1/auth/signup', { displayName: 'Khan', email: 'Khan@Example.net', password: 'correct-horse-battery-2026', organizationName: 'Northstar HVAC', industry: 'home_services', timeZone: 'America/Los_Angeles', role: 'platform_owner', isPlatformOwner: true });
    assert.equal(signup.status, 202);
    assert.equal((await signup.json()).status, 'verification_pending');
    assert.equal(api.mail.verification.length, 1);
    assert.equal(api.store.users.get('khan@example.net').emailVerified, false);

    const verified = await api.post('/api/v1/auth/verify-email', { token: api.mail.verification[0].token });
    assert.equal(verified.status, 200);

    const login = await api.post('/api/v1/auth/login', { email: 'khan@example.net', password: 'correct-horse-battery-2026' });
    assert.equal(login.status, 200);
    const loginData = await login.json();
    const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.match(login.headers.getSetCookie().join('; '), /HttpOnly/);
    assert.match(login.headers.getSetCookie().join('; '), /SameSite=Strict/);
    assert.equal(loginData.organizations[0].role, 'owner');

    const me = await fetch(api.base + '/api/v1/me', { headers: { cookie: cookies } });
    const profile = await me.json();
    assert.equal(me.status, 200);
    assert.equal(profile.platformOwner, true);
    assert.equal(profile.activeOrganization.name, 'Northstar HVAC');
    const dashboard = await fetch(api.base + '/api/v1/dashboard/summary', { headers: { cookie: cookies } });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json()).dataStatus, 'live_core_metrics');

    const csrfBlocked = await api.post('/api/v1/organizations', { name: 'Second workspace' }, { cookie: cookies });
    assert.equal(csrfBlocked.status, 403);
    assert.equal((await csrfBlocked.json()).error, 'csrf_check_failed');
    const newWorkspace = await api.post('/api/v1/organizations', { name: 'Second workspace', tenantId: 'fake', role: 'platform_owner' }, { cookie: cookies, csrf: loginData.csrfToken });
    assert.equal(newWorkspace.status, 201);
    const workspace = await newWorkspace.json();
    assert.equal(workspace.organization.role, 'owner');

    const crossTenant = await api.post('/api/v1/organizations/99999999-0000-4000-8000-000000000000/select', {}, { cookie: cookies, csrf: loginData.csrfToken });
    assert.equal(crossTenant.status, 404);
  } finally { await api.close(); }
});

test('verified company admins never receive platform-owner authority from request claims', async () => {
  const api = await startApi({ ownerEmail: 'khan@example.net' });
  try {
    const passwordHash = await hashPassword('company-owner-password-2026');
    const create = await api.store.createAccount({ email: 'customer@example.com', displayName: 'Customer Admin', organizationName: 'Customer Co', industryKey: 'agency', timeZone: 'America/New_York', passwordHash, verificationTokenHash: hashOpaqueToken('customer-verify-token-0000000000000000000'), expiresAt: new Date(Date.now()+60_000) });
    await api.store.verifyEmail({ tokenHash: hashOpaqueToken('customer-verify-token-0000000000000000000') });
    assert.equal(create.created, true);
    const login = await api.post('/api/v1/auth/login', { email: 'customer@example.com', password: 'company-owner-password-2026', isPlatformOwner: true, globalRole: 'platform_owner' });
    assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const response = await fetch(api.base + '/api/v1/me', { headers: { cookie: cookies } });
    const profile = await response.json();
    assert.equal(profile.platformOwner, false);
    assert.equal(profile.activeOrganization.role, 'owner');
  } finally { await api.close(); }
});

test('account reset mail is enumeration-safe and CSRF rejects a foreign origin', async () => {
  const api = await startApi();
  try {
    const unknown = await api.post('/api/v1/auth/password/forgot', { email: 'nobody@example.net' });
    const known = await api.post('/api/v1/auth/password/forgot', { email: 'owner@example.net' });
    assert.equal(unknown.status, 202); assert.equal(known.status, 202);
    assert.equal((await unknown.json()).message, (await known.json()).message);
    const foreign = await api.post('/api/v1/auth/signup', { email: 'blocked@example.net' }, { origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal(api.store.users.has('blocked@example.net'), false);
  } finally { await api.close(); }
});

test('production rate limits require a valid IP supplied by the configured trusted edge', async () => {
  const api = await startApi({ envOverrides: { NODE_ENV: 'production', ATLAS_TRUST_PROXY: 'true', ATLAS_PUBLIC_ORIGIN: 'https://atlas.example', ATLAS_SESSION_SECRET: 'production-session-secret-of-at-least-32-bytes' } });
  const request = { displayName: 'Khan', email: 'edge@example.net', password: 'correct-horse-battery-2026', organizationName: 'Northstar HVAC' };
  try {
    const missing = await api.post('/api/v1/auth/signup', request, { origin: 'https://atlas.example' });
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).error, 'trusted_client_ip_unavailable');
    const spoofChain = await api.post('/api/v1/auth/signup', request, { origin: 'https://atlas.example', realIp: '192.0.2.4, 10.0.0.2' });
    assert.equal(spoofChain.status, 503);
    const accepted = await api.post('/api/v1/auth/signup', request, { origin: 'https://atlas.example', realIp: '192.0.2.4' });
    assert.equal(accepted.status, 202);
  } finally { await api.close(); }
});
