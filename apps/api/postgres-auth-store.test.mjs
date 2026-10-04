import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresAuthStore } from './postgres-auth-store.mjs';

const safeRole = Object.freeze({
  role_name: 'atlas_app',
  rolsuper: false,
  rolbypassrls: false,
  rolcreatedb: false,
  rolcreaterole: false,
  has_role_memberships: false,
  owns_atlas_relation: false,
});

function storeReturning(role) {
  return new PostgresAuthStore({ query: async () => ({ rows: role ? [role] : [] }) });
}

test('production database role check accepts only the restricted atlas_app role', async () => {
  assert.equal(await storeReturning(safeRole).assertSafeRuntimeRole(), true);
  for (const [name, change] of [
    ['wrong role', { role_name: 'atlas' }],
    ['superuser', { rolsuper: true }],
    ['row-level security bypass', { rolbypassrls: true }],
    ['database creation privilege', { rolcreatedb: true }],
    ['role creation privilege', { rolcreaterole: true }],
    ['role membership', { has_role_memberships: true }],
    ['Atlas table ownership', { owns_atlas_relation: true }],
  ]) {
    await assert.rejects(
      storeReturning({ ...safeRole, ...change }).assertSafeRuntimeRole(),
      /restricted atlas_app role/,
      name,
    );
  }
  await assert.rejects(storeReturning(null).assertSafeRuntimeRole(), /restricted atlas_app role/, 'missing role fails closed');
});
