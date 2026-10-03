import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAtlasEmail, resolveAtlasAuthority, requireAtlasPlatformOwner, requireTenantRole } from './authority.mjs';

const ownerEmail = 'khan@example.test';

test('only the authenticated, verified, configured owner email receives global authority', () => {
  const owner = resolveAtlasAuthority({ actor: { id: 'khan', authenticated: true, email: ' KHAN@example.test ', emailVerified: true }, ownerEmail });
  assert.equal(owner.globalRole, 'platform_owner');
  assert.doesNotThrow(() => requireAtlasPlatformOwner(owner));
  for (const actor of [
    { id: 'other', authenticated: true, email: 'other@example.test', emailVerified: true, platformOwner: true, role: 'platform_owner' },
    { id: 'unverified', authenticated: true, email: ownerEmail, emailVerified: false },
    { id: 'anonymous', authenticated: false, email: ownerEmail, emailVerified: true }
  ]) {
    const authority = resolveAtlasAuthority({ actor, ownerEmail });
    assert.equal(authority.globalRole, 'none');
    assert.throws(() => requireAtlasPlatformOwner(authority), error => error.code === 'PLATFORM_OWNER_REQUIRED');
  }
});

test('a tenant admin is confined to the matching tenant and cannot promote itself globally', () => {
  const actor = { id: 'tenant-admin', authenticated: true, email: 'admin@example.test', emailVerified: true, platformOwner: true };
  const memberships = [{ id: 'm1', actorId: actor.id, tenantId: 'tenant-a', role: 'admin', status: 'active' }];
  const sameTenant = resolveAtlasAuthority({ actor, tenantId: 'tenant-a', memberships, ownerEmail });
  assert.equal(sameTenant.tenantRole, 'admin');
  assert.equal(sameTenant.globalRole, 'none');
  assert.doesNotThrow(() => requireTenantRole(sameTenant, 'tenant-a'));
  assert.throws(() => requireTenantRole(sameTenant, 'tenant-b'), error => error.code === 'TENANT_ROLE_REQUIRED');
  assert.throws(() => requireAtlasPlatformOwner(sameTenant), error => error.code === 'PLATFORM_OWNER_REQUIRED');
});

test('caller-supplied membership for another actor or tenant is ignored', () => {
  const authority = resolveAtlasAuthority({
    actor: { id: 'member-a', authenticated: true }, tenantId: 'tenant-a', ownerEmail,
    memberships: [{ id: 'forged', actorId: 'member-b', tenantId: 'tenant-a', role: 'admin' }, { id: 'other-tenant', actorId: 'member-a', tenantId: 'tenant-b', role: 'admin' }]
  });
  assert.equal(authority.tenantRole, null);
  assert.throws(() => requireTenantRole(authority, 'tenant-a'), error => error.code === 'TENANT_ROLE_REQUIRED');
});

test('authority guards reject forged objects and memberships that are not explicitly active', () => {
  assert.throws(() => requireAtlasPlatformOwner({ authenticated: true, globalRole: 'platform_owner', actorId: 'attacker' }), error => error.code === 'PLATFORM_OWNER_REQUIRED');
  assert.throws(() => requireTenantRole({ authenticated: true, tenantId: 'tenant-a', tenantRole: 'admin' }, 'tenant-a'), error => error.code === 'TENANT_ROLE_REQUIRED');
  for (const status of ['invited', 'pending', 'disabled', undefined]) {
    const authority = resolveAtlasAuthority({
      actor: { id: 'member-a', authenticated: true }, tenantId: 'tenant-a', ownerEmail,
      memberships: [{ id: 'membership', actorId: 'member-a', tenantId: 'tenant-a', role: 'admin', status }]
    });
    assert.equal(authority.tenantRole, null);
    assert.throws(() => requireTenantRole(authority, 'tenant-a'), error => error.code === 'TENANT_ROLE_REQUIRED');
  }
});

test('owner identity configuration fails closed when absent or malformed', () => {
  assert.equal(normalizeAtlasEmail('not-an-email'), null);
  assert.equal(resolveAtlasAuthority({ actor: { id: 'khan', authenticated: true, email: ownerEmail, emailVerified: true }, ownerEmail: '' }).globalRole, 'none');
});
