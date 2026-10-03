const OWNER_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TENANT_ROLES = new Set(['owner', 'admin', 'member', 'viewer']);
const trustedAuthorities = new WeakSet();

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAtlasEmail(value) {
  const email = clean(value).toLowerCase();
  return email.length <= 254 && OWNER_EMAIL.test(email) ? email : null;
}

function activeMembership(actor, tenantId, memberships) {
  if (!Array.isArray(memberships)) return null;
  return memberships.find(row => row && row.actorId === actor.id && row.tenantId === tenantId &&
    row.status === 'active' && TENANT_ROLES.has(row.role)) || null;
}

/**
 * Resolve authority from a server-authenticated actor and server-loaded tenant memberships.
 * Never call this with identity or membership claims copied from a request body.
 */
export function resolveAtlasAuthority({ actor, tenantId = null, memberships = [], ownerEmail = process.env.ATLAS_PLATFORM_OWNER_EMAIL } = {}) {
  const actorId = clean(actor?.id);
  const authenticated = actor?.authenticated === true && Boolean(actorId) && actor?.status !== 'disabled';
  const configuredOwner = normalizeAtlasEmail(ownerEmail);
  const verifiedActorEmail = actor?.emailVerified === true ? normalizeAtlasEmail(actor.email) : null;
  const isPlatformOwner = authenticated && Boolean(configuredOwner) && verifiedActorEmail === configuredOwner;
  const tenant = clean(tenantId) || null;
  const membership = authenticated && tenant ? activeMembership({ id: actorId }, tenant, memberships) : null;

  const authority = Object.freeze({
    actorId: authenticated ? actorId : null,
    tenantId: tenant,
    authenticated,
    globalRole: isPlatformOwner ? 'platform_owner' : 'none',
    tenantRole: membership?.role || null,
    tenantMembershipId: membership?.id || null
  });
  trustedAuthorities.add(authority);
  return authority;
}

export function requireAtlasPlatformOwner(authority) {
  if (!trustedAuthorities.has(authority) || authority?.authenticated !== true || authority.globalRole !== 'platform_owner') {
    throw Object.assign(new Error('Atlas platform-owner access required'), { status: 403, code: 'PLATFORM_OWNER_REQUIRED' });
  }
  return authority;
}

export function requireTenantRole(authority, tenantId, allowedRoles = ['owner', 'admin']) {
  const tenant = clean(tenantId);
  const allowed = new Set(Array.isArray(allowedRoles) ? allowedRoles.filter(role => TENANT_ROLES.has(role)) : []);
  if (!trustedAuthorities.has(authority) || authority?.authenticated !== true || !tenant || authority.tenantId !== tenant || !allowed.has(authority.tenantRole)) {
    throw Object.assign(new Error('Tenant membership does not allow this operation'), { status: 403, code: 'TENANT_ROLE_REQUIRED' });
  }
  return authority;
}
