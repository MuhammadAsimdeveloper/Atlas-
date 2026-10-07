import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashIp, hashOpaqueToken, hashPassword, hashRateKey, isAllowedOrigin, normalizeEmail, normalizeIndustryKey, normalizeTimeZone,
  parseCookies, serializeAuthCookies, validateCustomRole, verifyCsrf, verifyPassword
} from './auth-contracts.mjs';

test('identity inputs are normalized and bounded for US service workspaces', () => {
  assert.equal(normalizeEmail('  KHAN@Example.NET  '), 'khan@example.net');
  assert.equal(normalizeEmail('invalid'), null);
  assert.equal(normalizeIndustryKey('home_services'), 'home_services');
  assert.equal(normalizeIndustryKey('platform_owner'), null);
  assert.equal(normalizeIndustryKey(undefined), 'home_services');
  assert.equal(normalizeTimeZone('America/Chicago'), 'America/Chicago');
  assert.equal(normalizeTimeZone('not-a-time-zone'), null);
  assert.equal(normalizeTimeZone(undefined), 'America/Los_Angeles');
});

test('stored authentication limit and IP identifiers are secret-keyed HMAC digests', () => {
  const key = hashRateKey('secret-a', 'login', '192.0.2.1', 'person@example.net');
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(hashRateKey('secret-a', 'login', '192.0.2.1', 'person@example.net'), key);
  assert.notEqual(hashRateKey('secret-b', 'login', '192.0.2.1', 'person@example.net'), key);
  assert.notEqual(hashIp('secret-a', '192.0.2.1'), hashIp('secret-b', '192.0.2.1'));
  assert.equal(hashIp('secret-a', ''), null);
});

test('password storage uses parameter-pinned scrypt and verifies without timing-safe shortcuts', async () => {
  const hash = await hashPassword('a-long-private-password-2026');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('a-long-private-password-2026', hash), true);
  assert.equal(await verifyPassword('different-private-password', hash), false);
  assert.equal(await verifyPassword('a-long-private-password-2026', 'plaintext-password'), false);
  await assert.rejects(hashPassword('short'), { code: 'invalid_password' });
});

test('session cookies are HttpOnly, Strict, host-only in production and CSRF is double-submit bound', async () => {
  const cookies = serializeAuthCookies('opaque-session', 'csrf-value', 900, { NODE_ENV: 'production' });
  assert.match(cookies[0], /^__Host-atlas_session=/);
  assert.match(cookies[0], /HttpOnly/);
  assert.match(cookies[0], /Secure/);
  assert.match(cookies[0], /SameSite=Strict/);
  assert.doesNotMatch(cookies[1], /HttpOnly/);
  const env = { NODE_ENV: 'development', ATLAS_PUBLIC_ORIGIN: '' };
  const req = { method: 'POST', headers: { origin: 'https://atlas.test', host: 'atlas.test', cookie: 'atlas_csrf=known-token', 'x-atlas-csrf': 'known-token' }, socket: { encrypted: true } };
  const session = { csrfHash: hashOpaqueToken('known-token') };
  assert.equal(isAllowedOrigin(req, env), true);
  assert.equal(await verifyCsrf(req, session, env), true);
  req.headers['x-atlas-csrf'] = 'different-token';
  assert.equal(await verifyCsrf(req, session, env), false);
  req.headers.origin = 'https://attacker.example';
  assert.equal(await verifyCsrf(req, session, env), false);
});

test('custom tenant roles accept only the fixed non-platform permission catalog', () => {
  const role = validateCustomRole({ key: 'custom:service-coordinator', name: 'Service coordinator', permissions: ['contacts.read', 'workflows.read', 'contacts.read'] });
  assert.deepEqual(role.permissions, ['contacts.read', 'workflows.read']);
  assert.throws(() => validateCustomRole({ key: 'platform_owner', name: 'Global owner', permissions: [] }), { code: 'invalid_role_key' });
  const copilotRole = validateCustomRole({ key: 'custom:copilot-manager', name: 'Copilot manager', permissions: ['copilot.manage'] });
  assert.deepEqual(copilotRole.permissions, ['copilot.manage']);
  assert.throws(() => validateCustomRole({ key: 'custom:danger', name: 'Danger', permissions: ['platform.admin'] }), { code: 'invalid_role_permissions' });
});

test('cookie parser ignores duplicates and malformed names instead of trusting later values', () => {
  const cookies = parseCookies('atlas_session=first; atlas_session=second; bad name=x; atlas_csrf=ok');
  assert.equal(cookies.get('atlas_session'), 'first');
  assert.equal(cookies.get('atlas_csrf'), 'ok');
  assert.equal(cookies.has('bad name'), false);
});
